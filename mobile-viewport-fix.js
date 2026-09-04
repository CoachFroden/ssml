const isSmallTouchDevice = window.matchMedia?.("(max-width: 700px)")?.matches;

function ensureViewportFit() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const parts = new Set(meta.content.split(",").map(part => part.trim()).filter(Boolean));
  parts.add("width=device-width");
  parts.add("initial-scale=1");
  parts.add("viewport-fit=cover");
  meta.content = [...parts].join(", ");
}

function injectMobileGuards() {
  if (document.querySelector("#ssml-mobile-viewport-fix")) return;
  const style = document.createElement("style");
  style.id = "ssml-mobile-viewport-fix";
  style.textContent = `
    html {
      width: 100%;
      max-width: 100%;
      -webkit-text-size-adjust: 100%;
      text-size-adjust: 100%;
    }
    body {
      width: 100%;
      max-width: 100%;
      overflow-x: hidden;
    }
    #app-shell,
    #app-shell main,
    #app-shell .view,
    #app-shell .page-wrap {
      min-width: 0;
      max-width: 100%;
    }

    @media (max-width: 700px) {
      input,
      select,
      textarea {
        font-size: 16px !important;
      }

      #app-shell main,
      #app-shell .view,
      #app-shell .page-wrap {
        width: 100%;
        max-width: 100vw;
      }

      #app-shell .page-wrap {
        padding-left: max(14px, env(safe-area-inset-left));
        padding-right: max(14px, env(safe-area-inset-right));
      }

      .ssml-bottom-nav {
        max-width: calc(100vw - 12px) !important;
      }
    }

    @media (max-width: 390px) {
      #home-view .welcome.ssml-home-hero {
        padding-left: 16px !important;
        padding-right: 12px !important;
      }
      #home-view .welcome.ssml-home-hero .ssml-hero-visual {
        width: 150px !important;
        max-width: 150px !important;
        margin-right: -12px !important;
      }
      #home-view .welcome.ssml-home-hero .ssml-hero-art-img {
        width: 150px !important;
        max-width: 150px !important;
      }
    }
  `;
  document.head.append(style);
}

function clearRestoredFocus() {
  if (!isSmallTouchDevice) return;
  const active = document.activeElement;
  if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
    active.blur();
  }
}

ensureViewportFit();
injectMobileGuards();

window.addEventListener("pageshow", () => {
  requestAnimationFrame(clearRestoredFocus);
});
