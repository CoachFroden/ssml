import { firebaseConfig } from "./firebase-core.js?v=26";

const button = document.querySelector("#forgot-password");
const emailInput = document.querySelector("#email");
const status = document.querySelector("#password-reset-status");

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
    const { auth, authModule } = await getAuthService();
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
