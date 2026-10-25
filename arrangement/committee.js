import {loginCommittee,logout,auth} from "./firebase-client.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
const params=new URLSearchParams(location.search),slot=params.get("id")||document.body.dataset.slot,$=s=>document.querySelector(s);
const invitationName=params.get("namn")||params.get("name")||document.querySelector("#gate-event-name")?.textContent||"";
if(invitationName)$("#gate-event-name").textContent=invitationName;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const call=async(name,data)=>(await httpsCallable(getFunctions(auth.app,"europe-west1"),name)(data)).data;
async function loadPublicEventName(){
 if(!slot)return;
 try{
  const result=await call("arrangementPublicName",{slot});
  if(result.name){$("#gate-event-name").textContent=result.name;document.title=result.name+" · SSML komité";}
  else $("#gate-event-name").textContent="Ukjent arrangement";
 }catch(err){
  if(!invitationName)$("#gate-event-name").textContent="Komitéportal";
 }
}
loadPublicEventName();
let poll=null,channel="board",view="tasks",latestMessages=[];
let currentUid="";
const seenKey="ssml-committee-seen-v1:"+slot;
let seenIds=new Set();
try{const saved=JSON.parse(localStorage.getItem(seenKey)||"[]");if(Array.isArray(saved))seenIds=new Set(saved.filter(x=>typeof x==="string"));}catch{}
function markMessagesSeen(){for(const m of latestMessages){if(m.id)seenIds.add(m.id);}try{localStorage.setItem(seenKey,JSON.stringify([...seenIds].slice(-1000)));}catch{}updateUnreadCount();}
function updateUnreadCount(){const count=latestMessages.filter(m=>m.id&&!seenIds.has(m.id)).length;const badge=$("#message-count");badge.textContent=count?String(count):"";badge.hidden=!count;}

function showView(next){view=next;if(next==="messages")markMessagesSeen();document.querySelectorAll("[data-view]").forEach(b=>{const selected=b.dataset.view===next;b.classList.toggle("current",selected);if(selected)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");});document.querySelectorAll("[data-panel]").forEach(p=>p.hidden=p.dataset.panel!==next);}
document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
function error(e){$("#status").textContent=e?.message||"Noko gjekk gale.";}
function contactLinks(p){const phone=String(p.phone||"").trim(),email=String(p.email||"").trim();return '<div class="contact-links">'+(phone?'<a href="tel:'+esc(phone.replace(/[^+0-9]/g,""))+'">☎ '+esc(phone)+'</a>':"")+(email?'<a href="mailto:'+esc(email)+'">✉ '+esc(email)+'</a>':"")+'</div>';}
function draw(e,boardMembers=[]){
 $("#title").textContent=e.name;$("#date").textContent=[e.date,e.year].filter(Boolean).join(" · ");
 latestMessages=e.messages;if(view==="messages")markMessagesSeen();else updateUnreadCount();
 $("#task-summary").textContent=e.tasks.filter(t=>t.done).length+" av "+e.tasks.length+" oppgåver fullførte";
 $("#tasks").innerHTML=e.tasks.slice().sort((a,b)=>Number(a.done)-Number(b.done)).map(t=>'<div class="task"><label><input type="checkbox" data-id="'+esc(t.id)+'" '+(t.done?"checked":"")+'><span>'+esc(t.text)+'</span></label>'+(t.createdBy==="committee"&&t.createdByUid===currentUid?'<button type="button" class="delete-own-task" data-delete="'+esc(t.id)+'" title="Slett di eiga oppgåve" aria-label="Slett di eiga oppgåve">×</button>':"")+'</div>').join("")||"Ingen oppgåver enno.";
 const openedFamilies=new Set([...document.querySelectorAll("#members details[open]")].map(el=>el.dataset.familyId));
 $("#members").innerHTML=e.people.map(p=>'<details class="contact-card family-contact" data-family-id="'+esc(p.id)+'" '+(openedFamilies.has(String(p.id))?'open':'')+'><summary><strong>'+esc(p.childName||p.name)+'</strong><span class="family-hint">Vis føresette</span></summary><div class="family-guardian"><strong>'+esc(p.name)+'</strong>'+contactLinks(p)+'</div>'+(p.parent2Name?'<div class="family-guardian"><strong>'+esc(p.parent2Name)+'</strong>'+contactLinks({phone:p.parent2Phone,email:p.parent2Email})+'</div>':"")+'</details>').join("")||"Ingen medlemer enno.";
 $("#board-members").innerHTML=boardMembers.map(p=>'<div class="contact-card"><strong>'+esc(p.name)+'</strong><span class="contact-role">'+esc(p.role||"Styremedlem")+'</span>'+contactLinks(p)+'</div>').join("")||"Ingen styremedlemmer registrerte enno.";
 $("#messages").innerHTML=e.messages.filter(m=>channel==="committee"?m.recipient==="committee":m.recipient!=="committee").map(m=>'<article class="'+(m.role==='committee'?'from-committee':'from-board')+'"><strong>'+esc(m.sender)+'</strong><span class="source">'+(m.role==='committee'?'Komité':'Styret')+'</span> <small>'+esc(m.date)+'</small><p>'+esc(m.text)+'</p></article>').join("")||"Ingen meldingar enno.";
}
async function refresh(){
 try{const data=await call("arrangementCommitteeRead",{slot});draw(data.event,data.boardMembers||[]);$("#status").textContent="";}
 catch(err){error(err);if(err.code==="functions/permission-denied"){clearInterval(poll);poll=null;$("#portal").hidden=true;$("#gate").hidden=false;}}
}
$("#login").addEventListener("submit",async e=>{
 e.preventDefault();$("#status").textContent="Kontrollerer passord …";$("#enter").disabled=true;
 try{await loginCommittee(slot,$("#password").value);currentUid=auth.currentUser?.uid||"";$("#password").value="";$("#gate").hidden=true;$("#portal").hidden=false;showView("tasks");await refresh();clearInterval(poll);poll=setInterval(refresh,15000);}
 catch(err){error(err);}finally{$("#enter").disabled=false;}
});
document.querySelectorAll("[data-channel]").forEach(button=>button.addEventListener("click",()=>{channel=button.dataset.channel;$("#recipient").value=channel;document.querySelectorAll("[data-channel]").forEach(b=>b.classList.toggle("selected",b===button));refresh();}));
$("#recipient").addEventListener("change",()=>{channel=$("#recipient").value;document.querySelectorAll("[data-channel]").forEach(b=>b.classList.toggle("selected",b.dataset.channel===channel));refresh();});
$("#add-task").addEventListener("submit",async e=>{e.preventDefault();const button=e.currentTarget.querySelector("button");button.disabled=true;try{await call("arrangementCommitteeUpdate",{slot,action:"task-add",sender:$("#task-author").value.trim(),text:$("#task-text").value.trim()});$("#task-text").value="";await refresh();}catch(err){error(err);}finally{button.disabled=false;}});
$("#tasks").addEventListener("click",async e=>{const button=e.target.closest("[data-delete]");if(!button||!confirm("Slette di eiga oppgåve?"))return;button.disabled=true;try{await call("arrangementCommitteeUpdate",{slot,action:"task-delete",taskId:button.dataset.delete});await refresh();}catch(err){error(err);await refresh();}});
$("#tasks").addEventListener("change",async e=>{
 if(!e.target.matches("[data-id]"))return;
 try{await call("arrangementCommitteeUpdate",{slot,action:"task",taskId:e.target.dataset.id,done:e.target.checked});await refresh();}
 catch(err){error(err);await refresh();}
});
$("#send").addEventListener("submit",async e=>{
 e.preventDefault();
 try{await call("arrangementCommitteeUpdate",{slot,action:"message",recipient:$("#recipient").value,sender:$("#sender").value.trim(),text:$("#message").value.trim()});$("#message").value="";await refresh();}
 catch(err){error(err);}
});
$("#logout").onclick=async()=>{clearInterval(poll);poll=null;await logout();currentUid="";$("#portal").hidden=true;$("#gate").hidden=false;};
