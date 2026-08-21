const SHARE_SERVICE_URL = "https://ssml-email-pdf-1091683313021.europe-west1.run.app";

async function fetchWithTimeout(resource, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Delinga brukte for lang tid på å lastast. Prøv igjen.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function escapeHtml(value = "") {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function shareToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id") || window.location.hash.replace(/^#/, "").trim();
}

function formatExpiry(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("nn-NO", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function renderError(message) {
  document.querySelector("#share-title").textContent = "Delinga er ikkje tilgjengeleg";
  document.querySelector("#share-status").innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}

async function loadShare() {
  const token = shareToken();
  if (!token) {
    renderError("Delingslenka manglar ein gyldig kode.");
    return;
  }

  try {
    const response = await fetchWithTimeout(`${SHARE_SERVICE_URL}/share/${encodeURIComponent(token)}`, { cache: "no-store" }, 30000);
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body.error || "Kunne ikkje hente dei delte notane.");

    document.title = `${body.title || "Delte notar"} · SSML`;
    document.querySelector("#share-title").textContent = body.title || "Delte notar";
    const meta = [body.composer, body.arranger ? `arr. ${body.arranger}` : ""].filter(Boolean).join(" · ");
    document.querySelector("#share-meta").textContent = meta;

    const expiry = formatExpiry(body.expiresAt);
    if (expiry) {
      const box = document.querySelector("#share-expiry");
      box.hidden = false;
      box.textContent = `Denne delingslenka er gyldig til ${expiry}.`;
    }

    const files = Array.isArray(body.files) ? body.files : [];
    const list = document.querySelector("#share-files");
    list.innerHTML = "";
    for (const file of files) {
      const row = document.createElement("article");
      row.className = "file";
      row.innerHTML = `
        <span class="icon" aria-hidden="true">▧</span>
        <div class="file-info">
          <strong>${escapeHtml(file.name || "Stemme")}</strong>
          <small>${escapeHtml(file.fileName || "Notar.pdf")}</small>
        </div>
        <div class="actions">
          <a class="btn primary" href="${escapeHtml(file.openUrl || "#")}" target="_blank" rel="noopener">Åpne / skriv ut</a>
          <a class="btn" href="${escapeHtml(file.downloadUrl || "#")}">Last ned</a>
        </div>`;
      list.append(row);
    }

    const status = document.querySelector("#share-status");
    if (files.length) {
      status.remove();
    } else {
      status.textContent = "Denne delinga inneheld ingen stemmer.";
    }
  } catch (error) {
    console.error(error);
    renderError(error.message || "Kunne ikkje hente dei delte notane.");
  }
}

loadShare();
