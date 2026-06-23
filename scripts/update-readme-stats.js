#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Rebuilds the definition statistics documented in README.md from voci/*.csv.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const inputDir = path.join(root, "voci");
const legacyPath = path.join(root, "voci.csv");
const readmePath = path.join(root, "README.md");

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (quoted) throw new Error("CSV non valido: virgolette non chiuse");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readFile(file, label) {
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const header = rows.shift() || [];
  if (header[0] !== "soluzione" || header[1] !== "definizione") {
    throw new Error("Intestazione attesa 'soluzione,definizione' in " + label);
  }
  return rows;
}

function readRows() {
  if (fs.existsSync(inputDir) && fs.statSync(inputDir).isDirectory()) {
    const files = fs.readdirSync(inputDir).filter((f) => f.endsWith(".csv")).sort();
    if (!files.length) throw new Error("Nessun file .csv trovato in voci/");
    return files.flatMap((f) => readFile(path.join(inputDir, f), "voci/" + f));
  }

  if (fs.existsSync(legacyPath)) return readFile(legacyPath, "voci.csv");
  throw new Error("Sorgente non trovata: né la cartella voci/ né voci.csv");
}

function buildStats(rows) {
  const cluesBySol = new Map();
  const order = [];
  let dupes = 0;
  let invalid = 0;
  let malformed = 0;

  for (const row of rows) {
    if (row.length === 1 && !row[0].trim()) continue;
    if (row.length !== 2) {
      malformed++;
      continue;
    }

    const [word, clue] = row;
    const sol = norm(word);
    const cleanClue = String(clue || "").trim();
    if (sol.length < 2 || !cleanClue) {
      invalid++;
      continue;
    }
    if (!cluesBySol.has(sol)) {
      cluesBySol.set(sol, []);
      order.push(sol);
    }
    const clues = cluesBySol.get(sol);
    if (clues.includes(cleanClue)) {
      dupes++;
      continue;
    }
    clues.push(cleanClue);
  }

  const byLen = {};
  let clueCount = 0;
  let multiClueSolutions = 0;

  for (const sol of order) {
    const clueLen = cluesBySol.get(sol).length;
    byLen[sol.length] = (byLen[sol.length] || 0) + 1;
    clueCount += clueLen;
    if (clueLen > 1) multiClueSolutions++;
  }

  return {
    solutionCount: cluesBySol.size,
    clueCount,
    multiClueSolutions,
    byLen,
    dupes,
    invalid,
    malformed,
  };
}

function formatNumber(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatFourteenPlus(byLen) {
  return Object.keys(byLen)
    .map(Number)
    .filter((len) => len >= 14)
    .sort((a, b) => a - b)
    .map((len) => {
      const count = byLen[len];
      const word = count === 1 ? "word" : "words";
      return count + " " + word + " of length " + len;
    })
    .join(", ")
    .replace(/, ([^,]*)$/, " and $1");
}

function replaceOrFail(text, pattern, replacement, label) {
  if (!pattern.test(text)) throw new Error("Pattern README non trovato: " + label);
  return text.replace(pattern, replacement);
}

const stats = buildStats(readRows());
const buckets = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const fourteenPlus = Object.entries(stats.byLen)
  .filter(([len]) => Number(len) >= 14)
  .reduce((sum, [, count]) => sum + count, 0);
const distribution = buckets.map((len) => stats.byLen[len] || 0).concat(fourteenPlus).join(" | ");

let readme = fs.readFileSync(readmePath, "utf8");
readme = replaceOrFail(
  readme,
  /with \*\*[\d,]+ definition rows\*\*/,
  "with **" + formatNumber(stats.clueCount) + " definition rows**",
  "definition rows"
);
readme = replaceOrFail(
  readme,
  /- \*\*[\d,]+ solutions \/ [\d,]+ clues \/ [\d,]+ multi-clue solutions\.\*\*/,
  "- **" +
    formatNumber(stats.solutionCount) +
    " solutions / " +
    formatNumber(stats.clueCount) +
    " clues / " +
    formatNumber(stats.multiClueSolutions) +
    " multi-clue solutions.**",
  "summary counts"
);
readme = replaceOrFail(
  readme,
  /\| Solutions \| [\d |]+\|/,
  "| Solutions | " + distribution + " |",
  "length distribution"
);
readme = replaceOrFail(
  readme,
  /The `14\+` bucket is made of .*?\. Short slots/,
  "The `14+` bucket is made of " + formatFourteenPlus(stats.byLen) + ". Short slots",
  "14+ bucket"
);

fs.writeFileSync(readmePath, readme);
console.log(
  "README stats updated:",
  formatNumber(stats.solutionCount) + " solutions,",
  formatNumber(stats.clueCount) + " clues,",
  formatNumber(stats.multiClueSolutions) + " multi-clue solutions"
);
if (stats.dupes || stats.invalid || stats.malformed) {
  console.log("Scartate (dup/invalid/malformed):", stats.dupes, "/", stats.invalid, "/", stats.malformed);
}
