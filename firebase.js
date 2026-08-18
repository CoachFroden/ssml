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

export async function fetchSongs() {
  const { collection, getDocs, orderBy, query } = services.firestoreModule;
  const snapshot = await getDocs(query(collection(services.db, "songs"), orderBy("createdAt", "desc")));
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
      // Filene ligg direkte under songmappa slik at dei passar Storage-regelen
      // songs/{songId}/{fileName}. Prefikset skil originalen frå den forbetra fila.
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
        pageCount: null
      });
    }
    await updateDoc(docRef, { parts });
    return { id: docRef.id, ...song, parts, createdAt: new Date().toISOString() };
  } catch (error) {
    // Rydd opp både delvis opplasta filer og den tomme Firestore-posten.
    await Promise.allSettled(uploadedPaths.map(path =>
      services.storageModule.deleteObject(services.storageModule.ref(services.storage, path))
    ));
    await deleteDoc(docRef).catch(() => {});
    throw error;
  }
}

export async function updateSongParts(songId, parts, mode = "mapped") {
  if (!services) throw new Error("Firebase er ikkje konfigurert.");
  const { doc, updateDoc } = services.firestoreModule;
  await updateDoc(doc(services.db, "songs", songId), { parts, mode });
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

export async function analyzeSongPdf(song, sourceFiles) {
  if (!services?.analysisModel) throw new Error("Firebase AI Logic er ikkje klart.");
  const analysisFiles = sourceFiles?.length ? [...sourceFiles] : await Promise.all(song.parts.map(async part => {
    const response = await fetch(part.url);
    if (!response.ok) throw new Error(`Kunne ikkje hente ${part.fileName} for AI-analyse.`);
    return new File([await response.blob()], part.fileName, { type: "application/pdf" });
  }));
  const totalBytes = analysisFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > 15 * 1024 * 1024) throw new Error("AI_ANALYSIS_FILE_TOO_LARGE");
  const files = await Promise.all(analysisFiles.map(async file => ({
    inlineData: {
      mimeType: "application/pdf",
      data: await fileToBase64(file)
    }
  })));
  const prompt = `Analyser desse musikknotane for eit skulemusikkorps. Returner berre data i skjemaet.
Finn korrekt songtittel, komponist og arrangør frå tekst i notane. Identifiser kvar instrumentstemme og alle PDF-sidene som høyrer til stemma. Ei stemme kan gå over fleire sider. Bruk PDF-sidetal frå 1, ikkje trykte sidetal. Skil mellom til dømes Fløyte 1 og Fløyte 2. Bruk norsk instrumentnamn når det er naturleg. Set fileName til nøyaktig namnet på kjeldefila. Dersom noko ikkje finst, bruk tom tekst. Confidence skal vere mellom 0 og 1. Filnamn: ${song.parts.map(p=>p.fileName).join(", ")}.`;
  const result = await services.analysisModel.generateContent([prompt, ...files]);
  return JSON.parse(result.response.text());
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
  const { doc, updateDoc, serverTimestamp } = services.firestoreModule;
  await updateDoc(doc(services.db, "songs", songId), {
    title: metadata.title,
    composer: metadata.composer,
    arranger: metadata.arranger,
    parts,
    mode: "analyzed",
    aiAnalyzedAt: serverTimestamp(),
    aiModel: "gemini-3.5-flash",
    aiConfidence: metadata.confidence
  });
}
