import path from "node:path";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".log", ".srt", ".vtt", ".rtf"]);
const HTML_EXT = new Set([".html", ".htm", ".xml"]);

/** Limpia el texto para que se lea bien en voz alta. */
export function cleanText(raw) {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/­/g, "") // guiones blandos
    .replace(/(\w)-\n(\w)/g, "$1$2") // palabras cortadas por fin de línea
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtml(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Extrae el texto de un PDF con pdf.js (maneja PDFs de casi cualquier generador). */
async function pdfToText(buffer) {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  const pages = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let out = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        out += item.str;
        if (item.hasEOL) out += "\n";
      }
      pages.push(out);
    }
  } finally {
    await doc.destroy();
  }
  return { text: pages.join("\n\n"), numpages: pages.length };
}

/**
 * Extrae texto de un archivo subido.
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {string} [mimetype]
 */
export async function extractText(buffer, filename, mimetype = "") {
  const ext = path.extname(filename || "").toLowerCase();

  if (ext === ".pdf" || mimetype === "application/pdf") {
    let data;
    try {
      data = await pdfToText(buffer);
    } catch (err) {
      if (err?.name === "PasswordException") throw new Error("El PDF está protegido con contraseña.");
      throw new Error("No pude leer este PDF (puede estar dañado). Probá abrirlo y guardarlo de nuevo.");
    }
    const text = cleanText(data.text || "");
    if (!text) {
      throw new Error(
        "Este PDF no tiene texto seleccionable (parece un escaneo / imagen). Hace falta OCR para leerlo."
      );
    }
    return { text, pages: data.numpages, kind: "pdf" };
  }

  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: cleanText(value), kind: "docx" };
  }

  if (ext === ".doc") {
    throw new Error("El formato .doc viejo no está soportado. Guardalo como .docx o PDF y probá de nuevo.");
  }

  if (HTML_EXT.has(ext) || mimetype.includes("html")) {
    return { text: cleanText(stripHtml(buffer.toString("utf8"))), kind: "html" };
  }

  if (TEXT_EXT.has(ext) || mimetype.startsWith("text/") || !ext) {
    return { text: cleanText(buffer.toString("utf8")), kind: "texto" };
  }

  throw new Error(`Formato "${ext}" no soportado. Probá con PDF, DOCX, TXT, MD o HTML.`);
}

/**
 * Parte el texto en trozos "leíbles" (oraciones agrupadas) para hablarlos de a uno.
 * Cada trozo mantiene su posición en el texto original para poder resaltarlo.
 */
export function splitIntoChunks(text, maxLen = 300) {
  const chunks = [];
  // Primero por párrafos, después por oraciones
  // Ojo: no excluir ¡ ni ¿ del cuerpo de la oración, o se pierden al partir
  const sentenceRe = /[^.!?…\n]+[.!?…]+["')\]»”]*|[^.!?…\n]+$/g;
  let cursor = 0;

  const paragraphs = text.split(/\n{2,}/);
  for (const para of paragraphs) {
    const pStart = text.indexOf(para, cursor);
    cursor = pStart + para.length;
    const flat = para.replace(/\n/g, " ");
    const sentences = flat.match(sentenceRe) || [flat];

    let buf = "";
    for (const s of sentences) {
      const sentence = s.trim();
      if (!sentence) continue;
      if (sentence.length > maxLen) {
        if (buf) {
          chunks.push(buf);
          buf = "";
        }
        // Oración gigante: cortar por comas / espacios
        let rest = sentence;
        while (rest.length > maxLen) {
          let cut = rest.lastIndexOf(",", maxLen);
          if (cut < maxLen * 0.4) cut = rest.lastIndexOf(" ", maxLen);
          if (cut <= 0) cut = maxLen;
          chunks.push(rest.slice(0, cut + 1).trim());
          rest = rest.slice(cut + 1);
        }
        if (rest.trim()) buf = rest.trim();
        continue;
      }
      if ((buf + " " + sentence).trim().length > maxLen) {
        chunks.push(buf);
        buf = sentence;
      } else {
        buf = (buf + " " + sentence).trim();
      }
    }
    if (buf) chunks.push(buf);
  }
  return chunks.filter(Boolean);
}
