const $ = (selector, root = document) => root.querySelector(selector);

function injectLogoutStyles() {
  if ($("#ssml-contacts-logout-styles")) return;
  const style = document.createElement("style");
  style.id = "ssml-contacts-logout-styles";
  style.textContent = `
    .ssml-contacts-logout-wrap {
      margin: 22px 0 4px;
      padding-top: 18px;
      border-top: 1px solid #e3e9e6;
    }

    #ssml-contacts-logout {
      width: 100%;
      min-height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 1px solid #d8e1dd;
      border-radius: 13px;
      background: #fff;
      color: #6d3535;
      font: 800 .84rem Manrope, sans-serif;
      cursor: pointer;
    }

    #ssml-contacts-logout:active {
      transform: translateY(1px);
    }

    @media (min-width: 701px) {
      #ssml-contacts-logout {
        width: auto;
        min-width: 150px;
        padding: 0 18px;
      }
    }
  `;
  document.head.append(style);
}

function ensureContactsLogout() {
  const view = $("#contacts-view");
  if (!view || $("#ssml-contacts-logout", view)) return;

  const wrap = document.createElement("div");
  wrap.className = "ssml-contacts-logout-wrap";

  const button = document.createElement("button");
  button.id = "ssml-contacts-logout";
  button.type = "button";
  button.innerHTML = '<span aria-hidden="true">↗</span><span>Logg ut</span>';
  button.addEventListener("click", () => {
    const existingLogout = document.querySelector("#logout");
    if (existingLogout) {
      existingLogout.click();
      return;
    }
    console.warn("Fant ikkje den eksisterande utloggingsknappen.");
  });

  wrap.append(button);
  view.append(wrap);
}

injectLogoutStyles();
ensureContactsLogout();

const observer = new MutationObserver(ensureContactsLogout);
observer.observe(document.body, { childList: true, subtree: true });
