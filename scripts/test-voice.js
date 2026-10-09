// Prueba rápida de la voz: genera un MP3 corto y te dice si funciona.
// Uso:  npm run test:voice
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { synthesize, activeProvider } from "../server/tts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  const envText = fs.readFileSync(path.join(here, "..", ".env"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* sin .env */
}

console.log(`Proveedor de voz: ${activeProvider()}`);
try {
  const mp3 = await synthesize("Hola, soy tu lector. Si me escuchás bien, todo está funcionando.", "es-AR-ElenaNeural", 1);
  const out = path.join(here, "..", "prueba-voz.mp3");
  fs.writeFileSync(out, mp3);
  console.log(`✅ Funciona. Se generó ${out} (${(mp3.length / 1024).toFixed(1)} KB). Abrilo para escucharlo.`);
} catch (e) {
  console.error(`❌ Falló la voz neuronal: ${e.message}`);
  console.error("   Probá con otra red/VPN, o configurá Azure Speech en .env (ver README). La app igual usa la voz del navegador como respaldo.");
  process.exit(1);
}
