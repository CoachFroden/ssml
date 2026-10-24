"use strict";
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("node:crypto");
admin.initializeApp();
const db = admin.firestore();
const bootstrap = defineSecret("SSML_ARRANGEMENT_BOOTSTRAP");
const base = "arrangementAccess";
const credential=id=>db.doc(base+"/credentials/entries/"+id);
const session=id=>db.doc(base+"/sessions/entries/"+id);
const limit=id=>db.doc(base+"/limits/entries/"+id);
const slots = new Set(["a0","a1","a2","a3"]);
const validEventId=id=>typeof id==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(id);
function hash(value,salt){return crypto.scryptSync(value,salt,64).toString("hex");}
function validPassword(value){return typeof value==="string" && value.length>=10 && value.length<=128;}
function check(value,record){if(!record?.salt||!record?.hash)return false;const candidate=Buffer.from(hash(value,record.salt),"hex"),expected=Buffer.from(record.hash,"hex");return candidate.length===expected.length&&crypto.timingSafeEqual(candidate,expected);}
function sealed(password){const salt=crypto.randomBytes(24).toString("hex");return {salt,hash:hash(password,salt)};}
async function throttle(key){const ref=limit(crypto.createHash("sha256").update(key).digest("hex"));await db.runTransaction(async tx=>{const doc=await tx.get(ref),now=Date.now(),data=doc.data()||{};const fresh=now-(data.start||0)>15*60*1000;const count=fresh?1:(data.count||0)+1;if(count>12)throw new HttpsError("resource-exhausted","For mange forsøk. Vent 15 minutt.");tx.set(ref,{start:fresh?now:data.start,count,updatedAt:admin.firestore.FieldValue.serverTimestamp()});});}
async function login(slot,password){if(typeof password!=="string"||password.length>128)throw new HttpsError("invalid-argument","Ugyldig passord");const id=slot||"board";if(id!=="board"&&!validEventId(id))throw new HttpsError("invalid-argument","Ukjend komité");const ownerRecord=id==="board"?(await credential("admin").get()).data():null;const owner=id==="board"&&check(password,ownerRecord);const snap=await credential(id).get();const record=snap.data();if(!owner&&!check(password,record))throw new HttpsError("permission-denied","Feil kode");if(id!=="board"){const store=await db.doc("arrangementData/main").get();const match=(store.data()?.events||[]).find(e=>e.id===id);if(!match||match.open!==true)throw new HttpsError("permission-denied","Komiteen er stengd");}const uid="arr_"+crypto.randomUUID();await session(uid).set({role:owner?"admin":id==="board"?"board":"committee",slot:id,version:owner?(ownerRecord.version||1):(record.version||1),createdAt:admin.firestore.FieldValue.serverTimestamp(),expiresAt:admin.firestore.Timestamp.fromMillis(Date.now()+8*60*60*1000)});const token=await admin.auth().createCustomToken(uid,{ssmlArrangement:true});return {token};}
exports.arrangementLogin=onCall({region:"europe-west1",enforceAppCheck:false},async request=>{const slot=request.data?.slot||"board";await throttle("login:"+slot+":"+(request.rawRequest.ip||"unknown"));return login(slot,request.data?.password);});
async function requireBoard(request){if(!request.auth?.uid)throw new HttpsError("unauthenticated","Logg inn");const snap=await session(request.auth.uid).get();const s=snap.data();const cred=await credential(s?.role==="admin"?"admin":"board").get();if(!["board","admin"].includes(s?.role)||!s.expiresAt||s.expiresAt.toMillis()<=Date.now()||s.version!==cred.data()?.version)throw new HttpsError("permission-denied","Ingen styretilgang");}
exports.arrangementInitialize=onCall({region:"europe-west1",secrets:[bootstrap]},async request=>{const initial=request.data?.password;if(!validPassword(initial))throw new HttpsError("invalid-argument","Bruk minst 10 teikn");if(request.data?.bootstrapSecret!==bootstrap.value())throw new HttpsError("permission-denied","Feil oppsettnøkkel");const ref=credential("board");await db.runTransaction(async tx=>{if((await tx.get(ref)).exists)throw new HttpsError("already-exists","Styrekoden er allereie sett");tx.create(ref,{...sealed(initial),version:1});});return {ok:true};});
exports.arrangementSetPassword=onCall({region:"europe-west1"},async request=>{await requireBoard(request);const slot=request.data?.slot,password=request.data?.password;if(slot==="board")await requireAdminSession(request);else if(!validEventId(slot))throw new HttpsError("invalid-argument","Ukjend komité");if(slot==="board"?!validPassword(password):!(typeof password==="string"&&password.length>=6&&password.length<=128))throw new HttpsError("invalid-argument",slot==="board"?"Bruk minst 10 teikn":"Bruk minst 6 teikn");const ref=credential(slot);await db.runTransaction(async tx=>{const old=await tx.get(ref);tx.set(ref,{...sealed(password),version:(old.data()?.version||0)+1});});return {ok:true};});

exports.arrangementSetOpen=onCall({region:"europe-west1"},async request=>{
  await requireBoard(request);
  const slot=request.data?.slot;
  if(!slots.has(slot)||typeof request.data?.open!=="boolean")throw new HttpsError("invalid-argument","Ugyldig komité");
  const ref=db.doc("arrangementEvents/"+slot);
  await ref.set({open:request.data.open},{merge:true});
  return {ok:true};
});
exports.arrangementImport=onCall({region:"europe-west1"},async request=>{
  await requireBoard(request);
  const events=request.data?.events;
  if(!Array.isArray(events)||events.length>100)throw new HttpsError("invalid-argument","Ugyldig sikkerheitskopi");
  const normalized=events.map((event,i)=>{
    if(!event||typeof event.name!=="string"||event.name.length>200||!Array.isArray(event.tasks)||!Array.isArray(event.people)||!Array.isArray(event.messages))throw new HttpsError("invalid-argument","Ugyldig arrangement");
    if(event.tasks.length+event.people.length+event.messages.length>400)throw new HttpsError("invalid-argument","For mange oppføringar");
    const id=slots.has(event.id)?event.id:"extra_"+i+"_"+crypto.randomBytes(6).toString("hex");
    return {id,event};
  });
  const exists=await Promise.all(normalized.map(({id})=>db.doc("arrangementEvents/"+id).get()));
  if(exists.some(x=>x.exists))throw new HttpsError("already-exists","Eitt eller fleire arrangement finst allereie. Ingen data er endra.");
  for(const {event} of normalized){
    if(event.tasks.some(t=>typeof t?.text!=="string"||t.text.length>1000))throw new HttpsError("invalid-argument","Ugyldig oppgåve");
  }
  for(const {id,event} of normalized){
    const ref=db.doc("arrangementEvents/"+id);
    const batch=db.batch();
    batch.create(ref,{name:event.name,year:String(event.year||""),date:String(event.date||""),open:false,importedAt:admin.firestore.FieldValue.serverTimestamp()});
    for(const task of event.tasks){if(typeof task.text!=="string"||task.text.length>1000)throw new HttpsError("invalid-argument","Ugyldig oppgåve");batch.create(ref.collection("tasks").doc(),{text:task.text,done:!!task.done});}
    for(const person of event.people){batch.create(ref.collection("members").doc(),{name:String(person.name||"").slice(0,150),phone:String(person.phone||"").slice(0,80),email:String(person.email||"").slice(0,180)});}
    for(const message of event.messages){batch.create(ref.collection("messages").doc(),{sender:String(message.sender||"").slice(0,100),text:String(message.text||"").slice(0,2000),createdAt:admin.firestore.FieldValue.serverTimestamp()});}
    await batch.commit();
  }
  return {ok:true,imported:normalized.length};
});

async function requireAdmin(request){
 if(!request.auth?.uid)throw new HttpsError("unauthenticated","Logg inn som administrator");
 const snap=await db.doc("arrangementAccess/admin/owner").get();
 if(!snap.exists||snap.data().uid!==request.auth.uid||request.auth.token.firebase?.sign_in_provider!=="google.com")throw new HttpsError("permission-denied","Berre administrator");
}
exports.arrangementClaimAdmin=onCall({region:"europe-west1",secrets:[bootstrap]},async request=>{
 if(!request.auth?.uid||request.auth.token.firebase?.sign_in_provider!=="google.com")throw new HttpsError("unauthenticated","Logg inn med Google");
 if(request.data?.bootstrapSecret!==bootstrap.value())throw new HttpsError("permission-denied","Feil administratornøkkel");
 const ref=db.doc("arrangementAccess/admin/owner");
 await db.runTransaction(async tx=>{
  if((await tx.get(ref)).exists)throw new HttpsError("already-exists","Administrator er allereie registrert");
  tx.create(ref,{uid:request.auth.uid,createdAt:admin.firestore.FieldValue.serverTimestamp()});
 });
 return {ok:true};
});
exports.arrangementAdminSetBoardPassword=onCall({region:"europe-west1"},async request=>{
 await requireAdmin(request);
 const password=request.data?.password;
 if(!validPassword(password))throw new HttpsError("invalid-argument","Bruk minst 10 teikn");
 const ref=credential("board");
 await db.runTransaction(async tx=>{
  const old=await tx.get(ref);
  tx.set(ref,{...sealed(password),version:(old.data()?.version||0)+1});
 });
 return {ok:true};
});

async function requireAdminSession(request){
 const uid=request.auth?.uid;
 if(!uid)throw new HttpsError("unauthenticated","Logg inn");
 const record=(await session(uid).get()).data();
 const cred=(await credential("admin").get()).data();
 if(record?.role!=="admin"||!record.expiresAt||record.expiresAt.toMillis()<=Date.now()||record.version!==cred?.version)throw new HttpsError("permission-denied","Berre administrator");
}

exports.arrangementCreateAdminPassword=onCall({region:"europe-west1",secrets:[bootstrap]},async request=>{
 const password=request.data?.password;
 if(!validPassword(password))throw new HttpsError("invalid-argument","Bruk minst 10 teikn");
 if(request.data?.bootstrapSecret!==bootstrap.value())throw new HttpsError("permission-denied","Feil oppsettnøkkel");
 const ref=credential("admin");
 await db.runTransaction(async tx=>{
  if((await tx.get(ref)).exists)throw new HttpsError("already-exists","Administratorpassord finst");
  tx.create(ref,{...sealed(password),version:1});
 });
 return {ok:true};
});
exports.arrangementMyRole=onCall({region:"europe-west1"},async request=>{
 if(!request.auth?.uid)return {role:"none"};
 const record=(await session(request.auth.uid).get()).data();
 if(!record?.expiresAt||record.expiresAt.toMillis()<=Date.now())return {role:"none"};
 const cred=(await credential(record.role==="admin"?"admin":record.slot).get()).data();
 return {role:record.version===cred?.version?record.role:"none"};
});

const arrangementStore=db.doc("arrangementData/main");
exports.arrangementReadAll=onCall({region:"europe-west1"},async request=>{
 await requireBoard(request);
 const snap=await arrangementStore.get();
 return {exists:snap.exists,events:snap.exists?snap.data().events:[],revision:snap.exists?snap.data().revision:0};
});
exports.arrangementWriteAll=onCall({region:"europe-west1"},async request=>{
 await requireBoard(request);
 const events=request.data?.events,revision=request.data?.revision;
 if(!Array.isArray(events)||events.length>100||!Number.isInteger(revision)||JSON.stringify(events).length>800000)throw new HttpsError("invalid-argument","Ugyldige arrangementsdata");
 for(const e of events){if(!e||typeof e.id!=="string"||typeof e.name!=="string"||!Array.isArray(e.tasks)||!Array.isArray(e.people)||!Array.isArray(e.messages))throw new HttpsError("invalid-argument","Ugyldig arrangement");}
 return db.runTransaction(async tx=>{
  const old=await tx.get(arrangementStore);
  const current=old.exists?old.data().revision:0;
  if(current!==revision)throw new HttpsError("aborted","Data er endra frå ei anna eining. Last inn på nytt.");
  tx.set(arrangementStore,{events,revision:current+1,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
  return {revision:current+1};
 });
});

async function requireCommittee(request,slot){
 if(!validEventId(slot)||!request.auth?.uid)throw new HttpsError("unauthenticated","Logg inn");
 const record=(await session(request.auth.uid).get()).data();
 const cred=(await credential(slot).get()).data();
 if(record?.role!=="committee"||record.slot!==slot||record.version!==cred?.version||!record.expiresAt||record.expiresAt.toMillis()<=Date.now())throw new HttpsError("permission-denied","Ugyldig komitétilgang");
}
function findCommitteeEvent(events,slot){return events.findIndex(e=>e.id===slot);}
exports.arrangementCommitteeRead=onCall({region:"europe-west1"},async request=>{
 const slot=request.data?.slot;await requireCommittee(request,slot);
 const snap=await arrangementStore.get(),events=snap.data()?.events||[];
 const index=findCommitteeEvent(events,slot);
 if(index<0)throw new HttpsError("not-found","Arrangementet finst ikkje");
 const event=events[index];
 if(event.open!==true)throw new HttpsError("permission-denied","Komiteen er stengd");
 return {event,revision:snap.data().revision};
});
exports.arrangementCommitteeUpdate=onCall({region:"europe-west1"},async request=>{
 const slot=request.data?.slot;await requireCommittee(request,slot);
 const action=request.data?.action,taskId=request.data?.taskId,done=request.data?.done;
 const sender=request.data?.sender,text=request.data?.text;
 if(action==="task"&&(typeof taskId!=="string"||typeof done!=="boolean"))throw new HttpsError("invalid-argument","Ugyldig oppgåve");
 if(action==="message"&&(typeof sender!=="string"||!sender.trim()||sender.length>100||typeof text!=="string"||!text.trim()||text.length>2000))throw new HttpsError("invalid-argument","Ugyldig melding");
 if(!["task","message"].includes(action))throw new HttpsError("invalid-argument","Ukjend handling");
 return db.runTransaction(async tx=>{
  const snap=await tx.get(arrangementStore);
  if(!snap.exists)throw new HttpsError("not-found","Ingen arrangement");
  const events=snap.data().events,index=findCommitteeEvent(events,slot);
  if(index<0||events[index].open!==true)throw new HttpsError("permission-denied","Komiteen er stengd");
  const event=events[index];
  if(action==="task"){
   const task=event.tasks.find(t=>t.id===taskId);
   if(!task)throw new HttpsError("not-found","Oppgåva finst ikkje");
   task.done=done;
  }else{
   event.messages.push({id:crypto.randomUUID(),sender:sender.trim(),text:text.trim(),date:new Date().toLocaleString("nn-NO",{timeZone:"Europe/Oslo"})});
  }
  tx.update(arrangementStore,{events,revision:snap.data().revision+1,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
  return {ok:true};
 });
});
