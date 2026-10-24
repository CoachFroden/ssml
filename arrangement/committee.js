import {loginCommittee,logout,listenEvent,listenItems,editItem,addItem,serverTimestamp} from "./firebase-client.js";
const slot=document.body.dataset.slot;
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let stop=[];
function clear(){stop.forEach(fn=>fn());stop=[];}
function error(e){$("#status").textContent=e?.message||"Noko gjekk gale. Prøv igjen.";}
function show(){clear();$("#gate").hidden=true;$("#portal").hidden=false;
stop.push(listenEvent(slot,e=>{if(!e||e.open!==true){$("#portal").hidden=true;$("#gate").hidden=false;$("#status").textContent="Komiteen er ikkje open.";clear();return;}$("#title").textContent=e.name||"Arrangement";$("#date").textContent=[e.date,e.year].filter(Boolean).join(" · ");},error));
stop.push(listenItems(slot,"tasks",items=>{$("#tasks").innerHTML=items.map(t=>'<label class="task"><input type="checkbox" data-id="'+esc(t.id)+'" '+(t.done?"checked":"")+'><span>'+esc(t.text)+'</span></label>').join("")||"Ingen oppgåver enno.";},error));
stop.push(listenItems(slot,"members",items=>{$("#members").innerHTML=items.map(p=>'<p><strong>'+esc(p.name)+'</strong> '+esc(p.phone)+' '+esc(p.email)+'</p>').join("")||"Ingen medlemer enno.";},error));
stop.push(listenItems(slot,"messages",items=>{$("#messages").innerHTML=items.map(m=>'<article><strong>'+esc(m.sender)+'</strong><p>'+esc(m.text)+'</p></article>').join("")||"Ingen meldingar enno.";},error));
}
$("#login").addEventListener("submit",async e=>{e.preventDefault();$("#status").textContent="Kontrollerer passord …";$("#enter").disabled=true;try{await loginCommittee(slot,$("#password").value);$("#password").value="";$("#status").textContent="";show();}catch(err){error(err);}finally{$("#enter").disabled=false;}});
$("#tasks").addEventListener("change",async e=>{if(e.target.matches("[data-id]")){try{await editItem(slot,"tasks",e.target.dataset.id,{done:e.target.checked});}catch(err){error(err);}}});
$("#send").addEventListener("submit",async e=>{e.preventDefault();try{await addItem(slot,"messages",{sender:$("#sender").value.trim(),text:$("#message").value.trim(),createdAt:serverTimestamp()});$("#message").value="";}catch(err){error(err);}});
$("#logout").onclick=async()=>{clear();await logout();$("#portal").hidden=true;$("#gate").hidden=false;};
