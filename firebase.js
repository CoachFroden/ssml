import * as core from "./firebase-core.js?v=26";

export * from "./firebase-core.js?v=26";

const EMAIL_PDF_SERVICE_URL = "https://ssml-email-pdf-1091683313021.europe-west1.run.app";

async function fetchWithTimeout(resource, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("PDF-behandlinga brukte for lang tid. Prøv igjen.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isAiJsonSyntaxError(error) {
  const message = String(error?.message || error || "");
  return error instanceof SyntaxError || /JSON|double-quoted property name|Unexpected token|Expected property name|Unterminated string/i.test(message);
}

async function withAiJsonRetry(operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isAiJsonSyntaxError(error)) throw error;
    console.warn("AI returnerte ugyldig JSON. Prøver analysen éin gong til.", error);
    await new Promise(resolve => setTimeout(resolve, 300));
    try {
      return await operation();
    } catch (retryError) {
      if (!isAiJsonSyntaxError(retryError)) throw retryError;
      const finalError = new Error("AI svarte med ugyldig dataformat to gonger. Prøv analysen på nytt.");
      finalError.cause = retryError;
      throw finalError;
    }
  }
}

function normalizePartName(value = "") {
  return String(value)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SCORE_PART_ALIASES = new Set([
  "dirigent",
  "dirigentpartitur",
  "conductor",
  "conductor score",
  "full score",
  "score",
  "partitur",
  "full partitur",
  "samla partitur"
]);

function isScorePartName(value = "") {
  const normalized = normalizePartName(value);
  return SCORE_PART_ALIASES.has(normalized)
    || /^conductor(?: score)?$/.test(normalized)
    || /^dirigent(?:partitur)?$/.test(normalized)
    || /^(?:full )?score$/.test(normalized);
}

function partDisplayName(part = {}) {
  return part.name || [part.instrument, part.voice].filter(Boolean).join(" ") || "Ukjend stemme";
}

const SCORE_PAGE_MARKERS = [
  /\b(?:piccolo|picc)\b/,
  /\b(?:flute|floyte|fl)\b/,
  /\boboe\b/,
  /\b(?:bassoon|fagott|bsn)\b/,
  /\b(?:clarinet|klarinett|cl)\b/,
  /\b(?:saxophone|saksofon|sax|sx)\b/,
  /\b(?:trumpet|trompet|tpt)\b/,
  /\bhorn\b/,
  /\b(?:trombone|tbn)\b/,
  /\b(?:baritone|baryton|bar)\b/,
  /\btuba\b/,
  /\b(?:percussion|slagverk|perc)\b/,
  /\b(?:mallet|melodisk|mllt)\b/,
  /\b(?:timpani|pauker|timp)\b/
];

function normalizePdfText(value = "") {
  return String(value)
    .replace(/♭/g, "b")
    .replace(/♯/g, " sharp ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function detectScorePagesInPdf(file) {
  try {
    const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    const scorePages = new Set();
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = normalizePdfText(textContent.items.map(item => item.str || "").join(" "));
        const markerCount = SCORE_PAGE_MARKERS.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
        if (markerCount >= 6 || /\b(?:instrumentation|conductor score|full score)\b/.test(text) && markerCount >= 4) {
          scorePages.add(pageNumber);
        }
      }
    } finally {
      try { await pdf.destroy(); } catch {}
    }
    return scorePages;
  } catch (error) {
    console.warn("Kunne ikkje førehandsklassifisere partitur-sider. Bruker AI-signala i staden.", error);
    return new Set();
  }
}

function normalizeScoreChunkAnalysis(analysis, pageCount, knownScorePages = []) {
  const safePageCount = Number(pageCount || 0);
  const sourceParts = (analysis?.parts || []).map(part => ({
    ...part,
    name: partDisplayName(part),
    pageNumbers: [...new Set((part.pageNumbers || [])
      .map(Number)
      .filter(number => Number.isFinite(number) && number >= 1 && (!safePageCount || number <= safePageCount)))]
      .sort((a, b) => a - b)
  }));

  const scorePages = new Set([...knownScorePages].map(Number).filter(Number.isFinite));
  if (!sourceParts.length && !scorePages.size) return analysis;

  const pageUsage = new Map();
  let scoreConfidence = 0;

  for (const part of sourceParts) {
    const name = partDisplayName(part);
    const normalizedName = normalizePartName(name) || "ukjend";
    if (isScorePartName(name)) {
      for (const page of part.pageNumbers || []) scorePages.add(page);
      scoreConfidence = Math.max(scoreConfidence, Number(part.confidence || 0));
    }
    for (const page of part.pageNumbers || []) {
      if (!pageUsage.has(page)) pageUsage.set(page, new Set());
      pageUsage.get(page).add(normalizedName);
    }
  }

  // På eit dirigentpartitur står mange instrument på same PDF-side. Dersom AI-en
  // feilaktig lagar éi stemme per notelinje, vil fleire stemmer peike på same side.
  // Fire eller fleire samtidige stemmer er eit trygt signal om at sida er partitur.
  for (const [page, names] of pageUsage) {
    if (names.size >= 4) scorePages.add(page);
  }

  // Dersom AI-en allereie har funne partitur i bolken, tek vi også med nabosider
  // som er tydeleg fleirstemmige. Det fangar opp overgangar mellom AI-bolkar.
  if (scorePages.size) {
    for (const [page, names] of pageUsage) {
      if (names.size >= 3 && [...scorePages].some(scorePage => Math.abs(scorePage - page) <= 1)) {
        scorePages.add(page);
      }
    }
  }

  const cleanedParts = [];
  for (const part of sourceParts) {
    if (isScorePartName(part.name)) {
      scoreConfidence = Math.max(scoreConfidence, Number(part.confidence || 0));
      continue;
    }
    const remainingPages = (part.pageNumbers || []).filter(page => !scorePages.has(page));
    if (!remainingPages.length) continue;
    cleanedParts.push({ ...part, pageNumbers: remainingPages });
  }

  if (scorePages.size) {
    cleanedParts.unshift({
      name: "Dirigent",
      instrument: "Dirigent",
      voice: "",
      fileName: sourceParts.find(part => isScorePartName(part.name))?.fileName || sourceParts[0]?.fileName || "",
      pageNumbers: [...scorePages].sort((a, b) => a - b),
      confidence: Math.max(scoreConfidence, 0.95)
    });
  }

  return { ...analysis, parts: cleanedParts };
}

async function getFirebaseIdToken() {
  const authModule = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
  const user = authModule.getAuth().currentUser;
  if (!user) throw new Error("Du må vere innlogga for å klargjere PDF-en for AI-analyse.");
  return user.getIdToken();
}

async function getPdfPageCountWithPdfJs(file) {
  const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  try {
    return pdf.numPages;
  } finally {
    try { await pdf.destroy(); } catch {}
  }
}

function songStoragePathForFile(song, file) {
  const parts = song?.parts || [];
  const match = parts.find(part => part.fileName === file.name) || (parts.length === 1 ? parts[0] : null);
  return match?.originalStoragePath || match?.storagePath || "";
}

async function splitCombinedPdfOnServer(song, file) {
  const storagePath = songStoragePathForFile(song, file);
  if (!storagePath) throw new Error(`Fann ikkje lagringsstien til «${file.name}».`);

  const pageCount = await getPdfPageCountWithPdfJs(file);
  if (!pageCount) throw new Error(`PDF-en «${file.name}» har ingen sider.`);

  const token = await getFirebaseIdToken();
  const chunks = [];
  const maxPages = 6;

  for (let start = 1; start <= pageCount; start += maxPages) {
    const end = Math.min(start + maxPages - 1, pageCount);
    const pages = Array.from({ length: end - start + 1 }, (_, index) => start + index);
    const response = await fetchWithTimeout(`${EMAIL_PDF_SERVICE_URL}/compress`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        storagePath,
        fileName: `${file.name.replace(/\.pdf$/i, "")}-ai-${start}-${end}.pdf`,
        pages
      })
    }, 90000);

    if (!response.ok) {
      let message = `Serveren klarte ikkje å klargjere side ${start}–${end}.`;
      try {
        const payload = await response.json();
        if (payload?.error) message = payload.error;
      } catch {}
      throw new Error(message);
    }

    const blob = await response.blob();
    chunks.push({
      file: new File([blob], `${file.name.replace(/\.pdf$/i, "")}-ai-${start}-${end}.pdf`, { type: "application/pdf" }),
      pageOffset: start - 1,
      pageCount: pages.length
    });
  }

  return chunks;
}

async function splitCombinedPdf(song, file) {
  try {
    const { PDFDocument } = await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
    const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
    const pageCount = source.getPageCount();
    if (!pageCount) throw new Error(`PDF-en «${file.name}» har ingen sider.`);

    // Små bolkar gir mykje kortare og meir stabilt JSON-svar frå AI-en.
    const maxPages = 6;
    const maxBytes = 8 * 1024 * 1024;
    const chunks = [];
    let start = 0;

    while (start < pageCount) {
      let count = Math.min(maxPages, pageCount - start);
      let chunkFile = null;

      while (count >= 1) {
        const output = await PDFDocument.create();
        const indices = Array.from({ length: count }, (_, index) => start + index);
        const pages = await output.copyPages(source, indices);
        pages.forEach(page => output.addPage(page));
        const bytes = await output.save({ useObjectStreams: true });
        if (bytes.byteLength <= maxBytes || count === 1) {
          chunkFile = new File(
            [bytes],
            `${file.name.replace(/\.pdf$/i, "")}-ai-${start + 1}-${start + count}.pdf`,
            { type: "application/pdf" }
          );
          break;
        }
        count = Math.max(1, Math.floor(count / 2));
      }

      if (!chunkFile) throw new Error("AI_ANALYSIS_CHUNK_FAILED");
      chunks.push({ file: chunkFile, pageOffset: start, pageCount: count });
      start += count;
    }

    return chunks;
  } catch (error) {
    console.warn("PDF-en kunne ikkje delast lokalt. Bruker serveren til å reparere og dele han for AI-analyse.", error);
    return splitCombinedPdfOnServer(song, file);
  }
}

function mergeChunkAnalyses(items, song) {
  const bestText = field => {
    const candidates = items
      .filter(item => item.analysis?.[field])
      .sort((a, b) => Number(b.analysis?.confidence || 0) - Number(a.analysis?.confidence || 0));
    return candidates[0]?.analysis?.[field] || song?.[field] || "";
  };

  const merged = new Map();
  for (const item of items) {
    for (const part of item.analysis?.parts || []) {
      const rawName = partDisplayName(part);
      const name = isScorePartName(rawName) ? "Dirigent" : rawName;
      const key = `${item.originalFileName}\u0000${normalizePartName(name)}`;
      const adjustedPages = (part.pageNumbers || [])
        .map(number => Number(number) + item.pageOffset)
        .filter(Number.isFinite);
      const existing = merged.get(key);

      if (!existing) {
        merged.set(key, {
          ...part,
          name,
          instrument: isScorePartName(rawName) ? "Dirigent" : part.instrument,
          voice: isScorePartName(rawName) ? "" : part.voice,
          fileName: item.originalFileName,
          pageNumbers: [...new Set(adjustedPages)].sort((a, b) => a - b),
          confidence: Number(part.confidence || 0)
        });
        continue;
      }

      existing.pageNumbers = [...new Set([...(existing.pageNumbers || []), ...adjustedPages])].sort((a, b) => a - b);
      existing.confidence = Math.max(Number(existing.confidence || 0), Number(part.confidence || 0));
    }
  }

  return {
    title: bestText("title"),
    composer: bestText("composer"),
    arranger: bestText("arranger"),
    confidence: items.length ? Math.max(...items.map(item => Number(item.analysis?.confidence || 0))) : 0,
    parts: [...merged.values()]
  };
}

async function analyzeCombinedSong(song, sourceFiles) {
  const files = sourceFiles?.length ? [...sourceFiles] : null;
  if (!files?.length) return withAiJsonRetry(() => core.analyzeSongPdf(song, sourceFiles));

  const results = [];
  for (const originalFile of files) {
    const knownScorePages = await detectScorePagesInPdf(originalFile);
    const chunks = await splitCombinedPdf(song, originalFile);
    for (const chunk of chunks) {
      const rawAnalysis = await withAiJsonRetry(() => core.analyzeSongPdf(song, [chunk.file]));
      const localScorePages = [...knownScorePages]
        .filter(page => page > chunk.pageOffset && page <= chunk.pageOffset + chunk.pageCount)
        .map(page => page - chunk.pageOffset);
      const analysis = normalizeScoreChunkAnalysis(rawAnalysis, chunk.pageCount, localScorePages);
      results.push({
        analysis,
        originalFileName: originalFile.name,
        pageOffset: chunk.pageOffset
      });
    }
  }
  return mergeChunkAnalyses(results, song);
}

export async function analyzeSongPdf(song, sourceFiles) {
  if (song?.mode === "combined") return analyzeCombinedSong(song, sourceFiles);
  return withAiJsonRetry(() => core.analyzeSongPdf(song, sourceFiles));
}

export async function analyzeNewInstrumentPdf(...args) {
  return withAiJsonRetry(() => core.analyzeNewInstrumentPdf(...args));
}
