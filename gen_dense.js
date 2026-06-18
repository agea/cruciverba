// Generatore di cruciverba DENSO, stile Settimana Enigmistica.
// Griglia rettangolare piena con caselle nere; ogni sequenza bianca >=2 e' una
// parola del dizionario. Riempimento via backtracking con forward-checking.
// Backtick-free per l'embedding nel Web Worker.

function stripAccents(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function normalizeAnswer(s) {
  return stripAccents(String(s)).toUpperCase().replace(/[^A-Z]/g, "");
}
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleInPlace(arr, rnd) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(rnd() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

// ---------- word bank ----------
// byLen[L] = array di parole (uniche) di lunghezza L
// posIndex[L][i] = Map( char -> array di parole di lunghezza L con quel char in posizione i )
// answerToClues = Map( parola -> [definizioni] )
function buildBank(rawEntries, minLen, maxLen) {
  var answerToClues = new Map();
  for (var k = 0; k < rawEntries.length; k++) {
    var w = normalizeAnswer(rawEntries[k][0]);
    if (w.length < 2) continue;
    var raw = rawEntries[k][1];
    var clues = Array.isArray(raw) ? raw : [raw];
    if (!answerToClues.has(w)) answerToClues.set(w, []);
    var arr = answerToClues.get(w);
    for (var ci = 0; ci < clues.length; ci++) {
      if (clues[ci] != null && arr.indexOf(clues[ci]) === -1) arr.push(clues[ci]);
    }
  }
  var byLen = {};
  var posIndex = {};
  answerToClues.forEach(function (clues, w) {
    var L = w.length;
    if (L < minLen || L > maxLen) return;
    if (!byLen[L]) { byLen[L] = []; posIndex[L] = []; }
    var id = byLen[L].length;
    byLen[L].push(w);
    for (var i = 0; i < L; i++) {
      if (!posIndex[L][i]) posIndex[L][i] = new Map();
      var ch = w.charAt(i);
      var bucket = posIndex[L][i].get(ch);
      if (!bucket) { bucket = []; posIndex[L][i].set(ch, bucket); }
      bucket.push(w);
    }
  });
  return { answerToClues: answerToClues, byLen: byLen, posIndex: posIndex };
}

// ---------- pattern di caselle nere ----------
// Ritorna matrice booleana black[r][c]. Garantisce: nessuna cella bianca isolata
// (lunghezza 1 sia in orizzontale sia in verticale).
function makePattern(W, H, blackProb, rnd, maxRun) {
  maxRun = maxRun || 7;
  var black = [];
  for (var r = 0; r < H; r++) {
    black[r] = [];
    for (var c = 0; c < W; c++) black[r][c] = (rnd() < blackProb);
  }
  // evita run orizzontali/verticali troppo lunghi: spezzali con una nera
  function fixLongRuns() {
    var r, c, run;
    for (r = 0; r < H; r++) {
      run = 0;
      for (c = 0; c < W; c++) {
        if (black[r][c]) { run = 0; }
        else { run++; if (run > maxRun) { black[r][c] = true; run = 0; } }
      }
    }
    for (c = 0; c < W; c++) {
      run = 0;
      for (r = 0; r < H; r++) {
        if (black[r][c]) { run = 0; }
        else { run++; if (run > maxRun) { black[r][c] = true; run = 0; } }
      }
    }
  }

  function fixBadBlackPatterns() {
    var changed = false;
    var r, c, run;

    for (r = 0; r + 1 < H; r++) {
      for (c = 0; c + 1 < W; c++) {
        if (black[r][c] && black[r + 1][c] && black[r][c + 1] && black[r + 1][c + 1]) {
          black[r + 1][c + 1] = false;
          changed = true;
        }
      }
    }

    for (r = 0; r < H; r++) {
      run = 0;
      for (c = 0; c < W; c++) {
        if (black[r][c]) {
          run++;
          if (run > 3) {
            black[r][c] = false;
            run = 0;
            changed = true;
          }
        } else {
          run = 0;
        }
      }
    }

    for (c = 0; c < W; c++) {
      run = 0;
      for (r = 0; r < H; r++) {
        if (black[r][c]) {
          run++;
          if (run > 3) {
            black[r][c] = false;
            run = 0;
            changed = true;
          }
        } else {
          run = 0;
        }
      }
    }

    return changed;
  }

  fixLongRuns();
  // elimina celle bianche isolate (1 in entrambe le direzioni) -> nere
  function acrossLen(r, c) {
    if (black[r][c]) return 0;
    var n = 1, cc;
    for (cc = c - 1; cc >= 0 && !black[r][cc]; cc--) n++;
    for (cc = c + 1; cc < W && !black[r][cc]; cc++) n++;
    return n;
  }
  function downLen(r, c) {
    if (black[r][c]) return 0;
    var n = 1, rr;
    for (rr = r - 1; rr >= 0 && !black[rr][c]; rr--) n++;
    for (rr = r + 1; rr < H && !black[rr][c]; rr++) n++;
    return n;
  }
  var changed = true, guard = 0;
  while (changed && guard < 50) {
    changed = false; guard++;
    for (var r2 = 0; r2 < H; r2++) {
      for (var c2 = 0; c2 < W; c2++) {
        if (black[r2][c2]) continue;
        if (acrossLen(r2, c2) < 2 && downLen(r2, c2) < 2) {
          black[r2][c2] = true; changed = true;
        }
      }
    }
  }

  fixBadBlackPatterns();
  return black;
}

function analyzePattern(black, W, H) {
  var r, c;
  var whiteTotal = 0;
  var firstWhite = null;
  var blackSquares = 0;
  var maxBlackRun = 0;

  for (r = 0; r < H; r++) {
    var rowBlackRun = 0;
    for (c = 0; c < W; c++) {
      if (!black[r][c]) {
        whiteTotal++;
        if (!firstWhite) firstWhite = { r: r, c: c };
        rowBlackRun = 0;
      } else {
        rowBlackRun++;
        if (rowBlackRun > maxBlackRun) maxBlackRun = rowBlackRun;
      }
      if (r + 1 < H && c + 1 < W &&
          black[r][c] && black[r + 1][c] && black[r][c + 1] && black[r + 1][c + 1]) {
        blackSquares++;
      }
    }
  }
  for (c = 0; c < W; c++) {
    var colBlackRun = 0;
    for (r = 0; r < H; r++) {
      if (black[r][c]) {
        colBlackRun++;
        if (colBlackRun > maxBlackRun) maxBlackRun = colBlackRun;
      } else {
        colBlackRun = 0;
      }
    }
  }

  var connectedWhite = 0;
  if (firstWhite) {
    var seen = {};
    var q = [firstWhite];
    seen[firstWhite.r + "," + firstWhite.c] = true;
    while (q.length) {
      var cur = q.shift();
      connectedWhite++;
      var ns = [
        { r: cur.r - 1, c: cur.c },
        { r: cur.r + 1, c: cur.c },
        { r: cur.r, c: cur.c - 1 },
        { r: cur.r, c: cur.c + 1 }
      ];
      for (var i = 0; i < ns.length; i++) {
        var n = ns[i];
        var key = n.r + "," + n.c;
        if (n.r < 0 || n.r >= H || n.c < 0 || n.c >= W) continue;
        if (black[n.r][n.c] || seen[key]) continue;
        seen[key] = true;
        q.push(n);
      }
    }
  }

  return {
    whiteTotal: whiteTotal,
    blackTotal: W * H - whiteTotal,
    whiteConnected: whiteTotal > 0 && connectedWhite === whiteTotal,
    blackSquares: blackSquares,
    maxBlackRun: maxBlackRun
  };
}

// ---------- estrazione slot ----------
// slot = { id, dir(0=across,1=down), r, c, len, cells:[idx...] }
// cellId = r*W + c
function extractSlots(black, W, H) {
  var slots = [];
  var cellAcross = {}; // cellId -> slotId
  var cellDown = {};
  var r, c;
  // across
  for (r = 0; r < H; r++) {
    c = 0;
    while (c < W) {
      if (black[r][c]) { c++; continue; }
      var start = c;
      while (c < W && !black[r][c]) c++;
      var len = c - start;
      if (len >= 2) {
        var cells = [];
        for (var cc = start; cc < start + len; cc++) {
          var id = r * W + cc; cells.push(id); cellAcross[id] = slots.length;
        }
        slots.push({ id: slots.length, dir: 0, r: r, c: start, len: len, cells: cells });
      }
    }
  }
  // down
  for (c = 0; c < W; c++) {
    r = 0;
    while (r < H) {
      if (black[r][c]) { r++; continue; }
      var start2 = r;
      while (r < H && !black[r][c]) r++;
      var len2 = r - start2;
      if (len2 >= 2) {
        var cells2 = [];
        for (var rr = start2; rr < start2 + len2; rr++) {
          var id2 = rr * W + c; cells2.push(id2); cellDown[id2] = slots.length;
        }
        slots.push({ id: slots.length, dir: 1, r: start2, c: c, len: len2, cells: cells2 });
      }
    }
  }
  return { slots: slots, cellAcross: cellAcross, cellDown: cellDown };
}

// ---------- fill a backtracking ----------
function fillSlots(slots, bank, W, H, rnd, budget) {
  var nCells = W * H;
  var letters = new Array(nCells).fill(0); // 0 = vuota; altrimenti char
  var counts = new Array(nCells).fill(0);  // quanti slot assegnati coprono la cella
  var used = new Set();
  var assigned = new Array(slots.length).fill(null);
  var fixedCount = new Array(slots.length).fill(0); // celle gia vincolate per slot
  var nAssigned = 0;
  var backtracks = 0;

  // mappa cella -> slot che la attraversano; crossOf[s] = slot incrocianti
  var cellToSlots = {};
  var crossOf = [];
  for (var s0 = 0; s0 < slots.length; s0++) {
    for (var i0 = 0; i0 < slots[s0].len; i0++) {
      var id0 = slots[s0].cells[i0];
      if (!cellToSlots[id0]) cellToSlots[id0] = [];
      cellToSlots[id0].push(s0);
    }
  }
  for (var s1 = 0; s1 < slots.length; s1++) {
    var set = new Set();
    for (var i1 = 0; i1 < slots[s1].len; i1++) {
      var arr0 = cellToSlots[slots[s1].cells[i1]];
      for (var a0 = 0; a0 < arr0.length; a0++) if (arr0[a0] !== s1) set.add(arr0[a0]);
    }
    crossOf[s1] = Array.from(set);
  }

  function updFixed(id, delta, exceptSlot) {
    var arr = cellToSlots[id];
    for (var a = 0; a < arr.length; a++) if (arr[a] !== exceptSlot) fixedCount[arr[a]] += delta;
  }

  // candidati per uno slot dato lo stato attuale (limit = early stop opzionale)
  function candidates(slot, limit) {
    var L = slot.len;
    var pool = bank.byLen[L];
    if (!pool) return [];
    var fixed = null, fcount = 0;
    for (var i = 0; i < L; i++) {
      var id = slot.cells[i];
      if (counts[id] > 0) {
        if (!fixed) fixed = [];
        fixed.push(i); fixed.push(letters[id]); fcount++;
      }
    }
    var base;
    if (fcount === 0) {
      base = pool;
    } else {
      var best = null;
      for (var f = 0; f < fcount; f++) {
        var b = bank.posIndex[L][fixed[f * 2]].get(fixed[f * 2 + 1]);
        if (!b) return [];
        if (best === null || b.length < best.length) best = b;
      }
      base = best;
    }
    var out = [];
    for (var j = 0; j < base.length; j++) {
      var w = base[j];
      if (used.has(w)) continue;
      var ok = true;
      if (fcount) {
        for (var g = 0; g < fcount; g++) {
          if (w.charAt(fixed[g * 2]) !== fixed[g * 2 + 1]) { ok = false; break; }
        }
      }
      if (ok) { out.push(w); if (limit && out.length >= limit) break; }
    }
    return out;
  }

  function placeFix(slot, word) {
    var touched = [];
    for (var i = 0; i < slot.len; i++) {
      var id = slot.cells[i];
      if (counts[id] === 0) { letters[id] = word.charAt(i); touched.push(id); updFixed(id, 1, slot.id); }
      counts[id]++;
    }
    used.add(word); assigned[slot.id] = word;
    return touched;
  }
  function unplaceFix(slot, word, touched) {
    for (var i = 0; i < slot.len; i++) counts[slot.cells[i]]--;
    for (var t = 0; t < touched.length; t++) { letters[touched[t]] = 0; updFixed(touched[t], -1, slot.id); }
    used.delete(word); assigned[slot.id] = null;
  }

  // ordine statico dei "semi": slot con piu incroci e piu lunghi prima
  var seedOrder = slots.map(function (s) { return s.id; });
  seedOrder.sort(function (a, b) {
    var d = crossOf[b].length - crossOf[a].length;
    if (d !== 0) return d;
    return slots[b].len - slots[a].len;
  });

  function pickSlot() {
    var bestId = -1, bestN = Infinity, anyFixed = false;
    for (var s = 0; s < slots.length; s++) {
      if (assigned[s] !== null) continue;
      if (fixedCount[s] > 0) {
        anyFixed = true;
        var cap = (bestN === Infinity) ? 0 : bestN + 1;
        var n = candidates(slots[s], cap).length;
        if (n < bestN) { bestN = n; bestId = s; if (n === 0) break; }
      }
    }
    if (anyFixed) return { id: bestId, n: bestN };
    for (var k = 0; k < seedOrder.length; k++) {
      if (assigned[seedOrder[k]] === null) return { id: seedOrder[k], n: -1 };
    }
    return { id: -1, n: 0 };
  }

  function solve() {
    if (nAssigned === slots.length) return true;
    if (backtracks > budget) return false;
    var pick = pickSlot();
    if (pick.id === -1) return true;
    var slot = slots[pick.id];
    var cands = candidates(slot, 0);
    if (cands.length === 0) { backtracks++; return false; }
    shuffleInPlace(cands, rnd);
    var tryMax = Math.min(cands.length, 30);
    for (var ci = 0; ci < tryMax; ci++) {
      var word = cands[ci];
      var touched = placeFix(slot, word);
      nAssigned++;
      var fcOk = true;
      var cr = crossOf[slot.id];
      for (var x = 0; x < cr.length; x++) {
        if (assigned[cr[x]] !== null) continue;
        if (fixedCount[cr[x]] > 0 && candidates(slots[cr[x]], 1).length === 0) { fcOk = false; break; }
      }
      if (fcOk && solve()) return true;
      unplaceFix(slot, word, touched);
      nAssigned--;
      if (backtracks > budget) return false;
    }
    backtracks++;
    return false;
  }

  var ok = solve();
  return ok ? { letters: letters } : null;
}

// ---------- numerazione e output finale ----------
function finalizeDense(black, letters, W, H, answerToClues, rnd) {
  // sceglie una definizione tra quelle disponibili (più definizioni = varietà tra una griglia e l'altra)
  function pickClue(w) {
    var arr = answerToClues.get(w);
    if (!arr || !arr.length) return null;
    if (arr.length === 1) return arr[0];
    var r = (typeof rnd === "function") ? rnd() : Math.random();
    return arr[Math.min(arr.length - 1, (r * arr.length) | 0)];
  }
  var cells = [];
  for (var r = 0; r < H; r++) {
    cells[r] = [];
    for (var c = 0; c < W; c++) {
      if (black[r][c]) cells[r][c] = null;
      else cells[r][c] = { ch: letters[r * W + c], num: 0 };
    }
  }
  var across = [], down = [], ghosts = [];
  var num = 0;
  function read(r, c, dr, dc) {
    var s = "", rr = r, cc = c;
    while (rr >= 0 && rr < H && cc >= 0 && cc < W && cells[rr][cc]) { s += cells[rr][cc].ch; rr += dr; cc += dc; }
    return s;
  }
  for (var r2 = 0; r2 < H; r2++) {
    for (var c2 = 0; c2 < W; c2++) {
      if (!cells[r2][c2]) continue;
      var leftBlack = c2 === 0 || !cells[r2][c2 - 1];
      var rightOk = c2 + 1 < W && cells[r2][c2 + 1];
      var upBlack = r2 === 0 || !cells[r2 - 1][c2];
      var downOk = r2 + 1 < H && cells[r2 + 1][c2];
      var startsAcross = leftBlack && rightOk;
      var startsDown = upBlack && downOk;
      if (startsAcross || startsDown) {
        num++;
        cells[r2][c2].num = num;
        if (startsAcross) {
          var wA = read(r2, c2, 0, 1);
          var clueA = pickClue(wA);
          if (clueA == null) ghosts.push(wA);
          across.push({ num: num, clue: clueA || "(?)", answer: wA, row: r2, col: c2, len: wA.length });
        }
        if (startsDown) {
          var wD = read(r2, c2, 1, 0);
          var clueD = pickClue(wD);
          if (clueD == null) ghosts.push(wD);
          down.push({ num: num, clue: clueD || "(?)", answer: wD, row: r2, col: c2, len: wD.length });
        }
      }
    }
  }
  return { width: W, height: H, cells: cells, across: across, down: down,
           wordCount: across.length + down.length, ghosts: ghosts };
}

// ---------- entry point ----------
function attemptDense(bank, W, H, blackProb, maxRun, patternAttempts, fillBudget, seed, sampleTarget) {
  var best = null;
  var sampled = 0;
  sampleTarget = sampleTarget || 4;
  for (var att = 0; att < patternAttempts; att++) {
    var rnd = mulberry32(seed + att * 2654435761);
    var bp = blackProb + (rnd() - 0.5) * 0.05;
    var black = makePattern(W, H, bp, rnd, maxRun);
    var quality = analyzePattern(black, W, H);
    if (!quality.whiteConnected || quality.blackSquares > 0 || quality.maxBlackRun > 3) continue;
    var ex = extractSlots(black, W, H);
    if (ex.slots.length < 6) continue;
    var feasible = true;
    for (var s = 0; s < ex.slots.length; s++) {
      var L = ex.slots[s].len;
      if (!bank.byLen[L] || bank.byLen[L].length === 0) { feasible = false; break; }
    }
    if (!feasible) continue;
    var filled = fillSlots(ex.slots, bank, W, H, rnd, fillBudget);
    if (filled) {
      var res = finalizeDense(black, filled.letters, W, H, bank.answerToClues, rnd);
      var score = quality.whiteTotal * 1000 + res.wordCount * 20 - res.ghosts.length * 100000;
      if (!best || score > best.score) best = { result: res, score: score };
      if (res.ghosts.length === 0) {
        sampled++;
        if (sampled >= sampleTarget) return best.result;
      }
    }
  }
  return best ? best.result : null;
}

function generateDenseCrossword(rawEntries, opts) {
  opts = opts || {};
  var maxSide = opts.maxSide || 11;
  var W = opts.width || maxSide;
  var H = opts.height || maxSide;
  var blackProb = opts.blackProb || 0.22;
  var maxRun = opts.maxRun || 6;
  var patternAttempts = opts.patternAttempts || 150;
  var fillBudget = opts.fillBudget || 8000;
  var minLen = opts.minLen || 2;
  var maxLen = opts.maxLen || Math.max(W, H);
  var minFallbackSide = opts.minFallbackSide || 5;
  var sampleTarget = opts.sampleTarget || 4;
  var seed = (opts.seed != null) ? opts.seed : (Date.now() >>> 0);

  var bank = buildBank(rawEntries, minLen, maxLen);

  // cascata di configurazioni: dalla richiesta a fallback via via piu facili
  var plans = [
    { W: W, H: H, bp: blackProb, mr: maxRun, att: patternAttempts, bud: fillBudget },
    { W: W, H: H, bp: blackProb + 0.01, mr: maxRun, att: patternAttempts, bud: fillBudget + 5000 },
    { W: W, H: H, bp: blackProb + 0.02, mr: maxRun, att: patternAttempts, bud: fillBudget + 8000 }
  ];
  // riduzione dimensione come ultima spiaggia
  var rW = Math.max(minFallbackSide, W - 2), rH = Math.max(minFallbackSide, H - 2);
  if (rW < W || rH < H) {
    plans.push({ W: rW, H: rH, bp: blackProb + 0.01, mr: maxRun, att: patternAttempts, bud: fillBudget + 4000 });
    plans.push({ W: rW, H: rH, bp: blackProb + 0.02, mr: maxRun, att: patternAttempts, bud: fillBudget + 7000 });
  }

  for (var p = 0; p < plans.length; p++) {
    var pl = plans[p];
    var r = attemptDense(bank, pl.W, pl.H, pl.bp, pl.mr, pl.att, pl.bud, seed + p * 7919, sampleTarget);
    if (r && r.ghosts.length === 0) return r;
    if (r && p === plans.length - 1) return r; // ultima spiaggia: accetta anche con ghost
  }
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { generateDenseCrossword: generateDenseCrossword, buildBank: buildBank,
                     makePattern: makePattern, extractSlots: extractSlots };
}

if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  self.onmessage = function (e) {
    var entries = e.data.entries;
    var opts = e.data.opts || {};
    var t0 = Date.now();
    try {
      var puzzle = generateDenseCrossword(entries, opts);
      self.postMessage({ ok: !!puzzle, puzzle: puzzle, ms: Date.now() - t0 });
    } catch (err) {
      self.postMessage({ ok: false, error: String(err && err.message || err) });
    }
  };
}
