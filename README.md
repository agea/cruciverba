# Cruciverba 🇮🇹

A generator and player for **Italian crosswords**, running entirely in the browser. No backend, no build step, no external dependencies — just HTML and vanilla JavaScript. Installable as a PWA and fully playable **offline**, tuned for iPad and desktop.

**▶️ Play it: https://agea.github.io/cruciverba/**

---

## ✨ Features

- **Automatic generation** of dense, *Settimana Enigmistica*–style grids with black squares, at three difficulty levels (easy / medium / hard) of increasing size and density.
- **Interactive solving**: pick a clue, type with the physical or on-screen keyboard, with highlighting of the active word and crossing cell.
- **Helpers**: check wrong letters, reveal a cell or a whole word, clear.
- **Persistence**: the game state is saved in `localStorage`, so you can pick up where you left off.
- **Game timer** and automatic completion detection.
- **"Pencil-on-paper" design**, touch-friendly and **offline-first** (PWA with a service worker).

---

## 🏗️ Architecture

Three decoupled components:

1. **Clue database** — [`cruciverba_db.json`](cruciverba_db.json): pure data, kept separate from logic.
2. **Grid generator** — [`gen_dense.js`](gen_dense.js): the grid-construction algorithm, run inside a **Web Worker** so the UI never blocks.
3. **UI** — the HTML app: grid rendering, input, helpers, persistence.

The worker loads `gen_dense.js`, which is precached by the service worker together with the database for offline PWA use.

---

## 🗂️ The database

[`cruciverba_db.json`](cruciverba_db.json) is a compact JSON array of `["SOLUTION", "clue"]` pairs.

- **15,016 entries.** Solutions are uppercase, letters **A–Z only** (accents and spaces stripped at build time).
- Length distribution is deliberately skewed toward short words, which feed the dense crossings:

| Letters | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14+ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Entries | 178 | 248 | 829 | 1705 | 2265 | 3018 | 2366 | 2018 | 1232 | 665 | 306 | 134 | 52 |

Short slots (2–3 letters) lean on the classic Italian-puzzle style: initialism, car plates, musical notes and chemical symbols.

### Extending the database

1. Add rows to [`voci.csv`](voci.csv), under the header `soluzione,definizione`. Wrap a clue in double quotes if it contains a comma.
2. Run `node builddb.js`. It reads the CSV, **normalizes** (NFD → uppercase → A–Z only), **deduplicates** (first occurrence wins), **drops** invalid entries, sorts, and rewrites `cruciverba_db.json`.

> 💡 Solutions shorter than 2 letters or without a clue are discarded automatically. Duplicate solutions keep the first clue seen.

---

## ⚙️ The dense generator (`gen_dense.js`)

Produces dense grids in the Italian style: a filled rectangular grid with **black squares**, where every white run of length ≥ 2 (across or down) is a database word with its clue.

**Pipeline:**

1. **Word bank** — the DB is indexed by length and by `(position, letter)`, to quickly fetch candidates for a partially filled slot.
2. **Black-square pattern** — randomly generated with controlled density; over-long white runs are split (`maxRun`) to favor 3–6 letter slots where the vocabulary is richest; isolated white cells are removed.
3. **Slot extraction** — all white runs ≥ 2, across and down, plus a cell → slot map.
4. **Filling (backtracking)** — most-constrained-slot selection (propagation from already-filled slots + a static seed on the most-crossed ones), **forward-checking** on crossings, no repeated words.
5. **Fallback cascade** — if a configuration can't be completed, it retries with more black squares and shorter slots, and finally with a smaller grid: a valid grid is always returned.

**Benchmarks** (Node, on the real 15k DB, 100% success, zero clueless words):

| Difficulty | Grid | Avg time | Words |
|---|---|---|---|
| Easy | 9×9 | ~0.05 s | ~30 |
| Medium | 11×11 | ~1.3 s (peaks up to ~6 s) | ~42 |
| Hard | 13×13 | ~0.3 s | ~61 |

### Output structure

```js
{
  width, height,
  cells: [[ null | { ch, num }, ... ], ...],  // null = black square
  across: [{ num, clue, answer, row, col, len }, ...],
  down:   [{ num, clue, answer, row, col, len }, ...],
  wordCount,
  ghosts  // words without a clue (expected: 0)
}
```

---

## 📁 Project structure

| File | Role |
|---|---|
| [`voci.csv`](voci.csv) | Database source (`soluzione,definizione`) |
| [`builddb.js`](builddb.js) | Build script: CSV → JSON |
| `cruciverba_db.json` | Generated database (rebuilt in CI) |
| [`gen_dense.js`](gen_dense.js) | Dense generator (Web Worker) |
| [`index.html`](index.html) | Playable PWA app |
| [`cruciverba.html`](cruciverba.html) | Alias of the app |
| `sw.js` · `manifest.webmanifest` · `icons/` | PWA assets |

---

## 🚀 Development

No toolchain required.

```bash
# rebuild the database after editing voci.csv
node builddb.js

# serve locally (a service worker needs an HTTP origin)
python3 -m http.server 8000
# then open http://localhost:8000
```

Pushing to `main` triggers the GitHub Actions workflow, which rebuilds the database and deploys the static site to **GitHub Pages**.

### Offline use

Full offline use requires opening the app at least once from GitHub Pages (or any HTTP origin), so the service worker can cache `index.html`, `gen_dense.js`, `cruciverba_db.json` and the other assets. Opening directly via `file://` is not the main target, because browsers restrict `fetch` and service workers outside an HTTP/HTTPS origin.
