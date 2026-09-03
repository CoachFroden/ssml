function loadHeroStyles() {
  if (document.querySelector('link[data-ssml-home-hero]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./home-hero.css?v=1', import.meta.url).href;
  link.dataset.ssmlHomeHero = 'true';
  document.head.append(link);
}

function enhanceHomeHero() {
  const welcome = document.querySelector('#home-view .welcome');
  if (!welcome || welcome.dataset.ssmlHero === 'true') return;

  welcome.dataset.ssmlHero = 'true';
  welcome.classList.add('ssml-home-hero');
  welcome.innerHTML = `
    <div class="ssml-hero-copy">
      <p class="eyebrow green">Samnanger Skulemusikklag</p>
      <h1>Musikken samla</h1>
      <p>Notar, stemmer og repertoar for Samnanger Skulemusikklag.</p>
    </div>
    <div class="ssml-hero-visual" aria-hidden="true">
      <svg viewBox="0 0 300 230" role="presentation" focusable="false">
        <g transform="translate(40 18) rotate(-6 105 92)">
          <rect x="34" y="22" width="172" height="164" rx="13" fill="#e7efec" stroke="#cdded8" stroke-width="2"/>
        </g>
        <g transform="translate(20 8) rotate(4 130 105)">
          <rect x="52" y="16" width="176" height="172" rx="13" fill="#f2f6f4" stroke="#d8e5e0" stroke-width="2"/>
        </g>
        <g>
          <rect x="56" y="22" width="176" height="172" rx="14" fill="#ffffff" stroke="#cadbd5" stroke-width="2"/>
          <rect x="77" y="47" width="70" height="7" rx="3.5" fill="#153f3a" opacity="0.88"/>
          <rect x="77" y="61" width="106" height="5" rx="2.5" fill="#9fb8b0"/>
          <g stroke="#d8e4df" stroke-width="2">
            <line x1="78" y1="92" x2="209" y2="92"/>
            <line x1="78" y1="101" x2="209" y2="101"/>
            <line x1="78" y1="110" x2="209" y2="110"/>
            <line x1="78" y1="119" x2="209" y2="119"/>
            <line x1="78" y1="128" x2="209" y2="128"/>
            <line x1="78" y1="148" x2="209" y2="148"/>
            <line x1="78" y1="157" x2="209" y2="157"/>
            <line x1="78" y1="166" x2="209" y2="166"/>
          </g>
          <g fill="#1f5b52">
            <ellipse cx="112" cy="115" rx="8" ry="6" transform="rotate(-14 112 115)"/>
            <rect x="118" y="91" width="3.5" height="24" rx="1.5"/>
            <ellipse cx="153" cy="105" rx="8" ry="6" transform="rotate(-14 153 105)"/>
            <rect x="159" y="80" width="3.5" height="25" rx="1.5"/>
            <ellipse cx="184" cy="124" rx="8" ry="6" transform="rotate(-14 184 124)"/>
            <rect x="190" y="98" width="3.5" height="26" rx="1.5"/>
          </g>
          <circle cx="210" cy="54" r="18" fill="#d6a63f" opacity="0.15"/>
          <path d="M201 55c7-9 15-10 20-5-1 8-7 14-17 15 4-2 6-5 6-8-4 1-7 0-9-2Z" fill="#d6a63f"/>
        </g>
      </svg>
    </div>`;
}

function loadHomeNavigationStyles() {
  if (document.querySelector('#ssml-home-navigation-styles')) return;
  const style = document.createElement('style');
  style.id = 'ssml-home-navigation-styles';
  style.textContent = `
    .ssml-home-button {
      display: inline-grid;
      place-items: center;
      width: 40px;
      height: 40px;
      margin: 0 0 16px;
      padding: 0;
      border: 1px solid #d6e1dd;
      border-radius: 11px;
      background: #fff;
      color: #17564d;
      cursor: pointer;
      box-shadow: 0 3px 10px rgba(21,63,58,.045);
      transition: background .15s ease, border-color .15s ease, transform .15s ease;
    }
    .ssml-home-button:hover {
      background: #f3f8f6;
      border-color: #b9cec6;
      transform: translateY(-1px);
    }
    .ssml-home-button:focus-visible {
      outline: 3px solid rgba(32,102,91,.16);
      outline-offset: 2px;
    }
    .ssml-home-button svg {
      width: 19px;
      height: 19px;
      display: block;
    }
    @media (max-width: 520px) {
      .ssml-home-button {
        width: 38px;
        height: 38px;
        margin-bottom: 14px;
        border-radius: 10px;
      }
    }
  `;
  document.head.append(style);
}

function goToOverview() {
  const homeNav = document.querySelector('.sidebar .nav-item[data-view="home"]');
  if (homeNav) homeNav.click();
}

function createHomeButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ssml-home-button';
  button.setAttribute('aria-label', 'Til oversikt');
  button.title = 'Til oversikt';
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3.5 10.6 12 3.8l8.5 6.8v9a1 1 0 0 1-1 1h-5.2v-6.1H9.7v6.1H4.5a1 1 0 0 1-1-1v-9Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>`;
  button.addEventListener('click', goToOverview);
  return button;
}

function ensureHomeButton(view) {
  if (!view || view.id === 'home-view') return;
  if (!view.classList.contains('view')) return;
  if (view.querySelector('.ssml-home-button')) return;

  const existingBack = view.querySelector('.back-btn');
  const button = createHomeButton();

  if (existingBack) existingBack.replaceWith(button);
  else view.prepend(button);
}

function ensureHomeNavigation() {
  document.querySelectorAll('.view').forEach(ensureHomeButton);
}

function observeViews() {
  const main = document.querySelector('#app-shell main');
  if (!main) return;
  const observer = new MutationObserver(() => ensureHomeNavigation());
  observer.observe(main, { childList: true, subtree: true });
}

loadHeroStyles();
enhanceHomeHero();
loadHomeNavigationStyles();
ensureHomeNavigation();
observeViews();
