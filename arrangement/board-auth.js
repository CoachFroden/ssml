import {auth,loginBoard,setPassword,logout,listenEvents,getMyRole} from "./firebase-client.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
const $=s=>document.querySelector(s);
let verified=false,stop=null,adminMode=false;
function lock(){verified=false;adminMode=false;if(window.adminResetButton)window.adminResetButton.hidden=true;document.body.classList.add("locked");$("#access-gate").hidden=false;}
function unlock(){verified=true;document.body.classList.remove("locked");$("#access-gate").hidden=true;loadFirebaseEvents();}
async function verify(){
  if(!auth.currentUser||auth.currentUser.getIdTokenResult===undefined){lock();return;}
  const claims=(await auth.currentUser.getIdTokenResult()).claims;
  if(claims.ssmlArrangement!==true){lock();return;}
  stop?.();
  const role=await getMyRole();if(role!=="admin"&&role!=="board"){lock();return;}adminMode=role==="admin";if(window.adminResetButton)window.adminResetButton.hidden=!adminMode;
  if(adminMode){unlock();return;}
  stop=listenEvents(()=>unlock(),()=>{lock();$("#access-error").textContent="Økta er ikkje gyldig. Logg inn på nytt.";});
}
onAuthStateChanged(auth,()=>{if(!auth.currentUser){lock();return;}verify().catch(err=>{$("#access-error").textContent="Kunne ikkje kontrollere økta: "+(err.code||err.message);lock();});});
$("#access-form").addEventListener("submit",async e=>{
 e.preventDefault();const b=$("#access-form button");b.disabled=true;$("#access-error").textContent="Kontrollerer passord …";
 try{await loginBoard($("#access-code").value);$("#access-code").value="";$("#access-error").textContent="Innlogga. Kontrollerer tilgang …";await Promise.race([verify(),new Promise((_,reject)=>setTimeout(()=>reject(new Error("Tidsavbrot ved tilgangskontroll")),12000))]);if(!verified)throw new Error("Tilgangen kunne ikkje stadfestast");$("#access-error").textContent="";}
 catch(err){const code=String(err?.code||"");const messages={"functions/permission-denied":"Passordet vart ikkje godkjent.","functions/resource-exhausted":"For mange forsøk. Vent 15 minutt.","functions/internal":"Firebase har ein intern feil. Vi må sjå funksjonsloggen.","auth/invalid-custom-token":"Firebase avviste innloggingstokenet.","auth/operation-not-allowed":"Firebase Auth må aktiverast for innlogging."};$("#access-error").textContent=(messages[code]||"Innlogging feila: "+(code||err?.message||"ukjend feil"));console.error(err);}
 finally{b.disabled=false;}
});
const dialog=document.createElement("dialog");
dialog.innerHTML='<form id="password-form" class="fields"><h2>Passord og komitétilgang</h2><p id="password-link"></p><label>Vel passord<select id="password-slot"><option value="a0">Julekonsert</option><option value="a1">Vårkonsert</option><option value="a2">Sommarkonsert</option><option value="a3">Basar</option></select></label><label>Nytt passord (minst 10 teikn)<input id="password-new" type="password" minlength="10" maxlength="128" autocomplete="new-password" required></label><label>Gjenta passord<input id="password-repeat" type="password" minlength="10" maxlength="128" autocomplete="new-password" required></label><p id="password-status" role="status"></p><div class="stack"><button class="primary" type="submit">Lagre passord</button><button class="secondary" type="button" id="password-cancel">Lukk</button></div></form>';
document.body.appendChild(dialog);
$("#password-cancel").onclick=()=>dialog.close();
$("#committee-settings").onclick=()=>{
 const event=window.ssmlCurrentEvent?.();
 if(!event)return;
 const slot=event.id;
 $("#password-slot").innerHTML="";
 $("#password-status").textContent="";
 $("#password-new").value="";$("#password-repeat").value="";
 const option=document.createElement("option");option.value=slot;option.textContent=event.name;
 $("#password-slot").appendChild(option);
 const url=new URL("./komite/",location.href);url.searchParams.set("id",slot);
 $("#password-link").textContent="Komitélenkje: "+url.href;
 $("#password-form button[type=submit]").disabled=false;
 dialog.showModal();
};
$("#password-form").addEventListener("submit",async e=>{
 e.preventDefault();const password=$("#password-new").value;
 if(password!==$("#password-repeat").value){$("#password-status").textContent="Passorda er ikkje like.";return;}
 const b=$("#password-form button[type=submit]");b.disabled=true;
 try{await setPassword($("#password-slot").value,password);$("#password-status").textContent="Passordet er lagra i Firebase.";$("#password-new").value="";$("#password-repeat").value="";}
 catch(err){$("#password-status").textContent="Kunne ikkje lagre passordet: "+(err.message||"ukjend feil");}
 finally{b.disabled=false;}
});
const resetButton=document.createElement("button");
resetButton.type="button";
resetButton.textContent="Tilbakestill styrepassord";
resetButton.className="secondary";
resetButton.style.cssText="margin-top:12px;width:100%;text-align:center;padding:12px 16px;border-radius:12px;font-weight:650";
resetButton.hidden=true;
resetButton.onclick=()=>{
 $("#password-slot").innerHTML='<option value="board">Styrepassord</option>';
 $("#password-status").textContent="";
 $("#password-new").value="";
 $("#password-repeat").value="";
 dialog.showModal();
};
window.adminResetButton=resetButton;
$("#home .panel").appendChild(resetButton);
const setup=document.createElement("details");
setup.innerHTML='<summary>Førstegongsoppsett for administrator</summary><form id="admin-setup-form"><p>Dette blir brukt berre éin gong. Du treng Firebase-oppsettnøkkelen.</p><input id="admin-bootstrap" type="password" placeholder="Oppsettnøkkel" required><input id="admin-new" type="password" minlength="10" maxlength="128" placeholder="Nytt administratorpassord" required><button type="submit">Opprett administratorpassord</button><p id="admin-setup-status" role="status"></p></form>';
$("#access-form").appendChild(setup);
$("#admin-setup-form").onsubmit=async e=>{
 e.preventDefault();e.stopPropagation();
 const button=$("#admin-setup-form button");button.disabled=true;
 try{
  const {getFunctions,httpsCallable}=await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js");
  const fn=httpsCallable(getFunctions(auth.app,"europe-west1"),"arrangementCreateAdminPassword");
  await fn({bootstrapSecret:$("#admin-bootstrap").value,password:$("#admin-new").value});
  $("#admin-bootstrap").value="";$("#admin-new").value="";
  $("#admin-setup-status").textContent="Administratorpassordet er oppretta. Du kan no logge inn med det.";
  setup.open=false;
 }catch(err){$("#admin-setup-status").textContent=err.message||"Oppsett feila.";}
 finally{button.disabled=false;}
};

let revision=0,writeQueue=Promise.resolve(),loading=false,pendingWrites=0;
const syncMessage=document.createElement("p");
syncMessage.className="muted small";
syncMessage.textContent="Firebase: ventar på tilkopling";
$("#home .panel").appendChild(syncMessage);
const migrationButton=document.createElement("button");
migrationButton.className="secondary";
migrationButton.textContent="Overfør eksisterande arrangement til Firebase";
migrationButton.hidden=true;
$("#home .panel").appendChild(migrationButton);
const invoke=async(name,data)=>{
 const {getFunctions,httpsCallable}=await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js");
 return (await httpsCallable(getFunctions(auth.app,"europe-west1"),name)(data)).data;
};
async function loadFirebaseEvents(){
 if(loading||pendingWrites)return;
 loading=true;
 try{
  const data=await invoke("arrangementReadAll",{});
  if(pendingWrites)return;
  revision=data.revision;
  window.ssmlFirebaseReady=true;
  if(data.exists){
   window.ssmlSetEvents(data.events);
   syncMessage.textContent="Firebase: arrangementa er synkroniserte";
  }else{
   syncMessage.textContent="Firebase er tom. Overfør dei eksisterande arrangementa før du endrar noko.";
   migrationButton.hidden=false;
  }
 }catch(err){
  window.ssmlFirebaseReady=false;
  syncMessage.textContent="Firebase er ikkje tilgjengeleg: "+(err.code||err.message);
 }finally{loading=false;}
}
window.ssmlSaveEvents=events=>{
 const snapshot=structuredClone(events);
 pendingWrites++;
 const operation=writeQueue.then(async()=>{
  const result=await invoke("arrangementWriteAll",{events:snapshot,revision});
  revision=result.revision;
  syncMessage.textContent="Firebase: lagra";
 }).finally(()=>{pendingWrites--;});
 writeQueue=operation.catch(err=>{window.ssmlFirebaseReady=false;syncMessage.textContent="Lagring feila: "+(err.code||err.message)+". Last inn sida på nytt.";});
 return operation;
};
migrationButton.onclick=async()=>{
 const local=JSON.parse(localStorage.getItem("ssml-arrangement-demo-v1")||"null");
 if(!Array.isArray(local)||!local.length){syncMessage.textContent="Ingen lokal sikkerheitskopi funnen på denne eininga.";return;}
 if(!confirm("Overføre "+local.length+" arrangement til Firebase? Dette blir hovudregisteret."))return;
 migrationButton.disabled=true;
 try{
  const current=await invoke("arrangementReadAll",{});
  if(current.exists){syncMessage.textContent="Firebase inneheld allereie arrangement. Overføring avbroten.";return;}
  const result=await invoke("arrangementWriteAll",{events:local,revision:0});
  revision=result.revision;
  window.ssmlFirebaseReady=true;
  window.ssmlSetEvents(local);
  migrationButton.hidden=true;
  syncMessage.textContent="Firebase: "+local.length+" arrangement overførte";
 }catch(err){syncMessage.textContent="Overføring feila: "+(err.code||err.message);}
 finally{migrationButton.disabled=false;}
};

// Hent endringar frå komiteane utan å forstyrre pågåande lagring.
setInterval(()=>{if(verified&&window.ssmlFirebaseReady&&!loading&&!pendingWrites)loadFirebaseEvents();},10000);
