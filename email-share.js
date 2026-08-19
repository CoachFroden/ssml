const FIREBASE_APP_URL = "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
const FIRESTORE_URL = "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
const PDFLIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
const LARGE_SEPARATE_PDF_BYTES = 8 * 1024 * 1024;
const EMAIL_RASTER_SCALE = 1.75;
const EMAIL_JPEG_QUALITY = 0.72;

let preparedFiles = [];
let preparing = false;

function toast(message, type = "ok") {
  const region = document.querySelector("#toast-region");
  if (!region) return;
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.textContent = message;
  region.append(element);
  setTimeout(() => element.remove(), 4000);
}

function escapeHtml(value = "") {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function ensureStyles() {
  if (document.querySelector("#email-share-styles")) return;
  const style = document.createElement("style");
  style.id = "email-share-styles";
  style.textContent = `
    #email-selected-parts { grid-column: 2; white-space: nowrap; }
    #email-share-dialog > div { padding: 1.7rem; overflow: auto; max-height: 90vh; }
    #email-share-dialog header { gap: 1rem; }
    #email-share-dialog header > div { min-width: 0; }
    #email-share-dialog .eyebrow { margin-bottom: .45rem; }
    #email-share-summary { margin: .85rem 0 1rem; line-height: 1.45; }
    #email-share-files { max-height: 42vh; overflow: auto; margin: .8rem 0; }
    #email-share-files .file-row { grid-template-columns: 1fr; padding: .85rem .9rem; }
    #email-share-files .file-row strong { overflow-wrap: anywhere; }
    #email-share-dialog footer { flex-wrap: wrap; }
    @media (max-width: 520px) {
      #email-selected-parts { grid-column: auto; width: 100%; min-height: 44px; }
      #email-share-dialog { width: calc(100% - 1.5rem); max-height: calc(100dvh - 1.5rem); border-radius: 16px; }
      #email-share-dialog > div { padding: 1.15rem; max-height: calc(100dvh - 1.5rem); }
      #email-share-dialog header .icon-btn { flex: 0 0 40px; }
      #email-share-dialog footer { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; }
      #email-share-dialog footer .btn { width: 100%; padding: .8rem .7rem; }
    }
  `;
  document.head.append(style);
}

function ensureDialog() {
  if (document.querySelector("#email-share-dialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "email-share-dialog";
  dialog.className = "modal small-modal";
  dialog.innerHTML = `
    <div>
      <header>
        <div><p class="eyebrow green">Del notar</p><h2>Send på e-post</h2></div>
        <button class="icon-btn email-share-close" type="button" aria-label="Lukk">×</button>
      </header>
      <p id="email-share-summary" class="muted">Klargjer PDF-filer …</p>
      <div id="email-share-files" class="file-list"></div>
      <aside class="info-note"><span>i</span><p><strong>På iPhone/iPad:</strong><br>Trykk «Del PDF-ar» og vel <strong>Mail</strong>. PDF-filene blir lagde ved som vedlegg.</p></aside>
      <footer>
        <button class="btn btn-ghost email-share-close" type="button">Avbryt</button>
        <button id="share-email-now" class="btn btn-primary" type="button">Del PDF-ar</button>
      </footer>
    </div>`;
  document.body.append(dialog);
  dialog.querySelectorAll(".email-share-close").forEach(button => button.addEventListener("click", () => dialog.close()));
  dialog.querySelector("#share-email-now").addEventListener("click", sharePreparedFiles);
}

function selectedRows() {
  return [...document.querySelectorAll("#part-list .part-select-row")]
    .filter(row => row.querySelector('input[type="checkbox"]')?.checked)
    .map(row => {
      const name = row.querySelector("strong")?.textContent?.trim() || "Stemme";
      const detail = row.querySelector("small")?.textContent?.trim() || "";
      const fileName = detail.split(" · PDF-forbetring:")[0].trim();
      return { name, fileName };
    });
}

function updateButtonState() {
  const button = document.querySelector("#email-selected-parts");
  if (!button || preparing) return;
  const count = selectedRows().length;
  const disabled = count === 0;
  const label = `✉ Send på e-post (${count})`;
  if (button.disabled !== disabled) button.disabled = disabled;
  if (button.textContent !== label) button.textContent = label;
}

function ensureButton() {
  ensureStyles();
  ensureDialog();
  const tools = document.querySelector(".part-selection-tools");
  if (!tools || tools.querySelector("#email-selected-parts")) {
    updateButtonState();
    return;
  }
  const button = document.createElement("button");
  button.id = "email-selected-parts";
  button.className = "btn btn-ghost";
  button.type = "button";
  button.addEventListener("click", prepareShare);
  tools.append(button);
  updateButtonState();
}

async function getCurrentSong(selected) {
  const [{ getApps, getApp }, firestore] = await Promise.all([
    import(FIREBASE_APP_URL),
    import(FIRESTORE_URL)
  ]);
  if (!getApps().length) throw new Error("Firebase er ikkje klart enno.");
  const db = firestore.getFirestore(getApp());
  const title = document.querySelector("#song-detail .detail-header h1")?.textContent?.trim();
  if (!title) throw new Error("Kunne ikkje finne den opne songen.");
  const snapshot = await firestore.getDocs(
    firestore.query(firestore.collection(db, "songs"), firestore.where("title", "==", title))
  );
  const candidates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  if (!candidates.length) throw new Error("Kunne ikkje finne songen i Firebase.");
  const score = song => selected.reduce((sum, item) => sum + ((song.parts || []).some(part => part.fileName === item.fileName) ? 1 : 0), 0);
  candidates.sort((a, b) => score(b) - score(a));
  const song = candidates[0];
  if (score(song) < selected.length) throw new Error("Kunne ikkje kople alle valde stemmer til PDF-filene.");
  return song;
}

function useOriginalSource() {
  const toggle = document.querySelector("#toggle-pdf-source");
  return Boolean(toggle && /Vis forbetra/i.test(toggle.textContent || ""));
}

function sourceUrl(part, original) {
  if (original && part.originalUrl) return part.originalUrl;
  return part.enhancedUrl || part.url || part.originalUrl || "";
}

function safeFileName(song, part) {
  return `${song.title || "Notar"} - ${part.name || "Stemme"}.pdf`
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function safeWholeFileName(song, part) {
  const originalName = String(part?.fileName || "").trim();
  const name = /\.pdf$/i.test(originalName) ? originalName : `${song.title || "Notar"}.pdf`;
  return name
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

async function getPdfJsDocument(entry, url) {
  if (entry.pdfjs) return entry.pdfjs;
  const pdfjs = await import(PDFJS_URL);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  if (entry.blob) {
    const data = new Uint8Array(await entry.blob.arrayBuffer());
    entry.pdfjs = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  } else {
    entry.pdfjs = await pdfjs.getDocument({ url, verbosity: 0 }).promise;
  }
  return entry.pdfjs;
}

async function rasterizePartPdf(source, pages, fileName, options = {}) {
  const { PDFDocument } = await import(PDFLIB_URL);
  const output = await PDFDocument.create();
  const scale = Number(options.scale || 2);
  const quality = Number(options.quality ?? 0.82);
  const wanted = pages?.length ? pages : Array.from({ length: source.numPages }, (_, index) => index + 1);
  for (const pageNo of wanted) {
    if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > source.numPages) continue;
    const page = await source.getPage(pageNo);
    const baseViewport = page.getViewport({ scale: 1 });
    const renderViewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(renderViewport.width);
    canvas.height = Math.ceil(renderViewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport: renderViewport }).promise;
    const jpgData = canvas.toDataURL("image/jpeg", quality);
    const image = await output.embedJpg(jpgData);
    const outPage = output.addPage([baseViewport.width, baseViewport.height]);
    outPage.drawImage(image, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height });
    canvas.width = 1;
    canvas.height = 1;
  }
  if (!output.getPageCount()) throw new Error("Ingen gyldige sider kunne klargjerast.");
  return new File([await output.save({ useObjectStreams: true })], fileName, { type: "application/pdf" });
}

async function releaseCachedSource(sourceCache, url) {
  const entry = sourceCache.get(url);
  if (!entry) return;
  if (entry.pdfjs) {
    try { await entry.pdfjs.destroy(); } catch {}
    entry.pdfjs = null;
  }
  entry.pdf = null;
  entry.blob = null;
  sourceCache.delete(url);
}

async function prepareLargeSeparatePdf(entry, url, fileName) {
  const originalSize = entry.blob?.size || 0;
  const source = await getPdfJsDocument(entry, url);
  const compact = await rasterizePartPdf(source, null, fileName, {
    scale: EMAIL_RASTER_SCALE,
    quality: EMAIL_JPEG_QUALITY
  });
  if (!originalSize || compact.size < originalSize) return compact;
  return new File([entry.blob], fileName, { type: "application/pdf" });
}

async function buildFiles(song, selected, onProgress = () => {}) {
  const original = useOriginalSource();
  const selectedParts = selected.map(item => {
    const matches = (song.parts || []).filter(part => part.fileName === item.fileName);
    return matches.find(part => part.name === item.name) || matches[0];
  });
  if (selectedParts.some(part => !part)) throw new Error("Ei vald stemme manglar i arkivet.");

  const sourceCounts = new Map();
  for (const part of song.parts || []) {
    const url = sourceUrl(part, original);
    if (url) sourceCounts.set(url, (sourceCounts.get(url) || 0) + 1);
  }

  const selectedSourceCounts = new Map();
  for (const part of selectedParts) {
    const url = sourceUrl(part, original);
    if (url) selectedSourceCounts.set(url, (selectedSourceCounts.get(url) || 0) + 1);
  }

  const sourceCache = new Map();
  const getSource = async url => {
    if (sourceCache.has(url)) return sourceCache.get(url);
    const response = await fetch(url);
    if (!response.ok) throw new Error("Kunne ikkje hente ei av PDF-filene.");
    const blob = await response.blob();
    const entry = { blob, pdf: null, pdfjs: null, encrypted: false };
    sourceCache.set(url, entry);
    return entry;
  };

  const files = [];
  const sentWholeSources = new Set();
  try {
    for (let index = 0; index < selectedParts.length; index++) {
      const part = selectedParts[index];
      onProgress(index, selectedParts.length, part.name);
      const url = sourceUrl(part, original);
      if (!url) throw new Error(`«${part.name}» manglar PDF-fil.`);

      const sourcePartCount = sourceCounts.get(url) || 0;
      const sharedSource = sourcePartCount > 1;
      const wholeSourceSelected = sharedSource && (selectedSourceCounts.get(url) || 0) === sourcePartCount;
      if (wholeSourceSelected && sentWholeSources.has(url)) continue;

      const entry = await getSource(url);
      const fileName = safeFileName(song, part);

      if (wholeSourceSelected) {
        files.push(new File([entry.blob], safeWholeFileName(song, part), { type: "application/pdf" }));
        sentWholeSources.add(url);
        await releaseCachedSource(sourceCache, url);
        continue;
      }

      if (!sharedSource) {
        if (entry.blob.size > LARGE_SEPARATE_PDF_BYTES) {
          files.push(await prepareLargeSeparatePdf(entry, url, fileName));
        } else {
          files.push(new File([entry.blob], fileName, { type: "application/pdf" }));
        }
        await releaseCachedSource(sourceCache, url);
        continue;
      }

      const requestedPages = part.pageNumbers?.length ? part.pageNumbers : null;
      const { PDFDocument } = await import(PDFLIB_URL);
      if (!entry.pdf && !entry.encrypted) {
        try {
          entry.pdf = await PDFDocument.load(await entry.blob.arrayBuffer());
        } catch (error) {
          if (/encrypted/i.test(String(error?.message || error))) entry.encrypted = true;
          else throw error;
        }
      }

      if (entry.encrypted) {
        const source = await getPdfJsDocument(entry, url);
        files.push(await rasterizePartPdf(source, requestedPages, fileName));
        continue;
      }

      const pages = requestedPages || Array.from({ length: entry.pdf.getPageCount() }, (_, pageIndex) => pageIndex + 1);
      const validPages = pages.filter(page => Number.isInteger(page) && page >= 1 && page <= entry.pdf.getPageCount());
      if (!validPages.length) throw new Error(`Ingen gyldige sider funne for «${part.name}».`);
      const output = await PDFDocument.create();
      const copied = await output.copyPages(entry.pdf, validPages.map(page => page - 1));
      copied.forEach(page => output.addPage(page));
      files.push(new File([await output.save({ useObjectStreams: true })], fileName, { type: "application/pdf" }));
    }
    onProgress(selectedParts.length, selectedParts.length, "");
    return files;
  } finally {
    for (const url of [...sourceCache.keys()]) await releaseCachedSource(sourceCache, url);
  }
}

async function prepareShare() {
  const selected = selectedRows();
  if (!selected.length) {
    toast("Vel minst éi stemme.", "error");
    return;
  }
  if (!navigator.share) {
    toast("Denne nettlesaren støttar ikkje PDF-vedlegg via delingsmenyen.", "error");
    return;
  }

  const button = document.querySelector("#email-selected-parts");
  preparing = true;
  button.disabled = true;
  button.textContent = "Klargjer PDF-ar …";
  try {
    const song = await getCurrentSong(selected);
    preparedFiles = await buildFiles(song, selected, (done, total, name) => {
      const next = Math.min(total, done + 1);
      button.textContent = done >= total ? "Klargjort" : `Klargjer ${next} av ${total} …`;
      if (name && done < total) button.title = name;
    });
    if (navigator.canShare && !navigator.canShare({ files: preparedFiles })) {
      throw new Error("Nettlesaren kan ikkje dele desse PDF-filene som vedlegg.");
    }
    const totalMb = preparedFiles.reduce((sum, file) => sum + file.size, 0) / 1048576;
    const sizeWarning = totalMb > 25 ? " Dette er mykje for éin e-post; vurder færre stemmer om Mail avviser sendinga." : "";
    document.querySelector("#email-share-summary").textContent = `${preparedFiles.length} PDF-fil(er), ${totalMb.toFixed(1)} MB. Trykk «Del PDF-ar» og vel Mail.${sizeWarning}`;
    const list = document.querySelector("#email-share-files");
    list.innerHTML = "";
    preparedFiles.forEach(file => {
      const row = document.createElement("div");
      row.className = "file-row";
      row.innerHTML = `<div><strong>▧ ${escapeHtml(file.name)}</strong><small>${(file.size / 1048576).toFixed(1)} MB</small></div>`;
      list.append(row);
    });
    document.querySelector("#email-share-dialog").showModal();
  } catch (error) {
    console.error(error);
    preparedFiles = [];
    toast(error.message || "Kunne ikkje klargjere PDF-ane for e-post.", "error");
  } finally {
    preparing = false;
    button.title = "";
    updateButtonState();
  }
}

async function sharePreparedFiles() {
  if (!preparedFiles.length) {
    toast("Ingen PDF-filer er klargjorde.", "error");
    return;
  }
  try {
    if (navigator.canShare && !navigator.canShare({ files: preparedFiles })) {
      throw new Error("Nettlesaren kan ikkje dele desse PDF-filene som vedlegg.");
    }
    await navigator.share({ files: preparedFiles });
    document.querySelector("#email-share-dialog")?.close();
    preparedFiles = [];
    toast("PDF-ane blei delte til vald app.");
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error(error);
    toast(error.message || "Kunne ikkje opne delingsmenyen.", "error");
  }
}

const observer = new MutationObserver(() => ensureButton());
observer.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener("change", event => {
  if (event.target.matches?.('#part-list input[type="checkbox"]')) setTimeout(updateButtonState, 0);
});
ensureButton();
