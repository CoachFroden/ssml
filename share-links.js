const FIREBASE_APP_URL = "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
const FIRESTORE_URL = "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
const FIREBASE_AUTH_URL = "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
const SHARE_SERVICE_URL = "https://ssml-email-pdf-1091683313021.europe-west1.run.app";
const SHARE_EXPIRES_DAYS = 30;

let creatingShare = false;
let preparedShare = null;

function toast(message, type = "ok") {
  const region = document.querySelector("#toast-region");
  if (!region) return;
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.textContent = message;
  region.append(element);
  setTimeout(() => element.remove(), 4000);
}

function escapeHtml(value = "") {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function ensureStyles() {
  if (document.querySelector("#note-share-styles")) return;
  const style = document.createElement("style");
  style.id = "note-share-styles";
  style.textContent = `
    #share-selected-parts { grid-column: 2; white-space: nowrap; }
    #note-share-dialog > div { padding: 1.7rem; overflow: auto; max-height: 90vh; }
    #note-share-dialog header { gap: 1rem; }
    #note-share-dialog header > div { min-width: 0; }
    #note-share-dialog .eyebrow { margin-bottom: .45rem; }
    #note-share-summary { margin: .85rem 0 1rem; line-height: 1.5; }
    .note-share-link { display: block; width: 100%; box-sizing: border-box; padding: .85rem; border: 1px solid #d7dfda; border-radius: 10px; background: #f7f9f7; font: inherit; color: #174a43; }
    #note-share-dialog footer { flex-wrap: wrap; }
    @media (max-width: 520px) {
      #share-selected-parts { grid-column: auto; width: 100%; min-height: 44px; }
      #note-share-dialog { width: calc(100% - 1.5rem); max-height: calc(100dvh - 1.5rem); border-radius: 16px; }
      #note-share-dialog > div { padding: 1.15rem; max-height: calc(100dvh - 1.5rem); }
      #note-share-dialog footer { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; }
      #note-share-dialog footer .btn { width: 100%; padding: .8rem .7rem; }
    }
  `;
  document.head.append(style);
}

function ensureDialog() {
  if (document.querySelector("#note-share-dialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "note-share-dialog";
  dialog.className = "modal small-modal";
  dialog.innerHTML = `
    <div>
      <header>
        <div><p class="eyebrow green">Del notar</p><h2>Del med lenke</h2></div>
        <button class="icon-btn note-share-close" type="button" aria-label="Lukk">×</button>
      </header>
      <p id="note-share-summary" class="muted"></p>
      <input id="note-share-url" class="note-share-link" type="text" readonly aria-label="Delingslenke">
      <aside class="info-note"><span>i</span><p>Mottakaren ser berre dei stemmene du har valt. Dei kan opne, skrive ut eller laste ned kvar stemme frå lenka.</p></aside>
      <footer>
        <button id="copy-note-share" class="btn btn-ghost" type="button">Kopier lenke</button>
        <button id="share-note-link" class="btn btn-primary" type="button">Del lenke</button>
      </footer>
    </div>`;
  document.body.append(dialog);
  dialog.querySelector(".note-share-close").addEventListener("click", () => dialog.close());
  dialog.querySelector("#copy-note-share").addEventListener("click", copyPreparedLink);
  dialog.querySelector("#share-note-link").addEventListener("click", sharePreparedLink);
  dialog.addEventListener("close", () => { preparedShare = null; });
}

function selectedRows() {
  return [...document.querySelectorAll("#part-list .part-select-row")]
    .filter(row => row.querySelector('input[type="checkbox"]')?.checked)
    .map(row => {
      const name = row.querySelector("strong")?.textContent?.trim() || "Stemme";
      const detail = row.querySelector("small")?.textContent?.trim() || "";
      const fileName = detail.split(" · PDF-forbetring:")[0].trim();
      return { name, fileName };
    });
}

function updateButtonState() {
  const button = document.querySelector("#share-selected-parts");
  if (!button || creatingShare) return;
  const count = selectedRows().length;
  button.disabled = count === 0;
  button.textContent = `↗ Del noter (${count})`;
}

function ensureButton() {
  ensureStyles();
  ensureDialog();
  const tools = document.querySelector(".part-selection-tools");
  if (!tools || tools.querySelector("#share-selected-parts")) {
    updateButtonState();
    return;
  }
  const button = document.createElement("button");
  button.id = "share-selected-parts";
  button.className = "btn btn-ghost";
  button.type = "button";
  tools.append(button);
  updateButtonState();
}

async function getCurrentSong(selected) {
  const [{ getApps, getApp }, firestore] = await Promise.all([
    import(FIREBASE_APP_URL),
    import(FIRESTORE_URL)
  ]);
  if (!getApps().length) throw new Error("Firebase er ikkje klart enno.");
  const db = firestore.getFirestore(getApp());
  const title = document.querySelector("#song-detail .detail-header h1")?.textContent?.trim();
  if (!title) throw new Error("Kunne ikkje finne den opne songen.");
  const snapshot = await firestore.getDocs(
    firestore.query(firestore.collection(db, "songs"), firestore.where("title", "==", title))
  );
  const candidates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  if (!candidates.length) throw new Error("Kunne ikkje finne songen i Firebase.");
  const score = song => selected.reduce((sum, item) => sum + ((song.parts || []).some(part => part.fileName === item.fileName && part.name === item.name) ? 2 : (song.parts || []).some(part => part.fileName === item.fileName) ? 1 : 0), 0);
  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0];
}

function useOriginalSource() {
  const toggle = document.querySelector("#toggle-pdf-source");
  return Boolean(toggle && /Vis forbetra/i.test(toggle.textContent || ""));
}

function sourceStoragePath(part, original) {
  if (original && part.originalStoragePath) return part.originalStoragePath;
  return part.enhancedStoragePath || part.storagePath || part.originalStoragePath || "";
}

function mapSelectedParts(song, selected) {
  return selected.map(item => {
    const matches = (song.parts || []).filter(part => part.fileName === item.fileName);
    return matches.find(part => part.name === item.name) || matches[0] || null;
  });
}

async function getFirebaseIdToken() {
  const [{ getApps, getApp }, authModule] = await Promise.all([
    import(FIREBASE_APP_URL),
    import(FIREBASE_AUTH_URL)
  ]);
  if (!getApps().length) throw new Error("Firebase er ikkje klart enno.");
  const user = authModule.getAuth(getApp()).currentUser;
  if (!user) throw new Error("Du må vere innlogga for å dele notar.");
  return user.getIdToken();
}

function makeShareItems(song, selectedParts, original) {
  const sourceCounts = new Map();
  for (const part of song.parts || []) {
    const path = sourceStoragePath(part, original);
    if (path) sourceCounts.set(path, (sourceCounts.get(path) || 0) + 1);
  }

  return selectedParts.map(part => {
    const storagePath = sourceStoragePath(part, original);
    if (!storagePath) throw new Error(`«${part.name}» manglar PDF-fil i lagringa.`);
    const sharedSource = (sourceCounts.get(storagePath) || 0) > 1;
    if (sharedSource && !part.pageNumbers?.length) {
      throw new Error(`«${part.name}» manglar sideinformasjon og kan ikkje delast åleine enno.`);
    }
    return {
      name: part.name || "Stemme",
      fileName: `${song.title || "Notar"} - ${part.name || "Stemme"}.pdf`,
      storagePath,
      pages: sharedSource ? part.pageNumbers : null
    };
  });
}

function sharePageUrl(token) {
  const url = new URL("./share.html", window.location.href);
  url.searchParams.set("id", token);
  return url.toString();
}

function formatExpiry(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "30 dagar";
  return new Intl.DateTimeFormat("nn-NO", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

async function createShare() {
  if (creatingShare) return;
  const selected = selectedRows();
  if (!selected.length) {
    toast("Vel minst éi stemme.", "error");
    return;
  }

  const button = document.querySelector("#share-selected-parts");
  creatingShare = true;
  button.disabled = true;
  button.textContent = "Opprettar delingslenke …";

  try {
    const song = await getCurrentSong(selected);
    const selectedParts = mapSelectedParts(song, selected);
    if (selectedParts.some(part => !part)) throw new Error("Ei vald stemme manglar i arkivet.");
    const original = useOriginalSource();
    const items = makeShareItems(song, selectedParts, original);
    const token = await getFirebaseIdToken();

    const response = await fetch(`${SHARE_SERVICE_URL}/shares`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: song.title || "Delte notar",
        composer: song.composer || "",
        arranger: song.arranger || "",
        expiresDays: SHARE_EXPIRES_DAYS,
        items
      }),
      cache: "no-store"
    });

    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok || !body.token) {
      throw new Error(body.error || "Serveren klarte ikkje å opprette delingslenka.");
    }

    preparedShare = {
      url: sharePageUrl(body.token),
      title: song.title || "Delte notar",
      count: items.length,
      expiresAt: body.expiresAt
    };

    document.querySelector("#note-share-url").value = preparedShare.url;
    document.querySelector("#note-share-summary").textContent = `${preparedShare.count} stemme(r) er klare for deling. Lenka er gyldig til ${formatExpiry(preparedShare.expiresAt)}.`;
    document.querySelector("#note-share-dialog").showModal();
  } catch (error) {
    console.error(error);
    preparedShare = null;
    toast(error.message || "Kunne ikkje opprette delingslenka.", "error");
  } finally {
    creatingShare = false;
    updateButtonState();
  }
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

async function copyPreparedLink() {
  if (!preparedShare?.url) return;
  try {
    await copyText(preparedShare.url);
    toast("Delingslenka er kopiert.");
  } catch {
    toast("Kunne ikkje kopiere lenka.", "error");
  }
}

async function sharePreparedLink() {
  if (!preparedShare?.url) return;
  if (!navigator.share) {
    await copyPreparedLink();
    return;
  }
  try {
    await navigator.share({
      title: `${preparedShare.title} – notar`,
      text: `Her er dei ${preparedShare.count} stemmene du bad om.`,
      url: preparedShare.url
    });
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error(error);
      toast("Kunne ikkje opne delingsmenyen.", "error");
    }
  }
}

const observer = new MutationObserver(() => ensureButton());
observer.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener("click", event => {
  const button = event.target.closest?.("#share-selected-parts");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  createShare();
}, true);
document.addEventListener("change", event => {
  if (event.target.matches?.('#part-list input[type="checkbox"]')) setTimeout(updateButtonState, 0);
});
ensureButton();
