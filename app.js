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

/* ---------- Кэш переводов (экономия токенов) ---------- */
const CACHE_STORAGE = "translation_cache";
const CACHE_LIMIT = 500;

function normWord(w) {
  return w.trim().toLowerCase();
}
function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_STORAGE) || "{}");
  } catch {
    return {};
  }
}
function getCached(word) {
  return readCache()[normWord(word)] || null;
}
function setCached(word, data) {
  const cache = readCache();
  cache[normWord(word)] = data;
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
function openKeyDialog() {
  keyInput.value = getKey();
  if (modelSelect) modelSelect.value = getModel();
  keyDialog.showModal();
}

settingsBtn.addEventListener("click", openKeyDialog);
keyDialog.addEventListener("close", () => {
  if (keyDialog.returnValue === "save") {
    setKey(keyInput.value.trim());
    if (modelSelect) setModel(modelSelect.value);
  }
});

/* ---------- Gemini request ---------- */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    detectedLanguage: { type: "string", enum: ["ru", "de"] },
    direction: { type: "string", enum: ["ru-de", "de-ru"] },
    partOfSpeech: {
      type: "string",
      enum: ["noun", "verb", "adjective", "other"],
    },
    translation: { type: "string" },
    // существительные
    article: { type: "string" },          // der / die / das (или "")
    singular: { type: "string" },         // напр. das Haus
    plural: { type: "string" },           // напр. die Häuser
    // глаголы
    infinitive: { type: "string" },       // начальная форма
    // вспомогательное
    example: { type: "string" },          // короткий пример (опционально)
    notFound: { type: "boolean" },        // слово не распознано
  },
  required: ["partOfSpeech", "translation", "notFound"],
};

const SYSTEM_PROMPT = `Ты — двуязычный русско-немецкий словарь.
Тебе дают одно слово на русском ИЛИ немецком языке. Определи язык автоматически.
Если слово русское — переведи на немецкий. Если немецкое — переведи на русский.

Правила заполнения полей:
- partOfSpeech: noun (существительное), verb (глагол), adjective (прилагательное) или other.
- translation: основной перевод. Для существительного, переведённого на немецкий, ВКЛЮЧИ артикль (напр. "das Haus").
- Для существительных всегда заполни: article (der/die/das — немецкий артикль), singular (немецкое слово в ед. числе с артиклем), plural (немецкое слово во мн. числе с артиклем, напр. "die Häuser"). Если перевод с немецкого на русский — артикль и формы бери для немецкого слова.
- Для глаголов заполни infinitive — начальную форму немецкого глагола (инфинитив).
- Для прилагательных артикль/формы не нужны.
- example: один короткий пример употребления на немецком (по желанию).
- Если слово не существует или это бессмыслица — поставь notFound=true.
Отвечай строго в формате заданной JSON-схемы, без пояснений.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function translate(word, onRetry) {
  const key = getKey();
  if (!key) {
    openKeyDialog();
    throw { handled: true };
  }

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: word }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
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
const POS_LABEL = {
  noun: "Существительное",
  verb: "Глагол",
  adjective: "Прилагательное",
  other: "Слово",
};
const DIR_LABEL = { "ru-de": "RU → DE", "de-ru": "DE → RU" };

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

function render(word, d) {
  if (d.notFound) {
    resultEl.innerHTML = `<div class="error">Не удалось распознать слово «${esc(word)}». Проверьте написание.</div>`;
    return;
  }

  let rows = row("Перевод", d.translation);

  if (d.partOfSpeech === "noun") {
    const cls = articleClass(d.article);
    if (d.article) rows += row("Артикль", d.article, "art " + cls);
    rows += row("Единственное число", d.singular || d.translation);
    rows += row("Множественное число", d.plural);
  } else if (d.partOfSpeech === "verb") {
    rows += row("Начальная форма", d.infinitive);
  }

  const example = d.example
    ? `<div class="example">«${esc(d.example)}»</div>`
    : "";

  resultEl.innerHTML = `
    <div class="card">
      <div class="card__head">
        <span class="word">${esc(word)}</span>
        <span class="pos">${esc(POS_LABEL[d.partOfSpeech] || "Слово")}</span>
        <span class="dir">${esc(DIR_LABEL[d.direction] || "")}</span>
      </div>
      ${rows}
      ${example}
    </div>`;
}

function showLoading(text = "Перевожу…") {
  resultEl.innerHTML = `<div class="status"><div class="spinner"></div><span>${esc(text)}</span></div>`;
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

/* ---------- Form submit ---------- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const word = input.value.trim();
  if (!word) return;

  hintEl.style.display = "none";

  // Сначала смотрим в кэш — без обращения к API и трат токенов.
  const cached = getCached(word);
  if (cached) {
    render(word, cached);
    return;
  }

  btn.disabled = true;
  showLoading();

  try {
    const data = await translate(word, (attempt, max) =>
      showLoading(`Модель занята, повтор ${attempt}/${max - 1}…`)
    );
    setCached(word, data);
    render(word, data);
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
});

/* ---------- First run: ask for key ---------- */
window.addEventListener("load", () => {
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
