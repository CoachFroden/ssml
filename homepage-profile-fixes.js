const FIREBASE_VERSION = "11.10.0";
const $ = (selector, root = document) => root.querySelector(selector);

let firebasePromise = null;
let profileLoadState = "idle";
let contactsLoadState = "idle";
let permissionBlocked = false;

function injectStyles() {
  if ($("#ssml-home-profile-fixes")) return;
  const style = document.createElement("style");
  style.id = "ssml-home-profile-fixes";
  style.textContent = `
    .ssml-hero-cta { display:none !important; }

    #home-view .welcome.ssml-home-hero {
      display:grid !important;
      grid-template-columns:minmax(0,1fr) minmax(240px,360px) !important;
      align-items:center !important;
      gap:24px !important;
      min-height:330px !important;
      padding:40px 42px !important;
      overflow:hidden !important;
      border:0 !important;
      border-radius:24px !important;
      background:linear-gradient(135deg,#0f5147 0%,#073f39 100%) !important;
      box-shadow:0 18px 42px rgba(16,59,54,.18) !important;
    }
    #home-view .welcome.ssml-home-hero .ssml-hero-copy {
      position:relative !important;
      z-index:2 !important;
      max-width:520px !important;
      padding:0 !important;
    }
    #home-view .welcome.ssml-home-hero .ssml-hero-copy .eyebrow {
      margin:0 0 12px !important;
      color:#e5bc69 !important;
      font-size:.7rem !important;
      letter-spacing:.14em !important;
    }
    #home-view .welcome.ssml-home-hero .ssml-hero-copy h1 {
      margin:0 !important;
      color:#fff !important;
      font-family:Georgia,"Times New Roman",serif !important;
      font-size:clamp(3rem,7vw,5rem) !important;
      font-weight:700 !important;
      line-height:.92 !important;
      letter-spacing:-.045em !important;
    }
    #home-view .welcome.ssml-home-hero .ssml-hero-copy > p:last-child {
      max-width:390px !important;
      margin:18px 0 0 !important;
      color:rgba(244,250,247,.86) !important;
      font-size:1rem !important;
      line-height:1.55 !important;
    }
    #home-view .welcome.ssml-home-hero .ssml-hero-visual {
      position:relative !important;
      z-index:2 !important;
      display:grid !important;
      place-items:center !important;
      width:100% !important;
      max-width:340px !important;
      aspect-ratio:1 !important;
      justify-self:end !important;
      margin:0 !important;
      background:none !important;
      overflow:visible !important;
      opacity:1 !important;
      filter:none !important;
    }
    #home-view .welcome.ssml-home-hero .ssml-hero-art-img {
      display:block !important;
      width:100% !important;
      max-width:340px !important;
      height:auto !important;
      margin:0 !important;
      object-fit:contain !important;
      filter:drop-shadow(0 18px 20px rgba(0,0,0,.2)) !important;
    }

    #contacts-view { padding-bottom:calc(var(--ssml-nav-height,78px) + 90px) !important; }
    .ssml-my-profile {
      margin:0 0 18px;
      padding:18px;
      border:1px solid #dfe7e3;
      border-radius:18px;
      background:#fff;
      box-shadow:0 7px 20px rgba(21,63,58,.05);
    }
    .ssml-my-profile-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:14px; }
    .ssml-my-profile-head h2 { margin:0 0 4px; color:#153f3a; font-size:1.15rem; }
    .ssml-my-profile-head p { margin:0; max-width:620px; color:#72807c; font-size:.82rem; line-height:1.45; }
    .ssml-my-profile-badge { flex:0 0 auto; padding:5px 9px; border-radius:999px; background:#edf5f1; color:#176359; font-size:.69rem; font-weight:800; white-space:nowrap; }
    .ssml-profile-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:11px; }
    .ssml-profile-form label { display:grid; gap:5px; color:#284942; font-size:.76rem; font-weight:800; }
    .ssml-profile-form input { width:100%; min-height:44px; box-sizing:border-box; padding:9px 11px; border:1px solid #d8e3df; border-radius:11px; background:#fbfcfb; color:#153f3a; font:inherit; font-weight:500; outline:none; }
    .ssml-profile-form input:focus { border-color:#74a89d; box-shadow:0 0 0 3px rgba(35,112,98,.10); background:#fff; }
    .ssml-profile-form-actions { grid-column:1/-1; display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:2px; }
    #ssml-profile-status { min-height:18px; margin:0; color:#697a76; font-size:.75rem; }
    #ssml-save-profile { min-width:128px; min-height:42px; border:0; border-radius:11px; background:#14584f; color:#fff; font:800 .82rem Manrope,sans-serif; cursor:pointer; }
    #ssml-save-profile:disabled { opacity:.62; cursor:not-allowed; }
    .ssml-contact-section-title { margin:8px 0 10px; color:#153f3a; font-size:1rem; }
    .ssml-permission-note { padding:15px; border:1px solid #ead9ae; border-radius:14px; background:#fff9e9; color:#6e5b2c; font-size:.8rem; line-height:1.45; }

    @media (max-width:700px) {
      #home-view .welcome.ssml-home-hero {
        grid-template-columns:minmax(0,54%) minmax(0,46%) !important;
        gap:4px !important;
        min-height:292px !important;
        padding:24px 18px 26px !important;
        border-radius:21px !important;
      }
      #home-view .welcome.ssml-home-hero .ssml-hero-copy .eyebrow { max-width:180px !important; font-size:.6rem !important; line-height:1.35 !important; }
      #home-view .welcome.ssml-home-hero .ssml-hero-copy h1 { font-size:clamp(2.45rem,12vw,3.55rem) !important; }
      #home-view .welcome.ssml-home-hero .ssml-hero-copy > p:last-child { max-width:190px !important; margin-top:14px !important; font-size:.8rem !important; line-height:1.45 !important; }
      #home-view .welcome.ssml-home-hero .ssml-hero-visual { width:174px !important; max-width:174px !important; justify-self:end !important; margin-right:-18px !important; }
      #home-view .welcome.ssml-home-hero .ssml-hero-art-img { width:174px !important; max-width:174px !important; }
      .ssml-my-profile { padding:15px; border-radius:16px; }
      .ssml-my-profile-head { display:block; }
      .ssml-my-profile-badge { display:inline-block; margin-top:9px; }
      .ssml-profile-form { grid-template-columns:1fr; gap:9px; }
      .ssml-profile-form-actions { grid-column:auto; display:grid; gap:8px; }
      #ssml-save-profile { width:100%; }
    }
  `;
  document.head.append(style);
}

function repairHero() {
  const hero = $("#home-view .ssml-home-hero");
  if (!hero) return;
  hero.querySelector(".ssml-hero-cta")?.remove();

  let visual = $(".ssml-hero-visual", hero);
  if (!visual) {
    visual = document.createElement("div");
    visual.className = "ssml-hero-visual";
    hero.append(visual);
  }

  if (!$(".ssml-hero-art-img", visual)) {
    visual.replaceChildren();
    const image = document.createElement("img");
    image.className = "ssml-hero-art-img";
    image.src = new URL("./ssml-hero-art.svg?v=2", import.meta.url).href;
    image.alt = "SSML notearkiv med noteark og musikknoter";
    image.decoding = "async";
    visual.append(image);
  }
}

async function getFirebase() {
  if (firebasePromise) return firebasePromise;
  firebasePromise = Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
  ]).then(async ([appModule, authModule, firestoreModule]) => {
    for (let i = 0; i < 80 && !appModule.getApps().length; i++) await new Promise(r => setTimeout(r, 100));
    if (!appModule.getApps().length) throw new Error("Firebase er ikkje klart.");
    const app = appModule.getApp();
    return { auth: authModule.getAuth(app), db: firestoreModule.getFirestore(app), authModule, firestoreModule };
  });
  return firebasePromise;
}

function ensureProfilePanel() {
  const view = $("#contacts-view");
  if (!view || $("#ssml-my-profile", view)) return;

  const panel = document.createElement("section");
  panel.id = "ssml-my-profile";
  panel.className = "ssml-my-profile";
  panel.innerHTML = `
    <div class="ssml-my-profile-head">
      <div>
        <h2>Mine opplysningar</h2>
        <p>Det du fyller inn her blir synleg for andre innlogga brukarar under Kontaktar. Du kan endre opplysningane når du vil.</p>
      </div>
      <span class="ssml-my-profile-badge">Berre innlogga</span>
    </div>
    <form id="ssml-profile-form" class="ssml-profile-form">
      <label>Namn<input id="ssml-profile-name" autocomplete="name" required></label>
      <label>Rolle<input id="ssml-profile-role" placeholder="Til dømes dirigent, styre, musikant"></label>
      <label>Telefon<input id="ssml-profile-phone" type="tel" autocomplete="tel"></label>
      <label>E-post<input id="ssml-profile-email" type="email" autocomplete="email"></label>
      <div class="ssml-profile-form-actions">
        <p id="ssml-profile-status" aria-live="polite"></p>
        <button id="ssml-save-profile" type="submit">Lagre opplysningar</button>
      </div>
    </form>`;

  const heading = $(".ssml-simple-heading", view);
  if (heading) heading.after(panel); else view.prepend(panel);
  $("#ssml-profile-form", panel)?.addEventListener("submit", saveMyProfile);
}

function setProfileStatus(message, error = false) {
  const status = $("#ssml-profile-status");
  if (!status) return;
  status.textContent = message;
  status.style.color = error ? "#a33232" : "";
}

function fillAuthDefaults(user) {
  const name = $("#ssml-profile-name");
  const email = $("#ssml-profile-email");
  if (name && !name.value) name.value = user?.displayName || "";
  if (email && !email.value) email.value = user?.email || "";
}

function markPermissionBlocked() {
  permissionBlocked = true;
  profileLoadState = "blocked";
  contactsLoadState = "blocked";
  setProfileStatus("Kontaktlagring er ikkje opna i Firestore enno.", true);
  const target = $("#ssml-contacts-content");
  if (target) target.innerHTML = '<div class="ssml-permission-note"><strong>Kontaktregisteret er klart i appen, men Firestore-reglane blokkerer tilgang.</strong><br>Når regelen for <code>contacts</code> er lagt inn i Firebase, vil lagring og kontaktlista fungere automatisk.</div>';
}

async function loadMyProfile() {
  ensureProfilePanel();
  if (profileLoadState === "loading" || profileLoadState === "loaded" || profileLoadState === "blocked") return;
  profileLoadState = "loading";

  try {
    const { auth, db, firestoreModule } = await getFirebase();
    const user = auth.currentUser;
    if (!user) { profileLoadState = "idle"; return; }
    fillAuthDefaults(user);

    const snap = await firestoreModule.getDoc(firestoreModule.doc(db, "contacts", user.uid));
    const data = snap.exists() ? snap.data() : {};
    if ($("#ssml-profile-name")) $("#ssml-profile-name").value = data.name || user.displayName || "";
    if ($("#ssml-profile-role")) $("#ssml-profile-role").value = data.role || "";
    if ($("#ssml-profile-phone")) $("#ssml-profile-phone").value = data.phone || "";
    if ($("#ssml-profile-email")) $("#ssml-profile-email").value = data.email || user.email || "";
    profileLoadState = "loaded";
  } catch (error) {
    if (String(error?.code || "").includes("permission-denied")) markPermissionBlocked();
    else { console.warn("Kunne ikkje hente eigne kontaktopplysningar", error); profileLoadState = "idle"; }
  }
}

async function saveMyProfile(event) {
  event.preventDefault();
  const button = $("#ssml-save-profile");
  if (!button) return;

  const name = $("#ssml-profile-name")?.value.trim() || "";
  const role = $("#ssml-profile-role")?.value.trim() || "";
  const phone = $("#ssml-profile-phone")?.value.trim() || "";
  const email = $("#ssml-profile-email")?.value.trim() || "";
  if (!name) { setProfileStatus("Skriv inn namn før du lagrar.", true); return; }

  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Lagrar …";

  try {
    const { auth, db, firestoreModule } = await getFirebase();
    const user = auth.currentUser;
    if (!user) throw new Error("Du må vere innlogga.");

    await firestoreModule.setDoc(firestoreModule.doc(db, "contacts", user.uid), {
      uid: user.uid,
      name,
      role,
      phone,
      email,
      updatedAt: firestoreModule.serverTimestamp()
    }, { merge: true });

    permissionBlocked = false;
    profileLoadState = "loaded";
    contactsLoadState = "idle";
    setProfileStatus("Opplysningane er lagra og er synlege for andre innlogga brukarar.");
    await renderContactsList(true);
  } catch (error) {
    if (String(error?.code || "").includes("permission-denied")) markPermissionBlocked();
    else setProfileStatus(error?.message || "Kunne ikkje lagre opplysningane.", true);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function escapeHtml(value = "") {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}
function escapeAttr(value = "") {
  return String(value ?? "").replace(/["&<>]/g, ch => ({ '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}

async function renderContactsList(force = false) {
  const target = $("#ssml-contacts-content");
  if (!target) return;
  if (permissionBlocked || contactsLoadState === "blocked") return markPermissionBlocked();
  if (!force && (contactsLoadState === "loading" || contactsLoadState === "loaded")) return;
  contactsLoadState = "loading";

  try {
    const { auth, db, firestoreModule } = await getFirebase();
    if (!auth.currentUser) { contactsLoadState = "idle"; return; }
    const snap = await firestoreModule.getDocs(firestoreModule.collection(db, "contacts"));
    const contacts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(item => item.name || item.email || item.phone)
      .sort((a,b) => String(a.name || "").localeCompare(String(b.name || ""), "no"));

    if (!contacts.length) {
      target.innerHTML = '<div class="ssml-empty-panel"><strong>Ingen kontaktar enno</strong>Fyll ut «Mine opplysningar» over. Når fleire brukarar gjer det same, kjem dei automatisk opp her.</div>';
    } else {
      target.innerHTML = `<h2 class="ssml-contact-section-title">Kontaktliste</h2><div class="ssml-contact-grid">${contacts.map(contact => `
        <article class="ssml-contact-card">
          <h3>${escapeHtml(contact.name || "Kontakt")}</h3>
          <p class="ssml-contact-role">${escapeHtml(contact.role || "Samnanger Skulemusikklag")}</p>
          ${contact.phone ? `<a href="tel:${escapeAttr(contact.phone)}">☎ ${escapeHtml(contact.phone)}</a>` : ""}
          ${contact.email ? `<a href="mailto:${escapeAttr(contact.email)}">✉ ${escapeHtml(contact.email)}</a>` : ""}
        </article>`).join("")}</div>`;
    }
    contactsLoadState = "loaded";
  } catch (error) {
    if (String(error?.code || "").includes("permission-denied")) markPermissionBlocked();
    else { console.warn("Kunne ikkje hente kontaktlista", error); contactsLoadState = "idle"; }
  }
}

function contactsVisible() {
  const view = $("#contacts-view");
  return Boolean(view && !view.classList.contains("hidden"));
}

function syncContactsView() {
  if (!contactsVisible()) return;
  ensureProfilePanel();
  loadMyProfile();
  renderContactsList();
}

function observeStructure() {
  const main = $("#app-shell main");
  if (!main) return;
  const observer = new MutationObserver(() => {
    repairHero();
    ensureProfilePanel();
  });
  observer.observe(main, { childList:true, subtree:true });
}

injectStyles();
repairHero();
ensureProfilePanel();
observeStructure();

document.addEventListener("click", event => {
  if (event.target.closest?.('[data-bottom-view="contacts"]')) setTimeout(syncContactsView, 80);
});

window.addEventListener("pageshow", () => {
  repairHero();
  if (contactsVisible()) syncContactsView();
});
