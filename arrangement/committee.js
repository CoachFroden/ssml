import {mountSharedFiles} from "./committee-files.js";
import {loginCommittee,logout,auth} from "./firebase-client.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
const params=new URLSearchParams(location.search),slot=params.get("id")||document.body.dataset.slot,$=s=>document.querySelector(s);
const invitationName=params.get("namn")||params.get("name")||"";
if(invitationName)$("#gate-event-name").textContent=invitationName;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const call=async(name,data)=>(await httpsCallable(getFunctions(auth.app,"europe-west1"),name)(data)).data;
async function loadPublicEventName(){
 if(!slot)return;
 try{
  const result=await call("arrangementPublicName",{slot});
  if(result.name){$("#gate-event-name").textContent=result.name;document.title=result.name+" · SSML komité";}
  else $("#gate-event-name").textContent="Arrangement";
 }catch(err){
  $("#gate-event-name").textContent="Arrangement";
  console.warn("Kunne ikkje hente arrangementsnamn frå Firebase",err);
 }
}
loadPublicEventName();
let poll=null,channel="board",view="tasks",latestMessages=[];
let currentUid="";let notebookEntries=[];
const seenKey="ssml-committee-seen-v1:"+slot;
let seenIds=new Set();
try{const saved=JSON.parse(localStorage.getItem(seenKey)||"[]");if(Array.isArray(saved))seenIds=new Set(saved.filter(x=>typeof x==="string"));}catch{}
function markMessagesSeen(){for(const m of latestMessages){if(m.id)seenIds.add(m.id);}try{localStorage.setItem(seenKey,JSON.stringify([...seenIds].slice(-1000)));}catch{}updateUnreadCount();}
function updateUnreadCount(){const count=latestMessages.filter(m=>m.id&&!seenIds.has(m.id)).length;const badge=$("#message-count");badge.textContent=count?String(count):"";badge.hidden=!count;}

let evaluationLoaded=false;
async function loadEvaluation(){try{const result=await call("arrangementEvaluation",{slot,action:"read"});for(const [key,id] of Object.entries({good:"evaluation-good",improve:"evaluation-improve",tips:"evaluation-tips"})){const el=document.getElementById(id);if(document.activeElement!==el)el.value=result.fields?.[key]||"";el.disabled=!result.open;}$("#evaluation-save").disabled=!result.open;$("#committee-evaluation-form").hidden=!!result.notStarted;$("#evaluation-status").textContent=result.open?"Evalueringa er open. Hugs å lagre endringane.":result.notStarted?"Evalueringa opnar dagen etter at arrangementet er avslutta. Då kan komiteen dele erfaringar og tips til neste arrangement.":"Evalueringsperioden er avslutta. Kontakt styret om de treng meir tid.";evaluationLoaded=true;}catch(err){$("#evaluation-status").textContent="Kunne ikkje hente evaluering: "+(err.message||err);}}
$("#committee-evaluation-form").addEventListener("submit",async e=>{e.preventDefault();const button=$("#evaluation-save");button.disabled=true;try{await call("arrangementEvaluation",{slot,action:"save",fields:{good:$("#evaluation-good").value,improve:$("#evaluation-improve").value,tips:$("#evaluation-tips").value}});$("#evaluation-status").textContent="Evalueringa er lagra."; }catch(err){error(err);$("#evaluation-status").textContent="Lagring feila: "+err.message;}finally{button.disabled=false;}});
function showView(next){view=next;if(next==="evaluation")loadEvaluation();if(next==="messages")markMessagesSeen();document.querySelectorAll("[data-view]").forEach(b=>{const selected=b.dataset.view===next;b.classList.toggle("current",selected);if(selected)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");});document.querySelectorAll("[data-panel]").forEach(p=>p.hidden=p.dataset.panel!==next);}
document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
function error(e){$("#status").textContent=e?.message||"Noko gjekk gale.";}
function contactLinks(p){const phone=String(p.phone||"").trim(),email=String(p.email||"").trim();return '<div class="contact-links">'+(phone?'<a href="tel:'+esc(phone.replace(/[^+0-9]/g,""))+'">☎ '+esc(phone)+'</a>':"")+(email?'<a href="mailto:'+esc(email)+'">✉ '+esc(email)+'</a>':"")+'</div>';}
function draw(e,boardMembers=[]){
 notebookEntries=Array.isArray(e.notes)?e.notes:[];
 $("#committee-notes").innerHTML=notebookEntries.map(n=>'<article class="notebook-entry"><h3>'+esc(n.title||'Notat')+'</h3><p>'+esc(n.text)+'</p><footer><small>'+esc(n.author||'Ukjend')+' · '+esc(n.updatedAt||n.date||'')+'</small><button type="button" class="notebook-edit" data-note-edit="'+esc(n.id)+'">Rediger</button><button type="button" class="notebook-delete" data-note-delete="'+esc(n.id)+'">Slett</button></footer></article>').join('')||'<p>Notatboka er tom. Legg inn det første notatet nedanfor.</p>';
 $("#title").textContent=e.name;$("#date").textContent=[e.date,e.year].filter(Boolean).join(" · ");
 latestMessages=e.messages;if(view==="messages")markMessagesSeen();else updateUnreadCount();
 $("#task-summary").textContent=e.tasks.filter(t=>t.done).length+" av "+e.tasks.length+" oppgåver fullførte";
 $("#tasks").innerHTML=e.tasks.slice().sort((a,b)=>Number(a.done)-Number(b.done)).map(t=>'<div class="task"><label><input type="checkbox" data-id="'+esc(t.id)+'" '+(t.done?"checked":"")+'><span>'+esc(t.text)+'</span></label>'+(t.createdBy==="committee"&&t.createdByUid===currentUid?'<button type="button" class="delete-own-task" data-delete="'+esc(t.id)+'" title="Slett di eiga oppgåve" aria-label="Slett di eiga oppgåve">×</button>':"")+'</div>').join("")||"Ingen oppgåver enno.";
 const openedFamilies=new Set([...document.querySelectorAll("#members details[open]")].map(el=>el.dataset.familyId));
 $("#members").innerHTML=e.people.map(p=>'<details class="contact-card family-contact" data-family-id="'+esc(p.id)+'" '+(openedFamilies.has(String(p.id))?'open':'')+'><summary><strong>'+esc(p.childName||p.name)+'</strong><span class="family-hint">Vis føresette</span></summary><div class="family-guardian"><strong>'+esc(p.name)+'</strong>'+contactLinks(p)+'</div>'+(p.parent2Name?'<div class="family-guardian"><strong>'+esc(p.parent2Name)+'</strong>'+contactLinks({phone:p.parent2Phone,email:p.parent2Email})+'</div>':"")+'</details>').join("")||"Ingen medlemer enno.";
 $("#board-members").innerHTML=boardMembers.map(p=>'<div class="contact-card"><strong>'+esc(p.name)+'</strong><span class="contact-role">'+esc(p.role||"Styremedlem")+'</span>'+contactLinks(p)+'</div>').join("")||"Ingen styremedlemmer registrerte enno.";
 $("#messages").innerHTML=e.messages.filter(m=>channel==="committee"?m.recipient==="committee":m.recipient!=="committee").map(m=>'<article class="'+(m.role==='committee'?'from-committee':'from-board')+'"><strong>'+esc(m.sender)+'</strong><span class="source">'+(m.role==='committee'?'Komité':'Styret')+'</span> <small>'+esc(m.date)+'</small><p>'+esc(m.text)+'</p></article>').join("")||"Ingen meldingar enno.";
}
function setEvaluationOnly(active){
 document.getElementById("portal").classList.toggle("evaluation-only",active);
 if(active){showView("evaluation");clearInterval(poll);poll=null;}
}
async function refresh(){
 try{const data=await call("arrangementCommitteeRead",{slot});if(data.evaluationOnly){$("#title").textContent=data.event.name||"Arrangement";$("#date").textContent=[data.event.date,data.event.year].filter(Boolean).join(" · ");setEvaluationOnly(true);$("#status").textContent="";return;}setEvaluationOnly(false);draw(data.event,data.boardMembers||[]);$("#status").textContent="";}
 catch(err){error(err);if(err.code==="functions/permission-denied"){clearInterval(poll);poll=null;$("#portal").hidden=true;$("#gate").hidden=false;}}
}
$("#login").addEventListener("submit",async e=>{
 e.preventDefault();$("#status").textContent="Kontrollerer passord …";$("#enter").disabled=true;
 try{await loginCommittee(slot,$("#password").value);currentUid=auth.currentUser?.uid||"";$("#password").value="";$("#gate").hidden=true;$("#portal").hidden=false;showView("tasks");await refresh();clearInterval(poll);poll=setInterval(refresh,15000);}
 catch(err){error(err);}finally{$("#enter").disabled=false;}
});
document.querySelectorAll("[data-channel]").forEach(button=>button.addEventListener("click",()=>{channel=button.dataset.channel;document.querySelectorAll("[data-channel]").forEach(b=>b.classList.toggle("selected",b===button));refresh();}));

$("#add-task").addEventListener("submit",async e=>{e.preventDefault();const button=e.currentTarget.querySelector("button");button.disabled=true;try{await call("arrangementCommitteeUpdate",{slot,action:"task-add",sender:$("#task-author").value.trim(),text:$("#task-text").value.trim()});$("#task-text").value="";await refresh();}catch(err){error(err);}finally{button.disabled=false;}});
$("#tasks").addEventListener("click",async e=>{const button=e.target.closest("[data-delete]");if(!button||!confirm("Slette di eiga oppgåve?"))return;button.disabled=true;try{await call("arrangementCommitteeUpdate",{slot,action:"task-delete",taskId:button.dataset.delete});await refresh();}catch(err){error(err);await refresh();}});
$("#tasks").addEventListener("change",async e=>{
 if(!e.target.matches("[data-id]"))return;
 try{await call("arrangementCommitteeUpdate",{slot,action:"task",taskId:e.target.dataset.id,done:e.target.checked});await refresh();}
 catch(err){error(err);await refresh();}
});
$("#send").addEventListener("submit",async e=>{
 e.preventDefault();
 try{await call("arrangementCommitteeUpdate",{slot,action:"message",recipient:channel,sender:$("#sender").value.trim(),text:$("#message").value.trim()});$("#message").value="";await refresh();}
 catch(err){error(err);}
});
function resetNotebookForm(){ $("#committee-note-id").value="";$("#committee-note-title").value="";$("#committee-note-text").value="";$("#committee-note-form-heading").textContent="Nytt notat";$("#committee-note-submit").textContent="Lagre notat";$("#committee-note-cancel").hidden=true;}
$("#committee-note-cancel").onclick=resetNotebookForm;
$("#committee-notes").addEventListener("click",async ev=>{const del=ev.target.closest("[data-note-delete]");if(del){const n=notebookEntries.find(x=>x.id===del.dataset.noteDelete);if(!n||!confirm('Vil du slette notatet «'+(n.title||'Notat')+'»? Dette kan ikkje angrast.'))return;del.disabled=true;try{await call("arrangementCommitteeUpdate",{slot,action:"note-delete",noteId:n.id});$("#committee-note-status").textContent="Notatet er sletta.";resetNotebookForm();await refresh();}catch(err){$("#committee-note-status").textContent="Kunne ikkje slette: "+(err.message||"Ukjend feil");del.disabled=false;}return;}const btn=ev.target.closest("[data-note-edit]");if(!btn)return;const n=notebookEntries.find(x=>x.id===btn.dataset.noteEdit);if(!n)return;$("#committee-note-id").value=n.id;$("#committee-note-title").value=n.title||"Notat";$("#committee-note-author").value=n.author||"";$("#committee-note-text").value=n.text||"";$("#committee-note-form-heading").textContent="Rediger notat";$("#committee-note-submit").textContent="Lagre endringar";$("#committee-note-cancel").hidden=false;$("#committee-note-form").scrollIntoView({behavior:"smooth",block:"center"});});
$("#committee-note-form").addEventListener("submit",async ev=>{ev.preventDefault();const btn=$("#committee-note-submit");btn.disabled=true;$("#committee-note-status").textContent="Lagrar …";try{const noteId=$("#committee-note-id").value;await call("arrangementCommitteeUpdate",{slot,action:noteId?"note-edit":"note-add",noteId:noteId||undefined,title:$("#committee-note-title").value.trim(),sender:$("#committee-note-author").value.trim(),text:$("#committee-note-text").value.trim()});resetNotebookForm();$("#committee-note-status").textContent="Notatboka er oppdatert.";await refresh();}catch(err){$("#committee-note-status").textContent="Kunne ikkje lagre: "+(err.message||"Ukjend feil");}finally{btn.disabled=false;}});
$("#logout").onclick=async()=>{clearInterval(poll);poll=null;await logout();currentUid="";$("#portal").hidden=true;$("#gate").hidden=false;};

const refreshCommitteeFiles=mountSharedFiles({slot,listId:"committee-file-list",formId:"committee-file-form",inputId:"committee-file-input",statusId:"committee-file-status"});
document.querySelector('[data-view="files"]')?.addEventListener("click",()=>refreshCommitteeFiles?.());
