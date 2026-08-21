// Firebase-oppsett for prosjektet «Samnanger skulemusikklag».
// 1. Opne Firebase Console → Project settings → Your apps → Web app.
// 2. Lim inn verdiane under. Ikkje legg service account/private key i denne fila.
export const firebaseConfig = {
  apiKey: "AIzaSyBWsleL1F082y5dTsp2vnTe2LroXpoBSeE",
  authDomain: "samnanger-skulemusikklag.firebaseapp.com",
  projectId: "samnanger-skulemusikklag",
  storageBucket: "samnanger-skulemusikklag.firebasestorage.app",
  messagingSenderId: "1091683313021",
  appId: "1:1091683313021:web:fb43407e195744c8759814"
};

export const isFirebaseConfigured = !Object.values(firebaseConfig).some(value => value.includes("LIM_INN"));

let services = null;

function withOperationTimeout(promise, timeoutMs = 120000, message = "Tenesta brukte for lang tid på å svare.") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

async function fetchWithTimeout(resource, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Nedlastinga brukte for lang tid. Prøv igjen.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function initFirebase() {
  if (!isFirebaseConfigured) return null;
  const [{ initializeApp }, authModule, firestoreModule, storageModule, aiModule] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js"),
    import("https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js"),
    import("https://www.gstatic.com/firebasejs/11.10.0/firebase-ai.js")
  ]);
  const app = initializeApp(firebaseConfig);
  // App Check er mellombels slått av. Firebase-konsollen står på «unenforced»,
  // så tenestene kan brukast utan reCAPTCHA medan produksjonsoppsettet blir avklart.
  const ai = aiModule.getAI(app, { backend: new aiModule.GoogleAIBackend() });
  const responseSchema = aiModule.Schema.object({ properties: {
    title: aiModule.Schema.string(),
    composer: aiModule.Schema.string(),
    arranger: aiModule.Schema.string(),
    confidence: aiModule.Schema.number(),
    parts: aiModule.Schema.array({ items: aiModule.Schema.object({ properties: {
      instrument: aiModule.Schema.string(),
      voice: aiModule.Schema.string(),
      name: aiModule.Schema.string(),
      fileName: aiModule.Schema.string(),
      pageNumbers: aiModule.Schema.array({ items: aiModule.Schema.number() }),
      confidence: aiModule.Schema.number()
    }})})
  }});
  const analysisModel = aiModule.getGenerativeModel(ai, {
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0.1, maxOutputTokens: 8192 }
  });
  services = { app, ai, analysisModel, auth: authModule.getAuth(app), db: firestoreModule.getFirestore(app), storage: storageModule.getStorage(app), authModule, firestoreModule, storageModule };
  return services;
}

export async function signIn(email, password) {
  if (!services) throw new Error("Firebase er ikkje konfigurert.");
  return services.authModule.signInWithEmailAndPassword(services.auth, email, password);
}

export async function signOutUser() {
  if (services) await services.authModule.signOut(services.auth);
}

export function observeAuth(callback) {
  if (!services) return () => {};
  return services.authModule.onAuthStateChanged(services.auth, callback);
}

function normalizePartLabel(value = "") {
  return String(value)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function partPageSignature(part = {}) {
  if (Array.isArray(part.pageNumbers) && part.pageNumbers.length) {
    return [...new Set(part.pageNumbers.map(Number).filter(Number.isFinite))].sort((a, b) => a - b).join(",");
  }
  return `count:${part.pageCount ?? ""}`;
}

function partSourceKey(part = {}) {
  return part.originalStoragePath || part.storagePath || part.fileName || "";
}

function fileNameMatchScore(part = {}) {
  const fileName = normalizePartLabel(part.fileName || "");
  const name = normalizePartLabel(part.name || "");
  if (!fileName || !name) return 0;
  if (fileName === name) return 100;
  if (fileName.endsWith(` ${name}`) || fileName.includes(name)) return 80 + Math.min(19, name.length / 10);
  const tokens = name.split(" ").filter(token => token.length > 1);
  if (!tokens.length) return 0;
  const fileTokens = new Set(fileName.split(" "));
  const hits = tokens.filter(token => fileTokens.has(token)).length;
  return (hits / tokens.length) * 50;
}

function preferDuplicatePart(first, second) {
  const firstScore = fileNameMatchScore(first);
  const secondScore = fileNameMatchScore(second);
  const preferred = secondScore > firstScore ? second : first;
  const other = preferred === first ? second : first;
  return {
    ...other,
    ...preferred,
    storagePath: preferred.storagePath || other.storagePath,
    url: preferred.url || other.url,
    originalStoragePath: preferred.originalStoragePath || other.originalStoragePath,
    originalUrl: preferred.originalUrl || other.originalUrl,
    enhancedStoragePath: preferred.enhancedStoragePath || other.enhancedStoragePath || null,
    enhancedUrl: preferred.enhancedUrl || other.enhancedUrl || null,
    enhancementApplied: Boolean(preferred.enhancementApplied || other.enhancementApplied),
    confidence: Math.max(Number(first.confidence || 0), Number(second.confidence || 0))
  };
}

function clearlySameDuplicate(first, second) {
  if (normalizePartLabel(first.name) === normalizePartLabel(second.name)) return true;
  const scores = [fileNameMatchScore(first), fileNameMatchScore(second)].sort((a, b) => b - a);
  return scores[0] >= 75 && scores[1] < 50;
}

function dedupeDuplicateParts(parts = []) {
  const result = [];
  const exactIndexes = new Map();
  for (const part of parts) {
    const source = partSourceKey(part);
    if (!source) { result.push(part); continue; }
    const baseKey = `${source}\u0000${partPageSignature(part)}`;
    const existingIndex = exactIndexes.get(baseKey);
    if (existingIndex === undefined) {
      exactIndexes.set(baseKey, result.length);
      result.push(part);
      continue;
    }
    if (clearlySameDuplicate(result[existingIndex], part)) {
      result[existingIndex] = preferDuplicatePart(result[existingIndex], part);
    } else {
      result.push(part);
    }
  }

  const distinctSources = new Set(result.map(partSourceKey).filter(Boolean));
  if (distinctSources.size < 3) return result;

  const groups = new Map();
  result.forEach((part, index) => {
    const source = partSourceKey(part);
    if (!source) return;
    if (!groups.has(source)) groups.set(source, []);
    groups.get(source).push(index);
  });

  const removeIndexes = new Set();
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    const strongMatches = indexes.filter(index => fileNameMatchScore(result[index]) >= 75);
    if (strongMatches.length !== 1) continue;
    const winnerIndex = strongMatches[0];
    const others = indexes.filter(index => index !== winnerIndex);
    if (others.some(index => fileNameMatchScore(result[index]) >= 50)) continue;
    let winner = result[winnerIndex];
    for (const index of others) {
      winner = preferDuplicatePart(winner, result[index]);
      removeIndexes.add(index);
    }
    result[winnerIndex] = winner;
  }
  return result.filter((_, index) => !removeIndexes.has(index));
}

export async function fetchSongs() {
  const { collection, doc, getDocs, orderBy, query, updateDoc } = services.firestoreModule;
  const snapshot = await getDocs(query(collection(services.db, "songs"), orderBy("createdAt", "desc")));
  const songs = snapshot.docs.map(snapshotDoc => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
  const cleanupWrites = [];
  for (const song of songs) {
    const originalParts = song.parts || [];
    const cleanedParts = dedupeDuplicateParts(originalParts);
    if (cleanedParts.length !== originalParts.length) {
      song.parts = cleanedParts;
      cleanupWrites.push(updateDoc(doc(services.db, "songs", song.id), { parts: cleanedParts }));
    }
  }
  if (cleanupWrites.length) await Promise.allSettled(cleanupWrites);
  return songs;
}

export async function saveSong(song, files, enhancedFiles = []) {
  const { collection, addDoc, serverTimestamp, updateDoc, deleteDoc } = services.firestoreModule;
  const docRef = await addDoc(collection(services.db, "songs"), { ...song, parts: [], createdAt: serverTimestamp() });
  const parts = [];
  const uploadedPaths = [];
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const enhancedFile = enhancedFiles[index] || null;
      const stamp = `${Date.now()}-${index}`;
      const originalPath = `songs/${docRef.id}/${stamp}-original-${file.name}`;
      const originalRef = services.storageModule.ref(services.storage, originalPath);
      await services.storageModule.uploadBytes(originalRef, file, { contentType: "application/pdf" });
      uploadedPaths.push(originalPath);
      const originalUrl = await services.storageModule.getDownloadURL(originalRef);
      let enhancedPath = null;
      let enhancedUrl = null;
      if (enhancedFile) {
        enhancedPath = `songs/${docRef.id}/${stamp}-enhanced-${file.name}`;
        const enhancedRef = services.storageModule.ref(services.storage, enhancedPath);
        await services.storageModule.uploadBytes(enhancedRef, enhancedFile, { contentType: "application/pdf" });
        uploadedPaths.push(enhancedPath);
        enhancedUrl = await services.storageModule.getDownloadURL(enhancedRef);
      }
      parts.push({
        id: `${docRef.id}-${index}`,
        name: song.mode === "combined" ? "Samla partitur" : file.name.replace(/\.pdf$/i, ""),
        fileName: file.name,
        storagePath: enhancedPath || originalPath,
        url: enhancedUrl || originalUrl,
        originalStoragePath: originalPath,
        originalUrl,
        enhancedStoragePath: enhancedPath,
        enhancedUrl,
        enhancementApplied: Boolean(enhancedUrl),
        enhancementStatus: enhancedUrl ? "completed" : "not_requested",
        enhancementVersion: enhancedUrl ? "legacy-client-v1" : null,
        processingMode: enhancedUrl ? "legacy-client" : null,
        processingError: null,
        pageCount: null
      });
    }
    await updateDoc(docRef, { parts });
    return { id: docRef.id, ...song, parts, createdAt: new Date().toISOString() };
  } catch (error) {
    await Promise.allSettled(uploadedPaths.map(path =>
      services.storageModule.deleteObject(services.storageModule.ref(services.storage, path))
    ));
    await deleteDoc(docRef).catch(() => {});
    throw error;
  }
}

export async function queuePdfEnhancements(song, processingMode = "normal") {
  if (!services) throw new Error("Firebase er ikkje konfigurert.");
  const currentUser = services.auth.currentUser;
  if (!currentUser) throw new Error("Du må vere innlogga for å starte PDF-forbetring.");
  const { collection, doc, serverTimestamp, writeBatch } = services.firestoreModule;
  const batch = writeBatch(services.db);
  const jobsByPath = new Map();
  const parts = (song.parts || []).map(part => {
    const originalStoragePath = part.originalStoragePath || part.storagePath;
    if (!originalStoragePath || !originalStoragePath.startsWith(`songs/${song.id}/`)) {
      throw new Error(`Ugyldig originalsti for ${part.fileName || part.name || "stemme"}.`);
    }
    let jobRef = jobsByPath.get(originalStoragePath);
    if (!jobRef) {
      jobRef = doc(collection(services.db, "pdfEnhancementJobs"));
      jobsByPath.set(originalStoragePath, jobRef);
      batch.set(jobRef, {
        songId: song.id,
        partId: part.id,
        fileName: part.fileName,
        originalStoragePath,
        status: "queued",
        processingMode,
        pipelineVersion: "1.0.0",
        createdAt: serverTimestamp(),
        requestedBy: currentUser.uid
      });
    }
    return {
      ...part,
      enhancementJobId: jobRef.id,
      enhancementStatus: "queued",
      enhancementVersion: "1.0.0",
      processingMode,
      processingError: null
    };
  });
  batch.update(doc(services.db, "songs", song.id), { parts });
  await batch.commit();
  return parts;
}

export async function updateSongParts(songId, parts, mode = "mapped") {
  if (!services) throw new Error("Firebase er ikkje konfigurert.");
  const { doc, updateDoc } = services.firestoreModule;
  await updateDoc(doc(services.db, "songs", songId), { parts, mode });
}

export async function addSongPart(songId, parts, file, name, pageCount) {
  if (!services) throw new Error("Firebase er ikkje konfigurert.");
  const stamp = Date.now();
  const originalPath = `songs/${songId}/${stamp}-original-${file.name}`;
  const originalRef = services.storageModule.ref(services.storage, originalPath);
  try {
    await services.storageModule.uploadBytes(originalRef, file, { contentType: "application/pdf" });
    const originalUrl = await services.storageModule.getDownloadURL(originalRef);
    const part = {
      id: `${songId}-added-${stamp}`,
      name,
      fileName: file.name,
      storagePath: originalPath,
      url: originalUrl,
      originalStoragePath: originalPath,
      originalUrl,
      enhancedStoragePath: null,
      enhancedUrl: null,
      enhancementApplied: false,
      enhancementStatus: "not_requested",
      enhancementVersion: null,
      processingMode: null,
      processingError: null,
      pageCount,
      pageNumbers: Array.from({ length: pageCount }, (_, index) => index + 1)
    };
    const nextParts = [...(parts || []), part];
    const { doc, updateDoc } = services.firestoreModule;
    await updateDoc(doc(services.db, "songs", songId), { parts: nextParts });
    return { parts: nextParts, part };
  } catch (error) {
    await services.storageModule.deleteObject(originalRef).catch(() => {});
    throw error;
  }
}

export async function replacePartPdf(songId, parts, partId, originalFile, enhancedFile = null) {
  if (!services) throw new Error("Firebase er ikkje konfigurert.");
  const stamp = Date.now();
  const uploadedPaths = [];
  try {
    const originalPath = `songs/${songId}/${stamp}-original-${originalFile.name}`;
    const originalRef = services.storageModule.ref(services.storage, originalPath);
    await services.storageModule.uploadBytes(originalRef, originalFile, { contentType: "application/pdf" });
    uploadedPaths.push(originalPath);
    const originalUrl = await services.storageModule.getDownloadURL(originalRef);
    let enhancedPath = null;
    let enhancedUrl = null;
    if (enhancedFile) {
      enhancedPath = `songs/${songId}/${stamp}-enhanced-${enhancedFile.name}`;
      const enhancedRef = services.storageModule.ref(services.storage, enhancedPath);
      await services.storageModule.uploadBytes(enhancedRef, enhancedFile, { contentType: "application/pdf" });
      uploadedPaths.push(enhancedPath);
      enhancedUrl = await services.storageModule.getDownloadURL(enhancedRef);
    }
    const nextParts = parts.map(part => part.id === partId ? {
      ...part,
      archivedStoragePaths: [...new Set([
        ...(part.archivedStoragePaths || []),
        part.storagePath,
        part.originalStoragePath,
        part.enhancedStoragePath
      ].filter(Boolean))],
      fileName: originalFile.name,
      storagePath: enhancedPath || originalPath,
      url: enhancedUrl || originalUrl,
      originalStoragePath: originalPath,
      originalUrl,
      enhancedStoragePath: enhancedPath,
      enhancedUrl,
      enhancementApplied: Boolean(enhancedUrl),
      pageNumbers: Array.from({ length: part.pageCount }, (_, index) => index + 1)
    } : part);
    const { doc, updateDoc } = services.firestoreModule;
    await updateDoc(doc(services.db, "songs", songId), { parts: nextParts });
    return nextParts;
  } catch (error) {
    await Promise.allSettled(uploadedPaths.map(path =>
      services.storageModule.deleteObject(services.storageModule.ref(services.storage, path))
    ));
    throw error;
  }
}

export async function updateSongMetadata(songId, metadata) {
  if (!services) throw new Error("Firebase er ikkje konfigurert.");
  const { doc, updateDoc } = services.firestoreModule;
  await updateDoc(doc(services.db, "songs", songId), {
    title: metadata.title,
    composer: metadata.composer,
    arranger: metadata.arranger
  });
}

export async function deleteSongPart(song, partId) {
  if (!services) throw new Error("Firebase er ikkje konfigurert.");
  const part = (song.parts || []).find(item => item.id === partId);
  if (!part) throw new Error("Fann ikkje stemma som skulle slettast.");
  const nextParts = (song.parts || []).filter(item => item.id !== partId);
  if (!nextParts.length) throw new Error("Den siste stemma kan ikkje slettast. Slett heller heile songen.");

  const { doc, updateDoc } = services.firestoreModule;
  await updateDoc(doc(services.db, "songs", song.id), { parts: nextParts });

  const remainingPaths = new Set(nextParts.flatMap(item => [
    item.storagePath,
    item.originalStoragePath,
    item.enhancedStoragePath,
    ...(item.archivedStoragePaths || [])
  ]).filter(Boolean));
  const removablePaths = [...new Set([
    part.storagePath,
    part.originalStoragePath,
    part.enhancedStoragePath,
    ...(part.archivedStoragePaths || [])
  ].filter(path => path && !remainingPaths.has(path)))];

  for (const path of removablePaths) {
    try {
      await services.storageModule.deleteObject(services.storageModule.ref(services.storage, path));
    } catch (error) {
      if (error?.code !== "storage/object-not-found") {
        console.warn("Stemma vart fjerna, men ei ubrukt PDF-fil kunne ikkje slettast:", path, error);
      }
    }
  }
  return nextParts;
}

export async function deleteSong(song) {
  if (!services) throw new Error("Firebase er ikkje konfigurert.");
  const paths = [...new Set((song.parts || []).flatMap(part => [part.storagePath, part.originalStoragePath, part.enhancedStoragePath, ...(part.archivedStoragePaths || [])]).filter(Boolean))];
  for (const path of paths) {
    try {
      await services.storageModule.deleteObject(services.storageModule.ref(services.storage, path));
    } catch (error) {
      if (error?.code !== "storage/object-not-found") throw error;
    }
  }
  const { deleteDoc, doc } = services.firestoreModule;
  await deleteDoc(doc(services.db, "songs", song.id));
}

const FILE_PART_PATTERNS = [
  { re: /(?:^|\s)(?:full\s+score|conductor(?:\s+score)?|dirigent(?:partitur)?|partitur|score)$/, name: 'Partitur' },
  { re: /(?:^|\s)piccolo(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Piccolo' },
  { re: /(?:^|\s)(?:flute|floyte)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Fløyte' },
  { re: /(?:^|\s)(?:oboe|obo)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Obo' },
  { re: /(?:^|\s)(?:english\s+horn|cor\s+anglais|engelsk\s+horn)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Engelsk horn' },
  { re: /(?:^|\s)(?:contrabassoon|kontrafagott)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Kontrafagott' },
  { re: /(?:^|\s)(?:bassoon|fagott)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Fagott' },
  { re: /(?:^|\s)(?:eb|e\s+flat|ess)\s+(?:clarinet|klarinett)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'E♭ klarinett' },
  { re: /(?:^|\s)(?:eb|e\s+flat|ess)\s+(?:alto\s+clarinet|altklarinett)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'E♭ altklarinett' },
  { re: /(?:^|\s)(?:contrabass\s+clarinet|kontrabassklarinett)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Kontrabassklarinett' },
  { re: /(?:^|\s)(?:bb|b\s+flat)?\s*(?:bass\s+clarinet|bassklarinett)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'B♭ bassklarinett' },
  { re: /(?:^|\s)(?:alto\s+clarinet|altklarinett)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Altklarinett' },
  { re: /(?:^|\s)(?:bb|b\s+flat)?\s*(?:clarinet|klarinett)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'B♭ klarinett' },
  { re: /(?:^|\s)(?:soprano\s+sax(?:ophone)?|sopransaksofon)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Sopransaksofon' },
  { re: /(?:^|\s)(?:alto\s+sax(?:ophone)?|altsaksofon)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Altsaksofon' },
  { re: /(?:^|\s)(?:tenor\s+sax(?:ophone)?|tenorsaksofon)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Tenorsaksofon' },
  { re: /(?:^|\s)(?:baritone\s+sax(?:ophone)?|bari\s+sax|barytonsaksofon|baritonsaksofon)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Barytonsaksofon' },
  { re: /(?:^|\s)(?:french\s+horn|f\s+horn|horn)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Horn' },
  { re: /(?:^|\s)(?:cornet|kornett)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Kornett' },
  { re: /(?:^|\s)(?:flugelhorn|flygelhorn)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Flygelhorn' },
  { re: /(?:^|\s)(?:trumpet|trompet)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Trompet' },
  { re: /(?:^|\s)(?:bass\s+trombone|basstrombone)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Basstrombone' },
  { re: /(?:^|\s)trombone(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Trombone' },
  { re: /(?:^|\s)(?:baritone|baryton|euphonium|eufonium)\s+b\s*c$/, name: 'Baryton B.C.', noVoice: true },
  { re: /(?:^|\s)(?:baritone|baryton|euphonium|eufonium)\s+t\s*c$/, name: 'Baryton T.C.', noVoice: true },
  { re: /(?:^|\s)(?:euphonium|eufonium)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Eufonium' },
  { re: /(?:^|\s)(?:baritone|baryton)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Baryton' },
  { re: /(?:^|\s)tuba(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Tuba' },
  { re: /(?:^|\s)(?:string\s+bass|double\s+bass|contrabass|kontrabass|strykebass)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Kontrabass' },
  { re: /(?:^|\s)(?:electric\s+bass|bass\s+guitar|elektrisk\s+bass)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Elektrisk bass' },
  { re: /(?:^|\s)(?:timpani|pauker)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Pauker' },
  { re: /(?:^|\s)(?:xylophone|xylofon)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Xylofon' },
  { re: /(?:^|\s)(?:glockenspiel|bells|klokkespill)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Klokkespill' },
  { re: /(?:^|\s)(?:vibraphone|vibes|vibrafon)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Vibrafon' },
  { re: /(?:^|\s)marimba(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Marimba' },
  { re: /(?:^|\s)(?:mallet\s+percussion|melodisk\s+slagverk)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Melodisk slagverk' },
  { re: /(?:^|\s)(?:drum\s+set|drumset|trommesett)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Trommesett' },
  { re: /(?:^|\s)(?:percussion|slagverk)(?:\s+(?:part\s+)?([1-9]))?$/, name: 'Slagverk' }
];

function normalizeFilePartText(fileName = '') {
  return String(fileName)
    .replace(/\.pdf$/i, '')
    .replace(/♭/g, 'b')
    .replace(/♯/g, ' sharp ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function filenameToPartName(fileName = '') {
  const text = normalizeFilePartText(fileName);
  for (const item of FILE_PART_PATTERNS) {
    const match = text.match(item.re);
    if (!match) continue;
    const voice = item.noVoice ? '' : (match[1] || '');
    return voice ? `${item.name} ${voice}` : item.name;
  }
  return '';
}

async function firstPagePreview(file) {
  const { PDFDocument } = await import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm');
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
  const pageCount = source.getPageCount();
  if (!pageCount) throw new Error(`PDF-en «${file.name}» har ingen sider.`);
  const preview = await PDFDocument.create();
  const [page] = await preview.copyPages(source, [0]);
  preview.addPage(page);
  const previewFile = new File([await preview.save({ useObjectStreams: true })], file.name, { type: 'application/pdf' });
  return { previewFile, pageCount };
}

async function analyzeFirstPage(song, file, identifyInstrument = false) {
  const { previewFile, pageCount } = await firstPagePreview(file);
  const instrumentText = identifyInstrument
    ? ` Dersom filnamnet ikkje gir eit kjent instrument, identifiser også instrument/stemme frå overskrifta på notasida og returner maksimalt éi stemme i parts.`
    : ` Instrumentlista skal vere tom; parts skal vere [].`;
  const prompt = `Les berre førstesida av denne musikk-PDF-en. Finn korrekt songtittel, komponist og arrangør frå teksten på notasida. Den eksisterande songtittelen er «${song.title || ''}».${instrumentText} Set fileName nøyaktig til ${file.name} dersom du returnerer ei stemme. Dersom noko ikkje finst, bruk tom tekst. Confidence skal vere mellom 0 og 1.`;
  const result = await withOperationTimeout(services.analysisModel.generateContent([prompt, {
    inlineData: { mimeType: 'application/pdf', data: await fileToBase64(previewFile) }
  }]), 120000, "AI-analysen brukte for lang tid. Prøv igjen.");
  const data = JSON.parse(result.response.text());
  if (!Array.isArray(data.parts)) data.parts = [];
  return { data, pageCount };
}

export async function analyzeNewInstrumentPdf(song, file) {
  if (!services?.analysisModel) throw new Error('Firebase AI Logic er ikkje klart.');
  const fileNamePart = filenameToPartName(file.name);
  const { data, pageCount } = await analyzeFirstPage(song, file, !fileNamePart);
  const aiPart = data.parts?.[0];
  const name = fileNamePart || aiPart?.name || [aiPart?.instrument, aiPart?.voice].filter(Boolean).join(' ') || file.name.replace(/\.pdf$/i, '');
  return {
    title: data.title || song.title || '',
    composer: data.composer || song.composer || '',
    arranger: data.arranger || song.arranger || '',
    confidence: Number(data.confidence || 0),
    sourcePageCount: pageCount,
    parts: [{
      ...(aiPart || {}),
      name,
      fileName: file.name,
      pageNumbers: Array.from({ length: pageCount }, (_, index) => index + 1),
      confidence: fileNamePart ? 1 : Number(aiPart?.confidence || data.confidence || 0)
    }]
  };
}

export async function analyzeSongPdf(song, sourceFiles) {
  if (!services?.analysisModel) throw new Error('Firebase AI Logic er ikkje klart.');
  const analysisFiles = sourceFiles?.length ? [...sourceFiles] : await Promise.all(song.parts.map(async part => {
    const response = await fetchWithTimeout(part.url);
    if (!response.ok) throw new Error(`Kunne ikkje hente ${part.fileName} for AI-analyse.`);
    return new File([await response.blob()], part.fileName, { type: 'application/pdf' });
  }));

  if (song.mode === 'separate') {
    const metadataFile = analysisFiles.find(file => /(?:full[\s_-]*score|partitur|conductor|score)/i.test(file.name)) || analysisFiles[0];
    const metadata = metadataFile ? await analyzeFirstPage(song, metadataFile, false) : { data: {}, pageCount: 0 };
    const parts = [];
    for (const file of analysisFiles) {
      const fileNamePart = filenameToPartName(file.name);
      let pageCount;
      let name = fileNamePart;
      let confidence = fileNamePart ? 1 : 0;
      if (file === metadataFile) {
        pageCount = metadata.pageCount;
      } else {
        const { PDFDocument } = await import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm');
        const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
        pageCount = source.getPageCount();
        if (!pageCount) throw new Error(`PDF-en «${file.name}» har ingen sider.`);
      }
      if (!name) {
        const fallback = await analyzeFirstPage(song, file, true);
        const aiPart = fallback.data.parts?.[0];
        name = aiPart?.name || [aiPart?.instrument, aiPart?.voice].filter(Boolean).join(' ') || file.name.replace(/\.pdf$/i, '');
        confidence = Number(aiPart?.confidence || fallback.data.confidence || 0);
        pageCount = fallback.pageCount;
      }
      parts.push({
        name,
        fileName: file.name,
        pageNumbers: Array.from({ length: pageCount }, (_, index) => index + 1),
        confidence
      });
    }
    return {
      title: metadata.data.title || song.title || '',
      composer: metadata.data.composer || song.composer || '',
      arranger: metadata.data.arranger || song.arranger || '',
      confidence: Number(metadata.data.confidence || 0),
      parts
    };
  }

  const analyses = [];
  for (const file of analysisFiles) {
    const chunks = await splitPdfForAi(file);
    for (const chunk of chunks) {
      const rangeText = chunk.pageCount ? `Dette er side ${chunk.pageOffset + 1} til ${chunk.pageOffset + chunk.pageCount} av kjeldefila.` : 'Dette er heile kjeldefila.';
      const prompt = `Analyser desse musikknotane for eit skulemusikkorps. Returner berre data i skjemaet.\nFinn korrekt songtittel, komponist og arrangør frå tekst i notane. Identifiser kvar instrumentstemme og alle PDF-sidene som høyrer til stemma. Ei stemme kan gå over fleire sider. Bruk PDF-sidetal frå 1 i denne bolken, ikkje trykte sidetal. Skil mellom til dømes Fløyte 1 og Fløyte 2. Bruk norsk instrumentnamn når det er naturleg. Set fileName til nøyaktig dette kjeldefilnamnet: ${file.name}. Dersom noko ikkje finst, bruk tom tekst. Confidence skal vere mellom 0 og 1. ${rangeText}`;
      const result = await withOperationTimeout(services.analysisModel.generateContent([prompt, {
        inlineData: { mimeType: 'application/pdf', data: await fileToBase64(chunk.file) }
      }]), 120000, "AI-analysen brukte for lang tid. Prøv igjen.");
      analyses.push({ data: JSON.parse(result.response.text()), fileName: file.name, pageOffset: chunk.pageOffset });
    }
  }
  return mergeSongAnalyses(analyses, song);
}

async function splitPdfForAi(file) {
  const limit = 10 * 1024 * 1024;
  if (file.size <= limit) return [{ file, pageOffset: 0, pageCount: null }];
  const { PDFDocument } = await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
  const chunks = [];
  let start = 0;
  while (start < source.getPageCount()) {
    let count = Math.min(8, source.getPageCount() - start);
    let outputFile = null;
    while (count > 0) {
      const output = await PDFDocument.create();
      const indices = Array.from({ length: count }, (_, index) => start + index);
      const pages = await output.copyPages(source, indices);
      pages.forEach(page => output.addPage(page));
      const bytes = await output.save({ useObjectStreams: true });
      if (bytes.byteLength <= limit) {
        outputFile = new File([bytes], `${file.name.replace(/\.pdf$/i, "")}-del-${chunks.length + 1}.pdf`, { type: "application/pdf" });
        break;
      }
      count = Math.floor(count / 2);
    }
    if (!outputFile || count < 1) throw new Error("AI_ANALYSIS_SINGLE_PAGE_TOO_LARGE");
    chunks.push({ file: outputFile, pageOffset: start, pageCount: count });
    start += count;
  }
  return chunks;
}

function mergeSongAnalyses(analyses, song, { onePartPerFile = false } = {}) {
  const best = field => analyses
    .filter(item => item.data?.[field])
    .sort((a, b) => Number(b.data.confidence || 0) - Number(a.data.confidence || 0))[0]?.data?.[field] || song[field] || "";
  const merged = new Map();
  for (const item of analyses) {
    for (const part of item.data?.parts || []) {
      const name = part.name || [part.instrument, part.voice].filter(Boolean).join(" ") || "Ukjend stemme";
      const key = onePartPerFile ? item.fileName : `${item.fileName}\u0000${name.toLowerCase()}`;
      const candidate = { ...part, name, fileName: item.fileName, pageNumbers: [], confidence: Number(part.confidence || 0) };
      const existing = merged.get(key);
      const adjusted = (part.pageNumbers || []).map(number => Number(number) + item.pageOffset).filter(Number.isFinite);
      if (!existing) {
        candidate.pageNumbers = [...new Set(adjusted)].sort((a, b) => a - b);
        merged.set(key, candidate);
        continue;
      }
      const allPages = [...new Set([...(existing.pageNumbers || []), ...adjusted])].sort((a, b) => a - b);
      if (onePartPerFile) {
        const preferred = preferDuplicatePart(existing, candidate);
        preferred.pageNumbers = allPages;
        preferred.confidence = Math.max(Number(existing.confidence || 0), Number(candidate.confidence || 0));
        merged.set(key, preferred);
      } else {
        existing.pageNumbers = allPages;
        existing.confidence = Math.max(Number(existing.confidence || 0), Number(part.confidence || 0));
        merged.set(key, existing);
      }
    }
  }
  return {
    title: best("title"), composer: best("composer"), arranger: best("arranger"),
    confidence: analyses.length ? Math.max(...analyses.map(item => Number(item.data?.confidence || 0))) : 0,
    parts: [...merged.values()]
  };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error || new Error("Kunne ikkje lese PDF-fila."));
    reader.readAsDataURL(file);
  });
}

export async function applySongAnalysis(songId, metadata, parts) {
  const { doc, runTransaction, serverTimestamp } = services.firestoreModule;
  await runTransaction(services.db, async transaction => {
    const songRef = doc(services.db, "songs", songId);
    const snapshot = await transaction.get(songRef);
    const liveParts = snapshot.data()?.parts || [];
    const mergedParts = parts.map(part => {
      const live = liveParts.find(item =>
        item.originalStoragePath && item.originalStoragePath === part.originalStoragePath
      ) || liveParts.find(item => item.fileName === part.fileName);
      if (!live) return part;
      return {
        ...part,
        storagePath: live.storagePath || part.storagePath,
        url: live.url || part.url,
        originalStoragePath: live.originalStoragePath || part.originalStoragePath,
        originalUrl: live.originalUrl || part.originalUrl,
        enhancedStoragePath: live.enhancedStoragePath || part.enhancedStoragePath || null,
        enhancedUrl: live.enhancedUrl || part.enhancedUrl || null,
        enhancementApplied: Boolean(live.enhancementApplied || part.enhancementApplied),
        enhancementJobId: live.enhancementJobId || part.enhancementJobId || null,
        enhancementStatus: live.enhancementStatus || part.enhancementStatus || "not_requested",
        enhancementVersion: live.enhancementVersion || part.enhancementVersion || null,
        processingMode: live.processingMode || part.processingMode || null,
        processingError: live.processingError || part.processingError || null
      };
    });
    transaction.update(songRef, {
      title: metadata.title, composer: metadata.composer, arranger: metadata.arranger,
      parts: dedupeDuplicateParts(mergedParts), mode: "analyzed", aiAnalyzedAt: serverTimestamp(),
      aiModel: "gemini-3.5-flash", aiConfidence: metadata.confidence
    });
  });
}
