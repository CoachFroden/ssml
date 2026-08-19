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

function dedupeDuplicateParts(parts = []) {
  const sources = new Set(parts.map(partSourceKey).filter(Boolean));
  const onePartPerSource = sources.size > 1;
  const result = [];
  const indexes = new Map();
  for (const part of parts) {
    const source = partSourceKey(part);
    if (!source) { result.push(part); continue; }
    const key = onePartPerSource ? source : `${source}\u0000${partPageSignature(part)}`;
    if (!indexes.has(key)) {
      indexes.set(key, result.length);
      result.push(part);
      continue;
    }
    const index = indexes.get(key);
    result[index] = preferDuplicatePart(result[index], part);
  }
  return result;
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
    // Rydd opp både delvis opplasta filer og den tomme Firestore-posten.
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

export async function analyzeNewInstrumentPdf(song, file) {
  if (!services?.analysisModel) throw new Error("Firebase AI Logic er ikkje klart.");
  const { PDFDocument } = await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
  const pageCount = source.getPageCount();
  if (!pageCount) throw new Error("PDF-en har ingen sider.");
  const preview = await PDFDocument.create();
  const indices = Array.from({ length: Math.min(2, pageCount) }, (_, index) => index);
  const pages = await preview.copyPages(source, indices);
  pages.forEach(page => preview.addPage(page));
  const previewFile = new File([await preview.save({ useObjectStreams: true })], file.name, { type: "application/pdf" });
  const prompt = `Denne PDF-en skal leggjast til som ei ny instrumentstemme i den eksisterande songen «${song.title || ""}». Analyser berre for identifikasjon, ikkje kvalitet. Finn songtittel, komponist, arrangør og instrument/stemme frå dei første sidene. Returner éi instrumentstemme i parts dersom det er mogleg. Bruk norsk instrumentnamn når det er naturleg. Set fileName nøyaktig til ${file.name}. Dersom noko ikkje finst, bruk tom tekst. Confidence skal vere mellom 0 og 1.`;
  const result = await services.analysisModel.generateContent([prompt, {
    inlineData: { mimeType: "application/pdf", data: await fileToBase64(previewFile) }
  }]);
  const analysis = mergeSongAnalyses([{ data: JSON.parse(result.response.text()), fileName: file.name, pageOffset: 0 }], song, { onePartPerFile: true });
  return { ...analysis, sourcePageCount: pageCount };
}

export async function analyzeSongPdf(song, sourceFiles) {
  if (!services?.analysisModel) throw new Error("Firebase AI Logic er ikkje klart.");
  const analysisFiles = sourceFiles?.length ? [...sourceFiles] : await Promise.all(song.parts.map(async part => {
    const response = await fetch(part.url);
    if (!response.ok) throw new Error(`Kunne ikkje hente ${part.fileName} for AI-analyse.`);
    return new File([await response.blob()], part.fileName, { type: "application/pdf" });
  }));
  const analyses = [];
  for (const file of analysisFiles) {
    const chunks = await splitPdfForAi(file);
    for (const chunk of chunks) {
      const rangeText = chunk.pageCount ? `Dette er side ${chunk.pageOffset + 1} til ${chunk.pageOffset + chunk.pageCount} av kjeldefila.` : "Dette er heile kjeldefila.";
      const prompt = `Analyser desse musikknotane for eit skulemusikkorps. Returner berre data i skjemaet.
Finn korrekt songtittel, komponist og arrangør frå tekst i notane. Identifiser kvar instrumentstemme og alle PDF-sidene som høyrer til stemma. Ei stemme kan gå over fleire sider. Bruk PDF-sidetal frå 1 i denne bolken, ikkje trykte sidetal. Skil mellom til dømes Fløyte 1 og Fløyte 2. Bruk norsk instrumentnamn når det er naturleg. Set fileName til nøyaktig dette kjeldefilnamnet: ${file.name}. Dersom noko ikkje finst, bruk tom tekst. Confidence skal vere mellom 0 og 1. ${rangeText}`;
      const result = await services.analysisModel.generateContent([prompt, {
        inlineData: { mimeType: "application/pdf", data: await fileToBase64(chunk.file) }
      }]);
      analyses.push({ data: JSON.parse(result.response.text()), fileName: file.name, pageOffset: chunk.pageOffset });
    }
  }
  return mergeSongAnalyses(analyses, song, { onePartPerFile: song.mode === "separate" });
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
