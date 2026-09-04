import { firebaseConfig } from "./firebase-core.js?v=26";

const isMobile = () => window.matchMedia?.("(max-width: 850px)")?.matches ?? window.innerWidth <= 850;

function showMessage(message, type = "ok") {
  const region = document.querySelector("#toast-region");
  if (!region) {
    alert(message);
    return;
  }
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : "ok"}`;
  el.textContent = message;
  region.append(el);
  setTimeout(() => el.remove(), 5000);
}

function normalize(value = "") {
  return String(value).trim().toLocaleLowerCase("no");
}

function selectedPartNames() {
  return [...document.querySelectorAll("#part-list .part-select-row")]
    .filter(row => row.querySelector('input[type="checkbox"]')?.checked)
    .map(row => row.querySelector("strong")?.textContent?.trim())
    .filter(Boolean);
}

function activePartName() {
  return document.querySelector("#part-list .part-btn.active strong")?.textContent?.trim() || "";
}

function currentPdfPage() {
  const text = document.querySelector("#page-modal-count")?.textContent || "";
  const match = text.match(/PDF-side\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function openPreparingWindow(title) {
  const win = window.open("", "_blank");
  if (!win) return null;
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${String(title).replace(/[<>&]/g, "")}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8f5;color:#174a43;text-align:center;padding:28px;box-sizing:border-box}.card{max-width:420px}strong{display:block;font-size:1.2rem;margin-bottom:10px}.spin{font-size:2rem;margin-bottom:14px}</style></head><body><div class="card"><div class="spin">♫</div><strong>Klargjer notar for utskrift …</strong><p id="ssml-print-status">Lagar éi lett PDF-fil utan å rendere alle sidene som bilete.</p></div></body></html>`);
  win.document.close();
  return win;
}

function setPopupStatus(win, text) {
  try {
    const el = win?.document?.querySelector("#ssml-print-status");
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
    try {
      snapshot = await firestoreModule.getDocFromCache(ref);
    } catch {
      throw error;
    }
  }
  if (!snapshot?.exists()) throw new Error("Fann ikkje songdata for utskrift.");
  return { id: snapshot.id, ...snapshot.data() };
}

function resolveParts(song, names) {
  const available = [...(song.parts || [])];
  return names.map(name => {
    const index = available.findIndex(part => normalize(part.name) === normalize(name));
    if (index < 0) return null;
    return available.splice(index, 1)[0];
  }).filter(Boolean);
}

function sourceUrl(part) {
  return part.url || part.enhancedUrl || part.originalUrl || "";
}

function pagesForPart(part, sourceDoc, pageOverride = null) {
  if (Number.isFinite(pageOverride)) return [pageOverride];
  const pages = Array.isArray(part.pageNumbers) && part.pageNumbers.length
    ? part.pageNumbers.map(Number).filter(Number.isFinite)
    : Array.from({ length: sourceDoc.getPageCount() }, (_, index) => index + 1);
  return [...new Set(pages)].filter(page => page >= 1 && page <= sourceDoc.getPageCount());
}

async function buildPrintPdf(specs, win) {
  const { PDFDocument } = await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
  const output = await PDFDocument.create();
  let currentUrl = "";
  let currentSource = null;

  for (let specIndex = 0; specIndex < specs.length; specIndex++) {
    const spec = specs[specIndex];
    const url = sourceUrl(spec.part);
    if (!url) throw new Error(`Fann ikkje PDF-fila for «${spec.part.name}».`);

    setPopupStatus(win, `Klargjer ${spec.part.name} (${specIndex + 1} av ${specs.length}) …`);

    if (url !== currentUrl || !currentSource) {
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`Kunne ikkje hente PDF-en for «${spec.part.name}».`);
      currentSource = await PDFDocument.load(await response.arrayBuffer(), { ignoreEncryption: true });
      currentUrl = url;
    }

    const pages = pagesForPart(spec.part, currentSource, spec.pageOverride);
    if (!pages.length) throw new Error(`Fann ingen gyldige sider for «${spec.part.name}».`);
    const copies = Math.max(1, Number(spec.copies || 1));

    for (let copy = 0; copy < copies; copy++) {
      const copied = await output.copyPages(currentSource, pages.map(page => page - 1));
      copied.forEach(page => output.addPage(page));
    }
  }

  if (!output.getPageCount()) throw new Error("Utskrifts-PDF-en vart tom.");
  const bytes = await output.save({ useObjectStreams: true });
  return new Blob([bytes], { type: "application/pdf" });
}

function showPdfForPrint(win, blob, title) {
  const url = URL.createObjectURL(blob);
  const safeTitle = String(title || "Noter").replace(/[<>&]/g, "");
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>html,body{height:100%;margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f8f5;color:#174a43}.bar{height:64px;display:flex;align-items:center;justify-content:center;gap:10px;padding:8px 12px;box-sizing:border-box}.bar button,.bar a{border:0;border-radius:12px;background:#174a43;color:white;padding:12px 16px;font:inherit;font-weight:700;text-decoration:none}.bar a{background:#e7eeeb;color:#174a43}iframe{width:100%;height:calc(100% - 64px);border:0;background:white}</style></head><body><div class="bar"><button id="ssml-native-print" type="button">Skriv ut</button><a id="ssml-open-pdf" href="${url}" target="_self">Opne PDF</a></div><iframe id="ssml-print-pdf" src="${url}" title="Utskrifts-PDF"></iframe></body></html>`);
  win.document.close();

  const frame = win.document.querySelector("#ssml-print-pdf");
  const button = win.document.querySelector("#ssml-native-print");
  const tryPrint = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      return true;
    } catch {
      return false;
    }
  };
  button?.addEventListener("click", () => {
    if (!tryPrint()) win.location.href = url;
  });
  frame?.addEventListener("load", () => {
    setTimeout(() => { tryPrint(); }, 350);
  }, { once: true });

  setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
}

async function runSafePrint({ names, pageOverride = null, copies = 1, title = "Noter" }) {
  const popup = openPreparingWindow(title);
  if (!popup) {
    showMessage("Nettlesaren blokkerte utskriftsvindauget. Prøv igjen.", "error");
    return;
  }

  try {
    const song = await getSong();
    const parts = resolveParts(song, names);
    if (!parts.length) throw new Error("Fann ikkje dei valde stemmene.");
    const specs = parts.map(part => ({ part, pageOverride: parts.length === 1 ? pageOverride : null, copies: parts.length === 1 ? copies : 1 }));
    const blob = await buildPrintPdf(specs, popup);
    showPdfForPrint(popup, blob, title || song.title || "Noter");
    showMessage(`Klargjorde ${parts.length} stemme(r) som ei lett PDF for utskrift.`);
  } catch (error) {
    console.error("Mobilutskrift feila", error);
    const offline = !navigator.onLine;
    const message = offline
      ? "Telefonen er utan nett. Slå på nett og prøv utskrift igjen. Appen skal ikkje logge deg ut."
      : (error?.message || "Kunne ikkje klargjere notene for utskrift.");
    try {
      setPopupStatus(popup, message);
      const body = popup.document.body;
      if (body) body.insertAdjacentHTML("beforeend", '<p><button onclick="window.close()" style="border:0;border-radius:10px;padding:12px 16px;background:#174a43;color:white;font:inherit">Lukk</button></p>');
    } catch {}
    showMessage(message, "error");
  }
}

function intercept(event) {
  if (!isMobile()) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const selectedButton = target.closest("#print-selected-parts");
  if (selectedButton) {
    const names = selectedPartNames();
    if (!names.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    runSafePrint({ names, title: document.querySelector("#song-detail h1")?.textContent || "Noter" });
    return;
  }

  const mainButton = target.closest("#open-print");
  if (mainButton) {
    const names = selectedPartNames();
    if (names.length > 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
      runSafePrint({ names, title: document.querySelector("#song-detail h1")?.textContent || "Noter" });
    }
    return;
  }

  const currentPageButton = target.closest("#print-current-page");
  if (currentPageButton) {
    const name = activePartName();
    const page = currentPdfPage();
    if (!name || !page) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    runSafePrint({ names: [name], pageOverride: page, title: `${document.querySelector("#song-detail h1")?.textContent || "Noter"} – ${name}` });
  }
}

document.addEventListener("click", intercept, true);

document.addEventListener("submit", event => {
  if (!isMobile() || event.target?.id !== "print-form") return;
  const name = activePartName();
  if (!name) return;
  const choice = document.querySelector("#page-choice")?.value || "all";
  const copies = Math.max(1, Number(document.querySelector("#copy-count")?.value || 1));
  const pageOverride = choice === "all" ? null : Number(choice);
  event.preventDefault();
  event.stopImmediatePropagation();
  document.querySelector("#print-dialog")?.close();
  runSafePrint({ names: [name], pageOverride, copies, title: `${document.querySelector("#song-detail h1")?.textContent || "Noter"} – ${name}` });
}, true);
