import * as core from "./firebase-core.js?v=24";

export * from "./firebase-core.js?v=24";

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
      const name = part.name || [part.instrument, part.voice].filter(Boolean).join(" ") || "Ukjend stemme";
      const key = `${item.originalFileName}\u0000${normalizePartName(name)}`;
      const adjustedPages = (part.pageNumbers || [])
        .map(number => Number(number) + item.pageOffset)
        .filter(Number.isFinite);
      const existing = merged.get(key);

      if (!existing) {
        merged.set(key, {
          ...part,
          name,
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
    const chunks = await splitCombinedPdf(song, originalFile);
    for (const chunk of chunks) {
      const analysis = await withAiJsonRetry(() => core.analyzeSongPdf(song, [chunk.file]));
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
