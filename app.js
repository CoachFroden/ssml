import { initFirebase, isFirebaseConfigured, signIn, signOutUser, observeAuth, fetchSongs, saveSong, updateSongParts, deleteSong, analyzeSongPdf, applySongAnalysis } from "./firebase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const demoSongs = [
  { id:"demo-1", title:"Bruremarsj frå Lødingen", composer:"Trad.", arranger:"Jan Magne Førde", mode:"separate", createdAt:"2026-08-10T10:00:00Z", parts:[{id:"d1",name:"Fløyte 1",fileName:"Fløyte 1.pdf",url:null,pageCount:2},{id:"d2",name:"Klarinett 1",fileName:"Klarinett 1.pdf",url:null,pageCount:2},{id:"d3",name:"Althorn",fileName:"Althorn.pdf",url:null,pageCount:2}]},
  { id:"demo-2", title:"Norge i rødt, hvitt og blått", composer:"Lars-Erik Larsson", arranger:"Idar Torskangerpoll", mode:"combined", createdAt:"2026-08-04T10:00:00Z", parts:[{id:"d4",name:"Samla partitur",fileName:"partitur.pdf",url:null,pageCount:4}]},
  { id:"demo-3", title:"Fairytale", composer:"Alexander Rybak", arranger:"Lars Erik Gudim", mode:"separate", createdAt:"2026-07-29T10:00:00Z", parts:[{id:"d5",name:"Partitur",fileName:"Partitur.pdf",url:null,pageCount:3},{id:"d6",name:"Trompet 1",fileName:"Trompet 1.pdf",url:null,pageCount:2}]}
];
let state = { demo:false, songs:[], files:[], activeSong:null, activePart:null, selectedPartIds:new Set(), selectedPage:"all", pdfDoc:null, visiblePages:[], viewerIndex:0, pendingSong:null, pendingAnalysis:null, previewVersion:0 };
let firebase = null;
const previewPdfCache = new Map();

function toast(message, type="ok") { const el=document.createElement("div"); el.className=`toast ${type}`; el.textContent=message; $("#toast-region").append(el); setTimeout(()=>el.remove(),3500); }
function escapeHtml(value="") { const div=document.createElement("div"); div.textContent=value; return div.innerHTML; }
function formatDate(value) { const date=value?.toDate ? value.toDate() : new Date(value); return Number.isNaN(date.getTime()) ? "Nyleg" : new Intl.DateTimeFormat("nn-NO",{day:"numeric",month:"short",year:"numeric"}).format(date); }

async function boot() {
  // Bind skjema og knappar før eksterne Firebase-modular blir lasta.
  // Då kan ikkje innloggingsskjemaet laste sida på nytt dersom nettet er tregt.
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
  $("#logout").addEventListener("click",async()=>{ if(!state.demo) await signOutUser(); state={...state,demo:false,songs:[],activeSong:null}; showLogin(); });
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
  $("#previous-page").addEventListener("click",()=>moveViewer(-1));
  $("#next-page").addEventListener("click",()=>moveViewer(1));
  $("#print-current-page").addEventListener("click",()=>printPageNumbers([state.visiblePages[state.viewerIndex]]));
  $("#review-add-part").addEventListener("click",()=>addReviewPart());
  $("#ai-review-form").addEventListener("submit",confirmAnalysis);
}

function authMessage(code="") { if(code.includes("invalid-credential")) return "Feil e-post eller passord."; if(code.includes("too-many")) return "For mange forsøk. Vent litt og prøv igjen."; return "Innlogginga mislukkast. Kontroller Firebase-oppsettet."; }
function showLogin(){ $("#login-view").classList.remove("hidden");$("#app-shell").classList.add("hidden"); }
async function enterApp(user){ $("#login-view").classList.add("hidden");$("#app-shell").classList.remove("hidden");$("#user-name").textContent=user.displayName||user.email?.split("@")[0]||"SSML-brukar";$("#user-email").textContent=user.email||"Lokal modus"; try { state.songs=state.demo?[...demoSongs,...loadLocalSongs()]:await fetchSongs(); } catch(error){toast("Kunne ikkje hente arkivet.","error");state.songs=[];} renderAll();showView("home"); }
function showView(name){ $$(".view").forEach(view=>view.classList.add("hidden"));$(`#${name}-view`)?.classList.remove("hidden");$$('.nav-item[data-view]').forEach(x=>x.classList.toggle("active",x.dataset.view===name));$(".sidebar").classList.remove("open"); if(name==="archive")renderArchive(); window.scrollTo({top:0,behavior:"smooth"}); }
function renderAll(){ const parts=state.songs.flatMap(song=>song.parts||[]);$("#song-count").textContent=state.songs.length;$("#part-count").textContent=parts.length;$("#pdf-count").textContent=parts.length;renderCards($("#recent-grid"),[...state.songs].slice(0,6));renderArchive(); }
function renderArchive(){ const term=$("#archive-search").value.toLowerCase().trim();let songs=state.songs.filter(song=>[song.title,song.composer,song.arranger].join(" ").toLowerCase().includes(term)); const sort=$("#archive-sort").value;songs.sort((a,b)=>sort==="title"?a.title.localeCompare(b.title,"no"):sort==="composer"?(a.composer||"").localeCompare(b.composer||"","no"):new Date(b.createdAt)-new Date(a.createdAt));$("#result-count").textContent=`${songs.length} ${songs.length===1?"song":"songar"}`;renderCards($("#archive-grid"),songs); }
function renderCards(container,songs){ container.innerHTML="";if(!songs.length){container.append($("#empty-template").content.cloneNode(true));container.querySelector('[data-action="open-import"]').addEventListener("click",()=>$("#import-dialog").showModal());return;} songs.forEach(song=>{const card=document.createElement("article");card.className="song-card";card.tabIndex=0;card.innerHTML=`<div class="cover"><span class="cover-badge">${song.mode==="combined"?"Samla PDF":"Separate stemmer"}</span></div><div class="song-card-body"><h3>${escapeHtml(song.title)}</h3><p>${escapeHtml(song.composer||"Ukjend komponist")}${song.arranger?` · arr. ${escapeHtml(song.arranger)}`:""}</p><div class="song-meta"><span>${song.parts?.length||0} stemmer</span><span>${formatDate(song.createdAt)}</span></div></div>`;card.addEventListener("click",()=>openSong(song.id));card.addEventListener("keydown",e=>{if(e.key==="Enter")openSong(song.id)});container.append(card);}); }

function addFiles(fileList){ const pdfs=[...fileList].filter(file=>file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf")); const rejected=[...fileList].length-pdfs.length;if(rejected)toast(`${rejected} fil(er) vart hoppa over fordi dei ikkje er PDF.`,"error");state.files=[...state.files,...pdfs].filter((file,index,all)=>all.findIndex(x=>x.name===file.name&&x.size===file.size)===index);renderFiles(); }
function renderFiles(){ const list=$("#file-list");list.innerHTML="";state.files.forEach((file,index)=>{const row=document.createElement("div");row.className="file-row";row.innerHTML=`<div><strong>▧ ${escapeHtml(file.name)}</strong><small>${(file.size/1048576).toFixed(1)} MB</small></div><button type="button" aria-label="Fjern">×</button>`;row.querySelector("button").addEventListener("click",()=>{state.files.splice(index,1);renderFiles();});list.append(row);}); }
async function handleImport(event){ event.preventDefault();if(!state.files.length){toast("Vel minst éi PDF-fil.","error");return;}const button=$("#save-song");button.disabled=true;button.textContent=state.demo?"Lagrar …":"Lastar opp og analyserer …";const enteredTitle=$("#song-title").value.trim();const base={title:enteredTitle||state.files[0].name.replace(/\.pdf$/i,""),composer:$("#composer").value.trim(),arranger:$("#arranger").value.trim(),mode:$("input[name=pdf-mode]:checked").value,createdAt:new Date().toISOString()};try{let song;if(state.demo){song={id:`local-${Date.now()}`,...base,parts:state.files.map((file,index)=>({id:`local-part-${Date.now()}-${index}`,name:base.mode==="combined"?"Samla partitur":file.name.replace(/\.pdf$/i,""),fileName:file.name,url:URL.createObjectURL(file),pageCount:null}))};saveLocalMetadata(song);state.songs.unshift(song);finishImportUi();openSong(song.id);toast("Demo-import er lagra utan AI-analyse.");return;}song=await saveSong(base,state.files);state.pendingSong=song;toast("PDF-en er lasta opp. AI analyserer notane …");const analysis=await analyzeSongPdf(song);state.pendingAnalysis=analysis;finishImportUi();openAnalysisReview(song,analysis);}catch(error){console.error(error);if(state.pendingSong&&!state.songs.some(x=>x.id===state.pendingSong.id)){state.songs.unshift(state.pendingSong);renderAll();}toast(aiErrorMessage(error),"error");}finally{button.disabled=false;button.textContent="Lagre i arkivet";} }
function finishImportUi(){state.files=[];renderFiles();$("#import-form").reset();$("#import-dialog").close();}
function aiErrorMessage(error){const text=String(error?.message||error);if(text.includes("app-check")||text.includes("App Check"))return "AI blei blokkert av App Check. Registrer debug-nøkkelen og prøv igjen.";if(text.includes("403"))return "AI-tenesta manglar tilgang. Kontroller AI Logic-oppsettet.";return "PDF-en vart lagra, men AI-analysen mislukkast. Sjå konsollen for detaljar.";}
function saveLocalMetadata(song){ const stored=JSON.parse(localStorage.getItem("ssml-demo-songs")||"[]");stored.unshift({...song,parts:song.parts.map(part=>({...part,url:null}))});localStorage.setItem("ssml-demo-songs",JSON.stringify(stored.slice(0,20))); }
function loadLocalSongs(){try{return JSON.parse(localStorage.getItem("ssml-demo-songs")||"[]");}catch{return[];}}

function openAnalysisReview(song,analysis){$("#review-title").value=analysis.title||song.title;$("#review-composer").value=analysis.composer||song.composer||"";$("#review-arranger").value=analysis.arranger||song.arranger||"";const list=$("#review-parts");list.innerHTML="";(analysis.parts||[]).forEach(part=>addReviewPart(part));if(!analysis.parts?.length)addReviewPart({name:"Samla partitur",pageNumbers:[]});$("#ai-review-dialog").showModal();}
function addReviewPart(part={}){const row=document.createElement("div");row.className="part-editor-row review-part-row";const pages=(part.pageNumbers||[]).join(", ");row.dataset.fileName=part.fileName||"";row.dataset.confidence=part.confidence??0;row.innerHTML=`<label>Instrument/stemme<input class="review-part-name" required value="${escapeHtml(part.name||[part.instrument,part.voice].filter(Boolean).join(" "))}" placeholder="Fløyte 1"></label><label>PDF-sider<input class="review-part-pages" required value="${escapeHtml(pages)}" placeholder="1, 2"></label><button class="icon-btn" type="button" aria-label="Fjern">×</button>`;row.querySelector("button").addEventListener("click",()=>row.remove());$("#review-parts").append(row);}
async function confirmAnalysis(event){event.preventDefault();const song=state.pendingSong;if(!song)return;const button=$("#review-save");button.disabled=true;button.textContent="Lagrar …";try{const rows=$$(".review-part-row");const parts=rows.map((row,index)=>{const requested=row.dataset.fileName;const source=song.parts.find(part=>part.fileName===requested)||song.parts[Math.min(index,song.parts.length-1)]||song.parts[0];const numbers=parsePageNumbersLoose($(".review-part-pages",row).value);return{id:`${song.id}-ai-${index}`,name:$(".review-part-name",row).value.trim(),fileName:source.fileName,storagePath:source.storagePath,url:source.url,pageCount:null,pageNumbers:numbers,confidence:Number(row.dataset.confidence)||0};});const metadata={title:$("#review-title").value.trim(),composer:$("#review-composer").value.trim(),arranger:$("#review-arranger").value.trim(),confidence:Number(state.pendingAnalysis?.confidence)||0};await applySongAnalysis(song.id,metadata,parts);Object.assign(song,metadata,{parts,mode:"analyzed"});state.songs.unshift(song);state.pendingSong=null;state.pendingAnalysis=null;$("#ai-review-dialog").close();renderAll();toast(`«${song.title}» er analysert og lagra.`);openSong(song.id);}catch(error){console.error(error);toast(error.message||"Kunne ikkje lagre analysen.","error");}finally{button.disabled=false;button.textContent="Godkjenn og lagre";}}
function parsePageNumbersLoose(text){const pages=new Set();for(const token of text.replace(/–/g,"-").split(",")){const bit=token.trim();if(!bit)continue;if(bit.includes("-")){const[start,end]=bit.split("-").map(Number);if(!start||!end||start>end)throw new Error(`Ugyldig sideområde: ${bit}`);for(let n=start;n<=end;n++)pages.add(n);}else{const n=Number(bit);if(!n)throw new Error(`Ugyldig sidetal: ${bit}`);pages.add(n);}}if(!pages.size)throw new Error("Kvar stemme må ha minst éi side.");return[...pages].sort((a,b)=>a-b);}

const SSML_PART_ORDER=[/partitur|score|conductor|dirigent/,/piccolo/,/fløyte|flute/,/oboe/,/fagott|bassoon/,/klarinett|clarinet/,/altsaksofon|alto sax/,/tenorsaksofon|tenor sax/,/barytonsaksofon|baritone sax/,/trompet|trumpet|kornett|cornet/,/horn/,/trombone/,/baryton|baritone|eufonium|euphonium/,/tuba/,/elektrisk bass|electric bass/,/slagverk 1|percussion 1/,/trommesett|drum set|drums/,/slagverk 2|percussion 2/,/melodisk slagverk|mallet|xylophone|bells|vibes/,/pauker|timpani/,/slagverk|percussion/];
function partOrderValue(part){const name=(part.name||part.fileName||"").toLowerCase();let rank=SSML_PART_ORDER.findIndex(pattern=>pattern.test(name));if(rank<0)rank=99;if(/bassklarinett|bass clarinet/.test(name))rank=5.2;if(/altklarinett|alto clarinet/.test(name))rank=5.1;const voice=Number(name.match(/\b([1-9])\b/)?.[1]||0);return rank*100+voice;}
function sortParts(parts=[]){return [...parts].sort((a,b)=>partOrderValue(a)-partOrderValue(b)||(a.name||"").localeCompare(b.name||"","no"));}
function openSong(id){ const song=state.songs.find(x=>x.id===id);if(!song)return;song.parts=sortParts(song.parts||[]);state.activeSong=song;state.activePart=song.parts?.[0]||null;state.selectedPartIds=new Set(state.activePart?[state.activePart.id]:[]);state.selectedPage="all";renderSongDetail();showView("song");if(state.activePart)loadPreview(state.activePart); }
function renderSongDetail(){ const song=state.activeSong;const canMap=song.mode==="combined"||song.mode==="mapped";$("#song-detail").innerHTML=`<div class="detail-header"><div><p class="eyebrow">${canMap?"Samla PDF":"Stemmebibliotek"}</p><h1>${escapeHtml(song.title)}</h1><p>${escapeHtml(song.composer||"Ukjend komponist")}${song.arranger?` · arrangert av ${escapeHtml(song.arranger)}`:""}</p></div><div class="detail-actions"><span>${formatDate(song.createdAt)}</span><button id="delete-song" class="btn btn-danger" type="button">Slett sang</button></div></div><div class="parts-layout"><aside class="parts-panel"><div class="preview-toolbar"><h2>Stemmer <small>(${song.parts?.length||0})</small></h2>${canMap?'<button id="map-parts" class="text-btn">Rediger</button>':""}</div><div class="part-selection-tools"><button id="select-all-parts" class="text-btn" type="button">Velg alle</button><button id="print-selected-parts" class="btn btn-primary" type="button">Skriv ut valgte</button></div><div id="part-list"></div>${song.mode==="combined"?'<button id="map-parts-main" class="btn btn-primary btn-wide">Fordel instrument og stemmer</button>':""}</aside><section class="preview-panel"><div class="preview-toolbar"><h2 id="preview-title">Førehandsvising</h2><div class="preview-actions"><button id="edit-active-part" class="btn btn-ghost" type="button">Rediger instrument</button><button id="open-print" class="btn btn-primary">⌁ Skriv ut stemma</button></div></div><div id="thumbnail-grid" class="thumbnail-grid"></div></section></div>`;renderPartList();$("#open-print").addEventListener("click",openPrintDialog);$("#edit-active-part").addEventListener("click",openActivePartEditor);$("#select-all-parts").addEventListener("click",toggleAllParts);$("#print-selected-parts").addEventListener("click",printSelectedParts);$("#delete-song").addEventListener("click",handleDeleteSong);$("#map-parts")?.addEventListener("click",openPartsEditor);$("#map-parts-main")?.addEventListener("click",openPartsEditor); }

async function handleDeleteSong(){const song=state.activeSong;if(!song||!confirm(`Slette «${song.title}» og alle PDF-filene? Dette kan ikkje angrast.`))return;const button=$("#delete-song");button.disabled=true;button.textContent="Slettar …";try{if(state.demo){const stored=loadLocalSongs().filter(item=>item.id!==song.id);localStorage.setItem("ssml-demo-songs",JSON.stringify(stored));}else await deleteSong(song);state.songs=state.songs.filter(item=>item.id!==song.id);state.activeSong=null;state.activePart=null;renderAll();showView("archive");toast(`«${song.title}» er sletta.`);}catch(error){console.error(error);button.disabled=false;button.textContent="Slett sang";toast("Kunne ikkje slette songen og PDF-filene.","error");}}
function renderPartList(){ const list=$("#part-list");list.innerHTML="";sortParts(state.activeSong.parts||[]).forEach(part=>{const row=document.createElement("div");row.className="part-select-row";const checked=state.selectedPartIds.has(part.id);row.innerHTML=`<label class="part-check"><input type="checkbox" ${checked?"checked":""} aria-label="Vel ${escapeHtml(part.name)}"></label><button class="part-btn ${part.id===state.activePart?.id?"active":""}" type="button"><span><strong>${escapeHtml(part.name)}</strong><small>${escapeHtml(part.fileName)}</small></span><span>›</span></button>`;row.querySelector("input").addEventListener("change",event=>{if(event.target.checked)state.selectedPartIds.add(part.id);else state.selectedPartIds.delete(part.id);if(!state.selectedPartIds.has(state.activePart?.id))state.activePart=selectedParts()[0]||null;updatePartSelectionTools();renderPartList();renderSelectedPreview();});row.querySelector("button").addEventListener("click",()=>focusPreviewPart(part));list.append(row);});updatePartSelectionTools(); }

function updatePartSelectionTools(){const all=state.activeSong?.parts||[];const count=state.selectedPartIds.size;const button=$("#select-all-parts");if(button)button.textContent=all.length&&count===all.length?"Fjern alle":"Velg alle";const printButton=$("#print-selected-parts");if(printButton){printButton.disabled=count===0;printButton.textContent=`Skriv ut valgte (${count})`;}const mainPrint=$("#open-print");if(mainPrint)mainPrint.textContent=count>1?`Skriv ut valgte (${count})`:"⌁ Skriv ut stemma";}
function toggleAllParts(){const parts=state.activeSong.parts||[];state.selectedPartIds=state.selectedPartIds.size===parts.length?new Set():new Set(parts.map(part=>part.id));renderPartList();renderSelectedPreview();}

async function getPreviewPdf(part){
  if(!part.url)return null;
  if(previewPdfCache.has(part.url))return previewPdfCache.get(part.url);
  const pdfjs=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const pdf=await pdfjs.getDocument(part.url).promise;
  previewPdfCache.set(part.url,pdf);
  return pdf;
}

function selectedParts(){return sortParts((state.activeSong?.parts||[]).filter(part=>state.selectedPartIds.has(part.id)));}

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
      totalPages+=pages.length;
      const section=document.createElement("section");
      section.className="multi-preview-group";
      section.dataset.partId=part.id;
      section.innerHTML=`<header><div><strong>${escapeHtml(part.name)}</strong><small>${pages.length} ${pages.length===1?"side":"sider"}</small></div><button class="text-btn" type="button">Fjern</button></header><div class="thumbnail-grid"></div>`;
      section.querySelector("button").addEventListener("click",()=>{state.selectedPartIds.delete(part.id);renderPartList();renderSelectedPreview();});
      const pageGrid=$(".thumbnail-grid",section);
      if(pdf){
        part.pageCount=pdf.numPages;
        for(const pageNo of pages){
          const page=await pdf.getPage(pageNo);
          const viewport=page.getViewport({scale:.36});
          const canvas=document.createElement("canvas");
          canvas.width=viewport.width;canvas.height=viewport.height;
          await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
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

async function loadPreview(part,version=++state.previewVersion){ const grid=$("#thumbnail-grid");grid.className="thumbnail-grid";$("#preview-title").textContent=part.name;grid.innerHTML='<p class="loading-pages">Lastar PDF-sider …</p>';state.pdfDoc=null;if(!part.url){renderPlaceholderPages(part.pageCount||1);return;}try{state.pdfDoc=await getPreviewPdf(part);if(version!==state.previewVersion)return;part.pageCount=state.pdfDoc.numPages;state.visiblePages=part.pageNumbers?.length?part.pageNumbers:Array.from({length:state.pdfDoc.numPages},(_,i)=>i+1);grid.innerHTML="";for(const pageNo of state.visiblePages){const page=await state.pdfDoc.getPage(pageNo);const viewport=page.getViewport({scale:.45});const canvas=document.createElement("canvas");canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;if(version!==state.previewVersion)return;grid.append(makeThumb(canvas,pageNo,part,state.pdfDoc,state.visiblePages));}}catch(error){console.error(error);grid.innerHTML='<p class="loading-pages">Førehandsvisinga kunne ikkje lastast. PDF-en kan framleis opnast og skrivast ut.</p>';} }
function renderPlaceholderPages(count){const grid=$("#thumbnail-grid");grid.innerHTML="";for(let i=1;i<=count;i++){const canvas=document.createElement("canvas");canvas.width=180;canvas.height=250;const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,180,250);ctx.fillStyle="#dce4df";for(let y=65;y<175;y+=13)ctx.fillRect(22,y,136,1);ctx.fillStyle="#174a43";ctx.font="28px serif";ctx.fillText("♫",75,125);grid.append(makeThumb(canvas,i));}}
function makeThumb(canvas,pageNo,part=state.activePart,pdf=state.pdfDoc,pages=state.visiblePages){const wrap=document.createElement("div");wrap.className="page-thumb-wrap";const thumb=document.createElement("button");thumb.className="page-thumb";thumb.type="button";thumb.append(canvas);thumb.insertAdjacentHTML("beforeend",`<small>Side ${pageNo}</small>`);thumb.addEventListener("click",()=>{state.activePart=part;state.pdfDoc=pdf;state.visiblePages=pages;state.selectedPage=String(pageNo);renderPartList();updatePreviewFocus();openLargePage(pageNo);});const remove=document.createElement("button");remove.className="delete-page-btn";remove.type="button";remove.textContent="Slett side";remove.addEventListener("click",()=>removePageFromPart(part,pageNo,pdf));wrap.append(thumb,remove);return wrap;}

function openActivePartEditor(){if(!state.activePart){toast("Vel ei stemme først.","error");return;}$("#edit-part-name").value=state.activePart.name||"";$("#edit-part-dialog").showModal();setTimeout(()=>$("#edit-part-name").select(),0);}
async function saveActivePartName(event){event.preventDefault();const part=state.activePart;const name=$("#edit-part-name").value.trim();if(!part||!name)return;const revised=state.activeSong.parts.map(item=>item.id===part.id?{...item,name}:item);const button=$("#save-part-name");button.disabled=true;try{if(state.demo)throw new Error("Redigering må gjerast i Firebase-modus.");await updateSongParts(state.activeSong.id,revised,state.activeSong.mode);state.activeSong.parts=revised;state.activePart=revised.find(item=>item.id===part.id);$("#edit-part-dialog").close();renderSongDetail();renderSelectedPreview();renderAll();toast(`Namnet er endra til «${name}».`);}catch(error){console.error(error);toast(error.message||"Kunne ikkje lagre instrumentnamnet.","error");}finally{button.disabled=false;}}

async function removePageFromPart(part,pageNo,pdf){const pages=part.pageNumbers?.length?[...part.pageNumbers]:Array.from({length:pdf?.numPages||part.pageCount||1},(_,index)=>index+1);if(pages.length<=1){toast("Ei stemme må ha minst éi side.","error");return;}if(!confirm(`Slette side ${pageNo} frå «${part.name}»? Original-PDF-en blir ikkje sletta.`))return;const updated={...part,pageNumbers:pages.filter(number=>number!==pageNo),pageCount:pdf?.numPages||part.pageCount};const revised=state.activeSong.parts.map(item=>item.id===part.id?updated:item);try{if(state.demo)throw new Error("Sletting må gjerast i Firebase-modus.");await updateSongParts(state.activeSong.id,revised,state.activeSong.mode);state.activeSong.parts=revised;if(state.activePart?.id===part.id)state.activePart=updated;state.selectedPage="all";renderPartList();await renderSelectedPreview();renderAll();toast(`Side ${pageNo} er fjerna frå «${part.name}».`);}catch(error){console.error(error);toast(error.message||"Kunne ikkje slette sida.","error");}}

function openPartsEditor(){const list=$("#part-editor-list");list.innerHTML="";const existing=state.activeSong.mode==="mapped"?state.activeSong.parts:[];if(existing.length)existing.forEach(part=>addPartEditorRow(part.name,formatPageNumbers(part.pageNumbers)));else addPartEditorRow("","");$("#parts-dialog").showModal();}
function addPartEditorRow(name="",pages=""){const row=document.createElement("div");row.className="part-editor-row";row.innerHTML=`<label>Instrument/stemme<input class="part-name" required placeholder="Til dømes Fløyte 1" value="${escapeHtml(name)}"></label><label>PDF-sider<input class="part-pages" required placeholder="Til dømes 1-2, 5" value="${escapeHtml(pages)}"></label><button class="icon-btn" type="button" aria-label="Fjern">×</button>`;row.querySelector("button").addEventListener("click",()=>row.remove());$("#part-editor-list").append(row);}
function parsePageNumbers(text,max){const pages=new Set();for(const token of text.replace(/–/g,"-").split(",")){const bit=token.trim();if(!bit)continue;if(bit.includes("-")){const [start,end]=bit.split("-").map(Number);if(!start||!end||start>end)throw new Error(`Ugyldig sideområde: ${bit}`);for(let page=start;page<=end;page++)pages.add(page);}else{const page=Number(bit);if(!page)throw new Error(`Ugyldig sidetal: ${bit}`);pages.add(page);}}const result=[...pages].sort((a,b)=>a-b);if(!result.length||result.some(page=>page>max))throw new Error(`Sidene må vere mellom 1 og ${max}.`);return result;}
function formatPageNumbers(pages=[]){return pages.join(", ");}
async function savePartAssignments(event){event.preventDefault();const rows=$$(".part-editor-row");if(!rows.length){toast("Legg til minst éi stemme.","error");return;}const source=state.activeSong.parts[0];const max=state.pdfDoc?.numPages||source.pageCount;if(!max){toast("Vent til PDF-en er ferdig lasta.","error");return;}try{const parts=rows.map((row,index)=>({id:`${state.activeSong.id}-part-${index}-${Date.now()}`,name:$(".part-name",row).value.trim(),fileName:source.fileName,storagePath:source.storagePath,url:source.url,pageCount:max,pageNumbers:parsePageNumbers($(".part-pages",row).value,max)}));if(state.demo)throw new Error("Stemmefordeling må lagrast i Firebase-modus.");await updateSongParts(state.activeSong.id,parts);state.activeSong.parts=parts;state.activeSong.mode="mapped";state.activePart=parts[0];$("#parts-dialog").close();renderSongDetail();loadPreview(state.activePart);renderAll();toast("Instrument og stemmer er lagra.");}catch(error){toast(error.message||"Kunne ikkje lagre stemmene.","error");}}

async function openLargePage(pageNo){if(!state.pdfDoc)return;state.viewerIndex=Math.max(0,state.visiblePages.indexOf(pageNo));$("#page-dialog").showModal();await renderLargePage();}
async function moveViewer(direction){const next=state.viewerIndex+direction;if(next<0||next>=state.visiblePages.length)return;state.viewerIndex=next;await renderLargePage();}
async function renderLargePage(){const pageNo=state.visiblePages[state.viewerIndex];const page=await state.pdfDoc.getPage(pageNo);const stage=$(".page-stage");const scale=Math.min(2.2,Math.max(1.1,(stage.clientHeight-30)/page.getViewport({scale:1}).height));const viewport=page.getViewport({scale});const canvas=$("#large-page-canvas");canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;$("#page-modal-title").textContent=`${state.activeSong.title} · ${state.activePart.name}`;$("#page-modal-count").textContent=`PDF-side ${pageNo} · ${state.viewerIndex+1} av ${state.visiblePages.length} i stemma`;$("#previous-page").disabled=state.viewerIndex===0;$("#next-page").disabled=state.viewerIndex===state.visiblePages.length-1;}

function openPrintDialog(){if(state.selectedPartIds.size>1){printSelectedParts();return;}const part=state.activePart;if(!part)return;$("#print-summary").innerHTML=`<strong>${escapeHtml(state.activeSong.title)}</strong><br><span class="muted">${escapeHtml(part.name)}</span>`;const select=$("#page-choice");select.innerHTML='<option value="all">Heile denne stemma</option>';const pages=part.pageNumbers?.length?part.pageNumbers:Array.from({length:part.pageCount||state.pdfDoc?.numPages||1},(_,i)=>i+1);pages.forEach(page=>select.insertAdjacentHTML("beforeend",`<option value="${page}">Berre PDF-side ${page}</option>`));select.value=state.selectedPage;$("#print-dialog").showModal();}
async function handlePrint(event){event.preventDefault();const part=state.activePart,copies=Math.max(1,Number($("#copy-count").value)||1),choice=$("#page-choice").value;$("#print-dialog").close();if(!part.url){toast("Dette er ein demo-note utan ei ekte PDF-fil.","error");return;}const pages=choice==="all"?(part.pageNumbers?.length?part.pageNumbers:Array.from({length:part.pageCount||state.pdfDoc?.numPages||1},(_,i)=>i+1)):[Number(choice)];await printPageNumbers(pages,copies);}
async function printSelectedParts(){const parts=sortParts((state.activeSong.parts||[]).filter(part=>state.selectedPartIds.has(part.id)));if(!parts.length){toast("Vel minst éi stemme.","error");return;}const button=$("#print-selected-parts");button.disabled=true;button.textContent="Klargjer …";const win=window.open("","_blank");if(!win){button.disabled=false;updatePartSelectionTools();toast("Nettlesaren blokkerte utskriftsvindauget.","error");return;}try{const pdfjs=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";const documents=new Map();const output=[];for(const part of parts){if(!part.url)continue;let pdf=documents.get(part.url);if(!pdf){pdf=await pdfjs.getDocument(part.url).promise;documents.set(part.url,pdf);}const pages=part.pageNumbers?.length?part.pageNumbers:Array.from({length:pdf.numPages},(_,i)=>i+1);output.push(`<h1>${escapeHtml(state.activeSong.title)} – ${escapeHtml(part.name)}</h1>`);for(const pageNo of pages){const page=await pdf.getPage(pageNo);const viewport=page.getViewport({scale:2});const canvas=document.createElement("canvas");canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;output.push(`<img src="${canvas.toDataURL()}">`);}}win.document.write(`<title>${escapeHtml(state.activeSong.title)} – valde stemmer</title><style>body{margin:0;text-align:center;background:#ddd}h1{font:700 18px sans-serif;background:#fff;margin:0;padding:12px}img{display:block;max-width:100%;margin:0 auto 12px;background:white}@media print{body{background:white}h1{page-break-before:always}h1:first-child{page-break-before:auto}img{width:100%;height:auto;page-break-after:always;margin:0}}</style>${output.join("")}<script>onload=()=>print()<\/script>`);win.document.close();toast(`${parts.length} stemme(r) er klargjorde for utskrift.`);}catch(error){console.error(error);win.close();toast("Kunne ikkje klargjere dei valde stemmene.","error");}finally{button.disabled=false;updatePartSelectionTools();}}

async function printPageNumbers(pages,copies=1){try{if(!state.pdfDoc)await loadPreview(state.activePart);const win=window.open("","_blank");if(!win){toast("Nettlesaren blokkerte utskriftsvindauget.","error");return;}const images=[];for(const pageNo of pages){const page=await state.pdfDoc.getPage(pageNo);const viewport=page.getViewport({scale:2});const canvas=document.createElement("canvas");canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;images.push(`<img src="${canvas.toDataURL()}">`);}win.document.write(`<title>${escapeHtml(state.activeSong.title)} – ${escapeHtml(state.activePart.name)}</title><style>body{margin:0;text-align:center;background:#ddd}img{display:block;max-width:100%;margin:0 auto 12px;background:white}@media print{body{background:white}img{width:100%;height:auto;page-break-after:always;margin:0}img:last-child{page-break-after:auto}}</style>${images.join("")}<script>onload=()=>print()<\/script>`);win.document.close();toast(`${pages.length} side(r) klargjorde. Vel ${copies} kopiar i utskriftsvindauget.`);}catch(error){console.error(error);toast("Kunne ikkje klargjere sidene for utskrift.","error");}}

boot();
