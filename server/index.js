import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { extractText, splitIntoChunks, cleanText } from "./extract.js";
import { synthesize, activeProvider, VOICES, DEFAULT_VOICE } from "./tts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mini loader de .env (sin dependencias): KEY=valor, ignora comentarios
try {
  const envText = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* sin .env: ok */
}

const PORT = process.env.PORT || 3001;
const MAX_FILE_MB = 25;

const app = express();
app.use(express.json({ limit: "5mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
});

app.set("trust proxy", 1); // detrás del proxy del hosting, para ver la IP real

const ACCESS_CODE = process.env.ACCESS_CODE || "";
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const codeOk = (given) => !ACCESS_CODE || crypto.timingSafeEqual(sha(given), sha(ACCESS_CODE));

/** Límite simple por IP, en memoria: `max` pedidos cada `windowMs`. */
function limit(max, windowMs = 60_000) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, arr] of hits) {
      const fresh = arr.filter((t) => now - t < windowMs);
      if (fresh.length) hits.set(ip, fresh);
      else hits.delete(ip);
    }
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const arr = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: "Demasiados pedidos seguidos. Esperá un minuto y probá de nuevo." });
    }
    arr.push(now);
    hits.set(req.ip, arr);
    next();
  };
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Estas dos rutas son públicas: el front necesita saber si pedir código y validarlo
app.get("/api/config", (_req, res) => res.json({ needsCode: Boolean(ACCESS_CODE) }));
app.post("/api/auth", limit(10), (req, res) => {
  if (codeOk(req.body?.code ?? "")) return res.json({ ok: true });
  res.status(401).json({ error: "Código incorrecto." });
});

// Desde acá, todo /api exige el código (solo si ACCESS_CODE está configurado)
app.use("/api", (req, res, next) => {
  if (codeOk(req.get("x-access-code") ?? "")) return next();
  res.status(401).json({ error: "Falta el código de acceso.", auth: true });
});

app.get("/api/voices", (_req, res) => res.json({ voices: VOICES, default: DEFAULT_VOICE }));

/** Subís un archivo -> devuelve el texto limpio + los trozos para leer. */
app.post("/api/extract", limit(30), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No llegó ningún archivo." });
    const name = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const { text, pages, kind } = await extractText(req.file.buffer, name, req.file.mimetype);
    if (!text) return res.status(422).json({ error: "No encontré texto en el archivo." });
    res.json({ name, kind, pages: pages ?? null, text, chunks: splitIntoChunks(text) });
  } catch (err) {
    console.error("[extract]", err);
    res.status(422).json({ error: err.message || "No pude leer el archivo." });
  }
});

/** Texto pegado -> trozos para leer. */
app.post("/api/chunks", limit(60), (req, res) => {
  const text = cleanText(String(req.body?.text || ""));
  if (!text) return res.status(400).json({ error: "El texto está vacío." });
  res.json({ text, chunks: splitIntoChunks(text) });
});

/** Un trozo de texto -> audio MP3 con voz neuronal. */
app.post("/api/tts", limit(240), async (req, res) => {
  try {
    const { text, voice, rate } = req.body || {};
    const audio = await synthesize(text, voice, rate);
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": audio.length,
      "Cache-Control": "private, max-age=3600",
    });
    res.send(audio);
  } catch (err) {
    console.error("[tts]", err.message);
    res.status(502).json({ error: err.message || "Falló la síntesis de voz." });
  }
});

// Producción: servir el build del cliente
const dist = path.join(__dirname, "..", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `El archivo supera los ${MAX_FILE_MB} MB.` });
  }
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor." });
});

app.listen(PORT, () =>
  console.log(
    `🔊 Lector IA backend en http://localhost:${PORT}  (voz: ${activeProvider()}, código de acceso: ${ACCESS_CODE ? "sí" : "no"})`
  )
);
