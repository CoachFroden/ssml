import { firebaseConfig } from "./firebase-core.js?v=26";

const button = document.querySelector("#forgot-password");
const emailInput = document.querySelector("#email");
const status = document.querySelector("#password-reset-status");
const demoButton = document.querySelector("#demo-login");

let googleButton = document.querySelector("#google-login");
if (!googleButton && demoButton) {
  googleButton = document.createElement("button");
  googleButton.id = "google-login";
  googleButton.className = "btn btn-ghost btn-wide";
  googleButton.type = "button";
  googleButton.textContent = "Logg inn med Google";
  demoButton.before(googleButton);
}

function showStatus(message, isError = false) {
  if (!status) return;
  status.textContent = message;
  status.hidden = false;
  status.style.color = isError ? "#a33232" : "";
}

function resetErrorMessage(code = "") {
  if (code.includes("invalid-email")) return "Skriv inn ei gyldig e-postadresse først.";
  if (code.includes("too-many-requests")) return "For mange forsøk. Vent litt før du prøver igjen.";
  if (code.includes("network-request-failed")) return "Kunne ikkje kontakte Firebase. Kontroller nettet og prøv igjen.";
  return "Kunne ikkje sende e-post for nytt passord. Prøv igjen.";
}

function googleErrorMessage(code = "") {
  if (code.includes("popup-closed-by-user")) return "Google-innlogginga vart avbroten. Prøv igjen.";
  if (code.includes("cancelled-popup-request")) return "Google-innlogginga vart avbroten. Prøv igjen.";
  if (code.includes("unauthorized-domain")) return "Dette domenet er ikkje godkjent for Google-innlogging i Firebase. Legg coachfroden.github.io til under Authentication → Settings → Authorized domains.";
  if (code.includes("operation-not-allowed")) return "Google-innlogging er ikkje slått på i Firebase Authentication.";
  if (code.includes("network-request-failed")) return "Kunne ikkje kontakte Google/Firebase. Kontroller nettet og prøv igjen.";
  if (code.includes("account-exists-with-different-credential")) return "Denne e-postadressa er knytt til ein annan innloggingsmetode i Firebase.";
  return `Google-innlogginga mislukkast${code ? ` (${code})` : ""}.`;
}

async function getAuthService() {
  const [appModule, authModule] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js")
  ]);

  const app = appModule.getApps().length
    ? appModule.getApp()
    : appModule.initializeApp(firebaseConfig);

  return { auth: authModule.getAuth(app), authModule };
}

const authServicePromise = getAuthService();

button?.addEventListener("click", async () => {
  const email = emailInput?.value.trim() || "";
  if (!email) {
    emailInput?.focus();
    showStatus("Skriv inn e-postadressa di først.", true);
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Sender …";
  showStatus("Sender lenke for nytt passord …");

  try {
    const { auth, authModule } = await authServicePromise;
    await authModule.sendPasswordResetEmail(auth, email);
    showStatus("Viss e-postadressa er registrert, får du straks ein e-post med lenke for å lage nytt passord. Sjekk også søppelpost.");
  } catch (error) {
    console.error("Password reset failed", error);
    showStatus(resetErrorMessage(error?.code), true);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

googleButton?.addEventListener("click", async () => {
  const originalText = googleButton.textContent;
  googleButton.disabled = true;
  googleButton.textContent = "Opnar Google …";
  showStatus("Vel Google-kontoen du bruker for SSML.");

  try {
    const { auth, authModule } = await authServicePromise;
    const provider = new authModule.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    try {
      await authModule.signInWithPopup(auth, provider);
    } catch (error) {
      const code = String(error?.code || "");
      if (code.includes("popup-blocked") || code.includes("operation-not-supported-in-this-environment")) {
        showStatus("Sender deg vidare til Google for innlogging …");
        await authModule.signInWithRedirect(auth, provider);
        return;
      }
      throw error;
    }
  } catch (error) {
    console.error("Google sign-in failed", error);
    showStatus(googleErrorMessage(error?.code), true);
  } finally {
    googleButton.disabled = false;
    googleButton.textContent = originalText;
  }
});

import("./ui-enhancements.js?v=2").catch(error => console.error("Kunne ikkje laste UI-forbetringar", error));
import("./home-hero.js?v=4").catch(error => console.error("Kunne ikkje laste ny forside", error));
import("./compact-song-list.js?v=1").catch(error => console.error("Kunne ikkje laste kompakt songliste", error));
import("./homepage-profile-fixes.js?v=2").catch(error => console.error("Kunne ikkje laste hero-/kontaktforbetringar", error));
import("./contacts-ui-polish.js?v=1").catch(error => console.error("Kunne ikkje laste kontaktgrensesnitt", error));
import("./mobile-viewport-fix.js?v=1").catch(error => console.error("Kunne ikkje laste mobilfiks", error));
import("./print-selected-mobile-fix.js?v=1").catch(error => console.error("Kunne ikkje laste utskriftsfiks", error));

const songDetailStyles = document.createElement("link");
songDetailStyles.rel = "stylesheet";
songDetailStyles.href = "./song-detail-polish.css?v=1";
songDetailStyles.dataset.ssmlSongDetail = "true";
document.head.append(songDetailStyles);

const appShell = document.querySelector("#app-shell");
function syncBottomNavVisibility() {
  const nav = document.querySelector(".ssml-bottom-nav");
  if (!nav || !appShell) return;
  nav.hidden = appShell.classList.contains("hidden");
}
if (appShell) {
  const observer = new MutationObserver(syncBottomNavVisibility);
  observer.observe(appShell, { attributes: true, attributeFilter: ["class"] });
  const navObserver = new MutationObserver(syncBottomNavVisibility);
  navObserver.observe(document.body, { childList: true });
  syncBottomNavVisibility();
}
