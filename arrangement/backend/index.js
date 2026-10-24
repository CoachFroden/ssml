"use strict";
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("node:crypto");
admin.initializeApp();
const db = admin.firestore();
const bootstrap = defineSecret("SSML_ARRANGEMENT_BOOTSTRAP");
const base = "arrangementAccess";
const slots = new Set(["a0","a1","a2","a3"]);
function hash(value,salt){return crypto.scryptSync(value,salt,64).toString("hex");}
function validPassword(value){return typeof value==="string" && value.length>=10 && value.length<=128;}
function check(value,record){if(!record?.salt||!record?.hash)return false;const candidate=Buffer.from(hash(value,record.salt),"hex"),expected=Buffer.from(record.hash,"hex");return candidate.length===expected.length&&crypto.timingSafeEqual(candidate,expected);}
function sealed(password){const salt=crypto.randomBytes(24).toString("hex");return {salt,hash:hash(password,salt)};}
async function throttle(key){const ref=db.doc(base+"/limits/"+crypto.createHash("sha256").update(key).digest("hex"));await db.runTransaction(async tx=>{const doc=await tx.get(ref),now=Date.now(),data=doc.data()||{};const fresh=now-(data.start||0)>15*60*1000;const count=fresh?1:(data.count||0)+1;if(count>12)throw new HttpsError("resource-exhausted","For mange forsøk. Vent 15 minutt.");tx.set(ref,{start:fresh?now:data.start,count,updatedAt:admin.firestore.FieldValue.serverTimestamp()});});}
async function login(slot,password){if(typeof password!=="string"||password.length>128)throw new HttpsError("invalid-argument","Ugyldig passord");const id=slot||"board";if(id!=="board"&&!slots.has(id))throw new HttpsError("invalid-argument","Ukjend komité");const snap=await db.doc(base+"/credentials/"+id).get();const credential=snap.data();if(!check(password,credential))throw new HttpsError("permission-denied","Feil kode");if(id!=="board"){const ev=await db.doc("arrangementEvents/"+id).get();if(!ev.exists||ev.data().open!==true)throw new HttpsError("permission-denied","Komiteen er stengd");}const uid="arr_"+crypto.randomUUID();await db.doc(base+"/sessions/"+uid).set({role:id==="board"?"board":"committee",slot:id,version:credential.version||1,createdAt:admin.firestore.FieldValue.serverTimestamp(),expiresAt:admin.firestore.Timestamp.fromMillis(Date.now()+8*60*60*1000)});const token=await admin.auth().createCustomToken(uid,{ssmlArrangement:true});return {token};}
exports.arrangementLogin=onCall({region:"europe-west1",enforceAppCheck:false},async request=>{const slot=request.data?.slot||"board";await throttle("login:"+slot+":"+(request.rawRequest.ip||"unknown"));return login(slot,request.data?.password);});
async function requireBoard(request){if(!request.auth?.uid)throw new HttpsError("unauthenticated","Logg inn");const snap=await db.doc(base+"/sessions/"+request.auth.uid).get();const s=snap.data();const cred=await db.doc(base+"/credentials/board").get();if(s?.role!=="board"||!s.expiresAt||s.expiresAt.toMillis()<=Date.now()||s.version!==cred.data()?.version)throw new HttpsError("permission-denied","Ingen styretilgang");}
exports.arrangementInitialize=onCall({region:"europe-west1",secrets:[bootstrap]},async request=>{const initial=request.data?.password;if(!validPassword(initial))throw new HttpsError("invalid-argument","Bruk minst 10 teikn");if(request.data?.bootstrapSecret!==bootstrap.value())throw new HttpsError("permission-denied","Feil oppsettnøkkel");const ref=db.doc(base+"/credentials/board");await db.runTransaction(async tx=>{if((await tx.get(ref)).exists)throw new HttpsError("already-exists","Styrekoden er allereie sett");tx.create(ref,{...sealed(initial),version:1});});return {ok:true};});
exports.arrangementSetPassword=onCall({region:"europe-west1"},async request=>{await requireBoard(request);const slot=request.data?.slot,password=request.data?.password;if(slot!=="board"&&!slots.has(slot))throw new HttpsError("invalid-argument","Ukjend komité");if(!validPassword(password))throw new HttpsError("invalid-argument","Bruk minst 10 teikn");const ref=db.doc(base+"/credentials/"+slot);await db.runTransaction(async tx=>{const old=await tx.get(ref);tx.set(ref,{...sealed(password),version:(old.data()?.version||0)+1});});return {ok:true};});

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
    if(event.tasks.length>300||event.people.length>100||event.messages.length>500)throw new HttpsError("invalid-argument","For mange oppføringar");
    const id=slots.has(event.id)?event.id:"extra_"+i+"_"+crypto.randomBytes(6).toString("hex");
    return {id,event};
  });
  const exists=await Promise.all(normalized.map(({id})=>db.doc("arrangementEvents/"+id).get()));
  if(exists.some(x=>x.exists))throw new HttpsError("already-exists","Eitt eller fleire arrangement finst allereie. Ingen data er endra.");
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
