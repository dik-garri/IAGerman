"use strict";

const KEY_STORAGE = "gemini_api_key";
const MODEL_STORAGE = "gemini_model";
const DEFAULT_MODEL = "gemini-2.5-flash";
const API_URL = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

const $ = (sel) => document.querySelector(sel);
const form = $("#searchForm");
const input = $("#wordInput");
const btn = $("#translateBtn");
const resultEl = $("#result");
const hintEl = $("#hint");
const settingsBtn = $("#settingsBtn");
const keyDialog = $("#keyDialog");
const keyForm = $("#keyForm");
const keyInput = $("#keyInput");
const modelSelect = $("#modelSelect");

/* ---------- API key handling ---------- */
function getKey() {
  return localStorage.getItem(KEY_STORAGE) || "";
}
function setKey(v) {
  if (v) localStorage.setItem(KEY_STORAGE, v);
}
function getModel() {
  return localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL;
}
function setModel(v) {
  if (v) localStorage.setItem(MODEL_STORAGE, v);
}

/* ---------- Язык подписей интерфейса ---------- */
const LANG_STORAGE = "label_lang";
function getLang() {
  return localStorage.getItem(LANG_STORAGE) || "ru";
}
function setLang(v) {
  if (v) localStorage.setItem(LANG_STORAGE, v);
}
const LABELS = {
  ru: {
    translation: "Перевод",
    meanings: "Ещё значения",
    article: "Артикль",
    singular: "Единственное число",
    plural: "Множественное число",
    genitive: "Родительный падеж",
    infinitive: "Начальная форма",
    stammformen: "Основные формы",
    auxiliary: "Вспом. глагол",
    present: "Präsens",
    comparison: "Сравнение",
    noun: "Существительное",
    verb: "Глагол",
    adjective: "Прилагательное",
    other: "Слово",
    loading: "Перевожу…",
  },
  de: {
    translation: "Übersetzung",
    meanings: "Weitere Bedeutungen",
    article: "Artikel",
    singular: "Singular",
    plural: "Plural",
    genitive: "Genitiv",
    infinitive: "Grundform",
    stammformen: "Stammformen",
    auxiliary: "Hilfsverb",
    present: "Präsens",
    comparison: "Steigerung",
    noun: "Substantiv",
    verb: "Verb",
    adjective: "Adjektiv",
    other: "Wort",
    loading: "Übersetze…",
  },
};
const L = () => LABELS[getLang()] || LABELS.ru;

/* ---------- Кэш переводов (экономия токенов) ---------- */
const CACHE_STORAGE = "translation_cache";
const CACHE_LIMIT = 500;

function normWord(w) {
  return w.trim().toLowerCase();
}
// Ключ кэша включает набор включённых полей: при смене настроек — свежий ответ.
function cacheKey(word) {
  return normWord(word) + "@" + fieldsSig();
}
function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_STORAGE) || "{}");
  } catch {
    return {};
  }
}
function getCached(word) {
  return readCache()[cacheKey(word)] || null;
}
function setCached(word, data) {
  const cache = readCache();
  cache[cacheKey(word)] = data;
  // Ограничиваем размер: при переполнении убираем самые старые ключи.
  const keys = Object.keys(cache);
  if (keys.length > CACHE_LIMIT) {
    for (const k of keys.slice(0, keys.length - CACHE_LIMIT)) delete cache[k];
  }
  try {
    localStorage.setItem(CACHE_STORAGE, JSON.stringify(cache));
  } catch {
    /* квота localStorage переполнена — игнорируем */
  }
}
function renderFieldsList() {
  const box = document.getElementById("fieldsList");
  if (!box) return;
  const f = getFields();
  box.innerHTML = FIELD_DEFS.map(
    (d) => `
    <label class="field-toggle">
      <input type="checkbox" data-field="${d.key}" ${f[d.key] ? "checked" : ""} />
      <span>${d.label}</span>
    </label>`
  ).join("");
}

function openKeyDialog() {
  keyInput.value = getKey();
  if (modelSelect) modelSelect.value = getModel();
  const langSel = document.getElementById("langSelect");
  if (langSel) langSel.value = getLang();
  renderFieldsList();
  keyDialog.showModal();
}

settingsBtn.addEventListener("click", openKeyDialog);

// Раскрытие подсказок ⓘ рядом с полями.
keyDialog.addEventListener("click", (e) => {
  const info = e.target.closest(".info");
  if (!info) return;
  const help = document.getElementById(info.dataset.help);
  if (help) help.hidden = !help.hidden;
});

keyDialog.addEventListener("close", () => {
  if (keyDialog.returnValue === "save") {
    setKey(keyInput.value.trim());
    if (modelSelect) setModel(modelSelect.value);
    const langSel = document.getElementById("langSelect");
    if (langSel) setLang(langSel.value);
    const checks = keyDialog.querySelectorAll("#fieldsList input[data-field]");
    const fields = {};
    checks.forEach((c) => (fields[c.dataset.field] = c.checked));
    setFields(fields);
    // Применяем смену языка подписей к уже показанному результату.
    if (lastResult) render(lastResult.word, lastResult.d);
  }
});

/* ---------- Настройки детализации ответа ---------- */
const FIELDS_STORAGE = "display_fields";
// Порядок = порядок отображения и список чекбоксов в настройках.
const FIELD_DEFS = [
  { key: "genitive",   label: "Родительный падеж (Genitiv)" },
  { key: "verbForms",  label: "Формы глагола (gehen–ging–gegangen)" },
  { key: "present",    label: "Спряжение в Präsens" },
  { key: "comparison", label: "Степени сравнения" },
  { key: "meanings",   label: "Несколько значений / синонимы" },
  { key: "examples",   label: "Примеры с переводом" },
];
const DEFAULT_FIELDS = Object.fromEntries(FIELD_DEFS.map((f) => [f.key, true]));

function getFields() {
  try {
    return { ...DEFAULT_FIELDS, ...JSON.parse(localStorage.getItem(FIELDS_STORAGE) || "{}") };
  } catch {
    return { ...DEFAULT_FIELDS };
  }
}
function setFields(obj) {
  localStorage.setItem(FIELDS_STORAGE, JSON.stringify(obj));
}
// Подпись активных полей — для разделения кэша при разных настройках.
function fieldsSig() {
  const f = getFields();
  return FIELD_DEFS.filter((d) => f[d.key]).map((d) => d.key).join(",");
}

/* ---------- Gemini request ---------- */
const S = (type) => ({ type });
const ARR = { type: "array", items: { type: "string" } };

function buildSchema(f) {
  const props = {
    detectedLanguage: { type: "string", enum: ["ru", "de"] },
    direction: { type: "string", enum: ["ru-de", "de-ru"] },
    partOfSpeech: { type: "string", enum: ["noun", "verb", "adjective", "other"] },
    translation: S("string"),
    article: S("string"),
    singular: S("string"),
    plural: S("string"),
    infinitive: S("string"),
    notFound: S("boolean"),
  };
  if (f.genitive) props.genitive = S("string");
  if (f.verbForms) {
    props.praeteritum = S("string");
    props.partizip2 = S("string");
    props.auxiliary = S("string");
  }
  if (f.present) props.present = ARR;
  if (f.comparison) {
    props.comparative = S("string");
    props.superlative = S("string");
  }
  if (f.meanings) props.meanings = ARR;
  if (f.examples) {
    props.example = S("string");
    props.exampleRu = S("string");
  }
  return {
    type: "object",
    properties: props,
    required: ["partOfSpeech", "translation", "notFound"],
  };
}

function buildPrompt(f) {
  const lines = [
    "Ты — двуязычный русско-немецкий словарь.",
    "Тебе дают одно слово на русском ИЛИ немецком языке. Определи язык автоматически.",
    "Если слово русское — переведи на немецкий. Если немецкое — переведи на русский.",
    "",
    "Правила заполнения полей:",
    "- partOfSpeech: noun, verb, adjective или other.",
    '- translation: основной перевод. Для существительного на немецком ВКЛЮЧИ артикль (напр. "das Haus").',
    "- Для существительных всегда заполни: article (der/die/das), singular (с артиклем), plural (с артиклем). Формы относятся к немецкому слову.",
    "- Для глаголов заполни infinitive — инфинитив немецкого глагола.",
  ];
  if (f.genitive) lines.push('- genitive: форма родительного падежа существительного (напр. "des Hauses").');
  if (f.verbForms)
    lines.push(
      "- Для глаголов: praeteritum (3-е л. ед.ч. Präteritum, напр. \"ging\"), partizip2 (Partizip II, напр. \"gegangen\"), auxiliary (вспомогательный глагол \"haben\" или \"sein\")."
    );
  if (f.present)
    lines.push(
      '- present: спряжение немецкого глагола в Präsens, массив из 6 строк ("ich gehe", "du gehst", "er/sie/es geht", "wir gehen", "ihr geht", "sie/Sie gehen").'
    );
  if (f.comparison)
    lines.push('- Для прилагательных: comparative (напр. "schneller") и superlative (напр. "am schnellsten").');
  if (f.meanings)
    lines.push("- meanings: 2–4 других варианта перевода/синонима на языке перевода (если есть), иначе пустой массив.");
  if (f.examples)
    lines.push(
      "- example: короткий пример употребления на немецком; exampleRu: его перевод на русский."
    );
  lines.push("- Если слово не существует или это бессмыслица — поставь notFound=true.");
  lines.push("Заполняй только релевантные части речи поля. Отвечай строго в формате JSON-схемы, без пояснений.");
  return lines.join("\n");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function translate(word, onRetry) {
  const key = getKey();
  if (!key) {
    openKeyDialog();
    throw { handled: true };
  }

  const fields = getFields();
  const body = {
    systemInstruction: { parts: [{ text: buildPrompt(fields) }] },
    contents: [{ role: "user", parts: [{ text: word }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: buildSchema(fields),
    },
  };

  const url = API_URL(getModel(), key);
  const reqInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };

  // Повторяем при временной недоступности (503) и перегрузке (429).
  const MAX_ATTEMPTS = 4;
  let res;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await fetch(url, reqInit);
    if (res.ok) break;
    if ((res.status === 503 || res.status === 429) && attempt < MAX_ATTEMPTS) {
      onRetry?.(attempt, MAX_ATTEMPTS);
      await sleep(800 * attempt); // 0.8s, 1.6s, 2.4s
      continue;
    }
    break;
  }

  if (!res.ok) {
    let msg = `Ошибка ${res.status}`;
    try {
      const err = await res.json();
      if (err?.error?.message) msg = err.error.message;
    } catch (_) {}
    if (res.status === 400 || res.status === 403) {
      msg = "Неверный или недействительный API-ключ. Проверьте его в настройках ⚙️.";
    } else if (res.status === 429) {
      msg =
        "Превышена квота для текущей модели (для бесплатного тарифа она может быть равна 0). " +
        "Откройте настройки ⚙️ и выберите другую модель — обычно помогает gemini-2.5-flash-lite или gemini-2.0-flash-lite.";
    } else if (res.status === 503) {
      msg =
        "Модель сейчас перегружена и не ответила после нескольких попыток. " +
        "Подождите немного или выберите другую модель в настройках ⚙️.";
    }
    throw new Error(msg);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Пустой ответ от модели. Попробуйте ещё раз.");
  return JSON.parse(text);
}

/* ---------- Rendering ---------- */
const DIR_LABEL = { "ru-de": "RU → DE", "de-ru": "DE → RU" };
const posLabel = (pos) => L()[pos] || L().other;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function articleClass(article) {
  const a = (article || "").trim().toLowerCase();
  if (a === "der") return "art--der";
  if (a === "die") return "art--die";
  if (a === "das") return "art--das";
  return "";
}

function row(label, value, valueClass = "") {
  if (!value) return "";
  return `<div class="row"><div class="row__label">${esc(label)}</div><div class="row__value ${valueClass}">${esc(value)}</div></div>`;
}

let lastResult = null;

function render(word, d) {
  lastResult = { word, d };
  if (d.notFound) {
    resultEl.innerHTML = `
      <div class="error">
        <div class="error__row">
          <span>Не удалось распознать «${esc(word)}». Проверьте написание.</span>
          <button class="refresh" id="refreshBtn" title="Перевести заново" aria-label="Перевести заново">↻</button>
        </div>
      </div>`;
    const rb = $("#refreshBtn");
    if (rb) rb.addEventListener("click", () => runTranslate(word, { force: true }));
    return;
  }

  const list = (arr) =>
    Array.isArray(arr) && arr.length ? arr.map(esc).join(", ") : "";

  const t = L();
  let rows = row(t.translation, d.translation);
  if (d.meanings) rows += row(t.meanings, list(d.meanings));

  if (d.partOfSpeech === "noun") {
    const cls = articleClass(d.article);
    if (d.article) rows += row(t.article, d.article, "art " + cls);
    rows += row(t.singular, d.singular || d.translation);
    rows += row(t.plural, d.plural);
    rows += row(t.genitive, d.genitive);
  } else if (d.partOfSpeech === "verb") {
    rows += row(t.infinitive, d.infinitive);
    if (d.praeteritum || d.partizip2) {
      const parts = [d.infinitive, d.praeteritum, d.partizip2].filter(Boolean).join(" – ");
      rows += row(t.stammformen, parts);
    }
    rows += row(t.auxiliary, d.auxiliary);
    rows += row(t.present, list(d.present));
  } else if (d.partOfSpeech === "adjective") {
    if (d.comparative || d.superlative) {
      const parts = [d.translation, d.comparative, d.superlative].filter(Boolean).join(" – ");
      rows += row(t.comparison, parts);
    }
  }

  const example =
    d.example
      ? `<div class="example">«${esc(d.example)}»${
          d.exampleRu ? `<span class="example__ru">${esc(d.exampleRu)}</span>` : ""
        }</div>`
      : "";

  resultEl.innerHTML = `
    <div class="card">
      <div class="card__head">
        <span class="word">${esc(word)}</span>
        <span class="pos">${esc(posLabel(d.partOfSpeech))}</span>
        <span class="dir">${esc(DIR_LABEL[d.direction] || "")}</span>
        <button class="refresh" id="refreshBtn" title="Перевести заново" aria-label="Перевести заново">↻</button>
      </div>
      ${rows}
      ${example}
    </div>`;
  const rb = $("#refreshBtn");
  if (rb) rb.addEventListener("click", () => runTranslate(word, { force: true }));
}

function showLoading(text) {
  resultEl.innerHTML = `<div class="status"><div class="spinner"></div><span>${esc(text || L().loading)}</span></div>`;
}

function showError(message) {
  resultEl.innerHTML = `
    <div class="error">
      ${esc(message)}
      <div><button id="openSettings">Открыть настройки</button></div>
    </div>`;
  const b = $("#openSettings");
  if (b) b.addEventListener("click", openKeyDialog);
}

/* ---------- Список последних слов ---------- */
const RECENTS_STORAGE = "recent_words";
const RECENTS_LIMIT = 30;
const recentsEl = $("#recents");

function getRecents() {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_STORAGE) || "[]");
  } catch {
    return [];
  }
}
function pushRecent(word) {
  const w = word.trim();
  if (!w) return;
  const norm = w.toLowerCase();
  const list = getRecents().filter((x) => x.toLowerCase() !== norm);
  list.unshift(w);
  localStorage.setItem(RECENTS_STORAGE, JSON.stringify(list.slice(0, RECENTS_LIMIT)));
  renderRecents();
}
function renderRecents() {
  if (!recentsEl) return;
  const list = getRecents();
  if (!list.length) {
    recentsEl.hidden = true;
    recentsEl.innerHTML = "";
    return;
  }
  recentsEl.hidden = false;
  recentsEl.innerHTML = list
    .map((w) => `<button class="chip" type="button">${esc(w)}</button>`)
    .join("");
}

recentsEl?.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  input.value = chip.textContent;
  runTranslate(chip.textContent);
});

/* ---------- Перевод ---------- */
async function runTranslate(word, { force = false } = {}) {
  word = word.trim();
  if (!word) return;

  hintEl.style.display = "none";

  // Сначала смотрим в кэш — без обращения к API и трат токенов.
  // При force=true пропускаем кэш и переводим заново.
  if (!force) {
    const cached = getCached(word);
    if (cached) {
      render(word, cached);
      pushRecent(word);
      return;
    }
  }

  btn.disabled = true;
  showLoading();

  try {
    const data = await translate(word, (attempt, max) =>
      showLoading(`Модель занята, повтор ${attempt}/${max - 1}…`)
    );
    setCached(word, data);
    render(word, data);
    pushRecent(word);
  } catch (err) {
    if (err && err.handled) {
      resultEl.innerHTML = "";
      hintEl.style.display = "";
    } else {
      showError(err?.message || "Что-то пошло не так.");
    }
  } finally {
    btn.disabled = false;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  runTranslate(input.value);
});

/* ---------- First run: ask for key ---------- */
window.addEventListener("load", () => {
  renderRecents();
  if (!getKey()) openKeyDialog();
});

/* ---------- Установка приложения (PWA) ---------- */
const installBtn = $("#installBtn");
const iosHint = $("#iosHint");
let deferredPrompt = null;

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

// Android/Chrome/Edge: ловим системное событие и показываем свою кнопку.
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.hidden = false;
});

if (installBtn) {
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });
}

window.addEventListener("appinstalled", () => {
  if (installBtn) installBtn.hidden = true;
  deferredPrompt = null;
});

// iOS не поддерживает beforeinstallprompt — показываем инструкцию.
window.addEventListener("load", () => {
  if (isIOS() && !isStandalone() && iosHint) iosHint.hidden = false;
});

/* ---------- Service worker + обновление версии ---------- */
function showUpdateBanner(reg) {
  let banner = $("#updateBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "updateBanner";
    banner.className = "update-banner";
    banner.innerHTML =
      '<span>Доступна новая версия</span><button id="updateBtn">Обновить</button>';
    document.body.appendChild(banner);
    $("#updateBtn").addEventListener("click", () => {
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    });
  }
  banner.hidden = false;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");

      // Новая версия уже ждёт активации.
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);

      // Появился новый Service Worker.
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          // Установился И есть активный контроллер => это обновление, а не первая установка.
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateBanner(reg);
          }
        });
      });

      // Проверяем обновления при возврате на вкладку.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update();
      });
    } catch {
      /* SW недоступен — приложение всё равно работает */
    }
  });

  // Когда новый SW взял управление — перезагружаем страницу один раз.
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}
