function injectPrintSelectedFix() {
  if (document.querySelector('#ssml-print-selected-mobile-fix')) return;

  const style = document.createElement('style');
  style.id = 'ssml-print-selected-mobile-fix';
  style.textContent = `
    @media (max-width: 850px) {
      #song-view {
        padding-bottom: calc(var(--ssml-nav-height, 74px) + 110px + env(safe-area-inset-bottom, 0px)) !important;
      }

      #song-view #print-selected-parts {
        position: fixed !important;
        z-index: 75 !important;
        left: max(16px, env(safe-area-inset-left, 0px)) !important;
        right: max(16px, env(safe-area-inset-right, 0px)) !important;
        bottom: calc(var(--ssml-nav-height, 74px) + 18px + env(safe-area-inset-bottom, 0px)) !important;
        width: auto !important;
        min-height: 52px !important;
        margin: 0 !important;
        border-radius: 14px !important;
        box-shadow: 0 12px 30px rgba(14, 55, 49, .24), 0 2px 8px rgba(14, 55, 49, .12) !important;
      }
    }
  `;
  document.head.append(style);
}

injectPrintSelectedFix();
