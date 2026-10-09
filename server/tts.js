import crypto from "node:crypto";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

/** Voces neuronales en español (Microsoft Edge Read Aloud). */
export const VOICES = [
  { id: "es-AR-ElenaNeural", label: "Elena · Argentina (mujer)", locale: "es-AR" },
  { id: "es-AR-TomasNeural", label: "Tomás · Argentina (hombre)", locale: "es-AR" },
  { id: "es-ES-ElviraNeural", label: "Elvira · España (mujer)", locale: "es-ES" },
  { id: "es-ES-AlvaroNeural", label: "Álvaro · España (hombre)", locale: "es-ES" },
  { id: "es-MX-DaliaNeural", label: "Dalia · México (mujer)", locale: "es-MX" },
  { id: "es-MX-JorgeNeural", label: "Jorge · México (hombre)", locale: "es-MX" },
  { id: "es-US-PalomaNeural", label: "Paloma · EE.UU. (mujer)", locale: "es-US" },
  { id: "es-CO-SalomeNeural", label: "Salomé · Colombia (mujer)", locale: "es-CO" },
  { id: "en-US-AriaNeural", label: "Aria · English US (female)", locale: "en-US" },
  { id: "en-GB-RyanNeural", label: "Ryan · English UK (male)", locale: "en-GB" },
];

export const DEFAULT_VOICE = "es-AR-ElenaNeural";
const VOICE_IDS = new Set(VOICES.map((v) => v.id));

const MAX_CHARS = 1200; // por pedido; el cliente manda trozos más chicos
const CACHE_MAX = 200;
const cache = new Map(); // key -> Buffer (LRU simple)

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** multiplicador (0.5–2) -> porcentaje relativo SSML ("+25%", "-20%") */
function rateToPercent(rate) {
  const r = Math.min(2, Math.max(0.5, Number(rate) || 1));
  const pct = Math.round((r - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    const parts = [];
    const timer = setTimeout(() => {
      stream.destroy(new Error("Timeout esperando el audio de la voz neuronal."));
    }, 30000);
    stream.on("data", (d) => parts.push(Buffer.from(d)));
    stream.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    stream.on("close", () => {
      clearTimeout(timer);
      const buf = Buffer.concat(parts);
      if (!buf.length) reject(new Error("La voz neuronal devolvió audio vacío."));
      else resolve(buf);
    });
  });
}

/**
 * Proveedor de voz:
 *  - "azure": API oficial Azure Speech (si hay AZURE_SPEECH_KEY y AZURE_SPEECH_REGION en .env)
 *  - "edge":  endpoint "Read Aloud" de Microsoft Edge vía msedge-tts (gratis, sin clave, no oficial)
 */
export function activeProvider() {
  return process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION ? "azure" : "edge";
}

async function synthAzure(text, voice) {
  const lang = voice.split("-").slice(0, 2).join("-");
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">` +
    `<voice name="${voice}">${escapeXml(text)}</voice></speak>`;
  const res = await fetch(`https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
      "User-Agent": "lector-ia",
    },
    body: ssml,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`Azure Speech respondió ${res.status}. Revisá AZURE_SPEECH_KEY y AZURE_SPEECH_REGION.`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Crea una conexión nueva por pedido: más robusto que compartir un socket. */
async function synthEdge(text, voice, rateStr) {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(text), { rate: rateStr });
    return await collect(audioStream);
  } finally {
    try {
      tts.close();
    } catch {
      /* noop */
    }
  }
}

/** Sintetiza `text` y devuelve un Buffer MP3. */
export async function synthesize(text, voice = DEFAULT_VOICE, rate = 1) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Texto vacío.");
  if (clean.length > MAX_CHARS) throw new Error(`Trozo demasiado largo (máx ${MAX_CHARS} caracteres).`);
  if (!VOICE_IDS.has(voice)) voice = DEFAULT_VOICE;

  const rateStr = rateToPercent(rate);
  const key = crypto.createHash("sha1").update(`${voice}|${rateStr}|${clean}`).digest("hex");
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit); // refresca LRU
    return hit;
  }

  const audio =
    activeProvider() === "azure" ? await synthAzure(clean, voice) : await synthEdge(clean, voice, rateStr);
  cache.set(key, audio);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return audio;
}
