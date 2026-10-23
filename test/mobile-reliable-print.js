import { firebaseConfig } from "../firebase-core.js?v=26";

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
  win.document.write(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8f5;color:#174a43;text-align:center;padding:28px;box-sizing:border-box}.card{max-width:420px}.note{font-size:2rem;margin-bottom:12px}strong{display:block;font-size:1.2rem;margin-bottom:10px}</style></head><body><div class="card"><div class="note">♫</div><strong>Klargjer notar for utskrift …</strong><p id="ssml-status">Samlar valde notesider i éi PDF-fil utan å gjere dei om til bilete.</p></div></body></html>`);
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

async function openNativePdf(win, blob, pageCount, title) {
  const url = URL.createObjectURL(blob);
  const safeTitle = String(title || "Noter").replace(/[<>&"]/g, "");
  // A user-initiated link is more predictable in iOS Safari than replacing a
  // newly opened window with a blob URL after asynchronous PDF generation.
  win.document.open();
  win.document.write(`<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} – utskrift</title><style>body{margin:0;min-height:100dvh;box-sizing:border-box;padding:32px 20px;background:#081a30;color:#f6f1e8;font:16px -apple-system,BlinkMacSystemFont,Arial,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center}.card{max-width:430px;width:100%;padding:28px 20px;border:1px solid #48627a;border-radius:18px;background:#122d48}h1{font-size:1.35rem}p{line-height:1.55;color:#c7d5df}a{display:block;margin:22px 0;padding:17px 12px;border-radius:12px;background:#d5a547;color:#091b2c;text-decoration:none;font-weight:800}small{display:block;color:#c7d5df;line-height:1.5}</style></head><body><div class="card"><h1>Notane er klare</h1><p>${pageCount} notesider er samla i éi PDF-fil med original kvalitet.</p><a id="open-pdf">Opne PDF for utskrift</a><small>Trykk på knappen, vel Del og deretter Skriv ut i Safari.</small></div></body></html>`);
  win.document.close();
  const link = win.document.querySelector("#open-pdf");
  link.href = url;
  link.target = "_self";
  link.download = "";
  link.removeAttribute("download");
  // Keep the blob alive until the tab is closed. Revoking it after a timer
  // can break printing if the user returns to the PDF later.
  win.addEventListener("pagehide", () => setTimeout(() => URL.revokeObjectURL(url), 120000), { once: true });
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
    // Keep the original PDF pages and never rasterize an entire score on iPhone.
    // A failed PDF copy must not silently start a long, cancellable render job.
    let printResult;
    try {
      printResult = await buildA4Pdf(specs, popup);
    } catch (error) {
      console.error("PDF-kopiering feila", error);
      throw new Error("Kunne ikkje hente ut dei valde instrumentsidene frå PDF-en. Prøv ei anna stemme, eller kontroller sidetildelinga i arkivet.");
    }
    const { blob, pageCount } = printResult;
    await openNativePdf(popup, blob, pageCount, title);
    message(`Klargjorde ${pageCount} noteside${pageCount === 1 ? "" : "r"} for utskrift.`);
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
