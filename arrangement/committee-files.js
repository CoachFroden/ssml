import {auth} from "./firebase-client.js";
import {getStorage,ref,listAll,uploadBytes,getBytes,getMetadata} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

const storage=getStorage(auth.app);
const allowed=/\.(pdf|docx?|xlsx?|txt|png|jpe?g)$/i;
const MAX=15*1024*1024;
const safeSlot=slot=>{if(!/^[a-zA-Z0-9_-]{1,100}$/.test(slot||""))throw Error("Ugyldig arrangement");return slot;};
const ext=name=>(name.split(".").pop()||"").toLowerCase();
const kind=name=>/\.(png|jpe?g)$/i.test(name)?"image":/\.pdf$/i.test(name)?"pdf":/\.(docx?)$/i.test(name)?"doc":/\.(xlsx?)$/i.test(name)?"sheet":"other";
const iconFor=name=>({image:"🖼️",pdf:"📕",doc:"📝",sheet:"📊",other:"📄"})[kind(name)];
const readableSize=n=>n<1024?n+" B":n<1024*1024?(n/1024).toFixed(1)+" KB":(n/(1024*1024)).toFixed(1)+" MB";

export async function listSharedFiles(slot){
  const result=await listAll(ref(storage,"arrangementFiles/"+safeSlot(slot)));
  return result.items.map(item=>({name:item.name.replace(/^[0-9]+_[a-z0-9]+_/,""),storageRef:item}));
}
export async function uploadSharedFile(slot,file){
  if(!file||!allowed.test(file.name))throw Error("Filtypen er ikkje tillaten.");
  if(file.size>MAX)throw Error("Fila er større enn 15 MB.");
  const name=Date.now()+"_"+Math.random().toString(36).slice(2,10)+"_"+file.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120);
  await uploadBytes(ref(storage,"arrangementFiles/"+safeSlot(slot)+"/"+name),file,{contentType:file.type||"application/octet-stream"});
}
function el(tag,cls,text){
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=text;
  return node;
}
function installStyles(){
  if(document.getElementById("ssml-file-styles"))return;
  const style=el("style");style.id="ssml-file-styles";
  style.textContent=`
.ssml-files-shell{display:grid;gap:13px;margin:12px 0}
.ssml-files-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ssml-files-heading strong{font-size:1.02rem;color:#163c55}
.ssml-files-count{background:#e7f3f8;color:#245873;border-radius:999px;padding:5px 11px;font-size:.8rem;font-weight:700}
.ssml-files-list{display:grid;gap:10px}
.ssml-file-row{display:flex;align-items:center;gap:12px;padding:13px 14px;background:#fff;border:1px solid #dbe9f0;border-radius:15px;box-shadow:0 3px 12px rgba(17,62,88,.045);min-width:0}
.ssml-file-icon{display:grid;place-items:center;width:46px;height:46px;flex:0 0 46px;border-radius:12px;background:#eaf4f9;font-size:24px}
.ssml-file-info{display:grid;gap:4px;min-width:0;flex:1}
.ssml-file-name{font-weight:700;color:#173b52;overflow-wrap:anywhere}
.ssml-file-meta{color:#668091;font-size:.78rem}
.ssml-file-actions{display:flex;gap:7px;flex-wrap:wrap}
.ssml-file-actions button{border-radius:10px!important;padding:9px 12px!important;font-size:.87rem!important;min-height:39px}
.ssml-file-preview-btn{background:#eaf3f8!important;color:#174d6b!important;border:1px solid #cfe2ed!important}
.ssml-file-download-btn{background:#155d82!important;color:#fff!important;border:1px solid #155d82!important}
.ssml-file-empty{padding:25px 18px;text-align:center;border:1px dashed #b6d0df;background:#f5fafc;border-radius:16px;color:#55778b}
.ssml-file-modal{position:fixed;inset:0;z-index:99999;background:rgba(7,26,42,.82);display:flex;align-items:center;justify-content:center;padding:18px}
.ssml-file-dialog{display:flex;flex-direction:column;gap:10px;background:#fff;border-radius:17px;padding:15px;width:min(960px,100%);max-height:94vh;box-sizing:border-box}
.ssml-file-dialog-top{display:flex;align-items:center;gap:10px;justify-content:space-between}
.ssml-file-dialog-title{font-weight:700;overflow-wrap:anywhere;min-width:0}
.ssml-file-dialog-close{background:#eaf3f8!important;color:#173b52!important;border:0!important;border-radius:9px!important;padding:8px 12px!important}
.ssml-file-dialog img{display:block;max-width:100%;max-height:72vh;object-fit:contain;margin:auto}
.ssml-file-dialog iframe{width:100%;height:72vh;border:0;border-radius:8px;background:#f5f5f5}
@media(max-width:600px){.ssml-file-row{flex-wrap:wrap}.ssml-file-actions{width:100%;padding-left:58px}.ssml-file-actions button{flex:1}.ssml-file-icon{width:43px;height:43px;flex-basis:43px}.ssml-file-actions{padding-left:0}.ssml-file-dialog{max-height:95vh}.ssml-file-dialog iframe{height:70vh}}
`;
  document.head.append(style);
}
async function fileBlob(file){
  const [bytes,meta]=await Promise.all([getBytes(file.storageRef,MAX),getMetadata(file.storageRef)]);
  return new Blob([bytes],{type:meta.contentType||({image:ext(file.name)==="png"?"image/png":"image/jpeg",pdf:"application/pdf"})[kind(file.name)]||"application/octet-stream"});
}
async function downloadFile(file){
  const blob=await fileBlob(file),url=URL.createObjectURL(blob);
  const link=el("a");link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function previewFile(file){
  const blob=await fileBlob(file),url=URL.createObjectURL(blob);
  const modal=el("div","ssml-file-modal");
  const dialog=el("div","ssml-file-dialog");
  dialog.setAttribute("role","dialog");dialog.setAttribute("aria-modal","true");
  dialog.setAttribute("aria-label","Førehandsvising av "+file.name);
  const top=el("div","ssml-file-dialog-top");
  const title=el("div","ssml-file-dialog-title",file.name);
  const close=el("button","ssml-file-dialog-close","Lukk");close.type="button";
  const viewer=kind(file.name)==="image"?el("img"):el("iframe");
  if(viewer.tagName==="IMG")viewer.alt=file.name;
  viewer.src=url;
  let previous=document.activeElement;
  function dismiss(){document.removeEventListener("keydown",onKey);modal.remove();URL.revokeObjectURL(url);previous?.focus?.();}
  function onKey(e){if(e.key==="Escape")dismiss();}
  close.addEventListener("click",dismiss);
  modal.addEventListener("click",e=>{if(e.target===modal)dismiss();});
  document.addEventListener("keydown",onKey);
  top.append(title,close);dialog.append(top,viewer);modal.append(dialog);document.body.append(modal);close.focus();
}
export function mountSharedFiles({slot,listId,formId,inputId,statusId}){
  const list=document.getElementById(listId),form=document.getElementById(formId),input=document.getElementById(inputId),status=document.getElementById(statusId);
  if(!list||!form)return;
  installStyles();
  list.classList.add("ssml-files-list");
  const heading=el("div","ssml-files-heading");
  const headingTitle=el("strong",null,"Filer i arrangementet");
  const count=el("span","ssml-files-count","…");
  heading.append(headingTitle,count);
  list.parentNode.insertBefore(heading,list);
  let requestId=0;
  async function refresh(){
    const seq=++requestId;
    const id=typeof slot==="function"?slot():slot;
    if(!id){list.textContent="Vel eit arrangement først.";count.textContent="0 filer";return;}
    list.textContent="Hentar filer …";
    try{
      const files=await listSharedFiles(id);
      if(seq!==requestId)return;
      count.textContent=files.length===1?"1 fil":files.length+" filer";
      list.replaceChildren();
      if(!files.length){list.append(el("div","ssml-file-empty","📂 Ingen filer enno. Last opp den første fila for å dele henne med komiteen."));return;}
      for(const file of files){
        const row=el("div","ssml-file-row");
        const fileIcon=el("div","ssml-file-icon",iconFor(file.name));
        const info=el("div","ssml-file-info");
        const name=el("div","ssml-file-name",file.name);
        const meta=el("div","ssml-file-meta",ext(file.name).toUpperCase()+" · Delt i dette arrangementet");
        info.append(name,meta);
        const actions=el("div","ssml-file-actions");
        if(["image","pdf"].includes(kind(file.name))){
          const preview=el("button","ssml-file-preview-btn","Vis fil");preview.type="button";
          preview.addEventListener("click",async()=>{preview.disabled=true;preview.textContent="Hentar …";try{await previewFile(file);}catch(e){alert("Førehandsvising feila: "+(e.message||"Ukjend feil"));}finally{preview.disabled=false;preview.textContent="Vis fil";}});
          actions.append(preview);
        }
        const download=el("button","ssml-file-download-btn","↓ Last ned");download.type="button";
        download.addEventListener("click",async()=>{download.disabled=true;download.textContent="Hentar …";try{await downloadFile(file);}catch(e){alert("Nedlasting feila: "+(e.message||"Ukjend feil"));}finally{download.disabled=false;download.textContent="↓ Last ned";}});
        actions.append(download);row.append(fileIcon,info,actions);list.append(row);
      }
    }catch(e){if(seq!==requestId)return;count.textContent="Feil";list.textContent="Kunne ikkje hente filene. Kontroller tilgangen til arrangementet.";console.error(e);}
  }
  form.addEventListener("submit",async ev=>{
    ev.preventDefault();
    const id=typeof slot==="function"?slot():slot,file=input.files?.[0],button=form.querySelector('button[type="submit"]');
    if(!id||!file)return;
    button.disabled=true;status.textContent="Lastar opp …";
    try{await uploadSharedFile(id,file);input.value="";status.textContent="Fila er lasta opp.";await refresh();}
    catch(e){status.textContent="Opplasting feila: "+(e.message||"Ukjend feil");}
    finally{button.disabled=false;}
  });
  return refresh;
}
