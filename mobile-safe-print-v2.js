import { firebaseConfig } from "./firebase-core.js?v=26";

const isMobile = () => window.matchMedia?.("(max-width: 850px)")?.matches ?? window.innerWidth <= 850;
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN = 8;

function message(text, type = "ok") {
  const region = document.querySelector("#toast-region");
  if (!region) return alert(text);
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : "ok"}`;
  el.textContent = text;
  region.append(el);
  setTimeout(() => el.remove(), 5000);
}

function clean(value = "") {
  return String(value).trim().toLocaleLowerCase("no");
}

function selectedIds() {
  return [...document.querySelectorAll("#part-list .part-select-row")]
    .filter(row => row.querySelector('input[type="checkbox"]')?.checked)
    .map(row => row.dataset.partId).filter(Boolean);
}
function activeId() {
  const selected = selectedIds();
  if (selected.length === 1) return selected[0];
  return document.querySelector("#part-list .part-btn.active")?.closest(".part-select-row")?.dataset.partId || "";
}

function currentPdfPage() {
  const text = document.querySelector("#page-modal-count")?.textContent || "";
  const match = text.match(/PDF-side\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function openPreparing(title) {
  const win = window.open("", "_blank");
  if (!win) return null;
  const safeTitle = String(title || "Noter").replace(/[<>&]/g, "");
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8f5;color:#174a43;text-align:center;padding:28px;box-sizing:border-box}.card{max-width:420px}.note{font-size:2rem;margin-bottom:12px}strong{display:block;font-size:1.2rem;margin-bottom:10px}</style></head><body><div class="card"><div class="note">♫</div><strong>Klargjer notar for utskrift …</strong><p id="ssml-status">Lagar A4-PDF. Kvar noteside blir nøyaktig éi utskriftsside.</p></div></body></html>`);
  win.document.close();
  return win;
}

function setStatus(win, text) {
  try {
    const el = win?.document?.querySelector("#ssml-status");
    if (el) el.textContent = text;
  } catch {}
}

async function getSong() {
  const songId = document.querySelector("#song-detail")?.dataset?.songId;
  if (!songId) throw new Error("Fann ikkje den opne songen.");
  const [appModule, firestoreModule] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js")
  ]);
  const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
  const db = firestoreModule.getFirestore(app);
  const ref = firestoreModule.doc(db, "songs", songId);
  let snapshot;
  try {
    snapshot = await firestoreModule.getDoc(ref);
  } catch (error) {
    try { snapshot = await firestoreModule.getDocFromCache(ref); }
    catch { throw error; }
  }
  if (!snapshot?.exists()) throw new Error("Fann ikkje songdata for utskrift.");
  return { id: snapshot.id, ...snapshot.data() };
}

function resolveParts(song, ids) {
  const byId = new Map((song.parts || []).map(part => [String(part.id), part]));
  return ids.map(id => {
    const part = byId.get(String(id));
    if (!part) throw new Error("Ei vald stemme finst ikkje lenger i arkivet. Last sida på nytt.");
    return part;
  });
}

function sourceUrl(part) {
  return part.url || part.enhancedUrl || part.originalUrl || "";
}

function partPages(part, source, pageOverride = null) {
  if (Number.isFinite(pageOverride)) return pageOverride >= 1 && pageOverride <= source.getPageCount() ? [pageOverride] : [];
  const pages = Array.isArray(part.pageNumbers) && part.pageNumbers.length
    ? part.pageNumbers.map(Number).filter(Number.isFinite)
    : (() => { throw new Error("«" + part.name + "» manglar sidetildeling. Kontroller instrumentet før utskrift."); })();
  return [...new Set(pages)].filter(page => page >= 1 && page <= source.getPageCount());
}

async function buildRenderedPdf(specs, win) {
  const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const { PDFDocument } = await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
  const output = await PDFDocument.create();
  const cache = new Map();
  for (const spec of specs) {
    const url = sourceUrl(spec.part);
    if (!url) throw new Error("Manglar PDF for " + spec.part.name);
    let source = cache.get(url);
    if (!source) {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("Kunne ikkje hente notene.");
      source = await pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) }).promise;
      cache.set(url, source);
    }
    const pages = Number.isFinite(spec.pageOverride) ? [spec.pageOverride] :
      (spec.part.pageNumbers?.length ? spec.part.pageNumbers.map(Number) :
      (() => { throw new Error("«" + spec.part.name + "» manglar sidetildeling."); })());
    const valid = [...new Set(pages)].filter(n => Number.isInteger(n) && n >= 1 && n <= source.numPages);
    if (!valid.length) throw new Error("Ingen gyldige sider for " + spec.part.name);
    for (let copy = 0; copy < Math.max(1, Number(spec.copies) || 1); copy++) {
      for (const number of valid) {
        setStatus(win, "Klargjer " + spec.part.name + ", side " + number);
        const page = await source.getPage(number);
        const base = page.getViewport({ scale: 1 });
        const scaleFactor = Math.min(1.35, 1800 / Math.max(base.width, base.height));
        const viewport = page.getViewport({ scale: scaleFactor });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const renderTask = page.render({ canvasContext: canvas.getContext("2d", {alpha:false}), viewport });
        let timeoutId;
        try {
          await Promise.race([
            renderTask.promise,
            new Promise((_, reject) => {
              timeoutId = setTimeout(() => {
                renderTask.cancel();
                reject(new Error("PDF-sida tok for lang tid. Prøv færre sider om gongen."));
              }, 25000);
            })
          ]);
        } finally {
          clearTimeout(timeoutId);
        }
        const jpeg = await Promise.race([
          new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .82)),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Kunne ikkje gjere notesida klar på iPhone.")), 15000))
        ]);
        if (!jpeg) throw new Error("Kunne ikkje klargjere notesida.");
        const image = await output.embedJpg(await jpeg.arrayBuffer());
        const scale = Math.min((A4_WIDTH - 16) / image.width, (A4_HEIGHT - 16) / image.height);
        const width = image.width * scale, height = image.height * scale;
        output.addPage([A4_WIDTH, A4_HEIGHT]).drawImage(image, {
          x:(A4_WIDTH-width)/2, y:(A4_HEIGHT-height)/2, width, height
        });
        canvas.width = canvas.height = 1;
      }
    }
  }
  const bytes = await output.save();
  return { blob:new Blob([bytes], {type:"application/pdf"}), pageCount:output.getPageCount() };
}

async function buildA4Pdf(specs, win) {
  const { PDFDocument } = await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
  const output = await PDFDocument.create();
  const sources = new Map();
  let expectedPages = 0;

  for (let index = 0; index < specs.length; index++) {
    const spec = specs[index];
    const url = sourceUrl(spec.part);
    if (!url) throw new Error(`Fann ikkje PDF-fila for «${spec.part.name}».`);
    setStatus(win, `Klargjer ${spec.part.name} (${index + 1} av ${specs.length}) …`);

    let source = sources.get(url);
    if (!source) {
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`Kunne ikkje hente PDF-en for «${spec.part.name}».`);
      source = await PDFDocument.load(await response.arrayBuffer(), { ignoreEncryption: true });
      sources.set(url, source);
    }

    const pages = partPages(spec.part, source, spec.pageOverride);
    if (!pages.length) throw new Error(`Fann ingen gyldige sider for «${spec.part.name}».`);
    const copies = Math.max(1, Number(spec.copies || 1));
    expectedPages += pages.length * copies;

    for (let copy = 0; copy < copies; copy++) {
      for (const pageNumber of pages) {
        // Copy the source page directly. embedPage can fail on some uploaded PDFs
        // with "Expected instance ... undefined" in pdf-lib.
        const [page] = await output.copyPages(source, [pageNumber - 1]);
        output.addPage(page);
      }
    }
  }

  if (output.getPageCount() !== expectedPages) {
    throw new Error(`Utskrifts-PDF-en fekk feil sidetal (${output.getPageCount()} i staden for ${expectedPages}).`);
  }
  const bytes = await output.save({ useObjectStreams: true });
  return { blob: new Blob([bytes], { type: "application/pdf" }), pageCount: expectedPages };
}

function openNativePdf(win, blob, pageCount, title = "Noter") {
  const url = URL.createObjectURL(blob);
  const filename = (String(title).replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "").trim() || "Noter") + ".pdf";
  const file = new File([blob], filename, { type: "application/pdf" });
  const doc = win.document;
  doc.body.innerHTML = "";
  doc.body.style.cssText = "margin:0;padding:18px;font-family:-apple-system,system-ui,sans-serif;background:#f7f8f5;color:#174a43;text-align:center";
  const heading = doc.createElement("h2");
  heading.textContent = "Notane er klare";
  const info = doc.createElement("p");
  info.textContent = pageCount + " sider. Trykk «Del PDF» og vel «Skriv ut» eller «Lagre i Filer».";
  const share = doc.createElement("button");
  share.textContent = "Del PDF";
  share.style.cssText = "padding:15px 24px;border:0;border-radius:12px;background:#174a43;color:white;font-size:17px;font-weight:700";
  const save = doc.createElement("a");
  save.href = url;
  save.download = filename;
  save.textContent = "Lagre PDF";
  save.style.cssText = "display:inline-block;margin:12px;padding:12px;color:#174a43";
  const preview = doc.createElement("iframe");
  preview.src = url;
  preview.title = "Førehandsvising av notar";
  preview.style.cssText = "display:block;width:100%;height:65vh;border:1px solid #ddd;background:white";
  share.addEventListener("click", async () => {
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
      } else {
        save.click();
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        info.textContent = "Kunne ikkje dele direkte. Vel «Lagre PDF», opne fila i Filer og skriv ut derfrå.";
      }
    }
  });
  doc.body.append(heading, info, share, save, preview);
  setTimeout(() => URL.revokeObjectURL(url), 30 * 60 * 1000);
}

async function runPrint({ ids, pageOverride = null, copies = 1, title = "Noter" }) {
  const popup = openPreparing(title);
  if (!popup) return message("Nettlesaren blokkerte utskriftsvindauget. Prøv igjen.", "error");
  try {
    const song = await getSong();
    const parts = resolveParts(song, ids);
    if (!parts.length) throw new Error("Fann ikkje dei valde stemmene.");
    const specs = parts.map(part => ({
      part,
      pageOverride: parts.length === 1 ? pageOverride : null,
      copies: parts.length === 1 ? copies : 1
    }));
    // Never fall back to the entire source PDF: it may contain every instrument.
    let printResult;
    try {
      printResult = await buildA4Pdf(specs, popup);
    } catch (error) {
      console.warn("PDF-kopiering feila; prøver siderendering", error);
      setStatus(popup, "Prøver alternativ metode for dei valde sidene …");
      printResult = await buildRenderedPdf(specs, popup);
    }
    const { blob, pageCount } = printResult;
    openNativePdf(popup, blob, pageCount, title);
    message(`Klargjorde ${pageCount} A4-side${pageCount === 1 ? "" : "r"} for utskrift.`);
  } catch (error) {
    console.error("Mobilutskrift feila", error);
    const text = !navigator.onLine
      ? "Telefonen er utan nett. Slå på nett og prøv igjen."
      : (error?.message || "Kunne ikkje klargjere notene for utskrift.");
    setStatus(popup, text);
    message(text, "error");
  }
}

function interceptClick(event) {
  if (!isMobile()) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (target.closest("#print-selected-parts")) {
    const ids = selectedIds();
    if (!ids.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    runPrint({ ids, title: document.querySelector("#song-detail h1")?.textContent || "Noter" });
    return;
  }

  if (target.closest("#open-print")) {
    const ids = selectedIds();
    if (ids.length > 1) {
      event.preventDefault(); event.stopImmediatePropagation();
      runPrint({ ids, title: document.querySelector("#song-detail h1")?.textContent || "Noter" });
    }
    return;
  }

  if (target.closest("#print-current-page")) {
    const name = activeId();
    const page = currentPdfPage();
    if (!name || !page) return;
    event.preventDefault(); event.stopImmediatePropagation();
    runPrint({ ids: [name], pageOverride: page, title: `${document.querySelector("#song-detail h1")?.textContent || "Noter"} – ${name}` });
  }
}

document.addEventListener("click", interceptClick, true);

document.addEventListener("submit", event => {
  if (!isMobile() || event.target?.id !== "print-form") return;
  const name = activeId();
  if (!name) return;
  const choice = document.querySelector("#page-choice")?.value || "all";
  const copies = Math.max(1, Number(document.querySelector("#copy-count")?.value || 1));
  const pageOverride = choice === "all" ? null : Number(choice);
  event.preventDefault(); event.stopImmediatePropagation();
  document.querySelector("#print-dialog")?.close();
  runPrint({ ids: [name], pageOverride, copies, title: `${document.querySelector("#song-detail h1")?.textContent || "Noter"} – ${name}` });
}, true);
