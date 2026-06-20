# Cruciverba 🇮🇹

A generator and player for **Italian crosswords**, running entirely in the browser. No backend, no build step, no external dependencies — just HTML and vanilla JavaScript. Installable as a PWA and fully playable **offline**, tuned for iPad and desktop.

**▶️ Play it: https://agea.github.io/cruciverba/**

---

## ✨ Features

- **Automatic generation** of dense, *Settimana Enigmistica*–style grids with black squares, with square and landscape presets from **5×5** up to **25×13**.
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

The source database lives in [`voci/`](voci/): **26 CSV files**, one per initial letter, with **13,112 definition rows**. `node builddb.js` turns them into `cruciverba_db.json`, a compact JSON array of `["SOLUTION", clue]` entries, where `clue` is either a **string** (one definition) or an **array of strings** (several definitions for the same solution). When a word has multiple clues, the generator picks one at random per puzzle, so the same answer can be asked differently from one grid to the next.

- **12,870 solutions / 13,112 clues / 190 multi-clue solutions.** Solutions are uppercase, letters **A–Z only** (accents and spaces stripped at build time).
- Length distribution is deliberately skewed toward short words, which feed the dense crossings:

| Letters | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14+ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Solutions | 178 | 270 | 911 | 1900 | 2205 | 2609 | 1923 | 1415 | 785 | 403 | 164 | 71 | 36 |

The `14+` bucket is made of 23 words of length 14, 9 of length 15, 2 of length 16, 1 of length 18 and 1 of length 19. Short slots (2–3 letters) lean on the classic Italian-puzzle style: initialism, car plates, musical notes and chemical symbols — and, being the most frequent, often carry several alternative clues.

### Extending the database

1. Add rows to the right file in [`voci/`](voci/) — one file per initial letter (`voci/A.csv`, `voci/B.csv`, …), each under the header `soluzione,definizione`. A word goes in the file of its first letter. Wrap a clue in double quotes if it contains a comma. To give a word **more than one clue**, add several rows with the same solution and different definitions.
2. Run `node builddb.js`. It reads every `voci/*.csv`, **normalizes** (NFD → uppercase → A–Z only), **groups every distinct definition under its solution** (only exact `(solution, clue)` duplicates are dropped), **drops** invalid entries, sorts, and rewrites `cruciverba_db.json`. (A single legacy `voci.csv` is still accepted as a fallback.)

> 💡 Solutions shorter than 2 letters or without a clue are discarded automatically. Duplicate solutions are kept as one JSON entry with all distinct clues attached.

---

## ⚙️ The dense generator (`gen_dense.js`)

Produces dense grids in the Italian style: a filled rectangular grid with **black squares**, where every white run of length ≥ 2 (across or down) is a database word with its clue.

**Pipeline:**

1. **Word bank** — the DB is indexed by length and by `(position, letter)`, to quickly fetch candidates for a partially filled slot.
2. **Black-square pattern** — randomly generated with controlled density, then carved around a near-central crossing between one long across answer and one long down answer. Over-long non-seed white runs are split (`maxRun`) to keep the fill tractable; isolated white cells are removed; black squares are normalized to avoid 2×2 black blocks and black runs longer than 3 cells; among valid candidates the generator favors grids with fewer black squares and more long answers.
3. **Slot extraction** — all white runs ≥ 2, across and down, plus a cell → slot map.
4. **Filling (backtracking)** — the central crossing is pre-filled first, then most-constrained-slot selection (propagation from already-filled slots + a static seed on the most-crossed ones), **forward-checking** on crossings, no repeated words.
5. **Fallback cascade** — if a configuration can't be completed, it retries with gradually more black squares before falling back to a smaller grid: a valid grid is preferred over failing.

**Preset sizes**

| Shape | Sizes |
|---|---|
| Square | 5×5, 7×7, 9×9, 11×11, 13×13 |
| Landscape | 11×7, 13×9, 17×11, 21×13, 25×13 |

**Smoke-test timings** (Node, current DB, fixed seeds, first valid sample, zero clueless words):

| Requested | Actual | Words | Black | Longest | 7+ words | Time |
|---|---:|---:|---:|---:|---:|---:|
| 5×5 | 5×5 | 12 | 3/25 (12.0%) | 5 | 0 | ~0.01 s |
| 7×7 | 7×7 | 19 | 12/49 (24.5%) | 5 | 0 | ~0.01 s |
| 9×9 | 9×9 | 29 | 16/81 (19.8%) | 7 | 3 | ~0.86 s |
| 11×11 | 11×11 | 43 | 25/121 (20.7%) | 7 | 9 | ~4.26 s |
| 13×13 | 13×13 | 58 | 33/169 (19.5%) | 10 | 13 | ~8.15 s |
| 11×7 | 11×7 | 29 | 10/77 (13.0%) | 7 | 6 | ~0.80 s |
| 13×9 | 13×9 | 46 | 22/117 (18.8%) | 8 | 7 | ~0.12 s |
| 17×11 | 17×11 | 62 | 41/187 (21.9%) | 12 | 14 | ~94.74 s |
| 21×13 | 21×13 | 90 | 71/273 (26.0%) | 12 | 17 | ~48.78 s |
| 25×13 | 23×11 | 89 | 55/253 (21.7%) | 12 | 19 | ~59.77 s |

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
| [`voci/`](voci/) | Database source, split by initial (`A.csv … Z.csv`) |
| [`builddb.js`](builddb.js) | Build script: CSV → JSON |
| `cruciverba_db.json` | Generated database, ignored by git locally and rebuilt in CI before deploy |
| [`gen_dense.js`](gen_dense.js) | Dense generator (Web Worker) |
| [`index.html`](index.html) | Playable PWA app |
| [`sw.js`](sw.js) · [`manifest.webmanifest`](manifest.webmanifest) · [`icons/`](icons/) | PWA assets, offline cache and update flow |
| [`version.json`](version.json) | Build metadata used by the deployed app to detect updates |

---

## 🚀 Development

No toolchain required.

```bash
# rebuild the database after editing any voci/*.csv
node builddb.js

# serve locally (a service worker needs an HTTP origin)
python3 -m http.server 8000
# then open http://localhost:8000
```

Pushing to `main` triggers the GitHub Actions workflow, which rebuilds the database, writes deploy-time `version.json` metadata from the commit SHA and UTC build time, and deploys the static site to **GitHub Pages**.

### Offline use

Full offline use requires opening the app at least once from GitHub Pages (or any HTTP origin), so the service worker can cache `index.html`, `gen_dense.js`, `cruciverba_db.json`, `README.md` and the other assets. The service worker also refreshes `version.json` and `cruciverba_db.json` from the network when available, then shows an in-app update prompt for a newly deployed version. Opening directly via `file://` is not the main target, because browsers restrict `fetch` and service workers outside an HTTP/HTTPS origin.
