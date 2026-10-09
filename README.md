# 🔊 Lector IA

Pasale cualquier texto —pegado, PDF, DOCX, TXT, MD, HTML, subtítulos— y te lo lee en voz alta con una **voz neuronal** en español (por defecto, Elena de Argentina).

## Qué hace

- **Entrada**: pegar texto o subir/arrastrar un archivo (hasta 25 MB).
- **Lectura**: la app parte el texto en fragmentos, los va sintetizando de a uno (y pre-carga los próximos), y **resalta lo que está leyendo**. Click en cualquier párrafo para leer desde ahí.
- **Controles**: play/pausa (barra espaciadora), anterior/siguiente, velocidad 0.75×–2×, 10 voces (es-AR, es-ES, es-MX, es-US, es-CO + 2 en inglés).
- **Descargar MP3** de todo el texto.
- **Respaldo**: si la voz neuronal no responde, usa la voz de tu navegador y te avisa.
- **Recuerda dónde quedaste**: si cerrás o recargás la página, vuelve al último texto y fragmento.
- **Tamaño de letra** ajustable (A− / A+).
- **Celular**: controles de play/pausa/siguiente en la pantalla bloqueada (si el navegador lo soporta).
- **Código de acceso** opcional para que solo entre quien vos quieras.

## Cómo correrlo

Requiere Node 18+ (probado en Node 22).

```bash
npm install
npm run dev          # backend en :3001 + frontend en http://localhost:5173
```

Producción (todo desde un solo puerto):

```bash
npm run build
npm start            # http://localhost:3001
```

## ⚠️ Probá la voz primero

```bash
npm run test:voice
```

Genera `prueba-voz.mp3`. Si dice ✅, abrilo y escuchá.

Por defecto la voz usa el endpoint "Read Aloud" de Microsoft Edge (gratis, sin clave) a través de `msedge-tts`. **Es un endpoint no oficial**: Microsoft puede cambiarlo o bloquearlo sin aviso. Para algo estable, usá la API oficial **Azure Speech** (tier gratis de ~500.000 caracteres/mes):

1. Creá un recurso *Speech* en Azure y copiá la clave y la región.
2. `cp .env.example .env` y completá `AZURE_SPEECH_KEY` y `AZURE_SPEECH_REGION`.
3. Reiniciá. El log del backend dice `(voz: azure)`.

Las mismas voces (`es-AR-ElenaNeural`, etc.) funcionan en ambos proveedores.

## Publicarla para compartirla

Necesita un servidor Node: no sirve hosting estático (GitHub Pages, Netlify sin funciones), porque es el backend el que genera la voz.

**Antes de publicar, definí un `ACCESS_CODE`.** Sin eso, cualquiera que tenga el link puede usar tu voz (y tu cuota de Azure).

### Opción A — Render (permanente y gratis)

1. Subí el proyecto a un repo de GitHub (puede ser privado). `.env` y los `.mp3` ya están ignorados, no se suben.
   ```bash
   git init
   git add .
   git commit -m "Lector IA"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/lector-ia.git
   git push -u origin main
   ```
2. En [render.com](https://render.com): **New → Web Service** → conectá el repo.
3. Configuración:
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance type**: Free
4. En **Environment Variables** cargá:
   - `ACCESS_CODE` = el código que quieras (compartilo solo con tu novia)
   - `NODE_VERSION` = `22`
   - Si la voz falla desde el servidor (ver abajo): `AZURE_SPEECH_KEY` y `AZURE_SPEECH_REGION`
5. **Deploy**. Render te da una URL tipo `https://lector-ia.onrender.com`. Mandale ese link y el código.

Cosas del plan gratis de Render: el servicio se duerme tras 15 minutos sin uso y al volver tarda cerca de un minuto en despertar; hay 750 horas gratis por mes. Estos datos pueden cambiar, revisalos en render.com/free.

### Opción B — Hoy mismo, desde tu compu

Sirve para probar con ella ya, pero tu compu tiene que estar prendida.

```bash
npm run build
ACCESS_CODE=elcodigo npm start          # en Windows PowerShell: $env:ACCESS_CODE="elcodigo"; npm start
cloudflared tunnel --url http://localhost:3001
```

`cloudflared` (Cloudflare Tunnel) imprime un link público temporal que cambia cada vez que lo abrís. La voz sale desde tu casa, donde ya sabés que funciona.

### Voz oficial con Azure Speech

La voz gratis de Edge no es oficial y limita pedidos por IP; en un servidor, todos los pedidos salen de la misma IP, así que puede fallar. **Probala apenas publiques**: si aparece el aviso amarillo "Usando la voz de tu navegador", usá Azure.

1. En [portal.azure.com](https://portal.azure.com) creá un recurso **Speech** con el plan **Free (F0)**: 500.000 caracteres gratis por mes. Azure puede pedirte una tarjeta para verificar la cuenta.
2. En **Keys and Endpoint** copiá **KEY 1** y la **Region** (ej. `eastus`).
3. Cargalas como `AZURE_SPEECH_KEY` y `AZURE_SPEECH_REGION` (en Render: Environment → guardar → redeploy).

## Estructura

```
server/
  index.js     API Express: /api/extract, /api/chunks, /api/tts, /api/voices
  extract.js   Lectura de PDF (pdf.js), DOCX (mammoth), TXT/HTML + partición en fragmentos
  tts.js       Síntesis de voz (Edge o Azure) con caché en memoria
src/
  App.jsx      UI y reproductor (cola, prefetch, resaltado, fallback)
  styles.css
scripts/
  test-voice.js
```

## Límites conocidos

- **PDFs escaneados** (solo imagen) no tienen texto: la app lo avisa. Haría falta OCR.
- **.doc viejo** no está soportado: guardalo como .docx o PDF.
- El texto de PDFs con columnas múltiples puede leerse en el orden en que el PDF lo guarda.
- Los fragmentos se sintetizan al vuelo: textos muy largos tardan unos segundos solo al empezar.
- El caché de audio vive en memoria y se pierde al reiniciar el backend.

## Ideas para seguir

OCR para escaneos (Tesseract), resumen previo con un LLM, marcador de "dónde me quedé" por documento, instalarlo como PWA.
