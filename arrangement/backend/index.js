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
async function throttle(key){const ref=limit(crypto.createHash("sha256").update(key).digest("hex"));await db.runTransaction(async tx=>{const doc=await tx.get(ref),now=Date.now(),data=doc.data()||{};const fresh=now-(data.start||0)>15*60*1000;const count=fresh?1:(data.count||0)+1;if(count>12)throw new HttpsError("resource-exhausted","For mange forsÃ¸k. Vent 15 minutt.");tx.set(ref,{start:fresh?now:data.start,count,updatedAt:admin.firestore.FieldValue.serverTimestamp()});});}
async function login(slot,password){if(typeof password!=="string"||password.length>128)throw new HttpsError("invalid-argument","Ugyldig passord");const id=slot||"board";if(id!=="board"&&!validEventId(id))throw new HttpsError("invalid-argument","Ukjend komitÃ©");const ownerRecord=id==="board"?(await credential("admin").get()).data():null;const owner=id==="board"&&check(password,ownerRecord);const snap=await credential(id).get();const record=snap.data();if(!owner&&!check(password,record))throw new HttpsError("permission-denied","Feil kode");if(id!=="board"){const store=await db.doc("arrangementData/main").get();const match=(store.data()?.events||[]).find(e=>e.id===id);if(!match||match.open!==true)throw new HttpsError("permission-denied","Komiteen er stengd");}const uid="arr_"+crypto.randomUUID();await session(uid).set({role:owner?"admin":id==="board"?"board":"committee",slot:id,version:owner?(ownerRecord.version||1):(record.version||1),createdAt:admin.firestore.FieldValue.serverTimestamp(),expiresAt:admin.firestore.Timestamp.fromMillis(Date.now()+8*60*60*1000)});const token=await admin.auth().createCustomToken(uid,{ssmlArrangement:true,role:owner?"admin":id==="board"?"board":"committee",slot:id,sessionExpiresAt:Date.now()+8*60*60*1000});return {token};}
exports.arrangementLogin=onCall({region:"europe-west1",enforceAppCheck:false},async request=>{const slot=request.data?.slot||"board";await throttle("login:"+slot+":"+(request.rawRequest.ip||"unknown"));return login(slot,request.data?.password);});
async function requireBoard(request){if(!request.auth?.uid)throw new HttpsError("unauthenticated","Logg inn");const snap=await session(request.auth.uid).get();const s=snap.data();const cred=await credential(s?.role==="admin"?"admin":"board").get();if(!["board","admin"].includes(s?.role)||!s.expiresAt||s.expiresAt.toMillis()<=Date.now()||s.version!==cred.data()?.version)throw new HttpsError("permission-denied","Ingen styretilgang");}
exports.arrangementInitialize=onCall({region:"europe-west1",secrets:[bootstrap]},async request=>{const initial=request.data?.password;if(!validPassword(initial))throw new HttpsError("invalid-argument","Bruk minst 10 teikn");if(request.data?.bootstrapSecret!==bootstrap.value())throw new HttpsError("permission-denied","Feil oppsettnÃ¸kkel");const ref=credential("board");await db.runTransaction(async tx=>{if((await tx.get(ref)).exists)throw new HttpsError("already-exists","Styrekoden er allereie sett");tx.create(ref,{...sealed(initial),version:1});});return {ok:true};});
exports.arrangementSetPassword=onCall({region:"europe-west1"},async request=>{await requireBoard(request);const slot=request.data?.slot,password=request.data?.password;if(slot==="board")await requireAdminSession(request);else if(!validEventId(slot))throw new HttpsError("invalid-argument","Ukjend komitÃ©");if(slot==="board"?!validPassword(password):!(typeof password==="string"&&password.length>=6&&password.length<=128))throw new HttpsError("invalid-argument",slot==="board"?"Bruk minst 10 teikn":"Bruk minst 6 teikn");const ref=credential(slot);await db.runTransaction(async tx=>{const old=await tx.get(ref);tx.set(ref,{...sealed(password),version:(old.data()?.version||0)+1});});return {ok:true};});

exports.arrangementSetOpen=onCall({region:"europe-west1"},async request=>{
  await requireBoard(request);
  const slot=request.data?.slot;
  if(!slots.has(slot)||typeof request.data?.open!=="boolean")throw new HttpsError("invalid-argument","Ugyldig komitÃ©");
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
    if(event.tasks.length+event.people.length+event.messages.length>400)throw new HttpsError("invalid-argument","For mange oppfÃ¸ringar");
    const id=slots.has(event.id)?event.id:"extra_"+i+"_"+crypto.randomBytes(6).toString("hex");
    return {id,event};
  });
  const exists=await Promise.all(normalized.map(({id})=>db.doc("arrangementEvents/"+id).get()));
  if(exists.some(x=>x.exists))throw new HttpsError("already-exists","Eitt eller fleire arrangement finst allereie. Ingen data er endra.");
  for(const {event} of normalized){
    if(event.tasks.some(t=>typeof t?.text!=="string"||t.text.length>1000))throw new HttpsError("invalid-argument","Ugyldig oppgÃ¥ve");
  }
  for(const {id,event} of normalized){
    const ref=db.doc("arrangementEvents/"+id);
    const batch=db.batch();
    batch.create(ref,{name:event.name,year:String(event.year||""),date:String(event.date||""),open:false,importedAt:admin.firestore.FieldValue.serverTimestamp()});
    for(const task of event.tasks){if(typeof task.text!=="string"||task.text.length>1000)throw new HttpsError("invalid-argument","Ugyldig oppgÃ¥ve");batch.create(ref.collection("tasks").doc(),{text:task.text,done:!!task.done});}
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
 if(request.data?.bootstrapSecret!==bootstrap.value())throw new HttpsError("permission-denied","Feil administratornÃ¸kkel");
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
 if(request.data?.bootstrapSecret!==bootstrap.value())throw new HttpsError("permission-denied","Feil oppsettnÃ¸kkel");
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
// Offentleg, avgrensa metadata til innloggingssida. Ingen persondata eller meldingar.
const boardContactsRef=db.doc("arrangementData/boardContacts");
exports.arrangementBoardContacts=onCall({region:"europe-west1"},async request=>{
 await requireBoard(request);
 const action=request.data?.action||"read";
 if(action==="read"){const snap=await boardContactsRef.get();return {members:snap.data()?.members||[]};}
 if(!["save","delete"].includes(action))throw new HttpsError("invalid-argument","Ugyldig handling");
 const member=request.data?.member,id=request.data?.id;
 if(action==="save"&&(!member||typeof member.name!=="string"||!member.name.trim()||member.name.length>120||["role","phone","email"].some(k=>typeof member[k]!=="string"||member[k].length>200)))throw new HttpsError("invalid-argument","Ugyldig styremedlem");
 if(action==="delete"&&typeof id!=="string")throw new HttpsError("invalid-argument","Ugyldig ID");
 return db.runTransaction(async tx=>{
  const snap=await tx.get(boardContactsRef);const members=snap.data()?.members||[];
  if(action==="save"){
   const next={id:typeof member.id==="string"&&member.id?member.id:crypto.randomUUID(),name:member.name.trim(),role:member.role.trim(),phone:member.phone.trim(),email:member.email.trim()};
   const i=members.findIndex(m=>m.id===next.id);
   if(i>=0)members[i]=next;else members.push(next);
  }else{const i=members.findIndex(m=>m.id===id);if(i>=0)members.splice(i,1);}
  tx.set(boardContactsRef,{members});return {members};
 });
});
const childrenRef=db.doc("arrangementData/children");
const childKey=v=>String(v||"").trim().normalize("NFKC").toLocaleLowerCase("nb-NO").replace(/\\s+/g," ");
exports.arrangementChildren=onCall({region:"europe-west1"},async request=>{
 await requireBoard(request);
 const action=request.data?.action||"read";
 if(action==="read"){const snap=await childrenRef.get();return {children:snap.data()?.children||[]};}
 if(!["save","delete"].includes(action))throw new HttpsError("invalid-argument","Ugyldig handling");
 const child=request.data?.child,id=request.data?.id;
 if(action==="save"&&(!child||!String(child.firstName||"").trim()||!String(child.lastName||"").trim()))throw new HttpsError("invalid-argument","Fornamn og etternamn er pÃ¥kravd");
 return db.runTransaction(async tx=>{
  const snap=await tx.get(childrenRef),children=snap.data()?.children||[];
  if(action==="save"){
   const next={id:String(child.id||crypto.randomUUID()),firstName:String(child.firstName).trim(),lastName:String(child.lastName).trim(),corps:String(child.corps||"").trim(),instrument:String(child.instrument||"").trim(),parent1:String(child.parent1||"").trim(),phone1:String(child.phone1||"").trim(),email1:String(child.email1||"").trim(),parent2:String(child.parent2||"").trim(),phone2:String(child.phone2||"").trim(),email2:String(child.email2||"").trim()};
   if(Object.values(next).some(v=>v.length>200))throw new HttpsError("invalid-argument","For lang tekst");
   if(children.some(c=>c.id!==next.id&&childKey(c.firstName)===childKey(next.firstName)&&childKey(c.lastName)===childKey(next.lastName)))throw new HttpsError("already-exists","Dette barnet er allereie registrert.");
   const index=children.findIndex(c=>c.id===next.id);
   if(index<0)children.push(next);else children[index]=next;
  }else if(action==="delete"){const index=children.findIndex(c=>c.id===id);if(index>=0)children.splice(index,1);}
  tx.set(childrenRef,{children});return {children};
 });
});
exports.arrangementPublicName=onCall({region:"europe-west1"},async request=>{
 const slot=request.data?.slot;
 if(!validEventId(slot))throw new HttpsError("invalid-argument","Ugyldig arrangement");
 const snap=await arrangementStore.get();
 const event=(snap.data()?.events||[]).find(e=>e.id===slot);
 if(!event)return {name:null};
 return {name:String(event.name||"").slice(0,150)};
});
// Permanent, read-only snapshots of completed arrangements. Archive is created on first board read after the date passes.
const archiveCollection=db.collection("arrangementHistory");
function archiveDatePassed(event){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(event.date||"")))return false;const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Oslo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());return event.date<today;}
async function archivePastEvents(events){const past=events.filter(e=>archiveDatePassed(e)&&validEventId(e.id));if(!past.length)return;for(const e of past){const ref=archiveCollection.doc(e.id);await db.runTransaction(async tx=>{const existing=await tx.get(ref);if(!existing.exists)tx.create(ref,{event:e,archivedAt:admin.firestore.FieldValue.serverTimestamp()});});}}
// Evaluation is stored separately so that reopening never changes the original archive snapshot.
const evaluationCollection=db.collection("arrangementEvaluations");
function evaluationDeadline(event){const raw=String(event.date||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;const end=Date.parse(raw+"T23:59:59+01:00");return Number.isFinite(end)?end+14*86400000:null;}
function evaluationIsOpen(event,settings){const end=evaluationDeadline(event);if(end===null)return false;const now=Date.now();return now<=end||(settings?.reopenUntil?.toMillis?.()||0)>now;}
exports.arrangementEvaluation=onCall({region:"europe-west1"},async request=>{
 const slot=request.data?.slot,action=request.data?.action;
 if(!validEventId(slot))throw new HttpsError("invalid-argument","Ugyldig arrangement");
 const board=action==="reopen"||action==="board-read";
 if(board)await requireBoard(request);else await requireCommittee(request,slot);
 const snap=await arrangementStore.get();const event=(snap.data()?.events||[]).find(e=>e.id===slot);
 if(!event)throw new HttpsError("not-found","Arrangementet finst ikkje");
 const ref=evaluationCollection.doc(slot);
 if(action==="reopen"){
  const days=request.data?.days===14?14:null;
  if(!days)throw new HttpsError("invalid-argument","Ugyldig periode");
  await ref.set({reopenUntil:admin.firestore.Timestamp.fromMillis(Date.now()+days*86400000),updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
 }else if(action==="save"){
  const fields=request.data?.fields;
  if(!fields||typeof fields!=="object"||Array.isArray(fields)||!["good","improve","tips"].every(k=>typeof fields[k]==="string"&&fields[k].length<=4000))throw new HttpsError("invalid-argument","Ugyldig evaluering");
  await db.runTransaction(async tx=>{const existing=await tx.get(ref);if(!evaluationIsOpen(event,existing.data()))throw new HttpsError("permission-denied","Evalueringsperioden er avslutta");tx.set(ref,{fields:{good:fields.good.trim(),improve:fields.improve.trim(),tips:fields.tips.trim()},updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});});
 }else if(!["read","board-read"].includes(action))throw new HttpsError("invalid-argument","Ukjend handling");
 const record=(await ref.get()).data()||{};
 return {fields:record.fields||{good:"",improve:"",tips:""},open:evaluationIsOpen(event,record),reopenUntil:record.reopenUntil?.toDate().toISOString()||null,deadline:event.date};
});
exports.arrangementHistoryRead=onCall({region:"europe-west1"},async request=>{await requireBoard(request);const current=await arrangementStore.get();await archivePastEvents(current.data()?.events||[]);const snap=await archiveCollection.limit(100).get();const events=await Promise.all(snap.docs.map(async d=>{const event=d.data().event;const evaluation=(await evaluationCollection.doc(event.id).get()).data();return {...event,evaluation:evaluation?.fields||null};}));return {events};});
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
 const previous=await arrangementStore.get();
 await archivePastEvents(previous.data()?.events||[]);
 return db.runTransaction(async tx=>{
  const old=await tx.get(arrangementStore);
  const current=old.exists?old.data().revision:0;
  if(current!==revision)throw new HttpsError("aborted","Data er endra frå ei anna eining. Last inn på nytt.");
  tx.set(arrangementStore,{events,revision:current+1,updatedAt:admin.firestore.FieldValue.serverTimestamp()});for(const event of events){if(validEventId(event.id)){tx.set(db.doc("arrangementFileAccess/"+event.id),{open:event.open===true,updatedAt:admin.firestore.FieldValue.serverTimestamp()});}}

  return {revision:current+1};
 });
});

async function requireCommittee(request,slot){
 if(!validEventId(slot)||!request.auth?.uid)throw new HttpsError("unauthenticated","Logg inn");
 const record=(await session(request.auth.uid).get()).data();
 const cred=(await credential(slot).get()).data();
 if(record?.role!=="committee"||record.slot!==slot||record.version!==cred?.version||!record.expiresAt||record.expiresAt.toMillis()<=Date.now())throw new HttpsError("permission-denied","Ugyldig komitÃ©tilgang");
}
function findCommitteeEvent(events,slot){return events.findIndex(e=>e.id===slot);}
exports.arrangementCommitteeRead=onCall({region:"europe-west1"},async request=>{
 const slot=request.data?.slot;await requireCommittee(request,slot);
 const snap=await arrangementStore.get(),events=snap.data()?.events||[];
 const index=findCommitteeEvent(events,slot);
 if(index<0)throw new HttpsError("not-found","Arrangementet finst ikkje");
 const event=events[index];
 if(event.open!==true)throw new HttpsError("permission-denied","Komiteen er stengd");
 const boardSnap=await boardContactsRef.get();
 return {event,revision:snap.data().revision,boardMembers:boardSnap.data()?.members||[]};
});
exports.arrangementCommitteeUpdate=onCall({region:"europe-west1"},async request=>{
 const slot=request.data?.slot;await requireCommittee(request,slot);
 const action=request.data?.action,taskId=request.data?.taskId,done=request.data?.done;
 const sender=request.data?.sender,text=request.data?.text,recipient=request.data?.recipient;
 if(action==="task"&&(typeof taskId!=="string"||typeof done!=="boolean"))throw new HttpsError("invalid-argument","Ugyldig oppgÃ¥ve");
 if(action==="message"&&(typeof sender!=="string"||!sender.trim()||sender.length>100||typeof text!=="string"||!text.trim()||text.length>2000))throw new HttpsError("invalid-argument","Ugyldig melding");
 if(action==="message"&&!["board","committee"].includes(recipient))throw new HttpsError("invalid-argument","Vel mottakar");
 if(action==="task-add"&&(typeof text!=="string"||!text.trim()||text.length>500||typeof sender!=="string"||!sender.trim()||sender.length>100))throw new HttpsError("invalid-argument","Ugyldig oppgÃ¥ve");
 if(action==="task-delete"&&typeof taskId!=="string")throw new HttpsError("invalid-argument","Ugyldig oppgÃ¥ve");
 if(!["task","task-add","task-delete","message","note-add","note-edit","note-delete"].includes(action))throw new HttpsError("invalid-argument","Ukjend handling");
 return db.runTransaction(async tx=>{
  const snap=await tx.get(arrangementStore);
  if(!snap.exists)throw new HttpsError("not-found","Ingen arrangement");
  const events=snap.data().events,index=findCommitteeEvent(events,slot);
  if(index<0||events[index].open!==true)throw new HttpsError("permission-denied","Komiteen er stengd");
  const event=events[index];
  if(action==="task"){
   const task=event.tasks.find(t=>t.id===taskId);
   if(!task)throw new HttpsError("not-found","OppgÃ¥va finst ikkje");
   task.done=done;
  }else if(action==="task-add"){
   if(event.tasks.length>=300)throw new HttpsError("resource-exhausted","For mange oppgÃ¥ver");
   event.tasks.push({id:crypto.randomUUID(),text:text.trim(),done:false,createdBy:"committee",createdByUid:request.auth.uid,creatorName:sender.trim()});
  }else if(action==="task-delete"){
   const index=event.tasks.findIndex(t=>t.id===taskId);
   if(index<0)throw new HttpsError("not-found","OppgÃ¥va finst ikkje");
   if(event.tasks[index].createdBy!=="committee"||event.tasks[index].createdByUid!==request.auth.uid)throw new HttpsError("permission-denied","Du kan berre slette eigne oppgÃ¥ver frÃ¥ denne innlogginga");
   event.tasks.splice(index,1);
  }else if(action==="note-delete"){
  const noteId=request.data?.noteId;
  if(typeof noteId!=="string"||!noteId.trim())
    throw new HttpsError("invalid-argument","Ugyldig notat");
  if(!Array.isArray(event.notes))
    throw new HttpsError("not-found","Notatet finst ikkje");
  const index=event.notes.findIndex(n=>n.id===noteId);
  if(index<0)
    throw new HttpsError("not-found","Notatet finst ikkje");
  event.notes.splice(index,1);
}else if(action==="note-edit"){
  const noteId=request.data?.noteId;
  const title=request.data?.title;
  if(typeof noteId!=="string"||
     typeof title!=="string"||!title.trim()||title.length>120||
     typeof sender!=="string"||!sender.trim()||sender.length>100||
     typeof text!=="string"||!text.trim()||text.length>2000)
    throw new HttpsError("invalid-argument","Ugyldig notat");
  event.notes=Array.isArray(event.notes)?event.notes:[];
  const note=event.notes.find(n=>n.id===noteId);
  if(!note)throw new HttpsError("not-found","Notatet finst ikkje");
  note.title=title.trim();
  note.text=text.trim();
  note.author=sender.trim();
  note.updatedAt=new Date().toLocaleString("nn-NO",{timeZone:"Europe/Oslo"});
}else if(action==="note-add"){if(typeof request.data?.title!=="string"||!request.data.title.trim()||request.data.title.length>120)throw new HttpsError("invalid-argument","Ugyldig overskrift");if(typeof sender!=="string"||!sender.trim()||sender.length>100||typeof text!=="string"||!text.trim()||text.length>2000)throw new HttpsError("invalid-argument","Ugyldig notat");event.notes=Array.isArray(event.notes)?event.notes:[];if(event.notes.length>=500)throw new HttpsError("resource-exhausted","For mange notat");event.notes.push({id:crypto.randomUUID(),title:request.data.title.trim(),author:sender.trim(),text:text.trim(),date:new Date().toLocaleString("nn-NO",{timeZone:"Europe/Oslo"})});}else{event.messages.push({id:crypto.randomUUID(),sender:sender.trim(),text:text.trim(),recipient,role:"committee",date:new Date().toLocaleString("nn-NO",{timeZone:"Europe/Oslo"})});
  }
  tx.update(arrangementStore,{events,revision:snap.data().revision+1,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
  return {ok:true};
 });
});


