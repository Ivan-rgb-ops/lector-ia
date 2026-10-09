import { useCallback, useEffect, useRef, useState } from "react";

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv,.srt,.vtt,.json,.log";
const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const CACHE_LIMIT = 60;

const ls = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* noop */
    }
  },
};

const I = {
  play: <path d="M8 5v14l11-7z" />,
  pause: <path d="M7 5h4v14H7zM13 5h4v14h-4z" />,
  prev: <path d="M6 6h2v12H6zM20 6v12L9.5 12z" />,
  next: <path d="M16 6h2v12h-2zM4 6l10.5 6L4 18z" />,
  upload: <path d="M12 3l5 5h-3v6h-4V8H7l5-5zM5 18h14v3H5z" />,
  download: <path d="M10 3h4v6h3l-5 5-5-5h3zM5 18h14v3H5z" />,
};
const Icon = ({ name, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {I[name]}
  </svg>
);

// Código de acceso (solo si el servidor lo exige) + texto guardado de la última vez
let accessCode = ls.get("code", "");
let onAuthLost = () => {};
const SAVED = ls.get("last", null);
const SAVED_IDX = ls.get("lastIdx", 0);

function apiFetch(url, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (accessCode) headers["x-access-code"] = accessCode;
  return fetch(url, { ...init, headers }).then((res) => {
    if (res.status === 401) onAuthLost();
    return res;
  });
}

async function fetchAudioBlob(text, voice) {
  const res = await apiFetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, rate: 1 }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Error ${res.status}`);
  }
  return res.blob();
}

export default function App() {
  const [tab, setTab] = useState("paste");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const [title, setTitle] = useState(SAVED?.title || "");
  const [chunks, setChunks] = useState(SAVED?.chunks || []);
  const [idx, setIdx] = useState(
    SAVED?.chunks?.length ? Math.min(Math.max(0, Number(SAVED_IDX) || 0), SAVED.chunks.length - 1) : 0
  );
  const [status, setStatus] = useState("idle"); // idle | loading | playing | paused

  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState(() => ls.get("voice", "es-AR-ElenaNeural"));
  const [rate, setRate] = useState(() => ls.get("rate", 1));
  const [dl, setDl] = useState(null); // { done, total } | null
  const [auth, setAuth] = useState("checking"); // checking | needed | ok
  const [codeInput, setCodeInput] = useState("");
  const [fs, setFs] = useState(() => ls.get("fs", 1.12)); // tamaño de letra (rem)

  const audioRef = useRef(null);
  const cacheRef = useRef(new Map()); // `${voice}|${text}` -> Promise<Blob>
  const tokenRef = useRef(0);
  const modeRef = useRef("audio"); // audio | speech
  const urlRef = useRef(null);
  const chunksRef = useRef([]);
  const idxRef = useRef(0);
  const voiceRef = useRef(voice);
  const rateRef = useRef(rate);
  const itemRefs = useRef([]);

  chunksRef.current = chunks;
  idxRef.current = idx;
  voiceRef.current = voice;
  rateRef.current = rate;

  // 1) ¿El servidor pide código de acceso?
  useEffect(() => {
    onAuthLost = () => {
      accessCode = "";
      ls.set("code", "");
      setAuth("needed");
    };
    fetch("/api/config")
      .then((r) => r.json())
      .then(async (j) => {
        if (!j.needsCode) return setAuth("ok");
        if (!accessCode) return setAuth("needed");
        const r = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: accessCode }),
        });
        setAuth(r.ok ? "ok" : "needed");
      })
      .catch(() => {
        setAuth("ok");
        setError("No pude conectar con el servidor. ¿Está corriendo? Si recién lo abriste, esperá un minuto y recargá.");
      });
  }, []);

  // 2) Voces disponibles (una vez dentro)
  useEffect(() => {
    if (auth !== "ok") return;
    apiFetch("/api/voices")
      .then((r) => r.json())
      .then((j) => {
        setVoices(j.voices || []);
        if (!(j.voices || []).some((v) => v.id === ls.get("voice", j.default))) setVoice(j.default);
      })
      .catch(() => setError("No pude conectar con el servidor."));
  }, [auth]);

  async function submitCode(e) {
    e.preventDefault();
    setError("");
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeInput }),
      });
      if (r.status === 429) throw new Error("Demasiados intentos. Esperá un minuto.");
      if (!r.ok) throw new Error("Código incorrecto.");
      accessCode = codeInput;
      ls.set("code", codeInput);
      setCodeInput("");
      setAuth("ok");
    } catch (err) {
      setError(err.message || "No pude verificar el código.");
    }
  }

  useEffect(() => ls.set("voice", voice), [voice]);
  useEffect(() => ls.set("fs", fs), [fs]);
  // Recordar el último texto y en qué fragmento ibas (sobrevive a recargar la página)
  useEffect(() => {
    if (chunks.length) ls.set("last", { title, chunks });
  }, [title, chunks]);
  useEffect(() => ls.set("lastIdx", idx), [idx]);
  useEffect(() => {
    ls.set("rate", rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    itemRefs.current[idx]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [idx]);

  const getBlob = useCallback((text) => {
    const key = `${voiceRef.current}|${text}`;
    const cache = cacheRef.current;
    if (!cache.has(key)) {
      const p = fetchAudioBlob(text, voiceRef.current).catch((e) => {
        cache.delete(key);
        throw e;
      });
      cache.set(key, p);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  }, []);

  const prefetch = useCallback(
    (i) => {
      const t = chunksRef.current[i];
      if (t) getBlob(t).catch(() => {});
    },
    [getBlob]
  );

  const stopAll = useCallback(() => {
    tokenRef.current++;
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    window.speechSynthesis?.cancel();
  }, []);

  const speakFallback = useCallback((i, token) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      setStatus("idle");
      setError("La voz neuronal no está disponible y tu navegador no tiene voz de respaldo.");
      return;
    }
    modeRef.current = "speech";
    setNotice("Usando la voz de tu navegador (la voz neuronal no respondió).");
    const u = new SpeechSynthesisUtterance(chunksRef.current[i]);
    const loc = voiceRef.current.split("-").slice(0, 2).join("-");
    u.lang = loc;
    u.rate = rateRef.current;
    const match = synth.getVoices().find((v) => v.lang.replace("_", "-").startsWith(loc));
    if (match) u.voice = match;
    u.onend = () => {
      if (token !== tokenRef.current) return;
      if (i + 1 < chunksRef.current.length) playFrom(i + 1);
      else {
        setStatus("idle");
      }
    };
    u.onerror = () => {
      if (token === tokenRef.current) setStatus("idle");
    };
    synth.speak(u);
    setStatus("playing");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playFrom = useCallback(
    async (i) => {
      const list = chunksRef.current;
      if (!list.length || i < 0 || i >= list.length) return;
      stopAll();
      const token = ++tokenRef.current;
      setIdx(i);
      setStatus("loading");
      setError("");
      try {
        const blob = await getBlob(list[i]);
        if (token !== tokenRef.current) return;
        const a = audioRef.current;
        const url = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        modeRef.current = "audio";
        setNotice("");
        a.src = url;
        a.playbackRate = rateRef.current;
        await a.play();
        if (token !== tokenRef.current) return;
        setStatus("playing");
        prefetch(i + 1);
        prefetch(i + 2);
      } catch (e) {
        if (token !== tokenRef.current) return;
        speakFallback(i, token);
      }
    },
    [getBlob, prefetch, speakFallback, stopAll]
  );

  const onEnded = useCallback(() => {
    const next = idxRef.current + 1;
    if (next < chunksRef.current.length) playFrom(next);
    else setStatus("idle");
  }, [playFrom]);

  const toggle = useCallback(() => {
    if (!chunksRef.current.length) return;
    if (status === "playing") {
      if (modeRef.current === "speech") window.speechSynthesis.pause();
      else audioRef.current.pause();
      setStatus("paused");
    } else if (status === "paused") {
      if (modeRef.current === "speech") window.speechSynthesis.resume();
      else audioRef.current.play();
      setStatus("playing");
    } else if (status === "idle") {
      const atEnd = idxRef.current >= chunksRef.current.length - 1 && idxRef.current > 0;
      playFrom(atEnd ? 0 : idxRef.current);
    }
  }, [status, playFrom]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (e.code === "Space" && tag !== "TEXTAREA" && tag !== "INPUT" && tag !== "SELECT" && tag !== "BUTTON") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Controles en la pantalla bloqueada / notificación del celular
  useEffect(() => {
    if (!("mediaSession" in navigator) || !chunks.length) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || "Lectura",
        artist: `Fragmento ${idx + 1} de ${chunks.length}`,
        album: "Lector IA",
      });
      const handlers = {
        play: toggle,
        pause: toggle,
        previoustrack: () => playFrom(Math.max(0, idx - 1)),
        nexttrack: () => playFrom(Math.min(chunks.length - 1, idx + 1)),
      };
      for (const [action, fn] of Object.entries(handlers)) navigator.mediaSession.setActionHandler(action, fn);
    } catch {
      /* navegador sin soporte completo: se ignora */
    }
  }, [title, idx, chunks.length, toggle, playFrom]);

  // Cambiar de voz mientras se reproduce: retomar el trozo actual con la voz nueva
  const firstVoiceRun = useRef(true);
  useEffect(() => {
    if (firstVoiceRun.current) {
      firstVoiceRun.current = false;
      return;
    }
    if (status === "playing" || status === "paused") playFrom(idxRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice]);

  useEffect(
    () => () => {
      stopAll();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [stopAll]
  );

  function load(newChunks, name) {
    stopAll();
    cacheRef.current.clear();
    setChunks(newChunks);
    chunksRef.current = newChunks;
    setTitle(name);
    setIdx(0);
    setStatus("idle");
    setNotice("");
    itemRefs.current = [];
    setTimeout(() => prefetch(0), 0);
  }

  async function submitText() {
    if (!pasted.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await apiFetch("/api/chunks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasted }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      load(j.chunks, "Texto pegado");
    } catch (e) {
      setError(e.message || "No pude procesar el texto.");
    } finally {
      setBusy(false);
    }
  }

  async function submitFile(file) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await apiFetch("/api/extract", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      load(j.chunks, `${j.name}${j.pages ? ` · ${j.pages} págs.` : ""}`);
    } catch (e) {
      setError(e.message || "No pude leer el archivo.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadAudio() {
    if (!chunks.length || dl) return;
    setDl({ done: 0, total: chunks.length });
    try {
      const parts = [];
      for (let i = 0; i < chunks.length; i++) {
        parts.push(await getBlob(chunks[i]));
        setDl({ done: i + 1, total: chunks.length });
      }
      const url = URL.createObjectURL(new Blob(parts, { type: "audio/mpeg" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(title || "lectura").replace(/[^\w\-. ]+/g, "").trim() || "lectura"}.mp3`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError(`No pude generar el MP3: ${e.message}`);
    } finally {
      setDl(null);
    }
  }

  if (auth === "checking") return <div className="app" />;

  if (auth === "needed") {
    return (
      <div className="app gate-wrap">
        <form className="card gate" onSubmit={submitCode}>
          <div className="logo" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 64 64">
              <path d="M18 26v12h8l10 8V18l-10 8z" fill="currentColor" />
              <path d="M42 24c4 4 4 12 0 16" stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round" />
            </svg>
          </div>
          <h1>Lector IA</h1>
          <p>Ingresá el código de acceso para empezar.</p>
          <input
            type="password"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="Código de acceso"
            autoComplete="current-password"
            autoFocus
          />
          <button className="primary" type="submit" disabled={!codeInput}>
            Entrar
          </button>
          {error && (
            <div className="msg err" role="alert">
              {error}
            </div>
          )}
        </form>
      </div>
    );
  }

  const playing = status === "playing";
  const progress = chunks.length ? ((idx + (status === "idle" && idx === 0 ? 0 : 1)) / chunks.length) * 100 : 0;

  return (
    <div className="app">
      <header className="top">
        <div className="logo" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 64 64">
            <path d="M18 26v12h8l10 8V18l-10 8z" fill="currentColor" />
            <path d="M42 24c4 4 4 12 0 16" stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <h1>Lector IA</h1>
          <p>Pasale cualquier texto o documento y te lo leo en voz alta.</p>
        </div>
      </header>

      <main>
        <section className="card input-card">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "paste"} className={tab === "paste" ? "on" : ""} onClick={() => setTab("paste")}>
              Pegar texto
            </button>
            <button role="tab" aria-selected={tab === "file"} className={tab === "file" ? "on" : ""} onClick={() => setTab("file")}>
              Subir archivo
            </button>
          </div>

          {tab === "paste" ? (
            <div className="pane">
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="Pegá acá lo que quieras que te lea…"
                rows={7}
              />
              <button className="primary" disabled={busy || !pasted.trim()} onClick={submitText}>
                {busy ? "Preparando…" : "Preparar lectura"}
              </button>
            </div>
          ) : (
            <div className="pane">
              <label
                className={`drop ${dragOver ? "over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  submitFile(e.dataTransfer.files?.[0]);
                }}
              >
                <Icon name="upload" size={30} />
                <strong>{busy ? "Leyendo el archivo…" : "Arrastrá un archivo o hacé click"}</strong>
                <span>PDF · DOCX · TXT · MD · HTML · SRT (hasta 25 MB)</span>
                <input type="file" accept={ACCEPT} hidden onChange={(e) => submitFile(e.target.files?.[0])} />
              </label>
            </div>
          )}

          {error && (
            <div className="msg err" role="alert">
              {error}
            </div>
          )}
        </section>

        {chunks.length > 0 && (
          <section className="card reader">
            <div className="reader-head">
              <h2>{title}</h2>
              <div className="fsz">
                <button aria-label="Letra más chica" onClick={() => setFs((v) => Math.max(0.9, +(v - 0.1).toFixed(2)))}>
                  A−
                </button>
                <button aria-label="Letra más grande" onClick={() => setFs((v) => Math.min(1.8, +(v + 0.1).toFixed(2)))}>
                  A+
                </button>
                <span>{chunks.length} fragmentos</span>
              </div>
            </div>
            <div className="text" style={{ "--fs": `${fs}rem` }}>
              {chunks.map((c, i) => (
                <p
                  key={i}
                  ref={(el) => (itemRefs.current[i] = el)}
                  className={i === idx && status !== "idle" ? "cur" : ""}
                  onClick={() => playFrom(i)}
                  title="Click para leer desde acá"
                >
                  {c}
                </p>
              ))}
            </div>
          </section>
        )}
      </main>

      {chunks.length > 0 && (
        <footer className="player">
          <div className="bar" aria-hidden="true">
            <div style={{ width: `${progress}%` }} />
          </div>
          <div className="row">
            <div className="ctrl">
              <button aria-label="Fragmento anterior" onClick={() => playFrom(Math.max(0, idx - 1))}>
                <Icon name="prev" />
              </button>
              <button className="play" aria-label={playing ? "Pausar" : "Reproducir"} onClick={toggle}>
                {status === "loading" ? <span className="spin" /> : <Icon name={playing ? "pause" : "play"} size={26} />}
              </button>
              <button aria-label="Fragmento siguiente" onClick={() => playFrom(Math.min(chunks.length - 1, idx + 1))}>
                <Icon name="next" />
              </button>
            </div>

            <div className="opts">
              <label>
                Voz
                <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Velocidad
                <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
                  {RATES.map((r) => (
                    <option key={r} value={r}>
                      {r}×
                    </option>
                  ))}
                </select>
              </label>
              <button className="ghost" onClick={downloadAudio} disabled={!!dl} title="Descargar todo como MP3">
                <Icon name="download" size={18} />
                {dl ? `${dl.done}/${dl.total}` : "MP3"}
              </button>
            </div>
          </div>
          {notice && <div className="msg warn">{notice}</div>}
        </footer>
      )}

      <audio ref={audioRef} onEnded={onEnded} preload="auto" />
    </div>
  );
}
