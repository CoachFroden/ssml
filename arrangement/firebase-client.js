// SSML arrangement: isolert Firebase-klient, ikkje aktivert i portalen enno.
// Må først deployere backend, publisere reglar og initialisere styrekode.
import {initializeApp,getApps,getApp} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {getAuth,signInWithCustomToken,signOut} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import {getFirestore,collection,doc,onSnapshot,getDoc,setDoc,updateDoc,addDoc,deleteDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";
const app=getApps().length?getApp():initializeApp(firebaseConfig);
export const auth=getAuth(app);
export const db=getFirestore(app);
const functions=getFunctions(app,"europe-west1");
const call=(name,data)=>httpsCallable(functions,name)(data).then(r=>r.data);
export async function loginBoard(password){
  const {token}=await call("arrangementLogin",{slot:"board",password});
  await signInWithCustomToken(auth,token);
}
export async function loginCommittee(slot,password){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(slot))throw Error("Ukjend komité");
  const {token}=await call("arrangementLogin",{slot,password});
  await signInWithCustomToken(auth,token);
}
export async function setPassword(slot,password){
  return call("arrangementSetPassword",{slot,password});
}
export async function logout(){await signOut(auth);}
export function listenEvents(onData,onError){
  return onSnapshot(collection(db,"arrangementEvents"),snapshot=>onData(snapshot.docs.map(d=>({id:d.id,...d.data()}))),onError);
}
export function listenEvent(slot,onData,onError){
  return onSnapshot(doc(db,"arrangementEvents",slot),snapshot=>onData(snapshot.exists()?{id:snapshot.id,...snapshot.data()}:null),onError);
}

export const setCommitteeOpen=(slot,open)=>call("arrangementSetOpen",{slot,open});
export const importBackup=events=>call("arrangementImport",{events});
export const getEvent=slot=>getDoc(doc(db,"arrangementEvents",slot));
export const saveEvent=(slot,data)=>setDoc(doc(db,"arrangementEvents",slot),data,{merge:true});
export const listenItems=(slot,kind,onData,onError)=>onSnapshot(collection(db,"arrangementEvents",slot,kind),snap=>onData(snap.docs.map(d=>({id:d.id,...d.data()}))),onError);
export const addItem=(slot,kind,data)=>addDoc(collection(db,"arrangementEvents",slot,kind),data);
export const editItem=(slot,kind,id,data)=>updateDoc(doc(db,"arrangementEvents",slot,kind,id),data);
export const removeItem=(slot,kind,id)=>deleteDoc(doc(db,"arrangementEvents",slot,kind,id));
export {serverTimestamp};

export async function getMyRole(){const result=await call("arrangementMyRole",{});return result.role;}
