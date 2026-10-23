/* SSML test only: PC print original PDF pages without JPEG rendering. */
import { firebaseConfig } from "../firebase-core.js?v=26";
const desktop=()=>window.innerWidth>850;
const rows=()=>[...document.querySelectorAll("#part-list .part-select-row")];
const checked=()=>rows().filter(r=>r.querySelector('input[type="checkbox"]')?.checked).map(r=>r.dataset.partId).filter(Boolean);
const active=()=>document.querySelector("#part-list .part-btn.active")?.closest(".part-select-row")?.dataset.partId||checked()[0];
const title=()=>document.querySelector("#song-detail h1")?.textContent||"SSML Noter";
const notify=(text)=>{const el=document.createElement("div");el.className="toast error";el.textContent=text;(document.querySelector("#toast-region")||document.body).append(el);setTimeout(()=>el.remove(),7000);};
async function songData(){
 const id=document.querySelector("#song-detail")?.dataset.songId;
 if(!id)throw Error("Ingen song er vald.");
 const [a,f]=await Promise.all([import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js"),import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js")]);
 const app=a.getApps().length?a.getApp():a.initializeApp(firebaseConfig);
 const snap=await f.getDoc(f.doc(f.getFirestore(app),"songs",id));
 if(!snap.exists())throw Error("Fann ikkje songen i arkivet.");
 return snap.data();
}
function waiting(){
 const win=window.open("","_blank");
 if(!win)throw Error("Nettlesaren blokkerte utskriftsvindauget.");
 win.document.write('<!doctype html><html lang="no"><meta charset="utf-8"><title>SSML – utskrift</title><body style="font:16px Arial;background:#081a30;color:#f5e7ca;text-align:center;padding:60px"><h2>Klargjer originalnotar …</h2><p>Sidene blir kopierte utan kvalitetstap.</p></body></html>');
 return win;
}
async function makePdf(song,ids,pageOnly,copies){
 const {PDFDocument}=await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
 const output=await PDFDocument.create(),cache=new Map();
 const byId=new Map((song.parts||[]).map(p=>[String(p.id),p]));
 let count=0;
 for(const id of ids){
  const part=byId.get(String(id));
  if(!part)throw Error("Fann ikkje den valde instrumentstemma.");
  const url=part.url||part.enhancedUrl||part.originalUrl;
  if(!url)throw Error("Manglar PDF for "+part.name);
  if(!cache.has(url)){const response=await fetch(url);if(!response.ok)throw Error("Kunne ikkje laste PDF.");const loaded=await PDFDocument.load(await response.arrayBuffer(), { ignoreEncryption: true });if(loaded.isEncrypted)throw Error("Denne PDF-en er kryptert. Direkte kopiering kan gi blanke ark. Utskrift er stoppa for å unngå feil. Bruk original-PDF-en eller last opp ei ukryptert utgåve.");cache.set(url,loaded);}
  const source=cache.get(url);
  const pages=pageOnly!=null?[pageOnly]:part.pageNumbers?.length?part.pageNumbers:(song.mode==="combined"||song.mode==="mapped"||song.mode==="analyzed"?(()=>{throw Error("Stemma «"+part.name+"» manglar sidetildeling. Utskrift stoppa for å unngå heile partituret.");})():Array.from({length:source.getPageCount()},(_,i)=>i+1));
  if(!pages.length||pages.some(p=>!Number.isInteger(Number(p))||Number(p)<1||Number(p)>source.getPageCount()))throw Error("Ugyldig sidetildeling for "+part.name);
  for(let copy=0;copy<copies;copy++){const copied=await output.copyPages(source,pages.map(p=>Number(p)-1));copied.forEach(p=>output.addPage(p));count+=copied.length;}
 }
 if(!count)throw Error("Ingen sider vart valde.");
 return {blob:new Blob([await output.save()],{type:"application/pdf"}),count};
}
async function printJob(ids,pageOnly=null,copies=1){
 let win;try{win=waiting();const song=await songData();const {blob,count}=await makePdf(song,ids,pageOnly,copies);const url=URL.createObjectURL(blob);
 const safe=title().replace(/[<>&"]/g,"");
 win.document.open();win.document.write(`<!doctype html><html lang="no"><head><meta charset="utf-8"><title>${safe} – ${count} sider</title><style>html,body{height:100%;margin:0;background:#081a30;color:#f5e7ca;font:15px Arial}.toolbar{height:58px;display:flex;gap:12px;align-items:center;justify-content:center}.toolbar button,.toolbar a{background:#d5a547;color:#081a30;padding:11px 17px;border:0;border-radius:8px;font-weight:bold;cursor:pointer;text-decoration:none}iframe{width:100%;height:calc(100% - 58px);border:0;background:white}</style></head><body><div class="toolbar"><span>${count} notesider</span><button id="print">Skriv ut PDF</button><a href="${url}" target="_blank">Opne PDF</a><span>Vel 1 kopi i dialogen</span></div><iframe id="pdf" src="${url}"></iframe></body></html>`);win.document.close();
 win.document.querySelector("#print").onclick=()=>{try{win.document.querySelector("#pdf").contentWindow.print();}catch{win.open(url,"_blank");}};
 // Open the PDF for inspection first; user chooses when to print.
 setTimeout(()=>URL.revokeObjectURL(url),30*60*1000);
 }catch(error){console.error(error);notify(error.message||"Utskrifta feila.");if(win&&!win.closed){win.document.body.textContent="Utskrift feila: "+(error.message||"Ukjend feil");}}
}
document.addEventListener("click",e=>{
 if(!desktop())return;
 const target=e.target.closest("#print-selected-parts,#open-print,#print-current-page");
 if(!target)return;
 let ids,page=null;
 if(target.id==="print-selected-parts")ids=checked();
 else if(target.id==="open-print"){if(checked().length>1)ids=checked();else return;}
 else{ids=[active()];const match=document.querySelector("#page-modal-count")?.textContent?.match(/PDF-side\s+(\d+)/i);page=match?Number(match[1]):null;}
 if(!ids?.length)return;
 e.preventDefault();e.stopImmediatePropagation();printJob(ids,page);
},true);
document.addEventListener("submit",e=>{
 if(!desktop()||e.target.id!=="print-form")return;
 const id=active();if(!id)return;
 const value=document.querySelector("#page-choice")?.value;
 const copies=Math.max(1,Math.min(99,Number(document.querySelector("#copy-count")?.value)||1));
 e.preventDefault();e.stopImmediatePropagation();document.querySelector("#print-dialog")?.close();
 printJob([id],value==="all"?null:Number(value),copies);
},true);
