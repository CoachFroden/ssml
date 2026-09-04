const FIREBASE_VERSION = "11.10.0";

const $ = (selector, root = document) => root.querySelector(selector);

function injectStyles() {
  if ($("#ssml-home-profile-fixes")) return;
  const style = document.createElement("style");
  style.id = "ssml-home-profile-fixes";
  style.textContent = `
    .ssml-hero-cta { display: none !important; }
    .ssml-hero-visual {
      background: none !important;
      overflow: visible !important;
    }
    .ssml-hero-art-img {
      display: block;
      width: 100%;
      height: auto;
      max-width: 390px;
      margin: 0 auto;
      object-fit: contain;
      filter: drop-shadow(0 20px 22px rgba(0,0,0,.20));
    }

    .ssml-my-profile {
      margin: 0 0 18px;
      padding: 18px;
      border: 1px solid #dfe7e3;
      border-radius: 18px;
      background: #fff;
      box-shadow: 0 7px 20px rgba(21,63,58,.05);
    }
    .ssml-my-profile-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 14px;
    }
    .ssml-my-profile-head h2 {
      margin: 0 0 4px;
      color: #153f3a;
      font-size: 1.15rem;
    }
    .ssml-my-profile-head p {
      margin: 0;
      max-width: 620px;
      color: #72807c;
      font-size: .82rem;
      line-height: 1.45;
    }
    .ssml-my-profile-badge {
      flex: 0 0 auto;
      padding: 5px 9px;
      border-radius: 999px;
      background: #edf5f1;
      color: #176359;
      font-size: .69rem;
      font-weight: 800;
      white-space: nowrap;
    }
    .ssml-profile-form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0,1fr));
      gap: 11px;
    }
    .ssml-profile-form label {
      display: grid;
      gap: 5px;
      color: #284942;
      font-size: .76rem;
      font-weight: 800;
    }
    .ssml-profile-form input {
      width: 100%;
      min-height: 44px;
      box-sizing: border-box;
      padding: 9px 11px;
      border: 1px solid #d8e3df;
      border-radius: 11px;
      background: #fbfcfb;
      color: #153f3a;
      font: inherit;
      font-weight: 500;
      outline: none;
    }
    .ssml-profile-form input:focus {
      border-color: #74a89d;
      box-shadow: 0 0 0 3px rgba(35,112,98,.10);
      background: #fff;
    }
    .ssml-profile-form-actions {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 2px;
    }
    #ssml-profile-status {
      min-height: 18px;
      margin: 0;
      color: #697a76;
      font-size: .75rem;
    }
    #ssml-save-profile {
      min-width: 128px;
      min-height: 42px;
      border: 0;
      border-radius: 11px;
      background: #14584f;
      color: #fff;
      font: 800 .82rem Manrope, sans-serif;
      cursor: pointer;
    }
    #ssml-save-profile:disabled { opacity: .62; cursor: wait; }

    .ssml-contact-section-title {
      margin: 8px 0 10px;
      color: #153f3a;
      font-size: 1rem;
    }

    @media (max-width: 700px) {
      .ssml-hero-art-img {
        width: 160%;
        max-width: none;
        margin-left: -28%;
      }
      .ssml-my-profile { padding: 15px; border-radius: 16px; }
      .ssml-my-profile-head { display: block; }
      .ssml-my-profile-badge { display: inline-block; margin-top: 9px; }
      .ssml-profile-form { grid-template-columns: 1fr; gap: 9px; }
      .ssml-profile-form-actions { grid-column: auto; display: grid; gap: 8px; }
      #ssml-save-profile { width: 100%; }
    }
  `;
  document.head.append(style);
}

function repairHero() {
  const hero = $("#home-view .ssml-home-hero");
  if (!hero) return;

  hero.querySelector(".ssml-hero-cta")?.remove();

  let visual = hero.querySelector(".ssml-hero-visual");
  if (!visual) {
    visual = document.createElement("div");
    visual.className = "ssml-hero-visual";
    hero.append(visual);
  }

  if (!visual.querySelector(".ssml-hero-art-img")) {
    visual.replaceChildren();
    const image = document.createElement("img");
    image.className = "ssml-hero-art-img";
    image.src = new URL("./ssml-hero-art.svg?v=1", import.meta.url).href;
    image.alt = "SSML notearkiv med noteark og musikknoter";
    image.decoding = "async";
    visual.append(image);
  }
}

let firebasePromise = null;
async function getFirebase() {
  if (firebasePromise) return firebasePromise;
  firebasePromise = Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
  ]).then(async ([appModule, authModule, firestoreModule]) => {
    for (let attempt = 0; attempt < 80 && !appModule.getApps().length; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!appModule.getApps().length) throw new Error("Firebase er ikkje klart.");
    const app = appModule.getApp();
    return {
      auth: authModule.getAuth(app),
      db: firestoreModule.getFirestore(app),
      authModule,
      firestoreModule
    };
  });
  return firebasePromise;
}

function ensureProfilePanel() {
  const view = $("#contacts-view");
  if (!view || $("#ssml-my-profile", view)) return;

  const heading = $(".ssml-simple-heading", view);
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
      <label>Namn<input id="ssml-profile-name" name="name" autocomplete="name" placeholder="Namn" required></label>
      <label>Rolle<input id="ssml-profile-role" name="role" placeholder="Til dømes dirigent, styre, musikant"></label>
      <label>Telefon<input id="ssml-profile-phone" name="phone" type="tel" autocomplete="tel" placeholder="Telefonnummer"></label>
      <label>E-post<input id="ssml-profile-email" name="email" type="email" autocomplete="email" placeholder="E-postadresse"></label>
      <div class="ssml-profile-form-actions">
        <p id="ssml-profile-status" aria-live="polite"></p>
        <button id="ssml-save-profile" type="submit">Lagre opplysningar</button>
      </div>
    </form>`;

  if (heading) heading.after(panel);
  else view.prepend(panel);

  $("#ssml-profile-form", panel)?.addEventListener("submit", saveMyProfile);
}

function setProfileStatus(message, error = false) {
  const status = $("#ssml-profile-status");
  if (!status) return;
  status.textContent = message;
  status.style.color = error ? "#a33232" : "";
}

async function loadMyProfile() {
  ensureProfilePanel();
  try {
    const { auth, db, firestoreModule } = await getFirebase();
    const user = auth.currentUser;
    if (!user) return;

    const ref = firestoreModule.doc(db, "contacts", user.uid);
    const snap = await firestoreModule.getDoc(ref);
    const data = snap.exists() ? snap.data() : {};

    const name = $("#ssml-profile-name");
    const role = $("#ssml-profile-role");
    const phone = $("#ssml-profile-phone");
    const email = $("#ssml-profile-email");

    if (name && !name.dataset.loaded) {
      name.value = data.name || user.displayName || "";
      role.value = data.role || "";
      phone.value = data.phone || "";
      email.value = data.email || user.email || "";
      [name, role, phone, email].forEach(input => { if (input) input.dataset.loaded = "true"; });
    }
  } catch (error) {
    console.warn("Kunne ikkje hente eigne kontaktopplysningar", error);
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

  if (!name) {
    setProfileStatus("Skriv inn namn før du lagrar.", true);
    $("#ssml-profile-name")?.focus();
    return;
  }

  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Lagrar …";
  setProfileStatus("Lagrar opplysningane …");

  try {
    const { auth, db, firestoreModule } = await getFirebase();
    const user = auth.currentUser;
    if (!user) throw new Error("Du må vere innlogga.");

    await firestoreModule.setDoc(
      firestoreModule.doc(db, "contacts", user.uid),
      {
        uid: user.uid,
        name,
        role,
        phone,
        email,
        updatedAt: firestoreModule.serverTimestamp()
      },
      { merge: true }
    );

    setProfileStatus("Opplysningane er lagra og er no synlege for andre innlogga brukarar.");
    await renderContactsList();
  } catch (error) {
    console.error("Kunne ikkje lagre kontaktopplysningar", error);
    const code = String(error?.code || "");
    if (code.includes("permission-denied")) {
      setProfileStatus("Firestore-reglane blokkerer lagring av kontaktar. Då må vi opne for contacts-samlinga i Firebase.", true);
    } else {
      setProfileStatus(error?.message || "Kunne ikkje lagre opplysningane.", true);
    }
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
  return String(value ?? "").replace(/["&<>]/g, char => ({ '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
}

async function renderContactsList() {
  const target = $("#ssml-contacts-content");
  if (!target) return;

  try {
    const { auth, db, firestoreModule } = await getFirebase();
    if (!auth.currentUser) return;

    const snap = await firestoreModule.getDocs(firestoreModule.collection(db, "contacts"));
    const contacts = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(contact => contact.name || contact.email || contact.phone)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "no"));

    if (!contacts.length) {
      target.innerHTML = '<div class="ssml-empty-panel"><strong>Ingen kontaktar enno</strong>Fyll ut «Mine opplysningar» over. Når fleire brukarar gjer det same, kjem dei automatisk opp her.</div>';
      return;
    }

    const wrapper = document.createElement("div");
    const title = document.createElement("h2");
    title.className = "ssml-contact-section-title";
    title.textContent = "Kontaktliste";
    const grid = document.createElement("div");
    grid.className = "ssml-contact-grid";

    contacts.forEach(contact => {
      const card = document.createElement("article");
      card.className = "ssml-contact-card";
      card.innerHTML = `
        <h3>${escapeHtml(contact.name || "Kontakt")}</h3>
        <p class="ssml-contact-role">${escapeHtml(contact.role || "Samnanger Skulemusikklag")}</p>
        ${contact.phone ? `<a href="tel:${escapeAttr(contact.phone)}">☎ ${escapeHtml(contact.phone)}</a>` : ""}
        ${contact.email ? `<a href="mailto:${escapeAttr(contact.email)}">✉ ${escapeHtml(contact.email)}</a>` : ""}`;
      grid.append(card);
    });

    wrapper.append(title, grid);
    target.replaceChildren(wrapper);
  } catch (error) {
    console.warn("Kunne ikkje hente kontaktlista", error);
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
  window.setTimeout(renderContactsList, 220);
}

function observeApp() {
  const main = $("#app-shell main");
  if (!main) return;
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      repairHero();
      ensureProfilePanel();
      syncContactsView();
    });
  });
  observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
}

injectStyles();
repairHero();
ensureProfilePanel();
observeApp();

document.addEventListener("click", event => {
  if (event.target.closest?.('[data-bottom-view="contacts"]')) {
    window.setTimeout(syncContactsView, 100);
  }
});

window.addEventListener("pageshow", () => {
  repairHero();
  syncContactsView();
});
