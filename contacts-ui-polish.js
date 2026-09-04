const $ = (selector, root = document) => root.querySelector(selector);

function injectStyles() {
  if ($("#ssml-contacts-ui-polish")) return;
  const style = document.createElement("style");
  style.id = "ssml-contacts-ui-polish";
  style.textContent = `
    .ssml-my-profile.ssml-profile-enhanced {
      padding: 0 !important;
      overflow: hidden;
    }
    .ssml-my-profile.ssml-profile-enhanced .ssml-my-profile-head {
      display: none !important;
    }
    .ssml-profile-toggle {
      width: 100%;
      min-height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 14px 16px;
      border: 0;
      background: #fff;
      color: #153f3a;
      text-align: left;
      cursor: pointer;
      font: inherit;
    }
    .ssml-profile-toggle-copy {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .ssml-profile-toggle-title {
      font-size: 1rem;
      font-weight: 850;
      line-height: 1.2;
    }
    .ssml-profile-toggle-subtitle {
      color: #7a8884;
      font-size: .72rem;
      line-height: 1.35;
    }
    .ssml-profile-toggle-icon {
      width: 32px;
      height: 32px;
      flex: 0 0 32px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: #edf5f1;
      color: #176359;
      transition: transform .2s ease;
      font-size: 1rem;
      font-weight: 900;
    }
    .ssml-profile-toggle[aria-expanded="true"] .ssml-profile-toggle-icon {
      transform: rotate(180deg);
    }
    .ssml-my-profile.ssml-profile-enhanced .ssml-profile-form {
      padding: 2px 16px 16px;
    }
    .ssml-my-profile.ssml-profile-collapsed .ssml-profile-form {
      display: none !important;
    }

    #ssml-contacts-content .ssml-contact-card a[href^="tel:"] {
      cursor: pointer;
    }

    .ssml-phone-sheet-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: grid;
      align-items: end;
      justify-items: center;
      padding: 18px;
      background: rgba(8, 34, 31, .34);
      backdrop-filter: blur(3px);
    }
    .ssml-phone-sheet {
      width: min(100%, 420px);
      padding: 14px;
      border-radius: 22px;
      background: #f8faf9;
      box-shadow: 0 22px 60px rgba(5, 31, 28, .28);
      animation: ssmlSheetIn .18s ease-out;
    }
    .ssml-phone-sheet-head {
      padding: 7px 8px 13px;
      text-align: center;
    }
    .ssml-phone-sheet-head strong {
      display: block;
      color: #153f3a;
      font-size: 1rem;
    }
    .ssml-phone-sheet-head span {
      display: block;
      margin-top: 3px;
      color: #788682;
      font-size: .78rem;
    }
    .ssml-phone-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 9px;
    }
    .ssml-phone-action,
    .ssml-phone-cancel {
      min-height: 52px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      border-radius: 14px;
      text-decoration: none;
      font: 800 .88rem Manrope, sans-serif;
      cursor: pointer;
    }
    .ssml-phone-action {
      border: 1px solid #d9e5e1;
      background: #fff;
      color: #14584f;
    }
    .ssml-phone-action:first-child {
      background: #14584f;
      border-color: #14584f;
      color: #fff;
    }
    .ssml-phone-cancel {
      width: 100%;
      margin-top: 9px;
      border: 0;
      background: transparent;
      color: #687773;
    }
    @keyframes ssmlSheetIn {
      from { transform: translateY(16px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `;
  document.head.append(style);
}

function enhanceProfilePanel() {
  const panel = $("#ssml-my-profile");
  if (!panel || panel.classList.contains("ssml-profile-enhanced")) return;

  panel.classList.add("ssml-profile-enhanced", "ssml-profile-collapsed");

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ssml-profile-toggle";
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = `
    <span class="ssml-profile-toggle-copy">
      <span class="ssml-profile-toggle-title">Mine opplysningar</span>
      <span class="ssml-profile-toggle-subtitle">Trykk for å sjå eller endre kontaktinformasjonen din</span>
    </span>
    <span class="ssml-profile-toggle-icon" aria-hidden="true">⌄</span>`;

  toggle.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("ssml-profile-collapsed");
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });

  panel.prepend(toggle);
}

function closePhoneSheet() {
  $(".ssml-phone-sheet-backdrop")?.remove();
}

function openPhoneSheet(phone, name = "") {
  closePhoneSheet();
  const cleanPhone = String(phone || "").trim();
  if (!cleanPhone) return;

  const backdrop = document.createElement("div");
  backdrop.className = "ssml-phone-sheet-backdrop";
  backdrop.setAttribute("role", "presentation");

  const sheet = document.createElement("div");
  sheet.className = "ssml-phone-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Telefonval");

  const safeName = name || "Kontakt";
  const head = document.createElement("div");
  head.className = "ssml-phone-sheet-head";
  const strong = document.createElement("strong");
  strong.textContent = safeName;
  const number = document.createElement("span");
  number.textContent = cleanPhone;
  head.append(strong, number);

  const actions = document.createElement("div");
  actions.className = "ssml-phone-actions";

  const call = document.createElement("a");
  call.className = "ssml-phone-action";
  call.href = `tel:${cleanPhone}`;
  call.textContent = "☎ Ring";

  const sms = document.createElement("a");
  sms.className = "ssml-phone-action";
  sms.href = `sms:${cleanPhone}`;
  sms.textContent = "✉ Send SMS";

  actions.append(call, sms);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ssml-phone-cancel";
  cancel.textContent = "Avbryt";
  cancel.addEventListener("click", closePhoneSheet);

  sheet.append(head, actions, cancel);
  backdrop.append(sheet);
  backdrop.addEventListener("click", event => {
    if (event.target === backdrop) closePhoneSheet();
  });
  document.body.append(backdrop);
}

function observeProfilePanel() {
  const root = $("#contacts-view") || document.body;
  const observer = new MutationObserver(enhanceProfilePanel);
  observer.observe(root, { childList: true, subtree: true });
  enhanceProfilePanel();
}

injectStyles();
observeProfilePanel();

document.addEventListener("click", event => {
  const phoneLink = event.target.closest?.('#ssml-contacts-content a[href^="tel:"]');
  if (!phoneLink) return;
  event.preventDefault();
  const phone = phoneLink.getAttribute("href")?.replace(/^tel:/i, "") || phoneLink.textContent.replace(/^☎\s*/, "").trim();
  const name = phoneLink.closest(".ssml-contact-card")?.querySelector("h3")?.textContent?.trim() || "Kontakt";
  openPhoneSheet(phone, name);
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closePhoneSheet();
});
