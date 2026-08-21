import { initFirebase, isFirebaseConfigured, signIn, signOutUser, observeAuth, fetchSongs, saveSong, queuePdfEnhancements, addSongPart, replacePartPdf, updateSongParts, updateSongMetadata, deleteSong, analyzeSongPdf, analyzeNewInstrumentPdf, applySongAnalysis } from "./firebase.js?v=23";
import { enhancePdfFiles } from "./pdf-enhance.js?v=1";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const demoSongs = [
  { id:"demo-1", title:"Bruremarsj frå Lødingen", composer:"Trad.", arranger:"Jan Magne Førde", mode:"separate", createdAt:"2026-08-10T10:00:00Z", parts:[{id:"d1",name:"Fløyte 1",fileName:"Fløyte 1.pdf",url:null,pageCount:2},{id:"d2",name:"Klarinett 1",fileName:"Klarinett 1.pdf",url:null,pageCount:2},{id:"d3",name:"Althorn",fileName:"Althorn.pdf",url:null,pageCount:2}]},
  { id:"demo-2", title:"Norge i rødt, hvitt og blått", composer:"Lars-Erik Larsson", arranger:"Idar Torskangerpoll", mode:"combined", createdAt:"2026-08-04T10:00:00Z", parts:[{id:"d4",name:"Samla partitur",fileName:"partitur.pdf",url:null,pageCount:4}]},
  { id:"demo-3", title:"Fairytale", composer:"Alexander Rybak", arranger:"Lars Erik Gudim", mode:"separate", createdAt:"2026-07-29T10:00:00Z", parts:[{id:"d5",name:"Partitur",fileName:"Partitur.pdf",url:null,pageCount:3},{id:"d6",name:"Trompet 1",fileName:"Trompet 1.pdf",url:null,pageCount:2}]}
];
let state = { demo:false, songs:[], files:[], appendFiles:[], newInstrumentFile:null, activeSong:null, activePart:null, selectedPartIds:new Set(), selectedPage:"all", pdfDoc:null, visiblePages:[], viewerIndex:0, pendingSong:null, pendingAnalysis:null, previewVersion:0, viewOriginal:false };
let firebase = null;
const previewPdfCache = new Map();

function isMobilePreview(){return window.matchMedia?.("(max-width: 850px)")?.matches ?? window.innerWidth<=850;}
function releasePdf(pdf){try{const result=pdf?.destroy?.();result?.catch?.(()=>{});}catch{}}
function clearPreviewPdfCache(){for(const pdf of previewPdfCache.values())releasePdf(pdf);previewPdfCache.clear();state.pdfDoc=null;}
function cachePreviewPdf(sourceUrl,pdf){
  if(previewPdfCache.has(sourceUrl))previewPdfCache.delete(sourceUrl);
  previewPdfCache.set(sourceUrl,pdf);
  const limit=isMobilePreview()?1:8;
  while(previewPdfCache.size>limit){
    const [oldUrl,oldPdf]=previewPdfCache.entries().next().value;
    previewPdfCache.delete(oldUrl);
    if(oldPdf!==state.pdfDoc)releasePdf(oldPdf);
  }
}

function toast(message, type="ok") { const el=document.createElement("div"); el.className=`toast ${type}`; el.textContent=message; $("#toast-region").append(el); setTimeout(()=>el.remove(),3500); }
function escapeHtml(value="") { const div=document.createElement("div"); div.textContent=value; return div.innerHTML; }
function formatDate(value) { const date=value?.toDate ? value.toDate() : new Date(value); return Number.isNaN(date.getTime()) ? "Nyleg" : new Intl.DateTimeFormat("nn-NO",{day:"numeric",month:"short",year:"numeric"}).format(date); }

async function boot() {
  bindEvents();
  try { firebase = await initFirebase(); } catch (error) { console.error(error); toast("Kunne ikkje starte Firebase. Demo er framleis tilgjengeleg.","error"); }
  if (firebase) {
    $("#login-help").textContent="Logg inn med ein brukar oppretta i Firebase Authentication.";
    observeAuth(async user => { if (user) await enterApp(user); else showLogin(); });
  }
}

function bindEvents() {
  $("#login-form").addEventListener("submit", async event => { event.preventDefault(); try { await signIn($("#email").value,$("#password").value); } catch(error){ toast(authMessage(error.code),"error"); } });
  $("#demo-login").addEventListener("click",()=>{ state.demo=true; enterApp({displayName:"Demo-brukar",email:"Lokal modus"}); });
  $("#logout").addEventListener("click",async()=>{ if(!state.demo) await signOutUser(); clearPreviewPdfCache(); state={...state,demo:false,songs:[],activeSong:null}; showLogin(); });
  $$('[data-view]').forEach(button=>button.addEventListener("click",()=>showView(button.dataset.view)));
  $$('[data-action="open-import"]').forEach(button=>button.addEventListener("click",()=>$("#import-dialog").showModal()));
  $$('[data-close-dialog]').forEach(button=>button.addEventListener("click",()=>button.closest("dialog").close()));
  $("#menu-button").addEventListener("click",()=>$(".sidebar").classList.toggle("open"));
  $("#global-search").addEventListener("input",event=>{ $("#archive-search").value=event.target.value; showView("archive"); renderArchive(); });
  $("#archive-search").addEventListener("input",renderArchive); $("#archive-sort").addEventListener("change",renderArchive);
  document.addEventListener("keydown",event=>{ if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();$("#global-search").focus();} });
  const zone=$("#drop-zone"), input=$("#pdf-files"); input.addEventListener("change",()=>addFiles(input.files));
  ["dragenter","dragover"].forEach(name=>zone.addEventListener(name,event=>{event.preventDefault();zone.classList.add("drag");}));
  ["dragleave","drop"].forEach(name=>zone.addEventListener(name,event=>{event.preventDefault();zone.classList.remove("drag");}));
  zone.addEventListener("drop",event=>addFiles(event.dataTransfer.files));
  $("#import-form").addEventListener("submit",handleImport); $("#print-form").addEventListener("submit",handlePrint);
  $("#page-choice").addEventListener("change",event=>state.selectedPage=event.target.value);
  $("#add-part-row").addEventListener("click",()=>addPartEditorRow());
  $("#parts-form").addEventListener("submit",savePartAssignments);
  $("#edit-part-form").addEventListener("submit",saveActivePartName);
  $("#edit-song-form").addEventListener("submit",saveSongMetadata);
  $("#append-pages-file").addEventListener("change",event=>addAppendFiles(event.target.files));
  $("#append-pages-form").addEventListener("submit",saveAppendedPages);
  $("#new-instrument-file").addEventListener("change",event=>selectNewInstrumentFile(event.target.files?.[0]));
  $("#add-instrument-form").addEventListener("submit",saveNewInstrument);
  $("#previous-page").addEventListener("click",()=>moveViewer(-1));
  $("#next-page").addEventListener("click",()=>moveViewer(1));
  $("#print-current-page").addEventListener("click",()=>printPageNumbers([state.visiblePages[state.viewerIndex]]));
  $("#review-add-part").addEventListener("click",()=>addReviewPart());
  $("#ai-review-form").addEventListener("submit",confirmAnalysis);
  window.addEventListener("pagehide",()=>clearPreviewPdfCache());
}

function authMessage(code="") { if(code.includes("invalid-credential")) return "Feil e-post eller passord."; if(code.includes("too-many")) return "For mange forsøk. Vent litt og prøv igjen."; return "Innlogginga mislukkast. Kontroller Firebase-oppsettet."; }
function showLogin(){ $("#login-view").classList.remove("hidden");$("#app-shell").classList.add("hidden"); }
async function enterApp(user){ $("#login-view").classList.add("hidden");$("#app-shell").classList.remove("hidden");$("#user-name").textContent=user.displayName||user.email?.split("@")[0]||"SSML-brukar";$("#user-email").textContent=user.email||"Lokal modus"; try { state.songs=state.demo?[...demoSongs,...loadLocalSongs()]:await fetchSongs(); } catch(error){toast("Kunne ikkje hente arkivet.","error");state.songs=[];} renderAll();showView("home"); }
function showView(name){ if(name!=="song"&&state.activeSong)clearPreviewPdfCache(); $$(".view").forEach(view=>view.classList.add("hidden"));$(`#${name}-view`)?.classList.remove("hidden");$$('.nav-item[data-view]').forEach(x=>x.classList.toggle("active",x.dataset.view===name));$(".sidebar").classList.remove("open"); if(name==="archive")renderArchive(); window.scrollTo({top:0,behavior:"smooth"}); }
function renderAll(){ const parts=state.songs.flatMap(song=>song.parts||[]);$("#song-count").textContent=state.songs.length;$("#part-count").textContent=parts.length;$("#pdf-count").textContent=parts.length;renderCards($("#recent-grid"),[...state.songs].slice(0,6));renderArchive(); }
function renderArchive(){ const term=$("#archive-search").value.toLowerCase().trim();let songs=state.songs.filter(song=>[song.title,song.composer,song.arranger].join(" ").toLowerCase().includes(term)); const sort=$("#archive-sort").value;songs.sort((a,b)=>sort==="title"?a.title.localeCompare(b.title,"no"):sort==="composer"?(a.composer||"").localeCompare(b.composer||"","no"):new Date(b.createdAt)-new Date(a.createdAt));$("#result-count").textContent=`${songs.length} ${songs.length===1?"song":"songar"}`;renderCards($("#archive-grid"),songs); }
function renderCards(container,songs){ container.innerHTML="";if(!songs.length){container.append($("#empty-template").content.cloneNode(true));container.querySelector('[data-action="open-import"]').addEventListener("click",()=>$("#import-dialog").showModal());return;} songs.forEach(song=>{const card=document.createElement("article");card.className="song-card";card.tabIndex=0;card.innerHTML=`<div class="cover"><span class="cover-badge">${song.mode==="combined"?"Samla PDF":"Separate stemmer"}</span></div><div class="song-card-body"><h3>${escapeHtml(song.title)}</h3><p>${escapeHtml(song.composer||"Ukjend komponist")}${song.arranger?` · arr. ${escapeHtml(song.arranger)}`:""}</p><div class="song-meta"><span>${song.parts?.length||0} stemmer</span><span>${formatDate(song.createdAt)}</span></div></div>`;card.addEventListener("click",()=>openSong(song.id));card.addEventListener("keydown",e=>{if(e.key==="Enter")openSong(song.id)});container.append(card);}); }

function addFiles(fileList){ const pdfs=[...fileList].filter(file=>file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf")); const rejected=[...fileList].length-pdfs.length;if(rejected)toast(`${rejected} fil(er) vart hoppa over fordi dei ikkje er PDF.`,"error");state.files=[...state.files,...pdfs].filter((file,index,all)=>all.findIndex(x=>x.name===file.name&&x.size===file.size)===index);renderFiles(); }
function renderFiles(){ const list=$("#file-list");list.innerHTML="";state.files.forEach((file,index)=>{const row=document.createElement("div");row.className="file-row";row.innerHTML=`<div><strong>▧ ${escapeHtml(file.name)}</strong><small>${(file.size/1048576).toFixed(1)} MB</small></div><button type="button" aria-label="Fjern">×</button>`;row.querySelector("button").addEventListener("click",()=>{state.files.splice(index,1);renderFiles();});list.append(row);}); }
async function handleImport(event){ event.preventDefault();if(!state.files.length){toast("Vel minst éi PDF-fil.","error");return;}const button=$("#save-song");button.disabled=true;button.textContent=state.demo?"Lagrar …":"Lastar opp originalar …";const enteredTitle=$("#song-title").value.trim();const base={title:enteredTitle||state.files[0].name.replace(/\.pdf$/i,""),composer:$("#composer").value.trim(),arranger:$("#arranger").value.trim(),mode:$("input[name=pdf-mode]:checked").value,createdAt:new Date().toISOString()};const sourceFiles=[...state.files];try{let song;if(state.demo){song={id:`local-${Date.now()}`,...base,parts:sourceFiles.map((file,index)=>({id:`local-part-${Date.now()}-${index}`,name:base.mode==="combined"?"Samla partitur":file.name.replace(/\.pdf$/i,""),fileName:file.name,url:URL.createObjectURL(file),pageCount:null}))};saveLocalMetadata(song);state.songs.unshift(song);finishImportUi();openSong(song.id);toast("Demo-import er lagra utan AI-analyse.");return;}song=await saveSong(base,sourceFiles,[]);state.pendingSong=song;if($("#enhance-scans").checked){button.textContent="Legg PDF-forbetring i kø …";try{song.parts=await queuePdfEnhancements(song);toast("Originalane er lagra. PDF-forbetringa køyrer trygt i bakgrunnen.");}catch(queueError){console.error(queueError);toast("Originalane er lagra, men PDF-forbetringa kunne ikkje leggjast i kø.","error");}}button.textContent="AI analyserer filene …";toast("PDF-ane er lasta opp. AI analyserer notane …");const analysis=await analyzeSongPdf(song,sourceFiles);state.pendingAnalysis=analysis;finishImportUi();openAnalysisReview(song,analysis);}catch(error){console.error(error);if(state.pendingSong&&!state.songs.some(x=>x.id===state.pendingSong.id)){state.songs.unshift(state.pendingSong);renderAll();finishImportUi();}toast(aiErrorMessage(error),"error");}finally{button.disabled=false;button.textContent="Lagre i arkivet";} }
function finishImportUi(){state.files=[];renderFiles();$("#import-form").reset();$("#import-dialog").close();}
function aiErrorMessage(error){const text=String(error?.message||error);if(text.includes("app-check")||text.includes("App Check"))return "AI blei blokkert av App Check. Registrer debug-nøkkelen og prøv igjen.";if(text.includes("403"))return "AI-tenesta manglar tilgang. Kontroller AI Logic-oppsettet.";return "PDF-en vart lagra, men AI-analysen mislukkast. Sjå konsollen for detaljar.";}
function saveLocalMetadata(song){ const stored=JSON.parse(localStorage.getItem("ssml-demo-songs")||"[]");stored.unshift({...song,parts:song.parts.map(part=>({...part,url:null}))});localStorage.setItem("ssml-demo-songs",JSON.stringify(stored.slice(0,20))); }
function loadLocalSongs(){try{return JSON.parse(localStorage.getItem("ssml-demo-songs")||"[]");}catch{return[];}}

function openAnalysisReview(song,analysis){$("#review-title").value=analysis.title||song.title;$("#review-composer").value=analysis.composer||song.composer||"";$("#review-arranger").value=analysis.arranger||song.arranger||"";const list=$("#review-parts");list.innerHTML="";(analysis.parts||[]).forEach(part=>addReviewPart(part));if(!analysis.parts?.length)addReviewPart({name:"Samla partitur",pageNumbers:[]});$("#ai-review-dialog").showModal();}
function addReviewPart(part={}){const row=document.createElement("div");row.className="part-editor-row review-part-row";const pages=(part.pageNumbers||[]).join(", ");row.dataset.fileName=part.fileName||"";row.dataset.confidence=part.confidence??0;row.innerHTML=`<label>Instrument/stemme<input class="review-part-name" required value="${escapeHtml(part.name||[part.instrument,part.voice].filter(Boolean).join(" "))}" placeholder="Fløyte 1"></label><label>PDF-sider<input class="review-part-pages" required value="${escapeHtml(pages)}" placeholder="1, 2"></label><button class="icon-btn" type="button" aria-label="Fjern">×</button>`;row.querySelector("button").addEventListener("click",()=>row.remove());$("#review-parts").append(row);}
async function confirmAnalysis(event){event.preventDefault();const song=state.pendingSong;if(!song)return;const button=$("#review-save");button.disabled=true;button.textContent="Lagrar …";try{const rows=$$(".review-part-row");const parts=rows.map((row,index)=>{const requested=row.dataset.fileName;const source=song.parts.find(part=>part.fileName===requested)||song.parts[Math.min(index,song.parts.length-1)]||song.parts[0];const numbers=parsePageNumbersLoose($(".review-part-pages",row).value);return{...source,id:`${song.id}-ai-${index}`,name:$(".review-part-name",row).value.trim(),pageCount:null,pageNumbers:numbers,confidence:Number(row.dataset.confidence)||0};});const metadata={title:$("#review-title").value.trim(),composer:$("#review-composer").value.trim(),arranger:$("#review-arranger").value.trim(),confidence:Number(state.pendingAnalysis?.confidence)||0};await applySongAnalysis(song.id,metadata,parts);Object.assign(song,metadata,{parts,mode:"analyzed"});if(!state.songs.some(item=>item.id===song.id))state.songs.unshift(song);state.pendingSong=null;state.pendingAnalysis=null;$("#ai-review-dialog").close();renderAll();toast(`«${song.title}» er analysert og lagra.`);openSong(song.id);}catch(error){console.error(error);toast(error.message||"Kunne ikkje lagre analysen.","error");}finally{button.disabled=false;button.textContent="Godkjenn og lagre";}}
function parsePageNumbersLoose(text){const pages=new Set();for(const token of text.replace(/–/g,"-").split(",")){const bit=token.trim();if(!bit)continue;if(bit.includes("-")){const[start,end]=bit.split("-").map(Number);if(!start||!end||start>end)throw new Error(`Ugyldig sideområde: ${bit}`);for(let n=start;n<=end;n++)pages.add(n);}else{const n=Number(bit);if(!n)throw new Error(`Ugyldig sidetal: ${bit}`);pages.add(n);}}if(!pages.size)throw new Error("Kvar stemme må ha minst éi side.");return[...pages].sort((a,b)=>a-b);}

const SSML_PART_ORDER=[
  {rank:0,pattern:/partitur|full score|score|conductor|dirigent/},
  {rank:10,pattern:/piccolo/},
  {rank:20,pattern:/fløyte|flute/},
  {rank:30,pattern:/oboe|\bobo\b/},
  {rank:40,pattern:/engelsk horn|english horn|cor anglais/},
  {rank:51,pattern:/kontrafagott|contrabassoon/},
  {rank:50,pattern:/fagott|bassoon/},
  {rank:60,pattern:/(^|\s)(ess|eb|e-flat|e flat|e♭)[-\s]*(klarinett|clarinet)/},
  {rank:80,pattern:/kontra[-\s]*altklarinett|contra[-\s]*alto clarinet/},
  {rank:81,pattern:/altklarinett|alto clarinet/},
  {rank:90,pattern:/kontrabassklarinett|contrabass clarinet/},
  {rank:91,pattern:/bassklarinett|bass clarinet/},
  {rank:70,pattern:/klarinett|clarinet/},
  {rank:100,pattern:/sopransaksofon|soprano sax/},
  {rank:110,pattern:/altsaksofon|alto sax/},
  {rank:120,pattern:/tenorsaksofon|tenor sax/},
  {rank:130,pattern:/barytonsaksofon|baritonsaksofon|baritone sax|bari sax/},
  {rank:140,pattern:/althorn|alto horn|tenorhorn|tenor horn|french horn|f-horn|\bhorn\b/},
  {rank:150,pattern:/kornett|cornet/},
  {rank:160,pattern:/flygelhorn|flugelhorn/},
  {rank:170,pattern:/trompet|trumpet/},
  {rank:190,pattern:/basstrombone|bass trombone/},
  {rank:180,pattern:/trombone/},
  {rank:200,pattern:/baryton|baritone|eufonium|euphonium/},
  {rank:210,pattern:/tuba/},
  {rank:220,pattern:/strykebass|string bass|double bass|contrabass|kontrabass/},
  {rank:230,pattern:/elektrisk bass|electric bass|bass guitar/},
  {rank:240,pattern:/pauker|timpani/},
  {rank:250,pattern:/melodisk slagverk|mallet|xylophone|xylofon|glockenspiel|bells|klokkespill|vibraphone|vibes|vibrafon|marimba/},
  {rank:260,pattern:/slagverk|percussion/},
  {rank:270,pattern:/trommesett|drum set|drumset|drums/}
];
function partOrderValue(part){
  const fileName=(part.fileName||"").toLowerCase().replace(/\.pdf$/i,"");
  const displayName=(part.name||"").toLowerCase();
  const fileMatch=SSML_PART_ORDER.find(item=>item.pattern.test(fileName));
  const nameMatch=SSML_PART_ORDER.find(item=>item.pattern.test(displayName));
  const match=fileMatch||nameMatch;
  const rank=match?.rank??999;
  const voiceSource=fileMatch?fileName:`${displayName} ${fileName}`;
  const voice=Number(voiceSource.match(/\b([1-9])\b/)?.[1]||0);
  return rank*100+voice;
}
function sortParts(parts=[]){return [...parts].sort((a,b)=>partOrderValue(a)-partOrderValue(b)||(a.fileName||"").localeCompare(b.fileName||"","no",{numeric:true})||(a.name||"").localeCompare(b.name||"","no",{numeric:true}));}
function openSong(id){ const song=state.songs.find(x=>x.id===id);if(!song)return;if(state.activeSong?.id!==id)clearPreviewPdfCache();song.parts=sortParts(song.parts||[]);state.activeSong=song;state.activePart=song.parts?.[0]||null;state.selectedPartIds=new Set(state.activePart?[state.activePart.id]:[]);state.selectedPage="all";state.viewOriginal=false;renderSongDetail();showView("song");if(state.activePart)loadPreview(state.activePart); }
function renderSongDetail(){ const song=state.activeSong;$("#song-detail").dataset.songId=song.id;const canMap=song.mode==="combined"||song.mode==="mapped";const hasEnhanced=(song.parts||[]).some(part=>part.enhancedUrl);const sourceButton=hasEnhanced?`<button id="toggle-pdf-source" class="btn btn-ghost source-toggle" type="button">${state.viewOriginal?"Vis forbetra":"Vis original"}</button>`:"";$("#song-detail").innerHTML=`<div class="detail-header"><div><p class="eyebrow">${canMap?"Samla PDF":"Stemmebibliotek"}</p><h1>${escapeHtml(song.title)}</h1><p>${escapeHtml(song.composer||"Ukjend komponist")}${song.arranger?` · arrangert av ${escapeHtml(song.arranger)}`:""}</p></div><div class="detail-actions"><span>${formatDate(song.createdAt)}</span><button id="edit-song" class="btn btn-light" type="button">Rediger informasjon</button><button id="delete-song" class="btn btn-danger" type="button">Slett sang</button></div></div><div class="parts-layout"><aside class="parts-panel"><div class="preview-toolbar"><h2>Stemmer <small>(${song.parts?.length||0})</small></h2><button id="add-instrument" class="text-btn" type="button">＋ Legg til instrument</button>${canMap?'<button id="map-parts" class="text-btn">Rediger</button>':""}</div><div class="part-selection-tools"><button id="select-all-parts" class="text-btn" type="button">Velg alle</button><button id="print-selected-parts" class="btn btn-primary" type="button">Skriv ut valgte</button></div><div id="part-list"></div>${song.mode==="combined"?'<button id="map-parts-main" class="btn btn-primary btn-wide">Fordel instrument og stemmer</button>':""}</aside><section class="preview-panel"><div class="preview-toolbar"><h2 id="preview-title">Førehandsvising</h2><div class="preview-actions">${sourceButton}<button id="append-pages" class="btn btn-ghost" type="button">＋ Legg til sider</button><button id="edit-active-part" class="btn btn-ghost" type="button">Rediger instrument</button><button id="open-print" class="btn btn-primary">⌁ Skriv ut stemma</button></div></div><div id="thumbnail-grid" class="thumbnail-grid"></div></section></div>`;renderPartList();$("#open-print").addEventListener("click",openPrintDialog);$("#append-pages").addEventListener("click",openAppendPagesDialog);$("#add-instrument").addEventListener("click",openAddInstrumentDialog);$("#edit-active-part").addEventListener("click",openActivePartEditor);$("#edit-song").addEventListener("click",openSongEditor);$("#toggle-pdf-source")?.addEventListener("click",togglePdfSource);$("#select-all-parts").addEventListener("click",toggleAllParts);$("#print-selected-parts").addEventListener("click",printSelectedParts);$("#delete-song").addEventListener("click",handleDeleteSong);$("#map-parts")?.addEventListener("click",openPartsEditor);$("#map-parts-main")?.addEventListener("click",openPartsEditor); }

function openAddInstrumentDialog(){
  const song=state.activeSong;if(!song)return;
  state.newInstrumentFile=null;
  $("#add-instrument-form").reset();
  $("#add-instrument-song-title").textContent=song.title||"Denne songen";
  $("#new-instrument-summary").textContent="Vel éi PDF-fil. AI bruker filnamnet og dei første sidene for å finne instrument.";
  $("#add-instrument-dialog").showModal();
}
function selectNewInstrumentFile(file){
  state.newInstrumentFile=null;
  const summary=$("#new-instrument-summary");
  if(!file){summary.textContent="Vel éi PDF-fil. AI bruker filnamnet og dei første sidene for å finne instrument.";return;}
  if(!(file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf"))){$("#new-instrument-file").value="";summary.textContent="Filen må vere ein PDF.";toast("Vel ei PDF-fil.","error");return;}
  if(file.size>50*1024*1024){$("#new-instrument-file").value="";summary.textContent="PDF-en er større enn 50 MB.";toast("PDF-en kan vere maks 50 MB.","error");return;}
  state.newInstrumentFile=file;
  summary.textContent=`${file.name} · ${(file.size/1048576).toFixed(1)} MB`;
}
function normalizedSongTitle(value=""){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function titlesProbablyMatch(a,b){
  const left=normalizedSongTitle(a),right=normalizedSongTitle(b);if(!left||!right||left===right||left.includes(right)||right.includes(left))return true;
  const ignore=new Set(["the","and","for","med","selection","selections","broadway"]);
  const tokens=value=>new Set(value.split(" ").filter(token=>token.length>2&&!ignore.has(token)));
  const one=tokens(left),two=tokens(right);if(!one.size||!two.size)return true;
  const overlap=[...one].filter(token=>two.has(token)).length;
  return overlap/Math.min(one.size,two.size)>=0.6;
}
async function saveNewInstrument(event){
  event.preventDefault();const song=state.activeSong,file=state.newInstrumentFile;
  if(!song||!file){toast("Vel PDF-en til det nye instrumentet.","error");return;}
  if(state.demo){toast("Nye instrument kan berre leggjast til i Firebase-modus.","error");return;}
  const button=$("#save-new-instrument");button.disabled=true;button.textContent="AI analyserer instrumentet …";
  try{
    const analysis=await analyzeNewInstrumentPdf(song,file);
    const detected=(analysis.parts||[]).find(part=>part.fileName===file.name)||(analysis.parts||[])[0];
    const name=(detected?.name||[detected?.instrument,detected?.voice].filter(Boolean).join(" ")||file.name.replace(/\.pdf$/i,"")).trim();
    if(analysis.title&&song.title&&!titlesProbablyMatch(analysis.title,song.title)){
      const proceed=confirm(`AI fann tittelen «${analysis.title}», medan den opne songen er «${song.title}». Legg til «${name}» likevel?`);
      if(!proceed)return;
    }
    button.textContent="Lastar opp …";
    const result=await addSongPart(song.id,song.parts||[],file,name,analysis.sourcePageCount||1);
    song.parts=sortParts(result.parts);
    state.activePart=song.parts.find(part=>part.id===result.part.id)||result.part;
    state.selectedPartIds=new Set([state.activePart.id]);
    clearPreviewPdfCache();state.viewOriginal=false;state.newInstrumentFile=null;
    $("#add-instrument-dialog").close();renderSongDetail();await renderSelectedPreview();renderAll();toast(`«${name}» er lagt til i «${song.title}».`);
  }catch(error){console.error(error);toast(error.message||"Kunne ikkje leggje til instrumentet.","error");}
  finally{button.disabled=false;button.textContent="Analyser og legg til";}
}

function openAppendPagesDialog(){
  const part=state.activePart;if(!part)return;
  state.appendFiles=[];renderAppendFiles();
  $("#append-part-name").textContent=part.name;
  const pageCount=part.pageNumbers?.length||part.pageCount||state.pdfDoc?.numPages||1;
  const position=$("#append-position");position.innerHTML='<option value="0">Før første side</option>';
  for(let index=1;index<pageCount;index++)position.insertAdjacentHTML("beforeend",`<option value="${index}">Etter side ${index}</option>`);
  position.insertAdjacentHTML("beforeend",`<option value="${pageCount}">Etter siste side</option>`);
  $("#append-pages-form").reset();position.value=String(pageCount);$("#enhance-appended-pages").checked=true;
  $("#append-pages-dialog").showModal();
}
function addAppendFiles(fileList){const pdfs=[...fileList].filter(file=>file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf"));state.appendFiles=[...state.appendFiles,...pdfs].filter((file,index,all)=>all.findIndex(item=>item.name===file.name&&item.size===file.size)===index);renderAppendFiles();}
function renderAppendFiles(){const list=$("#append-file-list");list.innerHTML="";state.appendFiles.forEach((file,index)=>{const row=document.createElement("div");row.className="file-row";row.innerHTML=`<div><strong>▧ ${escapeHtml(file.name)}</strong><small>${(file.size/1048576).toFixed(1)} MB</small></div><button type="button" aria-label="Fjern">×</button>`;row.querySelector("button").addEventListener("click",()=>{state.appendFiles.splice(index,1);renderAppendFiles();});list.append(row);});$("#append-summary").textContent=state.appendFiles.length?`${state.appendFiles.length} PDF-fil(er) blir sette inn i den viste rekkefølgja.`:"Vel éi eller fleire PDF-filer.";}

async function mergePartPdf(existingUrl,existingPages,newFiles,insertAt,fileName){
  const {PDFDocument}=await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
  const response=await fetch(existingUrl);if(!response.ok)throw new Error("Kunne ikkje hente den eksisterande stemma.");
  const current=await PDFDocument.load(await response.arrayBuffer());const output=await PDFDocument.create();
  const indexes=(existingPages?.length?existingPages:Array.from({length:current.getPageCount()},(_,index)=>index+1)).map(number=>number-1);
  const addExisting=async selected=>{if(!selected.length)return;const pages=await output.copyPages(current,selected);pages.forEach(page=>output.addPage(page));};
  await addExisting(indexes.slice(0,insertAt));
  for(const file of newFiles){const source=await PDFDocument.load(await file.arrayBuffer());const pages=await output.copyPages(source,source.getPageIndices());pages.forEach(page=>output.addPage(page));}
  await addExisting(indexes.slice(insertAt));
  return new File([await output.save()],fileName,{type:"application/pdf"});
}

async function saveAppendedPages(event){
  event.preventDefault();const part=state.activePart;if(!part||!state.appendFiles.length){toast("Vel minst éi PDF-fil.","error");return;}if(state.demo){toast("Sider kan berre leggjast til i Firebase-modus.","error");return;}
  const button=$("#save-appended-pages");button.disabled=true;button.textContent="Klargjer nye sider …";
  try{
    const insertAt=Number($("#append-position").value);let results=state.appendFiles.map(file=>({enhanced:file,changed:false}));
    if($("#enhance-appended-pages").checked)results=await enhancePdfFiles(state.appendFiles,message=>button.textContent=message);
    const safeName=`${state.activeSong.title}-${part.name}.pdf`.replace(/[\\/:*?"<>|]+/g,"-");const existingPages=part.pageNumbers?.length?part.pageNumbers:null;
    const originalMerged=await mergePartPdf(part.originalUrl||part.url,existingPages,state.appendFiles,insertAt,safeName);
    const needsEnhanced=Boolean(part.enhancedUrl)||results.some(result=>result.changed);
    const enhancedMerged=needsEnhanced?await mergePartPdf(part.enhancedUrl||part.url||part.originalUrl,existingPages,results.map(result=>result.enhanced),insertAt,safeName):null;
    const {PDFDocument}=await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");const pageCount=(await PDFDocument.load(await originalMerged.arrayBuffer())).getPageCount();
    const prepared=state.activeSong.parts.map(item=>item.id===part.id?{...item,pageCount}:item);button.textContent="Lastar opp …";
    const nextParts=await replacePartPdf(state.activeSong.id,prepared,part.id,originalMerged,enhancedMerged);
    state.activeSong.parts=sortParts(nextParts);state.activePart=state.activeSong.parts.find(item=>item.id===part.id);state.selectedPartIds.add(part.id);clearPreviewPdfCache();state.viewOriginal=false;
    $("#append-pages-dialog").close();renderSongDetail();await renderSelectedPreview();renderAll();toast(`Nye sider vart lagde til i «${part.name}».`);state.appendFiles=[];
  }catch(error){console.error(error);toast(error.message||"Kunne ikkje leggje til sidene.","error");}finally{button.disabled=false;button.textContent="Legg til sidene";}
}

function openSongEditor(){const song=state.activeSong;if(!song)return;$("#edit-song-title").value=song.title||"";$("#edit-song-composer").value=song.composer||"";$("#edit-song-arranger").value=song.arranger||"";$("#edit-song-dialog").showModal();setTimeout(()=>$("#edit-song-title").select(),0);}
async function saveSongMetadata(event){event.preventDefault();const song=state.activeSong;if(!song)return;const metadata={title:$("#edit-song-title").value.trim(),composer:$("#edit-song-composer").value.trim(),arranger:$("#edit-song-arranger").value.trim()};if(!metadata.title){toast("Songen må ha ein tittel.","error");return;}const button=$("#save-song-metadata");button.disabled=true;button.textContent="Lagrar …";try{if(state.demo)throw new Error("Redigering må gjerast i Firebase-modus.");await updateSongMetadata(song.id,metadata);Object.assign(song,metadata);$("#edit-song-dialog").close();renderSongDetail();renderSelectedPreview();renderAll();toast("Songinformasjonen er oppdatert.");}catch(error){console.error(error);toast(error.message||"Kunne ikkje lagre songinformasjonen.","error");}finally{button.disabled=false;button.textContent="Lagre endringar";}}

async function handleDeleteSong(){const song=state.activeSong;if(!song||!confirm(`Slette «${song.title}» og alle PDF-filene? Dette kan ikkje angrast.`))return;const button=$("#delete-song");button.disabled=true;button.textContent="Slettar …";try{state.previewVersion++;clearPreviewPdfCache();if(state.demo){const stored=loadLocalSongs().filter(item=>item.id!==song.id);localStorage.setItem("ssml-demo-songs",JSON.stringify(stored));}else await deleteSong(song);state.songs=state.songs.filter(item=>item.id!==song.id);state.activeSong=null;state.activePart=null;renderAll();showView("archive");toast(`«${song.title}» er sletta.`);}catch(error){console.error(error);button.disabled=false;button.textContent="Slett sang";toast("Kunne ikkje slette songen og PDF-filene.","error");}}
function renderPartList(){ const list=$("#part-list");list.innerHTML="";sortParts(state.activeSong.parts||[]).forEach(part=>{const row=document.createElement("div");row.className="part-select-row";const checked=state.selectedPartIds.has(part.id);const status=part.enhancementStatus;const processing=status&&!["completed","skipped","not_requested"].includes(status)?` · PDF-forbetring: ${status==="failed"?"feil":"pågår"}`:"";row.innerHTML=`<label class="part-check"><input type="checkbox" ${checked?"checked":""} aria-label="Vel ${escapeHtml(part.name)}"></label><button class="part-btn ${part.id===state.activePart?.id?"active":""}" type="button"><span><strong>${escapeHtml(part.name)}</strong><small>${escapeHtml(part.fileName)}${escapeHtml(processing)}</small></span><span>›</span></button>`;row.querySelector("input").addEventListener("change",event=>{if(event.target.checked)state.selectedPartIds.add(part.id);else state.selectedPartIds.delete(part.id);if(!state.selectedPartIds.has(state.activePart?.id))state.activePart=selectedParts()[0]||null;updatePartSelectionTools();renderPartList();if(isMobilePreview()&&state.selectedPartIds.size>1){state.previewVersion++;clearPreviewPdfCache();showMobileSelectionSummary();}else renderSelectedPreview();});row.querySelector("button").addEventListener("click",()=>focusPreviewPart(part));list.append(row);});updatePartSelectionTools(); }

function updatePartSelectionTools(){const all=state.activeSong?.parts||[];const count=state.selectedPartIds.size;const button=$("#select-all-parts");if(button)button.textContent=all.length&&count===all.length?"Fjern alle":"Velg alle";const printButton=$("#print-selected-parts");if(printButton){printButton.disabled=count===0;printButton.textContent=`Skriv ut valgte (${count})`;}const mainPrint=$("#open-print");if(mainPrint)mainPrint.textContent=count>1?`Skriv ut valgte (${count})`:"⌁ Skriv ut stemma";}
function toggleAllParts(){const parts=state.activeSong.parts||[];state.selectedPartIds=state.selectedPartIds.size===parts.length?new Set():new Set(parts.map(part=>part.id));renderPartList();if(isMobilePreview()&&state.selectedPartIds.size>1){state.previewVersion++;clearPreviewPdfCache();showMobileSelectionSummary();}else renderSelectedPreview();}

function partSourceUrl(part){return state.viewOriginal&&part.originalUrl?part.originalUrl:(part.enhancedUrl||part.url||part.originalUrl);}
async function togglePdfSource(){state.viewOriginal=!state.viewOriginal;clearPreviewPdfCache();state.previewVersion++;renderSongDetail();await renderSelectedPreview();toast(state.viewOriginal?"Viser original-PDF-en.":"Viser den forbetra PDF-en.");}

async function getPreviewPdf(part){
  const sourceUrl=partSourceUrl(part);
  if(!sourceUrl)return null;
  if(previewPdfCache.has(sourceUrl)){
    const cached=previewPdfCache.get(sourceUrl);
    previewPdfCache.delete(sourceUrl);previewPdfCache.set(sourceUrl,cached);
    return cached;
  }
  const pdfjs=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const pdf=await withOperationTimeout(pdfjs.getDocument(sourceUrl).promise,45000,"PDF-en brukte for lang tid på å lastast.");
  cachePreviewPdf(sourceUrl,pdf);
  return pdf;
}

function selectedParts(){return sortParts((state.activeSong?.parts||[]).filter(part=>state.selectedPartIds.has(part.id)));}
function showMobileSelectionSummary(){
  const count=state.selectedPartIds.size;
  const grid=$("#thumbnail-grid");
  const title=$("#preview-title");
  if(title)title.textContent=`${count} valde stemmer`;
  if(grid){
    grid.className="multi-preview";
    grid.innerHTML=`<p class="loading-pages"><strong>${count} stemmer valde.</strong><br>Førehandsvising av fleire PDF-ar er slått av på iPhone/iPad for å spare minne. Du kan framleis sende eller skrive ut dei valde stemmene.</p>`;
  }
}

async function focusPreviewPart(part){
  const wasSelected=state.selectedPartIds.has(part.id);
  if(!wasSelected)state.selectedPartIds.add(part.id);
  state.activePart=part;
  state.selectedPage="all";
  renderPartList();
  if(!wasSelected||state.selectedPartIds.size===1)await renderSelectedPreview();
  updatePreviewFocus(true);
}

function updatePreviewFocus(scroll=false){
  $$(".multi-preview-group").forEach(group=>group.classList.toggle("focused",group.dataset.partId===state.activePart?.id));
  if(!scroll)return;
  const panel=$(".preview-panel");
  const group=$(`.multi-preview-group[data-part-id="${CSS.escape(state.activePart?.id||"")}"]`);
  if(group&&window.innerWidth>850)panel.scrollTo({top:Math.max(0,group.offsetTop-75),behavior:"smooth"});
  else if(group)group.scrollIntoView({behavior:"smooth",block:"start"});
  else panel?.scrollTo({top:0,behavior:"smooth"});
}

async function renderSelectedPreview(){
  const parts=selectedParts();
  const version=++state.previewVersion;
  if(isMobilePreview()&&parts.length>1){clearPreviewPdfCache();showMobileSelectionSummary();return;}
  if(parts.length===0){$("#preview-title").textContent="Førehandsvising";$("#thumbnail-grid").innerHTML='<p class="loading-pages">Kryss av éi eller fleire stemmer for å sjå dei her.</p>';return;}
  if(parts.length===1){state.activePart=parts[0];renderPartList();await loadPreview(parts[0],version);return;}
  const grid=$("#thumbnail-grid");
  grid.className="multi-preview";
  grid.innerHTML='<p class="loading-pages">Lastar valde stemmer …</p>';
  $("#preview-title").textContent=`${parts.length} valde stemmer`;
  let totalPages=0;
  const groups=[];
  try{
    for(const part of parts){
      const pdf=await getPreviewPdf(part);
      if(version!==state.previewVersion)return;
      const pages=part.pageNumbers?.length?part.pageNumbers:Array.from({length:pdf?.numPages||part.pageCount||1},(_,i)=>i+1);
      const previewPages=isMobilePreview()?pages.slice(0,1):pages;
      totalPages+=pages.length;
      const section=document.createElement("section");
      section.className="multi-preview-group";
      section.dataset.partId=part.id;
      const mobileNote=isMobilePreview()&&pages.length>1?" · viser første side":"";
      section.innerHTML=`<header><div><strong>${escapeHtml(part.name)}</strong><small>${pages.length} ${pages.length===1?"side":"sider"}${mobileNote}</small></div><button class="text-btn" type="button">Fjern</button></header><div class="thumbnail-grid"></div>`;
      section.querySelector("button").addEventListener("click",()=>{state.selectedPartIds.delete(part.id);renderPartList();renderSelectedPreview();});
      const pageGrid=$(".thumbnail-grid",section);
      if(pdf){
        part.pageCount=pdf.numPages;
        for(const pageNo of previewPages){
          const page=await pdf.getPage(pageNo);
          const viewport=page.getViewport({scale:isMobilePreview()?.24:.36});
          const canvas=document.createElement("canvas");
          canvas.width=viewport.width;canvas.height=viewport.height;
          await withOperationTimeout(page.render({canvasContext:canvas.getContext("2d"),viewport}).promise,45000,"Ei PDF-side brukte for lang tid på å klargjerast.");
          if(version!==state.previewVersion)return;
          pageGrid.append(makeThumb(canvas,pageNo,part,pdf,pages));
        }
      }
      groups.push(section);
    }
    if(version!==state.previewVersion)return;
    grid.innerHTML="";groups.forEach(group=>grid.append(group));
    $("#preview-title").textContent=`${parts.length} stemmer · ${totalPages} sider`;
    updatePreviewFocus();
  }catch(error){console.error(error);if(version===state.previewVersion)grid.innerHTML='<p class="loading-pages">Éi eller fleire førehandsvisingar kunne ikkje lastast.</p>';}
}

async function loadPreview(part,version=++state.previewVersion){ const grid=$("#thumbnail-grid");grid.className="thumbnail-grid";$("#preview-title").textContent=part.name;grid.innerHTML='<p class="loading-pages">Lastar PDF-sider …</p>';state.pdfDoc=null;if(!partSourceUrl(part)){renderPlaceholderPages(part.pageCount||1);return;}try{state.pdfDoc=await getPreviewPdf(part);if(version!==state.previewVersion)return;part.pageCount=state.pdfDoc.numPages;state.visiblePages=part.pageNumbers?.length?part.pageNumbers:Array.from({length:state.pdfDoc.numPages},(_,i)=>i+1);const previewPages=isMobilePreview()?state.visiblePages.slice(0,1):state.visiblePages;grid.innerHTML="";for(const pageNo of previewPages){const page=await state.pdfDoc.getPage(pageNo);const viewport=page.getViewport({scale:isMobilePreview()?.28:.45});const canvas=document.createElement("canvas");canvas.width=viewport.width;canvas.height=viewport.height;await withOperationTimeout(page.render({canvasContext:canvas.getContext("2d"),viewport}).promise,45000,"Ei PDF-side brukte for lang tid på å klargjerast.");if(version!==state.previewVersion)return;grid.append(makeThumb(canvas,pageNo,part,state.pdfDoc,state.visiblePages));}}catch(error){console.error(error);grid.innerHTML='<p class="loading-pages">Førehandsvisinga kunne ikkje lastast. PDF-en kan framleis opnast og skrivast ut.</p>';} }
function renderPlaceholderPages(count){const grid=$("#thumbnail-grid");grid.innerHTML="";for(let i=1;i<=count;i++){const canvas=document.createElement("canvas");canvas.width=180;canvas.height=250;const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,180,250);ctx.fillStyle="#dce4df";for(let y=65;y<175;y+=13)ctx.fillRect(22,y,136,1);ctx.fillStyle="#174a43";ctx.font="28px serif";ctx.fillText("♫",75,125);grid.append(makeThumb(canvas,i));}}
function makeThumb(canvas,pageNo,part=state.activePart,pdf=state.pdfDoc,pages=state.visiblePages){const wrap=document.createElement("div");wrap.className="page-thumb-wrap";const thumb=document.createElement("button");thumb.className="page-thumb";thumb.type="button";thumb.append(canvas);thumb.insertAdjacentHTML("beforeend",`<small>Side ${pageNo}</small>`);thumb.addEventListener("click",async()=>{state.activePart=part;try{state.pdfDoc=await getPreviewPdf(part);}catch{state.pdfDoc=pdf;}state.visiblePages=pages;state.selectedPage=String(pageNo);renderPartList();updatePreviewFocus();await openLargePage(pageNo);});const remove=document.createElement("button");remove.className="delete-page-btn";remove.type="button";remove.textContent="Slett side";remove.addEventListener("click",()=>removePageFromPart(part,pageNo,pdf));wrap.append(thumb,remove);return wrap;}

function openActivePartEditor(){if(!state.activePart){toast("Vel ei stemme først.","error");return;}$("#edit-part-name").value=state.activePart.name||"";$("#edit-part-dialog").showModal();setTimeout(()=>$("#edit-part-name").select(),0);}
async function saveActivePartName(event){event.preventDefault();const part=state.activePart;const name=$("#edit-part-name").value.trim();if(!part||!name)return;const revised=state.activeSong.parts.map(item=>item.id===part.id?{...item,name}:item);const button=$("#save-part-name");button.disabled=true;try{if(state.demo)throw new Error("Redigering må gjerast i Firebase-modus.");await updateSongParts(state.activeSong.id,revised,state.activeSong.mode);state.activeSong.parts=sortParts(revised);state.activePart=state.activeSong.parts.find(item=>item.id===part.id);$("#edit-part-dialog").close();renderSongDetail();renderSelectedPreview();renderAll();toast(`Namnet er endra til «${name}».`);}catch(error){console.error(error);toast(error.message||"Kunne ikkje lagre instrumentnamnet.","error");}finally{button.disabled=false;}}

async function removePageFromPart(part,pageNo,pdf){const pages=part.pageNumbers?.length?[...part.pageNumbers]:Array.from({length:pdf?.numPages||part.pageCount||1},(_,index)=>index+1);if(pages.length<=1){toast("Ei stemme må ha minst éi side.","error");return;}if(!confirm(`Slette side ${pageNo} frå «${part.name}»? Original-PDF-en blir ikkje sletta.`))return;const updated={...part,pageNumbers:pages.filter(number=>number!==pageNo),pageCount:pdf?.numPages||part.pageCount};const revised=state.activeSong.parts.map(item=>item.id===part.id?updated:item);try{if(state.demo)throw new Error("Sletting må gjerast i Firebase-modus.");await updateSongParts(state.activeSong.id,revised,state.activeSong.mode);state.activeSong.parts=revised;if(state.activePart?.id===part.id)state.activePart=updated;state.selectedPage="all";renderPartList();await renderSelectedPreview();renderAll();toast(`Side ${pageNo} er fjerna frå «${part.name}».`);}catch(error){console.error(error);toast(error.message||"Kunne ikkje slette sida.","error");}}

function openPartsEditor(){const list=$("#part-editor-list");list.innerHTML="";const existing=state.activeSong.mode==="mapped"?state.activeSong.parts:[];if(existing.length)existing.forEach(part=>addPartEditorRow(part.name,formatPageNumbers(part.pageNumbers)));else addPartEditorRow("","");$("#parts-dialog").showModal();}
function addPartEditorRow(name="",pages=""){const row=document.createElement("div");row.className="part-editor-row";row.innerHTML=`<label>Instrument/stemme<input class="part-name" required placeholder="Til dømes Fløyte 1" value="${escapeHtml(name)}"></label><label>PDF-sider<input class="part-pages" required placeholder="Til dømes 1-2, 5" value="${escapeHtml(pages)}"></label><button class="icon-btn" type="button" aria-label="Fjern">×</button>`;row.querySelector("button").addEventListener("click",()=>row.remove());$("#part-editor-list").append(row);}
function parsePageNumbers(text,max){const pages=new Set();for(const token of text.replace(/–/g,"-").split(",")){const bit=token.trim();if(!bit)continue;if(bit.includes("-")){const [start,end]=bit.split("-").map(Number);if(!start||!end||start>end)throw new Error(`Ugyldig sideområde: ${bit}`);for(let page=start;page<=end;page++)pages.add(page);}else{const page=Number(bit);if(!page)throw new Error(`Ugyldig sidetal: ${bit}`);pages.add(page);}}const result=[...pages].sort((a,b)=>a-b);if(!result.length||result.some(page=>page>max))throw new Error(`Sidene må vere mellom 1 og ${max}.`);return result;}
function formatPageNumbers(pages=[]){return pages.join(", ");}
async function savePartAssignments(event){event.preventDefault();const rows=$$(".part-editor-row");if(!rows.length){toast("Legg til minst éi stemme.","error");return;}const source=state.activeSong.parts[0];const max=state.pdfDoc?.numPages||source.pageCount;if(!max){toast("Vent til PDF-en er ferdig lasta.","error");return;}try{const parts=rows.map((row,index)=>({...source,id:`${state.activeSong.id}-part-${index}-${Date.now()}`,name:$(".part-name",row).value.trim(),pageCount:max,pageNumbers:parsePageNumbers($(".part-pages",row).value,max)}));if(state.demo)throw new Error("Stemmefordeling må lagrast i Firebase-modus.");await updateSongParts(state.activeSong.id,parts);state.activeSong.parts=sortParts(parts);state.activeSong.mode="mapped";state.activePart=state.activeSong.parts[0];$("#parts-dialog").close();renderSongDetail();loadPreview(state.activePart);renderAll();toast("Instrument og stemmer er lagra.");}catch(error){toast(error.message||"Kunne ikkje lagre stemmene.","error");}}

async function openLargePage(pageNo){if(!state.pdfDoc)return;state.viewerIndex=Math.max(0,state.visiblePages.indexOf(pageNo));$("#page-dialog").showModal();await renderLargePage();}
async function moveViewer(direction){const next=state.viewerIndex+direction;if(next<0||next>=state.visiblePages.length)return;state.viewerIndex=next;await renderLargePage();}
async function renderLargePage(){const pageNo=state.visiblePages[state.viewerIndex];const page=await state.pdfDoc.getPage(pageNo);const stage=$(".page-stage");const maxScale=isMobilePreview()?1.35:2.2;const minScale=isMobilePreview()?.8:1.1;const scale=Math.min(maxScale,Math.max(minScale,(stage.clientHeight-30)/page.getViewport({scale:1}).height));const viewport=page.getViewport({scale});const canvas=$("#large-page-canvas");canvas.width=viewport.width;canvas.height=viewport.height;await withOperationTimeout(page.render({canvasContext:canvas.getContext("2d"),viewport}).promise,45000,"Ei PDF-side brukte for lang tid på å klargjerast.");$("#page-modal-title").textContent=`${state.activeSong.title} · ${state.activePart.name}`;$("#page-modal-count").textContent=`PDF-side ${pageNo} · ${state.viewerIndex+1} av ${state.visiblePages.length} i stemma`;$("#previous-page").disabled=state.viewerIndex===0;$("#next-page").disabled=state.viewerIndex===state.visiblePages.length-1;}

function openPrintDialog(){if(state.selectedPartIds.size>1){printSelectedParts();return;}const part=state.activePart;if(!part)return;$("#print-summary").innerHTML=`<strong>${escapeHtml(state.activeSong.title)}</strong><br><span class="muted">${escapeHtml(part.name)}</span>`;const select=$("#page-choice");select.innerHTML='<option value="all">Heile denne stemma</option>';const pages=part.pageNumbers?.length?part.pageNumbers:Array.from({length:part.pageCount||state.pdfDoc?.numPages||1},(_,i)=>i+1);pages.forEach(page=>select.insertAdjacentHTML("beforeend",`<option value="${page}">Berre PDF-side ${page}</option>`));select.value=state.selectedPage;$("#print-dialog").showModal();}
async function handlePrint(event){event.preventDefault();const part=state.activePart,copies=Math.max(1,Number($("#copy-count").value)||1),choice=$("#page-choice").value;$("#print-dialog").close();if(!partSourceUrl(part)){toast("Dette er ein demo-note utan ei ekte PDF-fil.","error");return;}const pages=choice==="all"?(part.pageNumbers?.length?part.pageNumbers:Array.from({length:part.pageCount||state.pdfDoc?.numPages||1},(_,i)=>i+1)):[Number(choice)];await printPageNumbers(pages,copies);}
async function printSelectedParts(){const parts=sortParts((state.activeSong.parts||[]).filter(part=>state.selectedPartIds.has(part.id)));if(!parts.length){toast("Vel minst éi stemme.","error");return;}const button=$("#print-selected-parts");button.disabled=true;button.textContent="Klargjer …";const jobTitle=parts.length===1?`${state.activeSong.title} – ${parts[0].name}`:`${state.activeSong.title} – ${parts.length} stemmer`;const win=openPrintWindow(jobTitle);if(!win){button.disabled=false;updatePartSelectionTools();toast("Nettlesaren blokkerte utskriftsvindauget.","error");return;}const documents=new Map();try{const pdfjs=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";const output=[];let completed=0;const total=parts.reduce((sum,part)=>sum+(part.pageNumbers?.length||part.pageCount||1),0);for(const part of parts){const sourceUrl=partSourceUrl(part);if(!sourceUrl)continue;let pdf=documents.get(sourceUrl);if(!pdf){pdf=await pdfjs.getDocument(sourceUrl).promise;documents.set(sourceUrl,pdf);}const pages=part.pageNumbers?.length?part.pageNumbers:Array.from({length:pdf.numPages},(_,i)=>i+1);output.push(`<h1>${escapeHtml(state.activeSong.title)} – ${escapeHtml(part.name)}</h1>`);for(const pageNo of pages){setPrintStatus(win,`Klargjer side ${completed+1} av ${total} …`);const page=await pdf.getPage(pageNo);const viewport=page.getViewport({scale:isMobilePreview()?1.5:2});const canvas=document.createElement("canvas");canvas.width=viewport.width;canvas.height=viewport.height;await withOperationTimeout(page.render({canvasContext:canvas.getContext("2d"),viewport}).promise,45000,"Ei PDF-side brukte for lang tid på å klargjerast.");output.push(`<img alt="${escapeHtml(part.name)}, side ${pageNo}" src="${await canvasToPrintUrl(canvas)}">`);canvas.width=1;canvas.height=1;completed++;}}await finishPrintWindow(win,output.join(""));toast(`${parts.length} stemme(r) er klargjorde for utskrift.`);}catch(error){console.error(error);showPrintError(win);toast("Kunne ikkje klargjere dei valde stemmene.","error");}finally{for(const pdf of documents.values())releasePdf(pdf);button.disabled=false;updatePartSelectionTools();}}

async function printPageNumbers(pages,copies=1){const win=openPrintWindow(`${state.activeSong.title} – ${state.activePart.name}`);if(!win){toast("Nettlesaren blokkerte utskriftsvindauget.","error");return;}try{if(!state.pdfDoc)await loadPreview(state.activePart);if(!state.pdfDoc)throw new Error("PDF-en kunne ikkje lastast.");const renderedPages=[];for(let index=0;index<pages.length;index++){const pageNo=pages[index];setPrintStatus(win,`Klargjer side ${index+1} av ${pages.length} …`);const page=await state.pdfDoc.getPage(pageNo);const viewport=page.getViewport({scale:isMobilePreview()?1.5:2});const canvas=document.createElement("canvas");canvas.width=viewport.width;canvas.height=viewport.height;await withOperationTimeout(page.render({canvasContext:canvas.getContext("2d"),viewport}).promise,45000,"Ei PDF-side brukte for lang tid på å klargjerast.");renderedPages.push({pageNo,url:await canvasToPrintUrl(canvas)});canvas.width=1;canvas.height=1;}const images=[];for(let copy=1;copy<=copies;copy++){for(const rendered of renderedPages){images.push(`<img alt="Side ${rendered.pageNo}, eksemplar ${copy}" src="${rendered.url}">`);}}await finishPrintWindow(win,images.join(""));const total=pages.length*copies;toast(`${copies} eksemplar klargjorde (${total} utskriftssider). La talet på kopiar stå på 1 i utskriftsvindauget.`);}catch(error){console.error(error);showPrintError(win);toast("Kunne ikkje klargjere sidene for utskrift.","error");}}

let activePrintFrame=null,activePrintOverlay=null,activePrintTitle="",previousDocumentTitle="";
const activePrintObjectUrls=[];
function withOperationTimeout(promise,ms,message){let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);});return Promise.race([Promise.resolve(promise),timeout]).finally(()=>clearTimeout(timer));}
async function canvasToPrintUrl(canvas){const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("Kunne ikkje lage utskriftsbiletet.")),"image/jpeg",.9));const url=URL.createObjectURL(blob);activePrintObjectUrls.push(url);return url;}
function waitForPrintImage(image){if(image.complete&&image.naturalWidth)return Promise.resolve();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(new Error("Eit utskriftsbilete brukte for lang tid på å lastast."));},15000);function cleanup(){clearTimeout(timer);image.onload=null;image.onerror=null;}image.onload=()=>{cleanup();resolve();};image.onerror=()=>{cleanup();reject(new Error("Eit utskriftsbilete kunne ikkje lastast."));};});}
function openPrintWindow(title){cleanupPrintArea();activePrintTitle=title;previousDocumentTitle=document.title;const frame=document.createElement("iframe");frame.title="Utskriftsområde";frame.setAttribute("aria-hidden","true");Object.assign(frame.style,{position:"fixed",left:"-10000px",top:"0",width:"1px",height:"1px",border:"0"});document.body.append(frame);const overlay=document.createElement("div");overlay.id="print-progress-overlay";Object.assign(overlay.style,{position:"fixed",inset:"0",display:"grid",placeItems:"center",background:"rgba(247,248,245,.96)",color:"#174a43",fontSize:"1.15rem",fontWeight:"700",zIndex:"1000",textAlign:"center",padding:"2rem"});overlay.textContent="Klargjer notar …";document.body.append(overlay);activePrintFrame=frame;activePrintOverlay=overlay;const win=frame.contentWindow;if(!win)return null;win.document.open();win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{margin:8mm}body{margin:0;text-align:center;background:#fff;font-family:Arial,sans-serif}h1{font-size:18px;background:#fff;margin:0;padding:12px}img{display:block;max-width:100%;margin:0 auto 12px;background:#fff}@media print{h1{page-break-before:always}h1:first-child{page-break-before:auto}img{width:100%;height:auto;page-break-after:always;margin:0}img:last-child{page-break-after:auto}}</style></head><body><main id="print-content"></main></body></html>`);win.document.close();return win;}
function setPrintStatus(win,message){if(activePrintOverlay)activePrintOverlay.textContent=message;}
async function finishPrintWindow(win,html){if(!win||!activePrintFrame)throw new Error("Utskriftsområdet vart lukka.");const content=win.document.getElementById("print-content");content.innerHTML=html;const images=[...content.querySelectorAll("img")];await Promise.all(images.map(waitForPrintImage));if(activePrintOverlay){activePrintOverlay.textContent="Opnar utskriftsvindauget …";await new Promise(resolve=>setTimeout(resolve,100));activePrintOverlay.remove();activePrintOverlay=null;}const frame=activePrintFrame;document.title=activePrintTitle||document.title;win.document.title=activePrintTitle||win.document.title;win.addEventListener("afterprint",()=>setTimeout(()=>{if(activePrintFrame===frame)cleanupPrintArea();},300),{once:true});win.focus();win.print();}
function showPrintError(win){if(!activePrintOverlay)return;activePrintOverlay.innerHTML='<div><p>Utskrifta kunne ikkje klargjerast.</p><button type="button" class="btn btn-primary">Lukk og prøv igjen</button></div>';activePrintOverlay.style.color="#913f37";activePrintOverlay.querySelector("button").addEventListener("click",cleanupPrintArea);}
function cleanupPrintArea(){if(previousDocumentTitle)document.title=previousDocumentTitle;activePrintOverlay?.remove();activePrintFrame?.remove();for(const url of activePrintObjectUrls.splice(0))URL.revokeObjectURL(url);activePrintOverlay=null;activePrintFrame=null;activePrintTitle="";previousDocumentTitle="";}

boot();
