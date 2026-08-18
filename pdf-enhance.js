const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
const PDFLIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";

export async function enhancePdfFiles(files, onProgress = () => {}) {
  const results = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    onProgress(`Kontrollerer ${file.name} (${index + 1} av ${files.length}) …`);
    try {
      results.push(await enhancePdf(file, message => onProgress(`${file.name}: ${message}`)));
    } catch (error) {
      console.warn(`PDF-forbetring vart hoppa over for ${file.name}.`, error);
      results.push({ original: file, enhanced: null, changed: false, error });
    }
  }
  return results;
}

async function enhancePdf(file, onProgress) {
  const [pdfjs, pdfLib] = await Promise.all([import(PDFJS_URL), import(PDFLIB_URL)]);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  const bytes = await file.arrayBuffer();
  const sourcePdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const sourceForCopy = await pdfLib.PDFDocument.load(bytes.slice(0));
  const output = await pdfLib.PDFDocument.create();
  let changed = false;

  for (let pageIndex = 0; pageIndex < sourcePdf.numPages; pageIndex++) {
    const pageNo = pageIndex + 1;
    onProgress(`forbetrar side ${pageNo} av ${sourcePdf.numPages} …`);
    const page = await sourcePdf.getPage(pageNo);
    if (!(await isScannedPage(page, pdfjs))) {
      const [copied] = await output.copyPages(sourceForCopy, [pageIndex]);
      output.addPage(copied);
      continue;
    }

    const viewport = page.getViewport({ scale: 2.35 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;

    const cleaned = cleanScan(canvas);
    const jpegBytes = await canvasToBytes(cleaned);
    const image = await output.embedJpg(jpegBytes);
    const originalViewport = page.getViewport({ scale: 1 });
    const outputPage = output.addPage([originalViewport.width, originalViewport.height]);
    const fit = Math.min(originalViewport.width / image.width, originalViewport.height / image.height);
    const imageWidth = image.width * fit;
    const imageHeight = image.height * fit;
    outputPage.drawImage(image, {
      x: (originalViewport.width - imageWidth) / 2,
      y: (originalViewport.height - imageHeight) / 2,
      width: imageWidth,
      height: imageHeight
    });
    changed = true;
    canvas.width = canvas.height = cleaned.width = cleaned.height = 1;
  }

  if (!changed) return { original: file, enhanced: null, changed: false };
  const outputBytes = await output.save({ useObjectStreams: true });
  const enhanced = new File([outputBytes], file.name, { type: "application/pdf", lastModified: Date.now() });
  return { original: file, enhanced, changed: true };
}

async function isScannedPage(page, pdfjs) {
  const operators = await page.getOperatorList();
  const imageOperators = new Set([
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintSolidColorImageMask
  ]);
  const imageCount = operators.fnArray.reduce((count, operation) => count + (imageOperators.has(operation) ? 1 : 0), 0);
  if (!imageCount) return false;
  const text = await page.getTextContent();
  const visibleText = text.items.filter(item => String(item.str || "").trim()).length;
  return visibleText < 25 || operators.fnArray.length < 300;
}

function cleanScan(source) {
  // Scans such as the supplied flute part have a thin dark frame along the
  // physical paper edge. Trim only that fixed outer safety margin; never use
  // musical content inside the page to decide how much to remove.
  const framed = trimScannerFrame(source);
  const crop = findDarkEdgeCrop(framed);
  const cropped = cropCanvas(framed, crop);

  const angle = estimateDeskew(cropped);
  const straight = Math.abs(angle) >= 0.2 ? rotateOnWhite(cropped, angle) : cropped;
  normalizeBackground(straight);
  removeEdgeArtifacts(straight);
  // Deskewing can expose a scanner border that was not at the outermost edge
  // of the original image. Run the crop test once more after cleanup.
  const finalCrop = findDarkEdgeCrop(straight);
  return finalCrop.x || finalCrop.y || finalCrop.width !== straight.width || finalCrop.height !== straight.height
    ? cropCanvas(straight, finalCrop)
    : straight;
}

function trimScannerFrame(source) {
  const context = source.getContext("2d", { willReadFrequently: true });
  const { width, height } = source;
  const pixels = context.getImageData(0, 0, width, height).data;
  const hasFrame = [
    lineStats(pixels, width, height, "row", 0),
    lineStats(pixels, width, height, "row", height - 1),
    lineStats(pixels, width, height, "column", 0),
    lineStats(pixels, width, height, "column", width - 1)
  ].filter(Boolean).length >= 2;
  if (!hasFrame) return source;
  const margin = Math.max(4, Math.round(Math.min(width, height) * 0.008));
  return cropCanvas(source, { x: margin, y: margin, width: width - margin * 2, height: height - margin * 2 });
}

function findDarkEdgeCrop(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const sample = context.getImageData(0, 0, width, height).data;
  const rowBad = y => lineStats(sample, width, height, "row", y);
  const colBad = x => lineStats(sample, width, height, "column", x);
  const maxY = Math.floor(height * 0.09);
  const maxX = Math.floor(width * 0.09);
  let top = 0, bottom = height - 1, left = 0, right = width - 1;
  const outermostBandExtent = (limit, at) => {
    let extent = null;
    for (let offset = 0; offset < limit; offset++) if (at(offset)) extent = offset;
    return extent;
  };
  // A scanner border may be separated from the physical edge by a thin white
  // strip. Find a broad dark band anywhere in the outer margin, not just at 0.
  const topBand = outermostBandExtent(maxY, rowBad);
  const bottomBand = outermostBandExtent(maxY, offset => rowBad(height - 1 - offset));
  const leftBand = outermostBandExtent(maxX, colBad);
  const rightBand = outermostBandExtent(maxX, offset => colBad(width - 1 - offset));
  if (topBand !== null) top = topBand + 1;
  if (bottomBand !== null) bottom = height - 2 - bottomBand;
  if (leftBand !== null) left = leftBand + 1;
  if (rightBand !== null) right = width - 2 - rightBand;
  const padding = Math.round(Math.min(width, height) * 0.006);
  left = Math.max(0, left - padding); top = Math.max(0, top - padding);
  right = Math.min(width - 1, right + padding); bottom = Math.min(height - 1, bottom + padding);
  if (right - left < width * 0.75 || bottom - top < height * 0.75) return { x: 0, y: 0, width, height };
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function cropCanvas(source, crop) {
  const output = document.createElement("canvas");
  output.width = crop.width;
  output.height = crop.height;
  const context = output.getContext("2d", { alpha: false, willReadFrequently: true });
  context.fillStyle = "white";
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return output;
}

function lineStats(data, width, height, direction, position) {
  const length = direction === "row" ? width : height;
  const step = Math.max(1, Math.floor(length / 450));
  let dark = 0, total = 0, sum = 0;
  for (let point = 0; point < length; point += step) {
    const x = direction === "row" ? point : position;
    const y = direction === "row" ? position : point;
    const index = (y * width + x) * 4;
    const gray = data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114;
    sum += gray; total++; if (gray < 125) dark++;
  }
  return sum / total < 178 || dark / total > .34;
}

function estimateDeskew(canvas) {
  const scale = Math.min(1, 700 / canvas.width);
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  const small = document.createElement("canvas");
  small.width = width; small.height = height;
  const context = small.getContext("2d", { willReadFrequently: true });
  context.drawImage(canvas, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  const points = [];
  for (let y = 0; y < height; y += 3) for (let x = 0; x < width; x += 3) {
    const index = (y * width + x) * 4;
    const gray = data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114;
    if (gray < 105) points.push([x, y]);
  }
  if (points.length < 150) return 0;
  let bestAngle = 0, bestScore = -1, zeroScore = 0;
  for (let angle = -2.5; angle <= 2.501; angle += .25) {
    const tangent = Math.tan(angle * Math.PI / 180);
    const rows = new Uint32Array(height + 12);
    for (const [x, y] of points) {
      const row = Math.round(y + tangent * (x - width / 2)) + 6;
      if (row >= 0 && row < rows.length) rows[row]++;
    }
    let score = 0;
    for (const value of rows) score += value * value;
    if (Math.abs(angle) < .01) zeroScore = score;
    if (score > bestScore) { bestScore = score; bestAngle = angle; }
  }
  return bestScore > zeroScore * 1.012 ? bestAngle : 0;
}

function rotateOnWhite(source, angle) {
  const output = document.createElement("canvas");
  output.width = source.width; output.height = source.height;
  const context = output.getContext("2d", { alpha: false });
  context.fillStyle = "white"; context.fillRect(0, 0, output.width, output.height);
  context.translate(output.width / 2, output.height / 2);
  context.rotate(angle * Math.PI / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return output;
}

function normalizeBackground(canvas) {
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const backgroundCanvas = document.createElement("canvas");
  const backgroundWidth = 120;
  backgroundCanvas.width = backgroundWidth;
  backgroundCanvas.height = Math.max(1, Math.round(canvas.height * backgroundWidth / canvas.width));
  const backgroundContext = backgroundCanvas.getContext("2d", { willReadFrequently: true });
  backgroundContext.filter = "blur(6px)";
  backgroundContext.drawImage(canvas, 0, 0, backgroundCanvas.width, backgroundCanvas.height);
  const background = backgroundContext.getImageData(0, 0, backgroundCanvas.width, backgroundCanvas.height).data;
  const histogram = new Uint32Array(256);
  const corrected = new Uint8Array(canvas.width * canvas.height);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const pixel = y * canvas.width + x;
    const index = pixel * 4;
    const bx = Math.min(backgroundCanvas.width - 1, Math.floor(x * backgroundCanvas.width / canvas.width));
    const by = Math.min(backgroundCanvas.height - 1, Math.floor(y * backgroundCanvas.height / canvas.height));
    const backgroundIndex = (by * backgroundCanvas.width + bx) * 4;
    const gray = image.data[index] * .299 + image.data[index + 1] * .587 + image.data[index + 2] * .114;
    const localBackground = background[backgroundIndex] * .299 + background[backgroundIndex + 1] * .587 + background[backgroundIndex + 2] * .114;
    const value = Math.max(0, Math.min(255, Math.round(gray + (246 - localBackground) * .82)));
    corrected[pixel] = value; histogram[value]++;
  }
  const low = percentile(histogram, corrected.length, .012);
  const high = Math.max(low + 40, percentile(histogram, corrected.length, .91));
  for (let pixel = 0; pixel < corrected.length; pixel++) {
    const index = pixel * 4;
    let value = (corrected[pixel] - low) * 255 / (high - low);
    value = Math.max(0, Math.min(255, value));
    if (value > 232) value = 255;
    image.data[index] = image.data[index + 1] = image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function removeEdgeArtifacts(canvas) {
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const total = canvas.width * canvas.height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0, tail = 0;
  const grayAt = pixel => image.data[pixel * 4];
  const enqueue = pixel => {
    if (pixel < 0 || pixel >= total || visited[pixel] || grayAt(pixel) >= 246) return;
    visited[pixel] = 1; queue[tail++] = pixel;
  };
  for (let x = 0; x < canvas.width; x++) { enqueue(x); enqueue((canvas.height - 1) * canvas.width + x); }
  for (let y = 0; y < canvas.height; y++) { enqueue(y * canvas.width); enqueue(y * canvas.width + canvas.width - 1); }
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % canvas.width;
    if (x > 0) enqueue(pixel - 1);
    if (x < canvas.width - 1) enqueue(pixel + 1);
    if (pixel >= canvas.width) enqueue(pixel - canvas.width);
    if (pixel < total - canvas.width) enqueue(pixel + canvas.width);
  }
  for (let index = 0; index < tail; index++) {
    const pixel = queue[index] * 4;
    image.data[pixel] = image.data[pixel + 1] = image.data[pixel + 2] = image.data[pixel + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function percentile(histogram, total, fraction) {
  const target = total * fraction;
  let count = 0;
  for (let value = 0; value < histogram.length; value++) {
    count += histogram[value];
    if (count >= target) return value;
  }
  return 255;
}

function canvasToBytes(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(async blob => {
    if (!blob) { reject(new Error("Kunne ikkje lage forbetra PDF-side.")); return; }
    resolve(new Uint8Array(await blob.arrayBuffer()));
  }, "image/jpeg", .94));
}
