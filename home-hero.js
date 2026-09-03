const FIREBASE_VERSION = "11.10.0";
const FAVORITES_PREFIX = "ssml:favorites:";

function loadHeroStyles() {
  if (!document.querySelector('link[data-ssml-home-hero]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./home-hero.css?v=2', import.meta.url).href;
    link.dataset.ssmlHomeHero = 'true';
    document.head.append(link);
  }

  if (document.querySelector('#ssml-app-shell-styles')) return;
  const style = document.createElement('style');
  style.id = 'ssml-app-shell-styles';
  style.textContent = `
    :root { --ssml-nav-height: 78px; }

    #app-shell { display:block !important; min-height:100vh; background:#f7f8f5; }
    #app-shell > .sidebar, #app-shell .topbar { display:none !important; }
    #app-shell main { display:block !important; width:100%; min-width:0; padding-bottom:calc(var(--ssml-nav-height) + 28px); }
    #app-shell .page-wrap { max-width:1080px; padding:clamp(18px,4vw,38px) clamp(14px,4vw,34px); }
    .ssml-home-button { display:none !important; }

    /* Hero */
    #home-view .ssml-home-hero {
      position:relative;
      display:grid;
      grid-template-columns:minmax(0,1fr) minmax(260px,390px);
      align-items:center;
      gap:clamp(18px,4vw,50px);
      min-height:340px;
      margin:0;
      padding:clamp(30px,5vw,58px);
      overflow:hidden;
      border:0;
      border-radius:26px;
      background:linear-gradient(135deg,#0f5147 0%,#073f39 100%);
      box-shadow:0 18px 42px rgba(16,59,54,.18);
    }
    #home-view .ssml-home-hero::before {
      content:"";
      position:absolute;
      right:-80px;
      top:-95px;
      width:330px;
      height:330px;
      border:1px solid rgba(255,255,255,.09);
      border-radius:50%;
      box-shadow:0 0 0 52px rgba(255,255,255,.025);
      pointer-events:none;
    }
    #home-view .ssml-home-hero::after {
      content:"";
      position:absolute;
      left:clamp(30px,5vw,58px);
      bottom:clamp(30px,4vw,46px);
      width:58px;
      height:3px;
      border-radius:99px;
      background:#d6a84e;
    }
    .ssml-hero-copy { position:relative; z-index:2; padding-bottom:36px; }
    .ssml-hero-copy .eyebrow { margin:0 0 14px; color:#e5bc69 !important; font-size:.72rem; letter-spacing:.14em; }
    .ssml-hero-copy h1 {
      margin:0;
      max-width:560px;
      color:#fff;
      font-family:Georgia,"Times New Roman",serif;
      font-size:clamp(3rem,7vw,5.8rem);
      font-weight:700;
      line-height:.91;
      letter-spacing:-.045em;
    }
    .ssml-hero-copy > p:last-of-type { max-width:410px; margin:20px 0 0; color:rgba(244,250,247,.83); font-size:1.04rem; line-height:1.55; }
    .ssml-hero-cta {
      display:inline-flex;
      align-items:center;
      gap:12px;
      margin-top:28px;
      min-height:48px;
      padding:0 18px;
      border:0;
      border-radius:12px;
      background:#f4f8f5;
      color:#0c4b43;
      font:800 .94rem Manrope,sans-serif;
      box-shadow:0 7px 20px rgba(0,0,0,.12);
    }
    .ssml-hero-cta span { font-size:1.25rem; }
    .ssml-hero-visual {
      position:relative;
      z-index:2;
      width:min(100%,390px);
      aspect-ratio:1;
      justify-self:end;
      background-position:center;
      background-repeat:no-repeat;
      background-size:contain;
      filter:drop-shadow(0 22px 24px rgba(0,0,0,.18));
    }
    .ssml-hero-visual svg { display:none !important; }

    /* Snarvegar */
    #home-view .home-actions {
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:14px;
      margin:18px 0 24px;
    }
    #home-view .home-action-card {
      position:relative;
      display:grid;
      grid-template-columns:54px minmax(0,1fr) 22px;
      align-items:center;
      gap:13px;
      min-height:92px;
      padding:15px 16px;
      border:1px solid #e0e6e2;
      border-radius:18px;
      background:#fff;
      color:#123e38;
      text-align:left;
      box-shadow:0 8px 22px rgba(30,58,53,.06);
    }
    #home-view .home-action-card::after { content:"›"; color:#7b8984; font-size:1.65rem; line-height:1; }
    #home-view .home-action-card .action-icon {
      width:54px;
      height:54px;
      display:grid;
      place-items:center;
      border-radius:50%;
      background:#eaf3ee;
      color:#0d594e;
      font-size:1.35rem;
      font-weight:800;
    }
    #home-view .home-action-card strong { display:block; margin-bottom:3px; font-size:1.02rem; }
    #home-view .home-action-card small { display:block; color:#75817d; font-size:.8rem; line-height:1.25; }

    /* Statistikk er nyttig andre stader, men tek unødig plass på den nye forsida. */
    #home-view .stats-grid { display:none !important; }

    /* Nyleg lagt til */
    .ssml-recent-panel {
      margin-top:4px;
      padding:20px 20px 8px;
      border:1px solid #e0e6e2;
      border-radius:20px;
      background:#fff;
      box-shadow:0 8px 24px rgba(30,58,53,.05);
    }
    #home-view .ssml-recent-panel .section-heading { margin:0 0 4px; align-items:center; }
    #home-view .ssml-recent-panel .section-heading h2 { margin:0; color:#123e38; font-size:1.25rem; }
    #home-view .ssml-recent-panel .section-heading p { display:none; }
    #home-view .ssml-recent-panel .section-heading .text-btn { color:#4f756d; font-size:.85rem; }
    #home-view #recent-grid { display:block; }
    #home-view #recent-grid .song-card {
      display:grid;
      grid-template-columns:52px minmax(0,1fr);
      align-items:center;
      gap:12px;
      margin:0;
      padding:13px 0;
      border:0;
      border-bottom:1px solid #edf0ee;
      border-radius:0;
      box-shadow:none;
      background:transparent;
      transform:none;
    }
    #home-view #recent-grid .song-card:nth-child(n+3) { display:none !important; }
    #home-view #recent-grid .song-card:last-of-type { border-bottom:0; }
    #home-view #recent-grid .song-card .cover {
      width:52px;
      height:52px;
      padding:0;
      border-radius:13px;
      background:#f2f4ef;
      display:grid;
      place-items:center;
    }
    #home-view #recent-grid .song-card .cover::after { content:"♫"; position:static; color:#176359; font-size:1.4rem; transform:none; }
    #home-view #recent-grid .cover-badge { display:none; }
    #home-view #recent-grid .song-card-body { min-width:0; padding:0; }
    #home-view #recent-grid .song-card h3 { margin:0 0 3px; color:#153f3a; font-size:.95rem; }
    #home-view #recent-grid .song-card p { margin:0; color:#7a8581; font-size:.78rem; }
    #home-view #recent-grid .song-meta { border:0; padding:4px 0 0; justify-content:flex-end; font-size:.7rem; }
    #home-view #recent-grid .song-meta span:first-child { display:none; }

    /* Botnmeny */
    .ssml-bottom-nav {
      position:fixed;
      left:50%;
      bottom:10px;
      z-index:60;
      transform:translateX(-50%);
      display:grid;
      grid-template-columns:repeat(4,1fr);
      width:min(620px,calc(100% - 22px));
      min-height:var(--ssml-nav-height);
      padding:8px;
      border:1px solid rgba(205,215,210,.9);
      border-radius:24px;
      background:rgba(255,255,255,.94);
      box-shadow:0 14px 34px rgba(27,53,48,.16);
      backdrop-filter:blur(16px);
      -webkit-backdrop-filter:blur(16px);
    }
    .ssml-bottom-nav button {
      display:grid;
      place-items:center;
      align-content:center;
      gap:3px;
      min-width:0;
      min-height:58px;
      padding:5px 4px;
      border:0;
      border-radius:16px;
      background:transparent;
      color:#7a8581;
      font:600 .72rem "DM Sans",sans-serif;
    }
    .ssml-bottom-nav button svg { width:23px; height:23px; }
    .ssml-bottom-nav button.active { background:#edf4f0; color:#0d594e; font-weight:800; }

    /* Favoritt og kontakt-sider */
    .ssml-simple-heading { margin-bottom:18px; }
    .ssml-simple-heading .eyebrow { margin-bottom:6px; }
    .ssml-simple-heading h1 { margin:0 0 5px; font-size:clamp(2rem,6vw,3rem); }
    .ssml-simple-heading p { margin:0; color:#71807b; }
    .ssml-favorites-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px; }
    .ssml-favorite-card {
      position:relative;
      padding:18px 52px 18px 18px;
      border:1px solid #dfe7e3;
      border-radius:16px;
      background:#fff;
      box-shadow:0 6px 18px rgba(21,63,58,.05);
      cursor:pointer;
    }
    .ssml-favorite-card h3 { margin:0 0 5px; color:#153f3a; font-size:1rem; }
    .ssml-favorite-card p { margin:0; color:#71807b; font-size:.8rem; }
    .ssml-favorite-toggle {
      position:absolute;
      top:10px;
      right:10px;
      z-index:4;
      width:36px;
      height:36px;
      display:grid;
      place-items:center;
      padding:0;
      border:1px solid #dfe7e3;
      border-radius:50%;
      background:rgba(255,255,255,.94);
      color:#7c8985;
      font-size:1.15rem;
      box-shadow:0 4px 12px rgba(21,63,58,.08);
    }
    .ssml-favorite-toggle.active { color:#b77b12; background:#fff8e7; border-color:#ecd89f; }
    .song-card { position:relative; }
    .ssml-empty-panel { padding:42px 20px; border:1px dashed #cbd8d2; border-radius:18px; background:#fff; color:#71807b; text-align:center; }
    .ssml-empty-panel strong { display:block; margin-bottom:5px; color:#153f3a; }
    .ssml-contact-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
    .ssml-contact-card { padding:17px; border:1px solid #dfe7e3; border-radius:16px; background:#fff; box-shadow:0 6px 18px rgba(21,63,58,.05); }
    .ssml-contact-card h3 { margin:0 0 3px; color:#153f3a; }
    .ssml-contact-role { margin:0 0 12px; color:#7a8581; font-size:.78rem; }
    .ssml-contact-card a { display:block; margin-top:7px; color:#176359; font-size:.88rem; text-decoration:none; overflow-wrap:anywhere; }

    @media (max-width:700px) {
      :root { --ssml-nav-height:74px; }
      #app-shell .page-wrap { padding:14px 12px 24px; }
      #home-view .ssml-home-hero {
        grid-template-columns:minmax(0,1fr) 43%;
        gap:8px;
        min-height:300px;
        padding:25px 20px 28px;
        border-radius:22px;
      }
      #home-view .ssml-home-hero::after { left:20px; bottom:26px; width:42px; }
      .ssml-hero-copy { padding-bottom:34px; }
      .ssml-hero-copy .eyebrow { max-width:180px; margin-bottom:10px; font-size:.61rem; line-height:1.35; }
      .ssml-hero-copy h1 { font-size:clamp(2.45rem,12vw,3.7rem); line-height:.92; }
      .ssml-hero-copy > p:last-of-type { max-width:190px; margin-top:14px; font-size:.82rem; line-height:1.45; }
      .ssml-hero-cta { min-height:42px; margin-top:20px; padding:0 13px; font-size:.78rem; }
      .ssml-hero-visual { width:155%; max-width:none; margin-right:-38%; }
      #home-view .home-actions { gap:9px; margin:12px 0 16px; }
      #home-view .home-action-card { grid-template-columns:42px minmax(0,1fr) 14px; gap:9px; min-height:76px; padding:11px; border-radius:15px; }
      #home-view .home-action-card .action-icon { width:42px; height:42px; font-size:1.05rem; }
      #home-view .home-action-card strong { font-size:.88rem; }
      #home-view .home-action-card small { display:block; font-size:.67rem; }
      .ssml-recent-panel { padding:15px 14px 5px; border-radius:17px; }
      .ssml-bottom-nav { bottom:7px; width:calc(100% - 14px); min-height:70px; border-radius:21px; }
      .ssml-bottom-nav button { min-height:54px; font-size:.68rem; }
      .ssml-bottom-nav button svg { width:21px; height:21px; }
      .ssml-favorites-grid, .ssml-contact-grid { grid-template-columns:1fr; }
    }

    @media (max-width:390px) {
      #home-view .ssml-home-hero { min-height:284px; padding-left:17px; padding-right:14px; }
      .ssml-hero-copy h1 { font-size:2.55rem; }
      .ssml-hero-copy > p:last-of-type { max-width:170px; font-size:.76rem; }
      .ssml-hero-visual { width:165%; margin-right:-46%; }
      #home-view .home-action-card { grid-template-columns:38px minmax(0,1fr) 10px; padding:9px; }
      #home-view .home-action-card .action-icon { width:38px; height:38px; }
    }
  `;
  document.head.append(style);
}

function iconSvg(name) {
  const icons = {
    home: '<path d="M3.5 10.6 12 3.8l8.5 6.8v9a1 1 0 0 1-1 1h-5.2v-6.1H9.7v6.1H4.5a1 1 0 0 1-1-1v-9Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    archive: '<path d="M3.5 7.5h6l1.7 2h9.3v8.8a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7V7.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3.5 7.5V5.7A1.7 1.7 0 0 1 5.2 4h4.2l1.7 2h7.7a1.7 1.7 0 0 1 1.7 1.7v1.8" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    star: '<path d="m12 3.2 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9L6.6 20l1-6.1-4.4-4.3 6.1-.9L12 3.2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    contacts: '<path d="M8.2 10.4a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6Zm7.8-.9a2.6 2.6 0 1 0 0-5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M2.8 19.8v-1.6c0-3 2.4-5.4 5.4-5.4s5.4 2.4 5.4 5.4v1.6M15 12.6c3 .2 5.2 2.1 5.2 4.8v1.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name]}</svg>`;
}

function goCoreView(name) {
  const button = document.querySelector(`.sidebar .nav-item[data-view="${name}"]`);
  if (button) button.click();
  if (name === 'home') setBottomActive('home');
  if (name === 'archive') setBottomActive('archive');
}

function enhanceHomeHero() {
  const welcome = document.querySelector('#home-view .welcome');
  if (!welcome || welcome.dataset.ssmlHero === 'v3') return;
  welcome.dataset.ssmlHero = 'v3';
  welcome.className = 'welcome ssml-home-hero';
  welcome.innerHTML = `
    <div class="ssml-hero-copy">
      <p class="eyebrow">Samnanger Skulemusikklag</p>
      <h1>Musikken<br>samla</h1>
      <p>Notar, stemmer og repertoar samla på eitt sted.</p>
      <button class="ssml-hero-cta" type="button">Utforsk arkivet <span>→</span></button>
    </div>
    <div class="ssml-hero-visual" aria-hidden="true"></div>`;
  welcome.querySelector('.ssml-hero-cta')?.addEventListener('click', () => goCoreView('archive'));
}

function polishHomeActions() {
  const actions = document.querySelector('#home-view .home-actions');
  if (!actions || actions.dataset.ssmlPolished === 'true') return;
  actions.dataset.ssmlPolished = 'true';
  const labels = [
    ['Notearkiv','Søk og bla i notar'],
    ['Songliste','Sjå og rediger lister'],
    ['Ny song','Legg til i arkivet'],
    ['Del liste','Del med andre']
  ];
  [...actions.querySelectorAll('.home-action-card')].forEach((card,index) => {
    const strong = card.querySelector('strong');
    const small = card.querySelector('small');
    if (labels[index]) {
      if (strong) strong.textContent = labels[index][0];
      if (small) small.textContent = labels[index][1];
    }
  });
}

function wrapRecentSection() {
  const home = document.querySelector('#home-view');
  const heading = home?.querySelector('.section-heading');
  const grid = home?.querySelector('#recent-grid');
  if (!home || !heading || !grid || heading.closest('.ssml-recent-panel')) return;
  const panel = document.createElement('section');
  panel.className = 'ssml-recent-panel';
  heading.before(panel);
  panel.append(heading, grid);
  const showAll = heading.querySelector('.text-btn');
  if (showAll) showAll.textContent = 'Sjå alle ›';
}

function createBottomNav() {
  if (document.querySelector('.ssml-bottom-nav')) return;
  const nav = document.createElement('nav');
  nav.className = 'ssml-bottom-nav';
  nav.setAttribute('aria-label','Hovudnavigasjon');
  nav.innerHTML = `
    <button type="button" data-bottom-view="home" class="active">${iconSvg('home')}<span>Heim</span></button>
    <button type="button" data-bottom-view="archive">${iconSvg('archive')}<span>Arkiv</span></button>
    <button type="button" data-bottom-view="favorites">${iconSvg('star')}<span>Favorittar</span></button>
    <button type="button" data-bottom-view="contacts">${iconSvg('contacts')}<span>Kontaktar</span></button>`;
  document.body.append(nav);
  nav.addEventListener('click', event => {
    const button = event.target.closest('[data-bottom-view]');
    if (!button) return;
    const view = button.dataset.bottomView;
    if (view === 'home' || view === 'archive') goCoreView(view);
    if (view === 'favorites') showFavoritesView();
    if (view === 'contacts') showContactsView();
  });
}

function setBottomActive(name) {
  document.querySelectorAll('.ssml-bottom-nav [data-bottom-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.bottomView === name);
  });
}

function visibleViewName() {
  const view = [...document.querySelectorAll('#app-shell main .view')].find(item => !item.classList.contains('hidden'));
  if (!view) return 'home';
  if (view.id === 'home-view') return 'home';
  if (view.id === 'favorites-view') return 'favorites';
  if (view.id === 'contacts-view') return 'contacts';
  return 'archive';
}

function watchViewChanges() {
  const main = document.querySelector('#app-shell main');
  if (!main || main.dataset.ssmlViewWatch === 'true') return;
  main.dataset.ssmlViewWatch = 'true';
  const observer = new MutationObserver(() => setBottomActive(visibleViewName()));
  observer.observe(main, { attributes:true, subtree:true, attributeFilter:['class'], childList:true });
}

function showCustomView(id) {
  document.querySelectorAll('#app-shell main .view').forEach(view => view.classList.add('hidden'));
  document.querySelector(`#${id}`)?.classList.remove('hidden');
  document.querySelector('.sidebar')?.classList.remove('open');
  window.scrollTo({ top:0, behavior:'smooth' });
}

let firebasePromise = null;
let allSongs = [];
let currentUid = 'local';
let favoriteIds = new Set();

async function getFirebase() {
  if (firebasePromise) return firebasePromise;
  firebasePromise = Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
  ]).then(async ([appModule, authModule, firestoreModule]) => {
    for (let i=0;i<80 && !appModule.getApps().length;i++) await new Promise(r => setTimeout(r,100));
    if (!appModule.getApps().length) throw new Error('Firebase er ikkje klart.');
    const app = appModule.getApp();
    return { auth:authModule.getAuth(app), db:firestoreModule.getFirestore(app), authModule, firestoreModule };
  });
  return firebasePromise;
}

function favoritesKey() { return `${FAVORITES_PREFIX}${currentUid}`; }
function loadFavorites() {
  try { favoriteIds = new Set(JSON.parse(localStorage.getItem(favoritesKey()) || '[]')); }
  catch { favoriteIds = new Set(); }
}
function saveFavorites() { localStorage.setItem(favoritesKey(), JSON.stringify([...favoriteIds])); }
function isFavorite(id) { return favoriteIds.has(String(id)); }

async function refreshSongsForShell() {
  try {
    const { auth, db, firestoreModule } = await getFirebase();
    if (!auth.currentUser) return [];
    currentUid = auth.currentUser.uid || 'local';
    loadFavorites();
    const snap = await firestoreModule.getDocs(firestoreModule.collection(db,'songs'));
    allSongs = snap.docs.map(doc => ({ id:doc.id, ...doc.data() }));
    return allSongs;
  } catch (error) {
    console.warn('Kunne ikkje hente songar til favorittfunksjonen', error);
    return allSongs;
  }
}

function findSongForCard(card) {
  const title = card.querySelector('h3')?.textContent?.trim();
  if (!title) return null;
  return allSongs.find(song => String(song.title || '').trim() === title) || null;
}

function favoriteButton(song) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `ssml-favorite-toggle${isFavorite(song.id) ? ' active' : ''}`;
  button.setAttribute('aria-label', isFavorite(song.id) ? 'Fjern frå favorittar' : 'Legg til i favorittar');
  button.title = button.getAttribute('aria-label');
  button.textContent = isFavorite(song.id) ? '★' : '☆';
  button.dataset.favoriteSong = song.id;
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    toggleFavorite(song.id);
  });
  return button;
}

function toggleFavorite(songId) {
  const id = String(songId);
  if (favoriteIds.has(id)) favoriteIds.delete(id); else favoriteIds.add(id);
  saveFavorites();
  decorateSongCards();
  if (!document.querySelector('#favorites-view')?.classList.contains('hidden')) renderFavorites();
}

function decorateSongCards() {
  document.querySelectorAll('.song-card').forEach(card => {
    const song = findSongForCard(card);
    const old = card.querySelector('.ssml-favorite-toggle');
    if (!song) { old?.remove(); return; }
    const active = isFavorite(song.id);
    if (!old) card.append(favoriteButton(song));
    else {
      old.classList.toggle('active',active);
      old.textContent = active ? '★' : '☆';
      old.setAttribute('aria-label', active ? 'Fjern frå favorittar' : 'Legg til i favorittar');
    }
  });
}

function ensureFavoritesView() {
  if (document.querySelector('#favorites-view')) return;
  const main = document.querySelector('#app-shell main');
  if (!main) return;
  const view = document.createElement('section');
  view.id = 'favorites-view';
  view.className = 'view page-wrap hidden';
  view.innerHTML = `
    <div class="ssml-simple-heading"><p class="eyebrow green">Dine val</p><h1>Favorittar</h1><p>Songar du vil finne raskt igjen.</p></div>
    <div id="ssml-favorites-content"></div>`;
  main.append(view);
}

function openSongViaArchive(song) {
  goCoreView('archive');
  const search = document.querySelector('#archive-search');
  if (!search) return;
  search.value = song.title || '';
  search.dispatchEvent(new Event('input',{bubbles:true}));
  requestAnimationFrame(() => {
    const card = [...document.querySelectorAll('#archive-grid .song-card')].find(item => item.querySelector('h3')?.textContent?.trim() === String(song.title || '').trim());
    if (card) card.click();
  });
}

function renderFavorites() {
  ensureFavoritesView();
  const target = document.querySelector('#ssml-favorites-content');
  if (!target) return;
  const favorites = allSongs.filter(song => isFavorite(song.id)).sort((a,b) => String(a.title||'').localeCompare(String(b.title||''),'no'));
  if (!favorites.length) {
    target.innerHTML = '<div class="ssml-empty-panel"><strong>Ingen favorittar enno</strong>Trykk på stjerna ved ein song i arkivet for å leggje han hit.</div>';
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'ssml-favorites-grid';
  favorites.forEach(song => {
    const card = document.createElement('article');
    card.className = 'ssml-favorite-card';
    card.innerHTML = `<h3>${escapeHtml(song.title || 'Utan tittel')}</h3><p>${escapeHtml(song.composer || 'Ukjend komponist')}${song.arranger ? ` · arr. ${escapeHtml(song.arranger)}` : ''}</p>`;
    card.append(favoriteButton(song));
    card.addEventListener('click', () => openSongViaArchive(song));
    grid.append(card);
  });
  target.replaceChildren(grid);
}

async function showFavoritesView() {
  ensureFavoritesView();
  await refreshSongsForShell();
  renderFavorites();
  showCustomView('favorites-view');
  setBottomActive('favorites');
}

function ensureContactsView() {
  if (document.querySelector('#contacts-view')) return;
  const main = document.querySelector('#app-shell main');
  if (!main) return;
  const view = document.createElement('section');
  view.id = 'contacts-view';
  view.className = 'view page-wrap hidden';
  view.innerHTML = `
    <div class="ssml-simple-heading"><p class="eyebrow green">Samnanger Skulemusikklag</p><h1>Kontaktar</h1><p>Kontaktinformasjon til brukarar og nøkkelpersonar.</p></div>
    <div id="ssml-contacts-content"><div class="ssml-empty-panel">Hentar kontaktar …</div></div>`;
  main.append(view);
}

async function loadContacts() {
  ensureContactsView();
  const target = document.querySelector('#ssml-contacts-content');
  if (!target) return;
  try {
    const { auth, db, firestoreModule } = await getFirebase();
    if (!auth.currentUser) throw new Error('Ikkje innlogga');
    const snap = await firestoreModule.getDocs(firestoreModule.collection(db,'contacts'));
    const contacts = snap.docs.map(doc => ({id:doc.id,...doc.data()})).filter(item => item.name || item.email || item.phone);
    contacts.sort((a,b) => String(a.name||'').localeCompare(String(b.name||''),'no'));
    if (!contacts.length) throw new Error('empty');
    const grid = document.createElement('div');
    grid.className = 'ssml-contact-grid';
    contacts.forEach(contact => {
      const card = document.createElement('article');
      card.className = 'ssml-contact-card';
      card.innerHTML = `<h3>${escapeHtml(contact.name || 'Kontakt')}</h3>${contact.role ? `<p class="ssml-contact-role">${escapeHtml(contact.role)}</p>` : '<p class="ssml-contact-role">Samnanger Skulemusikklag</p>'}${contact.phone ? `<a href="tel:${escapeAttr(contact.phone)}">☎ ${escapeHtml(contact.phone)}</a>` : ''}${contact.email ? `<a href="mailto:${escapeAttr(contact.email)}">✉ ${escapeHtml(contact.email)}</a>` : ''}`;
      grid.append(card);
    });
    target.replaceChildren(grid);
  } catch (error) {
    const userEmail = (() => { try { return document.querySelector('#user-email')?.textContent?.trim(); } catch { return ''; } })();
    target.innerHTML = `<div class="ssml-empty-panel"><strong>Kontaktregisteret er ikkje fylt ut enno</strong>${userEmail && userEmail !== 'Lokal modus' ? `Du er innlogga som ${escapeHtml(userEmail)}. ` : ''}Når kontaktane blir lagde i Firestore-samlinga <code>contacts</code>, kjem dei automatisk opp her.</div>`;
  }
}

async function showContactsView() {
  ensureContactsView();
  showCustomView('contacts-view');
  setBottomActive('contacts');
  await loadContacts();
}

function escapeHtml(value='') {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}
function escapeAttr(value='') { return String(value ?? '').replace(/["&<>]/g, ch => ({'"':'&quot;','&':'&amp;','<':'&lt;','>':'&gt;'}[ch])); }

function observeDynamicUi() {
  const main = document.querySelector('#app-shell main');
  if (!main || main.dataset.ssmlShellObserver === 'true') return;
  main.dataset.ssmlShellObserver = 'true';
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhanceHomeHero();
      polishHomeActions();
      wrapRecentSection();
      decorateSongCards();
      setBottomActive(visibleViewName());
    });
  });
  observer.observe(main,{childList:true,subtree:true});
}

async function bootShell() {
  loadHeroStyles();
  enhanceHomeHero();
  createBottomNav();
  ensureFavoritesView();
  ensureContactsView();
  polishHomeActions();
  wrapRecentSection();
  watchViewChanges();
  observeDynamicUi();
  try {
    const { auth, authModule } = await getFirebase();
    authModule.onAuthStateChanged(auth, async user => {
      if (!user) return;
      currentUid = user.uid || 'local';
      loadFavorites();
      await refreshSongsForShell();
      decorateSongCards();
    });
  } catch (error) {
    console.warn('SSML-shell starta utan Firebase-data', error);
  }
}

bootShell();
