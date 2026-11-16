// Public demo (pii.newmean.ai, later also GitHub Pages and a Hugging Face Space): type or pick a sample, the page finds and
// masks personal information in the browser with @newmean-ai/pii. Icon-first, a few strings in eight languages (LANGS).
// Model files come from Hugging Face (the SDK default); index.html preloads the medium ones. Built by build.mjs next to this file.
import { createRedactor, DEFAULT_VARIANT, LABELS, LEVEL1_LABELS, MODEL_FILES, type EngineName, type Redactor, type Size, type Span } from "../src/index.js";
import { SAMPLES } from "./samples.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
declare const __VERSION__: string; // SDK version, set by build.mjs from package.json
const SIZES: Size[] = ["nano", "small", "medium", "large"];
// Hero facts. Languages and phone speed come from the technical report (docs/report/REPORT.md, Section 5 "On phones": medium,
// built-in engine, 40 tokens, mean of four phones); the size range is read from the SDK's model table, so it follows releases.
const LANGUAGES = 54;
const PHONE_MS = 26;
const MB = (b: number) => (b / 1e6).toFixed(1);

// ---- strings -------------------------------------------------------------------------------------------------------------

const KEYS = ["tagline", "local", "placeholder", "loading", "found", "none", "copy", "copied", "options", "sensitivity", "level2", "regex", "engine", "notReady", "masked", "marked", "star", "models", "bench", "starAsk", "starShort", "install", "factLang", "factSize", "factSpeed", "guide", "phones", "results"] as const;
type Key = (typeof KEYS)[number];
const LANGS: Record<string, [string, string[]]> = {
  en: ["English", ["Mask personal info in your browser.", "Your text never leaves your device. Only speed numbers are sent.", "Type or paste text…", "Loading model {n}%", "{n} found", "Nothing found", "Copy", "Copied", "Options", "Sensitivity", "Also mask indirect identifiers", "Pattern layer (IP, URL, …)", "Engine", "The demo opens with the release.", "Masked", "Found", "Star on GitHub", "Models", "Speed", "Useful? A GitHub star helps others find it.", "Star", "Install", "languages", "model size", "phone · 40 tokens", "Guide", "Phone speed", "Accuracy"]],
  ko: ["한국어", ["브라우저에서 개인정보를 가립니다.", "글은 기기 밖으로 나가지 않아요. 속도 숫자만 보내요.", "텍스트를 입력하거나 붙여 넣으세요…", "모델 불러오는 중 {n}%", "{n}개 찾음", "찾은 개인정보 없음", "복사", "복사됨", "설정", "민감도", "간접 식별자도 가리기", "패턴 층 (IP, URL 등)", "엔진", "데모는 출시와 함께 열립니다.", "가린 결과", "찾은 결과", "GitHub 스타", "모델", "속도 측정", "도움이 됐다면 GitHub 스타로 응원해 주세요.", "스타", "설치", "언어", "모델 크기", "폰 · 40토큰", "가이드", "폰 속도", "정확도"]],
  ja: ["日本語", ["ブラウザで個人情報を隠します。", "文章は端末の外に出ません。送るのは速度の数値だけです。", "テキストを入力または貼り付け…", "モデルを読み込み中 {n}%", "{n}件検出", "個人情報なし", "コピー", "コピーしました", "設定", "感度", "間接的な識別子も隠す", "パターン層 (IP、URL など)", "エンジン", "デモは公開時にご利用いただけます。", "マスク結果", "検出結果", "GitHubでスター", "モデル", "速度テスト", "役に立ったら GitHub のスターで応援してください。", "スター", "インストール", "言語", "モデルサイズ", "スマホ · 40トークン", "ガイド", "スマホの速度", "精度"]],
  zh: ["简体中文", ["在浏览器中遮盖个人信息。", "文字不会离开你的设备。只发送速度数据。", "输入或粘贴文本…", "正在加载模型 {n}%", "找到 {n} 处", "未发现个人信息", "复制", "已复制", "设置", "灵敏度", "同时遮盖间接标识", "模式层（IP、URL 等）", "引擎", "演示将在发布时开放。", "遮盖结果", "检测结果", "在 GitHub 上加星", "模型", "测速", "觉得有用？在 GitHub 上点个星吧。", "加星", "安装", "语言", "模型大小", "手机 · 40 个词元", "指南", "手机速度", "准确率"]],
  "zh-Hant": ["繁體中文", ["在瀏覽器中遮蔽個人資料。", "文字不會離開你的裝置，只會送出測速數據。", "輸入或貼上文字…", "正在載入模型 {n}%", "找到 {n} 處", "沒有找到個人資料", "複製", "已複製", "設定", "敏感度", "一併遮蔽間接識別資訊", "規則比對層（IP、URL 等）", "引擎", "示範網站將隨正式版一同開放。", "遮蔽結果", "偵測結果", "在 GitHub 按星星", "模型", "測速", "覺得有用嗎？在 GitHub 按個星星，能讓更多人找到它。", "按星星", "安裝", "種語言", "模型大小", "手機 · 40 個 token", "指南", "手機執行速度", "準確率"]],
  es: ["Español", ["Oculta tus datos personales.", "Tu texto nunca sale de tu dispositivo. Solo se envían datos de velocidad.", "Escribe o pega un texto…", "Cargando modelo {n}%", "{n} encontrados", "No se encontró nada", "Copiar", "Copiado", "Opciones", "Sensibilidad", "Ocultar también identificadores indirectos", "Capa de patrones (IP, URL, …)", "Motor", "La demo se abrirá con el lanzamiento.", "Ocultado", "Encontrado", "Estrella en GitHub", "Modelos", "Rapidez", "¿Te sirve? Una estrella en GitHub ayuda a que otros lo encuentren.", "Estrella", "Instalar", "idiomas", "tamaño del modelo", "móvil · 40 tokens", "Guía", "Velocidad en móvil", "Precisión"]],
  fr: ["Français", ["Masquez les données personnelles.", "Votre texte ne quitte jamais l'appareil. Seules des mesures de vitesse sont envoyées.", "Saisissez ou collez un texte…", "Chargement du modèle {n} %", "{n} trouvés", "Rien trouvé", "Copier", "Copié", "Options", "Sensibilité", "Masquer aussi les identifiants indirects", "Couche de motifs (IP, URL, …)", "Moteur", "La démo ouvrira avec la sortie.", "Masqué", "Trouvé", "Étoile sur GitHub", "Modèles", "Vitesse", "Utile ? Une étoile sur GitHub aide les autres à le trouver.", "Étoile", "Installer", "langues", "taille du modèle", "mobile · 40 jetons", "Guide", "Vitesse sur mobile", "Précision"]],
  de: ["Deutsch", ["Personendaten lokal schwärzen.", "Ihr Text verlässt nie Ihr Gerät. Gesendet werden nur Tempo-Messwerte.", "Text eingeben oder einfügen…", "Modell wird geladen {n} %", "{n} gefunden", "Nichts gefunden", "Kopieren", "Kopiert", "Optionen", "Empfindlichkeit", "Auch indirekte Merkmale schwärzen", "Musterebene (IP, URL, …)", "Engine", "Die Demo startet mit der Veröffentlichung.", "Geschwärzt", "Gefunden", "Stern auf GitHub", "Modelle", "Tempo", "Nützlich? Ein GitHub-Stern hilft anderen, es zu finden.", "Stern", "Installieren", "Sprachen", "Modellgröße", "Handy · 40 Tokens", "Anleitung", "Tempo auf dem Handy", "Genauigkeit"]],
  pt: ["Português", ["Oculte dados pessoais no navegador.", "Seu texto nunca sai do dispositivo. Só enviamos números de velocidade.", "Digite ou cole um texto…", "Carregando modelo {n}%", "{n} encontrados", "Nada encontrado", "Copiar", "Copiado", "Opções", "Sensibilidade", "Ocultar também identificadores indiretos", "Camada de padrões (IP, URL, …)", "Motor", "A demo abre com o lançamento.", "Ocultado", "Encontrado", "Estrela no GitHub", "Modelos", "Rapidez", "Foi útil? Uma estrela no GitHub ajuda outros a encontrar.", "Estrela", "Instalar", "idiomas", "tamanho do modelo", "celular · 40 tokens", "Guia", "Velocidade no celular", "Precisão"]],
};

function pickLang(): string {
  try {
    const saved = localStorage.getItem("pii-demo-lang");
    if (saved && LANGS[saved]) return saved;
  } catch {}
  for (const l of navigator.languages ?? [navigator.language]) {
    // Chinese in Traditional script (zh-Hant, or Taiwan, Hong Kong and Macau without a script subtag) gets the zh-Hant strings
    if (/^zh-(hant|tw|hk|mo)\b/i.test(l)) return "zh-Hant";
    const base = l.toLowerCase().split("-")[0];
    if (LANGS[base]) return base;
  }
  return "en";
}
let lang = pickLang();
const t = (k: Key, n?: number) => {
  const s = LANGS[lang][1][KEYS.indexOf(k)];
  return n === undefined ? s : s.replace("{n}", String(n));
};

function applyLang() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) el.textContent = t(el.dataset.i18n as Key);
  $<HTMLTextAreaElement>("input").placeholder = t("placeholder");
  showResult();
}

// ---- labels --------------------------------------------------------------------------------------------------------------

// label → [icon symbol, colour family]; level 2 labels share their family's look with a dashed edge
const LABEL_LOOK: Record<string, [string, string]> = {
  PERSON: ["l-person", "a"], PERSON_L2: ["l-person", "a"], EMAIL: ["l-mail", "b"], PHONE: ["l-phone", "b"], ADDRESS: ["l-pin", "c"],
  ID_NUMBER: ["l-id", "d"], FINANCIAL: ["l-card", "d"], ORG: ["l-org", "e"], USERNAME: ["l-at", "b"], URL: ["l-link", "e"],
  URL_L2: ["l-link", "e"], DATE_OF_BIRTH: ["l-cake", "c"], SECRET: ["l-key", "d"],
};
const icon = (id: string) => `<svg class="li" aria-hidden="true"><use href="#${id}"/></svg>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ---- speed numbers -------------------------------------------------------------------------------------------------------

// On pii.newmean.ai only: the model size, engine, time and token count of each run and model load, a coarse device class and
// whether the text was one of the samples, sent to /api/demo when the page is hidden. Never the text or what was found; the
// "local" line under the title says so.
const TELEMETRY = location.hostname === "pii.newmean.ai";
const session = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
type DemoEvent = { kind: "run" | "load"; size: Size; engine: EngineName; ms: number; tokens?: number; src?: "sample" | "own" };
let events: DemoEvent[] = [];
const record = (e: DemoEvent) => {
  if (TELEMETRY && events.length < 100) events.push({ ...e, ms: Math.round(e.ms) });
};

function device() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iOS"
    : /Android/.test(ua) ? "Android" : /CrOS/.test(ua) ? "ChromeOS" : /Mac OS X/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "other";
  const browser = /SamsungBrowser/.test(ua) ? "Samsung" : /Edg(e|A|iOS)?\//.test(ua) ? "Edge" : /Firefox|FxiOS/.test(ua) ? "Firefox"
    : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "other";
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0;
  return { os, browser, mobile: os === "iOS" || os === "Android", cores: navigator.hardwareConcurrency ?? 0, memory };
}

function flush() {
  if (!events.length) return;
  const body = JSON.stringify({ session, v: __VERSION__, lang, device: device(), events });
  events = [];
  try {
    navigator.sendBeacon("/api/demo", body);
  } catch {}
}

// ---- model ---------------------------------------------------------------------------------------------------------------

let size: Size = "medium";
let engine: EngineName = "builtin";
let redactor: Redactor | null = null;
let loadingKey = "";
let last: { text: string; spans: Span[]; masked: string; ms: number; tokens: number } | null = null;
let view: "marked" | "masked" = "marked";

async function ensureModel() {
  const key = `${size}/${engine}/${regexOn()}/${level2()}`;
  if (redactor && loadingKey === key) return redactor;
  loadingKey = key;
  const prev = redactor;
  redactor = null;
  await prev?.dispose();
  const total = MODEL_FILES[size][DEFAULT_VARIANT[size]].bytes + MODEL_FILES[size].tokenizer.bytes;
  const got: Record<string, number> = {};
  setLoading(0);
  const t0 = performance.now();
  const r = await createRedactor({
    size,
    engine,
    regex: regexOn(),
    labels: level2() ? LABELS : LEVEL1_LABELS,
    sensitivity: sensitivity(),
    wasmPaths: new URL("ort/", document.baseURI).href,
    onProgress: (p) => {
      got[p.file] = p.loaded;
      setLoading(Math.min(99, Math.round((100 * Object.values(got).reduce((a, b) => a + b, 0)) / total)));
    },
  });
  if (loadingKey !== key) {
    await r.dispose();
    return null;
  }
  redactor = r;
  record({ kind: "load", size, engine, ms: performance.now() - t0 });
  setLoading(null);
  return r;
}

const sensitivity = () => Number($<HTMLInputElement>("sens").value);
const level2 = () => $<HTMLInputElement>("l2").checked;
const regexOn = () => $<HTMLInputElement>("regex").checked;

function setLoading(pct: number | null) {
  const el = $("loading");
  el.hidden = pct === null;
  if (pct !== null) {
    $("load-label").textContent = t("loading", pct);
    $("load-bar").style.transform = `scaleX(${pct / 100})`;
  }
}

// ---- run -----------------------------------------------------------------------------------------------------------------

let seq = 0;
async function run() {
  const id = ++seq;
  const text = $<HTMLTextAreaElement>("input").value;
  let r: Redactor | null;
  try {
    r = await ensureModel();
  } catch (e) {
    setLoading(null);
    $("note").hidden = false;
    $("note").textContent = String((e as Error)?.message ?? e);
    return;
  }
  if (!r || id !== seq) return;
  r.setSensitivity(sensitivity());
  const t0 = performance.now();
  const { text: masked, spans } = await r.redact(text, { mode: $<HTMLSelectElement>("mode").value as "tag" | "mask" });
  if (id !== seq) return;
  last = { text, spans, masked, ms: performance.now() - t0, tokens: r.lastRun?.tokens ?? 0 };
  if (text.trim()) record({ kind: "run", size, engine, ms: last.ms, tokens: last.tokens, src: SAMPLES.some((s) => s.text === text) ? "sample" : "own" });
  showResult();
}

let timer = 0;
const schedule = (ms = 160) => {
  clearTimeout(timer);
  timer = window.setTimeout(run, ms);
};

function showResult() {
  const out = $("output");
  if (!last) return;
  const { text, spans, masked, ms, tokens } = last;
  if (view === "masked") out.textContent = masked;
  else {
    let html = "";
    let at = 0;
    for (const s of spans) {
      const [ic, fam] = LABEL_LOOK[s.label] ?? ["l-key", "d"];
      html += esc(text.slice(at, s.start));
      // keep the icon on the same line as the first character of the span
      const [first = "", ...rest] = Array.from(text.slice(s.start, s.end));
      html += `<mark class="f-${fam}${String(s.label).endsWith("_L2") ? " l2" : ""}" title="${s.label}"><span class="nw">${icon(ic)}${esc(first)}</span>${esc(rest.join(""))}</mark>`;
      at = s.end;
    }
    out.innerHTML = html + esc(text.slice(at));
  }
  $("count").textContent = spans.length ? t("found", spans.length) : t("none");
  $("stats").textContent = `${ms.toFixed(0)} ms · ${tokens} tok · pii-${size} · ${engine}`;
  const used = [...new Set(spans.map((s) => s.label))];
  $("legend").innerHTML = used.map((l) => `<span class="f-${(LABEL_LOOK[l] ?? ["", "d"])[1]}">${icon((LABEL_LOOK[l] ?? ["l-key"])[0])}${l}</span>`).join("");
}

// ---- page ----------------------------------------------------------------------------------------------------------------

// GitHub star count next to the star buttons (unauthenticated API, 60 requests an hour per visitor; hidden on any failure
// and while the count is small)
async function starCount() {
  try {
    const res = await fetch("https://api.github.com/repos/newmean-ai/pii");
    if (!res.ok) return;
    const n = (await res.json()).stargazers_count;
    if (typeof n !== "number" || n < 20) return; // a small count reads as "nobody uses this"
    const txt = n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    for (const el of document.querySelectorAll<HTMLElement>(".stars")) {
      el.textContent = txt;
      el.hidden = false;
    }
  } catch {}
}

function start() {
  // The SDK imports the built-in engine and its wasm only after the model files have arrived; fetch that code now, while the
  // preloaded model downloads (same chunks, so the SDK's import then resolves at once).
  import("../src/engines/builtin.js")
    .then((m) => (m.relaxedSimdSupported() ? import("../src/engines/wasm-relaxed.js") : import("../src/engines/wasm-simd.js")))
    .catch(() => {});
  starCount();
  const mb = SIZES.map((s) => MODEL_FILES[s][DEFAULT_VARIANT[s]].bytes);
  $("fact-size").textContent = `${MB(Math.min(...mb))}–${MB(Math.max(...mb))} MB`;
  $("fact-ms").textContent = `${PHONE_MS} ms`;
  $("fact-lang").textContent = String(LANGUAGES);

  const sel = $<HTMLSelectElement>("lang");
  sel.replaceChildren(...Object.entries(LANGS).map(([code, [name]]) => new Option(name, code, false, code === lang)));
  sel.addEventListener("change", () => {
    lang = sel.value;
    try {
      localStorage.setItem("pii-demo-lang", lang);
    } catch {}
    applyLang();
  });

  // sample chips: the visitor's language first
  const chips = $("samples");
  const order = [...SAMPLES].sort((a, b) => Number(b.lang === lang) - Number(a.lang === lang));
  for (const s of order) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = s.name;
    b.lang = s.lang;
    b.addEventListener("click", () => {
      $<HTMLTextAreaElement>("input").value = s.text;
      for (const c of chips.children) c.classList.toggle("on", c === b);
      schedule(0);
    });
    chips.append(b);
  }

  // size switch with file sizes
  const sizes = $("sizes");
  for (const s of SIZES) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.size = s;
    b.innerHTML = `<b>${s}</b><small>${MB(MODEL_FILES[s][DEFAULT_VARIANT[s]].bytes)} MB</small>`;
    b.setAttribute("aria-pressed", String(s === size));
    b.addEventListener("click", () => {
      size = s;
      for (const c of sizes.children) c.setAttribute("aria-pressed", String(c === b));
      schedule(0);
    });
    sizes.append(b);
  }

  for (const v of ["marked", "masked"] as const)
    $(`view-${v}`).addEventListener("click", () => {
      view = v;
      $("view-marked").setAttribute("aria-pressed", String(v === "marked"));
      $("view-masked").setAttribute("aria-pressed", String(v === "masked"));
      showResult();
    });
  $("copy").addEventListener("click", async () => {
    if (!last) return;
    try {
      await navigator.clipboard.writeText(last.masked);
      $("copy-label").textContent = t("copied");
      setTimeout(() => ($("copy-label").textContent = t("copy")), 1500);
    } catch {}
  });
  // install commands, one platform at a time; the visitor's platform first
  // [name, install command, supported versions, guide folder in the repository]
  const pkgs: [string, string, string, string][] = [
    ["JavaScript", "npm install @newmean-ai/pii", "Browser · Node.js", "js"],
    ["Python", "pip install newmean-pii", "Python 3.9+", "python"],
    ["iOS · macOS", `.package(url: "https://github.com/newmean-ai/pii", from: "${__VERSION__}")`, "iOS 15+ · macOS 12+", "swift"],
    ["Android", `implementation("ai.newmean:pii:${__VERSION__}")`, "Android 7.0+", "android"],
    ["Flutter", "flutter pub add newmean_pii", "Flutter · Dart", "flutter"],
  ];
  const ua = navigator.userAgent;
  let pkg = /iPhone|iPad/.test(ua) ? 2 : /Android/.test(ua) ? 3 : 0;
  const plats = $("plats");
  const showPkg = () => {
    $("cmd").textContent = pkgs[pkg][1];
    $("req").textContent = pkgs[pkg][2];
    $<HTMLAnchorElement>("guide").href = `https://github.com/newmean-ai/pii/tree/main/${pkgs[pkg][3]}#readme`;
    for (const [i, c] of [...plats.children].entries()) c.classList.toggle("on", i === pkg);
  };
  plats.replaceChildren(...pkgs.map(([name], i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = name;
    b.addEventListener("click", () => ((pkg = i), showPkg()));
    return b;
  }));
  showPkg();
  $("cmd-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(pkgs[pkg][1]);
      $("cmd-copy").classList.add("done");
      setTimeout(() => $("cmd-copy").classList.remove("done"), 1500);
    } catch {}
  });
  $("input").addEventListener("input", () => schedule());
  for (const id of ["sens", "mode"]) $(id).addEventListener("input", () => schedule(60));
  for (const id of ["l2", "regex"]) $(id).addEventListener("change", () => schedule(0));
  $<HTMLSelectElement>("engine").addEventListener("change", (e) => {
    engine = (e.target as HTMLSelectElement).value as EngineName;
    schedule(0);
  });

  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  addEventListener("pagehide", flush);

  applyLang();
  (chips.firstElementChild as HTMLButtonElement).click();
}
start();
