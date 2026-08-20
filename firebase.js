import * as core from "./firebase-core.js?v=24";

export * from "./firebase-core.js?v=24";

function isAiJsonSyntaxError(error) {
  const message = String(error?.message || error || "");
  return error instanceof SyntaxError || /JSON|double-quoted property name|Unexpected token|Expected property name/i.test(message);
}

async function withAiJsonRetry(operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isAiJsonSyntaxError(error)) throw error;
    console.warn("AI returnerte ugyldig JSON. Prøver analysen éin gong til.", error);
    await new Promise(resolve => setTimeout(resolve, 300));
    try {
      return await operation();
    } catch (retryError) {
      if (!isAiJsonSyntaxError(retryError)) throw retryError;
      const finalError = new Error("AI svarte med ugyldig dataformat to gonger. Prøv analysen på nytt.");
      finalError.cause = retryError;
      throw finalError;
    }
  }
}

export async function analyzeSongPdf(...args) {
  return withAiJsonRetry(() => core.analyzeSongPdf(...args));
}

export async function analyzeNewInstrumentPdf(...args) {
  return withAiJsonRetry(() => core.analyzeNewInstrumentPdf(...args));
}
