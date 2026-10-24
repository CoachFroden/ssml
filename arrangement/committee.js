import {loginCommittee,logout,auth} from "./firebase-client.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
const slot=new URLSearchParams(location.search).get("id"),$=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const call=async(name,data)=>(await httpsCallable(getFunctions(auth.app,"europe-west1"),name)(data)).data;
let poll=null;
function error(e){$("#status").textContent=e?.message||"Noko gjekk gale.";}
function draw(e){
 $("#title").textContent=e.name;$("#date").textContent=[e.date,e.year].filter(Boolean).join(" · ");
 $("#task-summary").textContent=e.tasks.filter(t=>t.done).length+" av "+e.tasks.length+" oppgåver fullførte";
 $("#tasks").innerHTML=e.tasks.slice().sort((a,b)=>Number(a.done)-Number(b.done)).map(t=>'<label class="task"><input type="checkbox" data-id="'+esc(t.id)+'" '+(t.done?"checked":"")+'><span>'+esc(t.text)+'</span></label>').join("")||"Ingen oppgåver enno.";
 $("#members").innerHTML=e.people.map(p=>'<p><strong>'+esc(p.name)+'</strong> '+esc(p.phone)+' '+esc(p.email)+'</p>').join("")||"Ingen medlemer enno.";
 $("#messages").innerHTML=e.messages.map(m=>'<article class="'+(m.role==='committee'?'from-committee':'from-board')+'"><strong>'+esc(m.sender)+'</strong><span class="source">'+(m.role==='committee'?'Komité':'Styret')+'</span> <small>'+esc(m.date)+'</small><p>'+esc(m.text)+'</p></article>').join("")||"Ingen meldingar enno.";
}
async function refresh(){
 try{const data=await call("arrangementCommitteeRead",{slot});draw(data.event);$("#status").textContent="";}
 catch(err){error(err);if(err.code==="functions/permission-denied"){clearInterval(poll);poll=null;$("#portal").hidden=true;$("#gate").hidden=false;}}
}
$("#login").addEventListener("submit",async e=>{
 e.preventDefault();$("#status").textContent="Kontrollerer passord …";$("#enter").disabled=true;
 try{await loginCommittee(slot,$("#password").value);$("#password").value="";$("#gate").hidden=true;$("#portal").hidden=false;await refresh();clearInterval(poll);poll=setInterval(refresh,15000);}
 catch(err){error(err);}finally{$("#enter").disabled=false;}
});
$("#tasks").addEventListener("change",async e=>{
 if(!e.target.matches("[data-id]"))return;
 try{await call("arrangementCommitteeUpdate",{slot,action:"task",taskId:e.target.dataset.id,done:e.target.checked});await refresh();}
 catch(err){error(err);await refresh();}
});
$("#send").addEventListener("submit",async e=>{
 e.preventDefault();
 try{await call("arrangementCommitteeUpdate",{slot,action:"message",sender:$("#sender").value.trim(),text:$("#message").value.trim()});$("#message").value="";await refresh();}
 catch(err){error(err);}
});
$("#logout").onclick=async()=>{clearInterval(poll);poll=null;await logout();$("#portal").hidden=true;$("#gate").hidden=false;};
