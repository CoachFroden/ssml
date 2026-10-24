import {auth,loginBoard,setPassword,logout,listenEvents} from "./firebase-client.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
const $=s=>document.querySelector(s);
let verified=false,stop=null;
function lock(){verified=false;document.body.classList.add("locked");$("#access-gate").hidden=false;}
function unlock(){verified=true;document.body.classList.remove("locked");$("#access-gate").hidden=true;}
async function verify(){
  if(!auth.currentUser||auth.currentUser.getIdTokenResult===undefined){lock();return;}
  const claims=(await auth.currentUser.getIdTokenResult()).claims;
  if(claims.ssmlArrangement!==true){lock();return;}
  stop?.();
  stop=listenEvents(()=>unlock(),()=>{lock();$("#access-error").textContent="Økta er ikkje gyldig. Logg inn på nytt.";});
}
onAuthStateChanged(auth,()=>verify().catch(()=>lock()));
$("#access-form").addEventListener("submit",async e=>{
 e.preventDefault();const b=$("#access-form button");b.disabled=true;$("#access-error").textContent="Kontrollerer passord …";
 try{await loginBoard($("#access-code").value);$("#access-code").value="";await verify();}
 catch(err){const code=String(err?.code||"");const messages={"functions/permission-denied":"Passordet vart ikkje godkjent.","functions/resource-exhausted":"For mange forsøk. Vent 15 minutt.","functions/internal":"Firebase har ein intern feil. Vi må sjå funksjonsloggen.","auth/invalid-custom-token":"Firebase avviste innloggingstokenet.","auth/operation-not-allowed":"Firebase Auth må aktiverast for innlogging."};$("#access-error").textContent=(messages[code]||"Innlogging feila: "+(code||err?.message||"ukjend feil"));console.error(err);}
 finally{b.disabled=false;}
});
const dialog=document.createElement("dialog");
dialog.innerHTML='<form id="password-form" class="fields"><h2>Passord og komitétilgang</h2><p id="password-link"></p><label>Vel passord<select id="password-slot"><option value="board">Styreportal</option><option value="a0">Julekonsert</option><option value="a1">Vårkonsert</option><option value="a2">Sommarkonsert</option><option value="a3">Basar</option></select></label><label>Nytt passord (minst 10 teikn)<input id="password-new" type="password" minlength="10" maxlength="128" autocomplete="new-password" required></label><label>Gjenta passord<input id="password-repeat" type="password" minlength="10" maxlength="128" autocomplete="new-password" required></label><p id="password-status" role="status"></p><div class="stack"><button class="primary" type="submit">Lagre passord</button><button class="secondary" type="button" id="password-cancel">Lukk</button></div></form>';
document.body.appendChild(dialog);
$("#password-cancel").onclick=()=>dialog.close();
$("#committee-settings").onclick=()=>{
 const slot=window.ssmlCurrentEvent?.()?.id;
 $("#password-slot").value=["a0","a1","a2","a3"].includes(slot)?slot:"board";
 $("#password-status").textContent="";
 $("#password-new").value="";$("#password-repeat").value="";
 const links={a0:"julekonsert",a1:"varkonsert",a2:"sommarkonsert",a3:"basar"};
 $("#password-link").textContent=links[slot]?"Fast komitélenkje: "+new URL("./"+links[slot]+"/",location.href).href:"Vel kva passord du vil endre.";
 dialog.showModal();
};
$("#password-form").addEventListener("submit",async e=>{
 e.preventDefault();const password=$("#password-new").value;
 if(password!==$("#password-repeat").value){$("#password-status").textContent="Passorda er ikkje like.";return;}
 const b=$("#password-form button[type=submit]");b.disabled=true;
 try{await setPassword($("#password-slot").value,password);$("#password-status").textContent="Passordet er lagra i Firebase.";$("#password-new").value="";$("#password-repeat").value="";if($("#password-slot").value==="board"){stop?.();await logout();dialog.close();lock();$("#access-error").textContent="Styrepassordet er endra. Logg inn på nytt.";}}
 catch(err){$("#password-status").textContent="Kunne ikkje lagre passordet: "+(err.message||"ukjend feil");}
 finally{b.disabled=false;}
});
const notice=document.createElement("p");notice.className="muted small";notice.textContent="Styrepassordet er kontrollert av Firebase. Arrangementa på denne sida er framleis lagra lokalt til dei er overførte.";$("#home .panel").appendChild(notice);
