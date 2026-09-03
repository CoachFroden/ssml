const UI_VERSION = "1";

function loadEnhancementStyles() {
  if (document.querySelector('link[data-ssml-ui="enhancements"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL(`./ui-enhancements.css?v=${UI_VERSION}`, import.meta.url).href;
  link.dataset.ssmlUi = "enhancements";
  document.head.append(link);
}

loadEnhancementStyles();

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const FIREBASE_VERSION = "11.10.0";

let songs = [];
let songsFetchPromise = null;
let firebaseServicesPromise = null;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(value = "") {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function uiToast(message, type = "ok") {
  const region = $("#toast-region");
  if (!region) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  region.append(el);
  setTimeout(() => el.remove(), 4200);
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (Number.isFinite(Number(value.seconds))) return Number(value.seconds) * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getFirebaseServices() {
  if (firebaseServicesPromise) return firebaseServicesPromise;

  firebaseServicesPromise = (async () => {
    const [appModule, authModule, firestoreModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
    ]);

    let app = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (appModule.getApps().length) {
        app = appModule.getApp();
        break;
      }
      await delay(100);
    }

    if (!app) throw new Error("Firebase er ikkje starta enno.");
    return {
      app,
      auth: authModule.getAuth(app),
      db: firestoreModule.getFirestore(app),
      authModule,
      firestoreModule
    };
  })().catch(error => {
    firebaseServicesPromise = null;
    throw error;
  });

  return firebaseServicesPromise;
}

async function refreshSongs() {
  if (songsFetchPromise) return songsFetchPromise;

  songsFetchPromise = (async () => {
    const { auth, db, firestoreModule } = await getFirebaseServices();
    if (!auth.currentUser) throw new Error("Du må vere innlogga for å hente songlista.");

    const snapshot = await firestoreModule.getDocs(firestoreModule.collection(db, "songs"));
    songs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return songs;
  })().finally(() => {
    songsFetchPromise = null;
  });

  return songsFetchPromise;
}

function ensureListView() {
  let view = $("#list-view");
  if (view) return view;

  const archive = $("#archive-view");
  if (!archive) return null;

  view = document.createElement("section");
  view.id = "list-view";
  view.className = "view page-wrap hidden";
  view.innerHTML = `
    <div class="list-heading">
      <div>
        <p class="eyebrow green">Enkel oversikt</p>
        <h1>Songliste</h1>
        <p>Alle songane i arkivet samla i ei ryddig liste.</p>
      </div>
      <div class="list-actions">
        <button id="share-song-list" class="btn btn-primary" type="button">↗ Del liste</button>
        <button id="copy-song-list" class="btn btn-ghost" type="button">⧉ Kopier liste</button>
      </div>
    </div>
    <p class="list-share-note">Delinga inneheld berre tittel, komponist og arrangør – ikkje notar eller PDF-filer.</p>
    <div class="list-toolbar">
      <div class="inline-search"><span>⌕</span><input id="list-search" type="search" placeholder="Søk i songlista …" aria-label="Søk i songlista"></div>
      <select id="list-sort" aria-label="Sorter songlista">
        <option value="title">Tittel A–Å</option>
        <option value="composer">Komponist A–Å</option>
        <option value="newest">Nyaste først</option>
      </select>
    </div>
    <p id="song-list-count" class="song-list-count"></p>
    <div id="song-list-shell" class="song-list-shell">
      <div class="song-list-loading">Hentar songlista …</div>
    </div>`;

  archive.after(view);

  $("#list-search", view)?.addEventListener("input", renderSongList);
  $("#list-sort", view)?.addEventListener("change", renderSongList);
  $("#share-song-list", view)?.addEventListener("click", shareSongList);
  $("#copy-song-list", view)?.addEventListener("click", copySongList);
  $("#song-list-shell", view)?.addEventListener("click", event => {
    const button = event.target.closest("[data-open-song]");
    if (!button) return;
    const song = songs.find(item => item.id === button.dataset.openSong);
    if (song) openSongFromList(song);
  });

  return view;
}

function ensureNavigation() {
  const nav = $(".sidebar nav");
  if (!nav || $("#nav-song-list", nav)) return;

  const button = document.createElement("button");
  button.id = "nav-song-list";
  button.className = "nav-item";
  button.type = "button";
  button.dataset.view = "list";
  button.innerHTML = "<span>☷</span> Liste";
  button.addEventListener("click", showListView);

  const importButton = $('[data-action="open-import"]', nav);
  nav.insertBefore(button, importButton || null);
}

function ensureHomeActions() {
  const home = $("#home-view");
  const welcome = $(".welcome", home);
  if (!home || !welcome || $(".home-actions", home)) return;

  const actions = document.createElement("div");
  actions.className = "home-actions";
  actions.innerHTML = `
    <button class="home-action-card" type="button" data-ui-action="archive">
      <span class="action-icon">♫</span>
      <span><strong>Notearkiv</strong><small>Finn og opne notar</small></span>
    </button>
    <button class="home-action-card" type="button" data-ui-action="list">
      <span class="action-icon">☷</span>
      <span><strong>Songliste</strong><small>Enkel oversikt over alt</small></span>
    </button>
    <button class="home-action-card" type="button" data-ui-action="import">
      <span class="action-icon">＋</span>
      <span><strong>Ny song</strong><small>Importer PDF-ar i arkivet</small></span>
    </button>
    <button class="home-action-card" type="button" data-ui-action="share">
      <span class="action-icon">↗</span>
      <span><strong>Del liste</strong><small>Send repertoaroversikta</small></span>
    </button>`;

  welcome.after(actions);
  actions.addEventListener("click", event => {
    const action = event.target.closest("[data-ui-action]")?.dataset.uiAction;
    if (!action) return;

    if (action === "list") return showListView();
    if (action === "share") return shareSongList();
    if (action === "archive") return $('.sidebar [data-view="archive"]')?.click();
    if (action === "import") return $('.sidebar [data-action="open-import"]')?.click();
  });
}

function setupUi() {
  ensureListView();
  ensureNavigation();
  ensureHomeActions();
}

async function showListView(event) {
  event?.preventDefault?.();
  setupUi();

  const view = $("#list-view");
  if (!view) return;

  $$(".view").forEach(item => item.classList.add("hidden"));
  view.classList.remove("hidden");
  $$(".sidebar .nav-item").forEach(item => item.classList.toggle("active", item.id === "nav-song-list"));
  $(".sidebar")?.classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });

  const shell = $("#song-list-shell");
  if (shell) shell.innerHTML = '<div class="song-list-loading">Hentar songlista …</div>';

  try {
    await refreshSongs();
    renderSongList();
  } catch (error) {
    console.error("Could not load song list", error);
    if (shell) shell.innerHTML = '<div class="song-list-empty">Kunne ikkje hente songlista. Kontroller at du er innlogga og prøv igjen.</div>';
  }
}

function getVisibleSongs() {
  const term = ($("#list-search")?.value || "").toLowerCase().trim();
  const sort = $("#list-sort")?.value || "title";
  let visible = songs.filter(song => {
    const haystack = [song.title, song.composer, song.arranger].filter(Boolean).join(" ").toLowerCase();
    return !term || haystack.includes(term);
  });

  visible = [...visible].sort((a, b) => {
    if (sort === "composer") {
      const byComposer = (a.composer || "").localeCompare(b.composer || "", "no", { sensitivity: "base" });
      return byComposer || (a.title || "").localeCompare(b.title || "", "no", { sensitivity: "base" });
    }
    if (sort === "newest") return timestampMs(b.createdAt) - timestampMs(a.createdAt);
    return (a.title || "").localeCompare(b.title || "", "no", { sensitivity: "base" });
  });

  return visible;
}

function renderSongList() {
  const shell = $("#song-list-shell");
  const count = $("#song-list-count");
  if (!shell || !count) return;

  const visible = getVisibleSongs();
  count.textContent = visible.length === songs.length
    ? `${songs.length} ${songs.length === 1 ? "song" : "songar"}`
    : `${visible.length} av ${songs.length} songar`;

  if (!visible.length) {
    shell.innerHTML = '<div class="song-list-empty">Ingen songar passar søket.</div>';
    return;
  }

  shell.innerHTML = `
    <table class="song-list-table">
      <thead>
        <tr>
          <th class="song-list-number">#</th>
          <th class="song-list-title-cell">Tittel</th>
          <th>Komponist</th>
          <th>Arrangør</th>
          <th class="song-list-parts">Stemmer</th>
          <th class="song-list-open"></th>
        </tr>
      </thead>
      <tbody>
        ${visible.map((song, index) => `
          <tr>
            <td class="song-list-number">${index + 1}</td>
            <td class="song-list-title-cell"><button class="song-list-title-button" type="button" data-open-song="${escapeHtml(song.id)}">${escapeHtml(song.title || "Utan tittel")}</button></td>
            <td class="song-list-meta">${escapeHtml(song.composer || "–")}</td>
            <td class="song-list-meta">${escapeHtml(song.arranger || "–")}</td>
            <td class="song-list-parts">${Array.isArray(song.parts) ? song.parts.length : 0}</td>
            <td class="song-list-open"><button class="btn btn-ghost" type="button" data-open-song="${escapeHtml(song.id)}">Opne</button></td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function openSongFromList(song) {
  const archiveButton = $('.sidebar [data-view="archive"]');
  const search = $("#archive-search");
  if (!archiveButton || !search) return;

  archiveButton.click();
  search.value = song.title || "";
  search.dispatchEvent(new Event("input", { bubbles: true }));

  requestAnimationFrame(() => {
    const card = $$("#archive-grid .song-card").find(item =>
      item.querySelector("h3")?.textContent?.trim() === String(song.title || "").trim()
    );

    if (!card) {
      uiToast("Fann ikkje songen i kortvisinga.", "error");
      return;
    }

    card.click();
    setTimeout(() => {
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    }, 0);
  });
}

function buildShareText() {
  const alphabetic = [...songs].sort((a, b) =>
    (a.title || "").localeCompare(b.title || "", "no", { sensitivity: "base" })
  );

  const lines = alphabetic.map((song, index) => {
    let line = `${index + 1}. ${song.title || "Utan tittel"}`;
    if (song.composer) line += ` — ${song.composer}`;
    if (song.arranger) line += ` (arr. ${song.arranger})`;
    return line;
  });

  return `Samnanger Skulemusikklag – songliste\n${alphabetic.length} ${alphabetic.length === 1 ? "song" : "songar"}\n\n${lines.join("\n")}`;
}

async function ensureSongsForSharing() {
  try {
    await refreshSongs();
    if (!songs.length) {
      uiToast("Songlista er tom.", "error");
      return false;
    }
    return true;
  } catch (error) {
    console.error("Could not prepare song list", error);
    uiToast("Kunne ikkje hente songlista for deling.", "error");
    return false;
  }
}

async function shareSongList() {
  if (!await ensureSongsForSharing()) return;
  const text = buildShareText();

  if (navigator.share) {
    try {
      await navigator.share({ title: "SSML – songliste", text });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("Native sharing failed; copying instead", error);
    }
  }

  await copyText(text);
  uiToast("Songlista er kopiert. Du kan lime henne inn i melding, e-post eller liknande.");
}

async function copySongList() {
  if (!await ensureSongsForSharing()) return;
  await copyText(buildShareText());
  uiToast("Songlista er kopiert.");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

setupUi();

getFirebaseServices()
  .then(({ auth, authModule }) => {
    authModule.onAuthStateChanged(auth, user => {
      if (!user) {
        songs = [];
        return;
      }
      refreshSongs().then(() => {
        if (!$("#list-view")?.classList.contains("hidden")) renderSongList();
      }).catch(error => console.warn("Song list preloading failed", error));
    });
  })
  .catch(error => console.warn("SSML UI enhancements could not connect to Firebase", error));
