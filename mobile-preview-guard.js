(() => {
  const isAppleMobile = () => {
    const ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  };
  if (!isAppleMobile()) return;

  const nativeFetch = window.fetch.bind(window);
  let blockPreviewUntil = 0;

  const isStoragePdfRequest = input => {
    const value = typeof input === "string" ? input : input?.url || "";
    if (!/firebasestorage\.googleapis\.com|storage\.googleapis\.com/i.test(value)) return false;
    return /\.pdf(?:\?|$)|alt=media/i.test(value);
  };

  window.fetch = function(input, init) {
    if (Date.now() < blockPreviewUntil && isStoragePdfRequest(input)) {
      return Promise.reject(new TypeError("Fleir-PDF-førehandsvising er slått av på mobil for å spare minne."));
    }
    return nativeFetch(input, init);
  };

  document.addEventListener("change", event => {
    if (!event.target.matches?.('#part-list input[type="checkbox"]')) return;
    const count = document.querySelectorAll('#part-list input[type="checkbox"]:checked').length;
    blockPreviewUntil = count > 1 ? Date.now() + 15000 : 0;
    if (count > 1) {
      setTimeout(() => {
        const grid = document.querySelector("#thumbnail-grid");
        const title = document.querySelector("#preview-title");
        if (grid) {
          grid.className = "multi-preview";
          grid.innerHTML = `<p class="loading-pages"><strong>${count} stemmer valde.</strong><br>Førehandsvising av fleire PDF-ar er slått av på iPhone/iPad for å spare minne. Du kan framleis sende dei valde stemmene på e-post.</p>`;
        }
        if (title) title.textContent = `${count} valde stemmer`;
      }, 50);
    }
  }, true);

  document.addEventListener("click", event => {
    if (event.target.closest?.("#print-selected-parts, #open-print, .part-btn")) {
      blockPreviewUntil = 0;
    }
  }, true);
})();
