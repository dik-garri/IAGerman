# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Installable PWA Russian↔German dictionary. **No build step, no backend, no dependencies** — plain HTML/CSS/JS served as static files. Hosted on GitHub Pages (`https://dik-garri.github.io/IAGerman/`).

## Run locally

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```
Service Worker registration and PWA install require `https://` or `localhost` — `file://` will not work.

There is no test/lint/build tooling. Quick sanity checks:
```bash
node --check app.js && node --check sw.js
node -e "JSON.parse(require('fs').readFileSync('manifest.webmanifest','utf8'))"
```

## Architecture

- **`app.js`** — all logic. Calls Gemini `gemini-2.0-flash` directly from the browser via `fetch`. Translation reliability comes from `generationConfig.responseSchema` (`RESPONSE_SCHEMA`) forcing structured JSON output, so the response is `JSON.parse`d, never regex-scraped. `SYSTEM_PROMPT` defines dictionary behavior (auto language detection, per–part-of-speech field rules). Rendering branches on `partOfSpeech` (noun → article + singular/plural, verb → infinitive, adjective → translation only).
- **`index.html`** — static shell + the `<dialog>` for API-key entry.
- **`styles.css`** — single stylesheet, CSS custom properties at `:root`. Article colors (`der`/`die`/`das`) are applied via `articleClass()` in app.js mapping to `.art--der/die/das`.
- **`sw.js`** — app-shell cache. Bump `CACHE` constant (e.g. `de-dict-v2` → `v3`) whenever cached assets change, or clients keep stale files. **Never caches `generativelanguage.googleapis.com`** (explicit early-return in the fetch handler).
- **`manifest.webmanifest`** — PWA manifest. All paths are relative so the app works from the `/IAGerman/` GitHub Pages subpath without changes.

## Critical constraint: the API key

There is no server, so the Gemini key **must not be hardcoded** — on GitHub Pages any committed key becomes public. The key is supplied by the end user at runtime and stored in `localStorage` under `gemini_api_key`. The settings dialog (⚙️) is the only place it's entered. Preserve this pattern in any change.

## Icons

PNG icons (`icon-192/512.png`, `apple-touch-icon.png`) are generated from a source photo with macOS `sips`. Referenced from both `manifest.webmanifest` and `index.html`. When icons change, also update the `ASSETS` list and `CACHE` version in `sw.js`.
