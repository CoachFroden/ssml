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
function status(win,text){try{const el=win?.document?.getElementById("ssml-print-status");if(el)el.textContent=text;}catch{}}
function timeout(promise,ms,label){let t;return Promise.race([promise,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error(label+" tok for lang tid.")),ms)})]).finally(()=>clearTimeout(t));}
function waiting(){
 const win=window.open("","_blank");
 if(!win)throw Error("Nettlesaren blokkerte utskriftsvindauget.");
 win.document.write('<!doctype html><html lang="no"><meta charset="utf-8"><title>SSML – utskrift</title><body style="font:16px Arial;background:#081a30;color:#f5e7ca;text-align:center;padding:60px"><h2>Klargjer notar …</h2><p id="ssml-print-status">Hentar PDF og kontrollerer sidene …</p></body></html>');
 return win;
}
async function makePdf(song,ids,pageOnly,copies,win){
 const {PDFDocument}=await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
 const output=await PDFDocument.create(),cache=new Map();
 const byId=new Map((song.parts||[]).map(p=>[String(p.id),p]));
 let count=0;
 for(const id of ids){
  const part=byId.get(String(id));
  if(!part)throw Error("Fann ikkje den valde instrumentstemma.");
  status(win,"Hentar "+part.name+" …");
  const url=part.url||part.enhancedUrl||part.originalUrl;
  if(!url)throw Error("Manglar PDF for "+part.name);
  if(!cache.has(url)){
   const response=await fetch(url);if(!response.ok)throw Error("Kunne ikkje laste PDF.");
   const bytes=await response.arrayBuffer();
   let source=null;
   try{source=await PDFDocument.load(bytes,{ignoreEncryption:true});}catch(error){console.warn("PDF-lib kan ikkje lese originalen, brukar PDF.js",error);}
   if(source?.isEncrypted)source=null;
   cache.set(url,{bytes,source});
  }
  const item=cache.get(url);
  if(!item.source&&!item.pdfjs){
   const pdfjs=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
   pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
   item.pdfjs=await timeout(pdfjs.getDocument({data:new Uint8Array(item.bytes.slice(0))}).promise,45000,"Opning av PDF");
  }
  const total=item.source?.getPageCount()||item.pdfjs.numPages;
  const pages=pageOnly!=null?[pageOnly]:part.pageNumbers?.length?part.pageNumbers:(song.mode==="combined"||song.mode==="mapped"||song.mode==="analyzed"?(()=>{throw Error("Stemma «"+part.name+"» manglar sidetildeling.");})():Array.from({length:total},(_,i)=>i+1));
  if(!pages.length||pages.some(p=>!Number.isInteger(Number(p))||Number(p)<1||Number(p)>total))throw Error("Ugyldig sidetildeling for "+part.name);
  for(let copy=0;copy<copies;copy++){
   if(item.source){
    const copied=await output.copyPages(item.source,pages.map(p=>Number(p)-1));
    copied.forEach(p=>output.addPage(p));count+=copied.length;
   }else{
    for(const number of pages){
     status(win,"Klargjer "+part.name+" – PDF-side "+number+" ("+(count+1)+" ferdige etter denne) …");
     const page=await timeout(item.pdfjs.getPage(Number(number)),30000,"Henting av PDF-side");
     const viewport=page.getViewport({scale:1.65});
     const canvas=document.createElement("canvas");
     canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
     const context=canvas.getContext("2d",{alpha:false});
     context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);
     await timeout(page.render({canvasContext:context,viewport}).promise,45000,"Gjengiving av PDF-side");
     const blob=await timeout(new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error("Kunne ikkje lage utskriftsbilete.")),"image/png")),20000,"Laging av utskriftsbilete");
     const image=await output.embedPng(await blob.arrayBuffer());
     const sourceWidth=page.getViewport({scale:1}).width,sourceHeight=page.getViewport({scale:1}).height;
     const sheet=output.addPage([sourceWidth,sourceHeight]);
     sheet.drawImage(image,{x:0,y:0,width:sourceWidth,height:sourceHeight});
     canvas.width=canvas.height=1;
     count++;
    }
   }
  }
 }
 if(!count)throw Error("Ingen sider vart valde.");
 status(win,"Lagrar utskrifts-PDF med "+count+" sider …");
 return {blob:new Blob([await timeout(output.save(),90000,"Lagring av PDF")],{type:"application/pdf"}),count};
}
async function printJob(ids,pageOnly=null,copies=1){
 let win;try{win=waiting();const song=await songData();const {blob,count}=await makePdf(song,ids,pageOnly,copies,win);const url=URL.createObjectURL(blob);
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
