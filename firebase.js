import * as core from "./firebase-core.js?v=24";

export * from "./firebase-core.js?v=24";

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

async function splitCombinedPdf(file) {
  const { PDFDocument } = await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
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
    const chunks = await splitCombinedPdf(originalFile);
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
