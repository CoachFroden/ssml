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
  win.document.write(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8f5;color:#174a43;text-align:center;padding:28px;box-sizing:border-box}.card{max-width:420px}.note{font-size:2rem;margin-bottom:12px}strong{display:block;font-size:1.2rem;margin-bottom:10px}</style></head><body><div class="card"><div class="note">♫</div><strong>Klargjer notar for utskrift …</strong><p id="ssml-status">Klargjer valde notesider for stabil utskrift.</p></div></body></html>`);
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
  const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const { PDFDocument } = await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
  const output = await PDFDocument.create();
  const sources = new Map();
  let expectedPages = 0;
  for (const spec of specs) {
    const url = sourceUrl(spec.part);
    if (!url) throw new Error("Manglar PDF for " + spec.part.name);
    let source = sources.get(url);
    if (!source) {
      setStatus(win, "Hentar PDF for " + spec.part.name + " …");
      const response = await fetch(url);
      if (!response.ok) throw new Error("Kunne ikkje hente PDF-en.");
      source = await pdfjs.getDocument({data:new Uint8Array(await response.arrayBuffer())}).promise;
      sources.set(url, source);
    }
    const pages = Number.isFinite(spec.pageOverride) ? [spec.pageOverride] :
      (Array.isArray(spec.part.pageNumbers) && spec.part.pageNumbers.length ?
        [...new Set(spec.part.pageNumbers.map(Number))] :
        (() => { throw new Error("«" + spec.part.name + "» manglar sidetildeling."); })());
    if (!pages.length || pages.some(n => !Number.isInteger(n) || n < 1 || n > source.numPages))
      throw new Error("Ugyldig sidetildeling for " + spec.part.name);
    const copies = Math.max(1, Math.min(99, Number(spec.copies) || 1));
    for (let copy = 0; copy < copies; copy++) {
      for (const pageNo of pages) {
        setStatus(win, "Klargjer " + spec.part.name + " – side " + pageNo + " …");
        const page = await source.getPage(pageNo);
        const original = page.getViewport({scale:1});
        const scale = Math.min(1.5, 1500 / Math.max(original.width, original.height));
        const viewport = page.getViewport({scale});
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d", {alpha:false});
        if (!ctx) throw new Error("Kunne ikkje klargjere PDF-sida.");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({canvasContext:ctx,viewport}).promise;
        const blob = await new Promise((resolve,reject) =>
          canvas.toBlob(b => b ? resolve(b) : reject(new Error("Kunne ikkje lage utskriftsbilete.")), "image/jpeg", 0.92));
        const image = await output.embedJpg(await blob.arrayBuffer());
        const sheet = output.addPage([original.width,original.height]);
        sheet.drawImage(image,{x:0,y:0,width:original.width,height:original.height});
        canvas.width=canvas.height=1;
        expectedPages++;
      }
    }
  }
  if (!expectedPages || output.getPageCount() !== expectedPages)
    throw new Error("Feil sidetal i utskrifts-PDF.");
  setStatus(win,"Lagrar " + expectedPages + " notesider …");
  return {blob:new Blob([await output.save()],{type:"application/pdf"}),pageCount:expectedPages};
}

async function openNativePdf(win, blob, pageCount, title) {
  const url = URL.createObjectURL(blob);
  const safeTitle = String(title || "Noter").replace(/[<>&"]/g, "");
  // A user-initiated link is more predictable in iOS Safari than replacing a
  // newly opened window with a blob URL after asynchronous PDF generation.
  win.document.open();
  win.document.write(`<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} – utskrift</title><style>body{margin:0;min-height:100dvh;box-sizing:border-box;padding:32px 20px;background:#081a30;color:#f6f1e8;font:16px -apple-system,BlinkMacSystemFont,Arial,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center}.card{max-width:430px;width:100%;padding:28px 20px;border:1px solid #48627a;border-radius:18px;background:#122d48}h1{font-size:1.35rem}p{line-height:1.55;color:#c7d5df}a{display:block;margin:22px 0;padding:17px 12px;border-radius:12px;background:#d5a547;color:#091b2c;text-decoration:none;font-weight:800}small{display:block;color:#c7d5df;line-height:1.5}</style></head><body><div class="card"><h1>Notane er klare</h1><p>${pageCount} notesider er samla i éi utskrifts-PDF. Kontroller at notene vises før utskrift.</p><a id="open-pdf">Opne PDF for utskrift</a><small>Trykk på knappen, vel Del og deretter Skriv ut i Safari.</small></div></body></html>`);
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
  if (!popup) return message("Nettlesaren blokkerte PDF-vindauget.", "error");
  try {
    const song = await getSong();
    const parts = resolveParts(song, ids);
    if (!parts.length) throw new Error("Ingen stemmer er valde.");
    // Opening the source PDF directly avoids Safari canvas/PDF-lib hangs.
    // A source PDF can contain several instruments, so NEVER silently print all pages.
    const urls = [...new Set(parts.map(sourceUrl))];
    if (urls.some(url => !url)) throw new Error("Ei stemme manglar PDF.");
    const instructions = parts.map(part => {
      const pages = Number.isFinite(pageOverride) && parts.length === 1 ? [pageOverride] : part.pageNumbers;
      if (!Array.isArray(pages) || !pages.length) throw new Error("«" + part.name + "» manglar sidetildeling.");
      return {name:part.name, pages:[...new Set(pages.map(Number))]};
    });
    const escape = text => String(text).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const grouped = urls.map(url => {
      const matching = parts.filter(part => sourceUrl(part) === url);
      const pages = [...new Set(instructions.filter(item => matching.some(part => part.name === item.name)).flatMap(item => item.pages))].sort((a,b)=>a-b);
      return {url,pages};
    });
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Utskrift av notar</title><style>body{background:#081a30;color:#f5e7ca;font:16px -apple-system,Arial,sans-serif;padding:22px;margin:0}main{max-width:500px;margin:auto}h1{font-size:1.4rem}p,li{line-height:1.6}a{display:block;padding:16px;margin:16px 0;background:#d5a547;color:#081a30;border-radius:12px;text-align:center;font-weight:700;text-decoration:none}.pages{background:#122d48;border:1px solid #405b73;border-radius:12px;padding:14px;margin:12px 0;overflow-wrap:anywhere}strong{color:#fff}</style></head><body><main><h1>Opne original-PDF for utskrift</h1><p>Dette opnar notene direkte, utan konvertering som kan gi blanke sider eller låse telefonen.</p><p><strong>Viktig:</strong> PDF-en kan innehalde fleire instrument. Vel berre sidene som står under, i utskriftsmenyen. Ikkje vel «Alle» med mindre heile PDF-en skal skrivast ut.</p>${grouped.map((item,i)=>`<div class="pages"><strong>PDF ${i+1} – sider: ${item.pages.join(", ")}</strong><a href="${escape(item.url)}" target="_self">Opne original-PDF ${i+1}</a></div>`).join("")}<p>Etter opning: Del → Skriv ut → vel oppgitte sider. Kopiar: ${Number(copies)||1}.</p></main></body></html>`);
    popup.document.close();
  } catch (error) {
    console.error("Mobilutskrift feila",error);
    setStatus(popup,error.message||"Kunne ikkje opne PDF.");
    message(error.message||"Kunne ikkje opne PDF.","error");
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
