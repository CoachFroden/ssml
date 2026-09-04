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

function selectedNames() {
  return [...document.querySelectorAll("#part-list .part-select-row")]
    .filter(row => row.querySelector('input[type="checkbox"]')?.checked)
    .map(row => row.querySelector("strong")?.textContent?.trim())
    .filter(Boolean);
}

function activeName() {
  return document.querySelector("#part-list .part-btn.active strong")?.textContent?.trim() || "";
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

function resolveParts(song, names) {
  const available = [...(song.parts || [])];
  return names.map(name => {
    const index = available.findIndex(part => clean(part.name) === clean(name));
    if (index < 0) return null;
    return available.splice(index, 1)[0];
  }).filter(Boolean);
}

function sourceUrl(part) {
  return part.url || part.enhancedUrl || part.originalUrl || "";
}

function partPages(part, source, pageOverride = null) {
  if (Number.isFinite(pageOverride)) return [pageOverride];
  const pages = Array.isArray(part.pageNumbers) && part.pageNumbers.length
    ? part.pageNumbers.map(Number).filter(Number.isFinite)
    : Array.from({ length: source.getPageCount() }, (_, index) => index + 1);
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
        const sourcePage = source.getPage(pageNumber - 1);
        const embedded = await output.embedPage(sourcePage);
        const sourceWidth = sourcePage.getWidth();
        const sourceHeight = sourcePage.getHeight();
        const availableWidth = A4_WIDTH - PAGE_MARGIN * 2;
        const availableHeight = A4_HEIGHT - PAGE_MARGIN * 2;
        const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
        const width = sourceWidth * scale;
        const height = sourceHeight * scale;
        const x = (A4_WIDTH - width) / 2;
        const y = (A4_HEIGHT - height) / 2;
        const page = output.addPage([A4_WIDTH, A4_HEIGHT]);
        page.drawPage(embedded, { x, y, width, height });
      }
    }
  }

  if (output.getPageCount() !== expectedPages) {
    throw new Error(`Utskrifts-PDF-en fekk feil sidetal (${output.getPageCount()} i staden for ${expectedPages}).`);
  }
  const bytes = await output.save({ useObjectStreams: true });
  return { blob: new Blob([bytes], { type: "application/pdf" }), pageCount: expectedPages };
}

function openNativePdf(win, blob, pageCount) {
  const url = URL.createObjectURL(blob);
  setStatus(win, `Ferdig: ${pageCount} A4-sider. Opnar PDF …`);
  setTimeout(() => {
    try {
      win.location.replace(url);
      setTimeout(() => {
        try { win.focus(); win.print(); } catch {}
      }, 900);
    } catch {
      win.location.href = url;
    }
  }, 120);
  setTimeout(() => URL.revokeObjectURL(url), 15 * 60 * 1000);
}

async function runPrint({ names, pageOverride = null, copies = 1, title = "Noter" }) {
  const popup = openPreparing(title);
  if (!popup) return message("Nettlesaren blokkerte utskriftsvindauget. Prøv igjen.", "error");
  try {
    const song = await getSong();
    const parts = resolveParts(song, names);
    if (!parts.length) throw new Error("Fann ikkje dei valde stemmene.");
    const specs = parts.map(part => ({
      part,
      pageOverride: parts.length === 1 ? pageOverride : null,
      copies: parts.length === 1 ? copies : 1
    }));
    const { blob, pageCount } = await buildA4Pdf(specs, popup);
    openNativePdf(popup, blob, pageCount);
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
    const names = selectedNames();
    if (!names.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    runPrint({ names, title: document.querySelector("#song-detail h1")?.textContent || "Noter" });
    return;
  }

  if (target.closest("#open-print")) {
    const names = selectedNames();
    if (names.length > 1) {
      event.preventDefault(); event.stopImmediatePropagation();
      runPrint({ names, title: document.querySelector("#song-detail h1")?.textContent || "Noter" });
    }
    return;
  }

  if (target.closest("#print-current-page")) {
    const name = activeName();
    const page = currentPdfPage();
    if (!name || !page) return;
    event.preventDefault(); event.stopImmediatePropagation();
    runPrint({ names: [name], pageOverride: page, title: `${document.querySelector("#song-detail h1")?.textContent || "Noter"} – ${name}` });
  }
}

document.addEventListener("click", interceptClick, true);

document.addEventListener("submit", event => {
  if (!isMobile() || event.target?.id !== "print-form") return;
  const name = activeName();
  if (!name) return;
  const choice = document.querySelector("#page-choice")?.value || "all";
  const copies = Math.max(1, Number(document.querySelector("#copy-count")?.value || 1));
  const pageOverride = choice === "all" ? null : Number(choice);
  event.preventDefault(); event.stopImmediatePropagation();
  document.querySelector("#print-dialog")?.close();
  runPrint({ names: [name], pageOverride, copies, title: `${document.querySelector("#song-detail h1")?.textContent || "Noter"} – ${name}` });
}, true);
