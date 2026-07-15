// SPDX-License-Identifier: GPL-3.0-only
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
function makeFullBits(n) {
  var bits = new Uint32Array(Math.ceil(n / 32));
  for (var i = 0; i < bits.length; i++) bits[i] = 0xFFFFFFFF;
  var rem = n & 31;
  if (rem) bits[bits.length - 1] = (1 << rem) - 1;
  return bits;
}
function cloneBits(bits) {
  return new Uint32Array(bits);
}
function andBitsInto(dst, src) {
  for (var i = 0; i < dst.length; i++) dst[i] &= src[i];
}
function iterBits(bits, fn) {
  for (var bi = 0; bi < bits.length; bi++) {
    var x = bits[bi];
    while (x) {
      var lsb = x & -x;
      var bit = 31 - Math.clz32(lsb);
      if (fn((bi << 5) + bit) === false) return;
      x ^= lsb;
    }
  }
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
  var allBits = {};
  var posBits = {};
  for (var lenKey in byLen) {
    var L2 = Number(lenKey);
    var words = byLen[L2];
    allBits[L2] = makeFullBits(words.length);
    posBits[L2] = [];
    for (var pi = 0; pi < L2; pi++) {
      posBits[L2][pi] = new Map();
      for (var wi = 0; wi < words.length; wi++) {
        var ch2 = words[wi].charAt(pi);
        var bits = posBits[L2][pi].get(ch2);
        if (!bits) { bits = new Uint32Array(Math.ceil(words.length / 32)); posBits[L2][pi].set(ch2, bits); }
        bits[wi >>> 5] |= (1 << (wi & 31));
      }
    }
  }
  return { answerToClues: answerToClues, byLen: byLen, posIndex: posIndex,
           allBits: allBits, posBits: posBits };
}

// ---------- pattern di caselle nere ----------
// Ritorna matrice booleana black[r][c]. Garantisce: nessuna cella bianca isolata
// (lunghezza 1 sia in orizzontale sia in verticale).
function makePattern(W, H, blackProb, rnd, maxRun, seedCross) {
  maxRun = maxRun || 7;
  var black = [];
  for (var r = 0; r < H; r++) {
    black[r] = [];
    for (var c = 0; c < W; c++) black[r][c] = (rnd() < blackProb);
  }
  var protectedWhite = {};
  var protectedBlack = {};

  function key(r, c) { return r + "," + c; }
  function protectWhite(r, c) {
    if (r < 0 || r >= H || c < 0 || c >= W) return;
    black[r][c] = false;
    protectedWhite[key(r, c)] = true;
    delete protectedBlack[key(r, c)];
  }
  function protectBlack(r, c) {
    if (r < 0 || r >= H || c < 0 || c >= W) return;
    black[r][c] = true;
    protectedBlack[key(r, c)] = true;
    delete protectedWhite[key(r, c)];
  }
  function applySeedCross() {
    if (!seedCross) return;
    var i;
    for (i = 0; i < seedCross.across.len; i++) protectWhite(seedCross.row, seedCross.across.c + i);
    for (i = 0; i < seedCross.down.len; i++) protectWhite(seedCross.down.r + i, seedCross.col);
    protectBlack(seedCross.row, seedCross.across.c - 1);
    protectBlack(seedCross.row, seedCross.across.c + seedCross.across.len);
    protectBlack(seedCross.down.r - 1, seedCross.col);
    protectBlack(seedCross.down.r + seedCross.down.len, seedCross.col);
  }
  applySeedCross();
  // evita run orizzontali/verticali troppo lunghi: spezzali con una nera
  function fixLongRuns() {
    var r, c, run;
    for (r = 0; r < H; r++) {
      run = 0;
      for (c = 0; c < W; c++) {
        if (black[r][c]) { run = 0; }
        else {
          run++;
          if (run > maxRun && !protectedWhite[key(r, c)]) { black[r][c] = true; run = 0; }
        }
      }
    }
    for (c = 0; c < W; c++) {
      run = 0;
      for (r = 0; r < H; r++) {
        if (black[r][c]) { run = 0; }
        else {
          run++;
          if (run > maxRun && !protectedWhite[key(r, c)]) { black[r][c] = true; run = 0; }
        }
      }
    }
  }

  function fixBadBlackPatterns() {
    var changed = false;
    var r, c, run;

    for (r = 0; r + 1 < H; r++) {
      for (c = 0; c + 1 < W; c++) {
        if (black[r][c] && black[r + 1][c] && black[r][c + 1] && black[r + 1][c + 1]) {
          if (protectedBlack[key(r + 1, c + 1)]) continue;
          black[r + 1][c + 1] = false;
          changed = true;
        }
      }
    }

    for (r = 0; r + 1 < H; r++) {
      for (c = 0; c + 1 < W; c++) {
        var cells = [
          { r: r, c: c },
          { r: r, c: c + 1 },
          { r: r + 1, c: c },
          { r: r + 1, c: c + 1 }
        ];
        var blacks = [];
        for (var bi = 0; bi < cells.length; bi++) {
          if (black[cells[bi].r][cells[bi].c]) blacks.push(cells[bi]);
        }
        if (blacks.length === 3) {
          var cleared = false;
          for (var bj = blacks.length - 1; bj >= 0; bj--) {
            if (protectedBlack[key(blacks[bj].r, blacks[bj].c)]) continue;
            black[blacks[bj].r][blacks[bj].c] = false;
            changed = true;
            cleared = true;
            break;
          }
          if (!cleared) continue;
        }
      }
    }

    for (r = 0; r < H; r++) {
      run = 0;
      for (c = 0; c < W; c++) {
        if (black[r][c]) {
          run++;
          if (run > 3 && !protectedBlack[key(r, c)]) {
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
          if (run > 3 && !protectedBlack[key(r, c)]) {
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

  function fixLargeBlackComponents() {
    var seen = {};
    var changed = false;
    function blackNeighbors(r, c) {
      var n = 0;
      if (r > 0 && black[r - 1][c]) n++;
      if (r + 1 < H && black[r + 1][c]) n++;
      if (c > 0 && black[r][c - 1]) n++;
      if (c + 1 < W && black[r][c + 1]) n++;
      return n;
    }
    for (var sr = 0; sr < H; sr++) {
      for (var sc = 0; sc < W; sc++) {
        var startKey = key(sr, sc);
        if (!black[sr][sc] || seen[startKey]) continue;
        var comp = [];
        var q = [{ r: sr, c: sc }];
        seen[startKey] = true;
        while (q.length) {
          var cur = q.pop();
          comp.push(cur);
          var ns = [
            { r: cur.r - 1, c: cur.c },
            { r: cur.r + 1, c: cur.c },
            { r: cur.r, c: cur.c - 1 },
            { r: cur.r, c: cur.c + 1 }
          ];
          for (var ni = 0; ni < ns.length; ni++) {
            var n = ns[ni];
            var nk = key(n.r, n.c);
            if (n.r < 0 || n.r >= H || n.c < 0 || n.c >= W) continue;
            if (!black[n.r][n.c] || seen[nk]) continue;
            seen[nk] = true;
            q.push(n);
          }
        }
        while (comp.length > 2) {
          var victim = -1, victimScore = -1;
          for (var ci = 0; ci < comp.length; ci++) {
            var cell = comp[ci];
            if (!black[cell.r][cell.c] || protectedBlack[key(cell.r, cell.c)]) continue;
            var score = blackNeighbors(cell.r, cell.c);
            if (score > victimScore) { victimScore = score; victim = ci; }
          }
          if (victim < 0) break;
          black[comp[victim].r][comp[victim].c] = false;
          changed = true;
          comp.splice(victim, 1);
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
        if (acrossLen(r2, c2) < 2 && downLen(r2, c2) < 2 && !protectedWhite[key(r2, c2)]) {
          black[r2][c2] = true; changed = true;
        }
      }
    }
  }

  for (var cleanup = 0; cleanup < 8; cleanup++) {
    fixLongRuns();
    var fixedBad = fixBadBlackPatterns();
    var fixedGroups = fixLargeBlackComponents();
    if (!fixedBad && !fixedGroups) break;
  }
  applySeedCross();
  for (var finalCleanup = 0; finalCleanup < 4; finalCleanup++) {
    var finalBad = fixBadBlackPatterns();
    var finalGroups = fixLargeBlackComponents();
    if (!finalBad && !finalGroups) break;
  }
  return black;
}

function analyzePattern(black, W, H) {
  var r, c;
  var whiteTotal = 0;
  var firstWhite = null;
  var blackSquares = 0;
  var blackElbows = 0;
  var maxBlackGroup = 0;
  var blackGroups3 = 0;
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
      if (r + 1 < H && c + 1 < W) {
        var nBlack = (black[r][c] ? 1 : 0) + (black[r][c + 1] ? 1 : 0) +
          (black[r + 1][c] ? 1 : 0) + (black[r + 1][c + 1] ? 1 : 0);
        if (nBlack === 3) blackElbows++;
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

  var seenBlack = {};
  for (r = 0; r < H; r++) {
    for (c = 0; c < W; c++) {
      var bk = r + "," + c;
      if (!black[r][c] || seenBlack[bk]) continue;
      var size = 0;
      var bq = [{ r: r, c: c }];
      seenBlack[bk] = true;
      while (bq.length) {
        var bcur = bq.pop();
        size++;
        var bns = [
          { r: bcur.r - 1, c: bcur.c },
          { r: bcur.r + 1, c: bcur.c },
          { r: bcur.r, c: bcur.c - 1 },
          { r: bcur.r, c: bcur.c + 1 }
        ];
        for (var bn = 0; bn < bns.length; bn++) {
          var nb = bns[bn];
          var nbk = nb.r + "," + nb.c;
          if (nb.r < 0 || nb.r >= H || nb.c < 0 || nb.c >= W) continue;
          if (!black[nb.r][nb.c] || seenBlack[nbk]) continue;
          seenBlack[nbk] = true;
          bq.push(nb);
        }
      }
      if (size > maxBlackGroup) maxBlackGroup = size;
      if (size >= 3) blackGroups3++;
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
    blackElbows: blackElbows,
    maxBlackGroup: maxBlackGroup,
    blackGroups3: blackGroups3,
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
function fillSlots(slots, bank, W, H, rnd, budget, forcedPlacements, stats, progress, allowNearDuplicates, candidateJitter) {
  var nCells = W * H;
  var letters = new Array(nCells).fill(0); // 0 = vuota; altrimenti char
  var counts = new Array(nCells).fill(0);  // quanti slot assegnati coprono la cella
  var used = new Set();
  var usedByLen = {};
  var assigned = new Array(slots.length).fill(null);
  var fixedCount = new Array(slots.length).fill(0); // celle gia vincolate per slot
  var nAssigned = 0;
  var backtracks = 0;
  var solveNodes = 0;
  var nodeBudget = Math.max(12000, budget * 8);
  var searchCutoff = false;
  candidateJitter = candidateJitter || 1;

  // mappa cella -> slot che la attraversano; crossOf[s] = slot incrocianti
  var cellToSlots = {};
  var crossOf = [];
  var cellPosInSlot = [];
  for (var s0 = 0; s0 < slots.length; s0++) {
    cellPosInSlot[s0] = {};
    for (var i0 = 0; i0 < slots[s0].len; i0++) {
      var id0 = slots[s0].cells[i0];
      cellPosInSlot[s0][id0] = i0;
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

  function differsByOneLetter(a, b) {
    if (a.length !== b.length) return false;
    var diffs = 0;
    for (var i = 0; i < a.length; i++) {
      if (a.charAt(i) !== b.charAt(i)) {
        diffs++;
        if (diffs > 1) return false;
      }
    }
    return diffs === 1;
  }

  function tooCloseToUsed(word) {
    var sameLen = usedByLen[word.length];
    if (!sameLen) return false;
    for (var i = 0; i < sameLen.length; i++) {
      if (differsByOneLetter(word, sameLen[i])) return true;
    }
    return false;
  }

  function canUseWord(word) {
    return !used.has(word) && (allowNearDuplicates || !tooCloseToUsed(word));
  }

  function domainBits(slot) {
    if (stats) stats.candidateCalls++;
    var L = slot.len;
    if (!bank.byLen[L]) return null;
    var domain = bank.allBits[L] ? cloneBits(bank.allBits[L]) : null;
    if (!domain) return null;
    var fcount = 0;
    for (var i = 0; i < L; i++) {
      var id = slot.cells[i];
      if (counts[id] > 0) {
        var bits = bank.posBits[L][i].get(letters[id]);
        if (!bits) return null;
        andBitsInto(domain, bits);
        fcount++;
      }
    }
    if (stats && fcount > 0) stats.constrainedCandidateCalls++;
    return domain;
  }

  function candidateCount(slot, limit) {
    var L = slot.len;
    var pool = bank.byLen[L];
    if (!pool) return 0;
    var domain = domainBits(slot);
    if (!domain) return 0;
    var n = 0;
    iterBits(domain, function (j) {
      if (j >= pool.length) return false;
      if (!canUseWord(pool[j])) return;
      n++;
      if (limit && n >= limit) return false;
    });
    return n;
  }

  // candidati per uno slot dato lo stato attuale (limit = early stop opzionale)
  function candidates(slot, limit) {
    var L = slot.len;
    var pool = bank.byLen[L];
    var domain = domainBits(slot);
    if (!pool || !domain) return [];
    var out = [];
    iterBits(domain, function (j) {
      if (j >= pool.length) return false;
      var w = pool[j];
      if (!canUseWord(w)) return;
      out.push(w);
      if (limit && out.length >= limit) return false;
    });
    if (stats) {
      stats.candidateWords += out.length;
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
    if (!usedByLen[word.length]) usedByLen[word.length] = [];
    usedByLen[word.length].push(word);
    return touched;
  }
  function unplaceFix(slot, word, touched) {
    for (var i = 0; i < slot.len; i++) counts[slot.cells[i]]--;
    for (var t = 0; t < touched.length; t++) { letters[touched[t]] = 0; updFixed(touched[t], -1, slot.id); }
    used.delete(word); assigned[slot.id] = null;
    var sameLen = usedByLen[word.length];
    if (sameLen) {
      var idx = sameLen.lastIndexOf(word);
      if (idx !== -1) sameLen.splice(idx, 1);
      if (sameLen.length === 0) delete usedByLen[word.length];
    }
  }

  forcedPlacements = forcedPlacements || [];
  for (var fp = 0; fp < forcedPlacements.length; fp++) {
    var forced = forcedPlacements[fp];
    if (!forced || assigned[forced.slotId] !== null) continue;
    if (!canUseWord(forced.word)) return null;
    placeFix(slots[forced.slotId], forced.word);
    nAssigned++;
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
        var n = candidateCount(slots[s], cap);
        if (n < bestN) { bestN = n; bestId = s; if (n === 0) break; }
      }
    }
    if (anyFixed) return { id: bestId, n: bestN };
    for (var k = 0; k < seedOrder.length; k++) {
      if (assigned[seedOrder[k]] === null) return { id: seedOrder[k], n: -1 };
    }
    return { id: -1, n: 0 };
  }

  function scoreCandidate(slot, word, rndTie) {
    var score = rndTie * candidateJitter;
    for (var i = 0; i < slot.len; i++) {
      var id = slot.cells[i];
      var arr = cellToSlots[id];
      for (var a = 0; a < arr.length; a++) {
        var other = arr[a];
        if (other === slot.id || assigned[other] !== null) continue;
        var otherSlot = slots[other];
        var pos = cellPosInSlot[other][id];
        var bucket = bank.posIndex[otherSlot.len] && bank.posIndex[otherSlot.len][pos] &&
          bank.posIndex[otherSlot.len][pos].get(word.charAt(i));
        if (!bucket || bucket.length === 0) return -1000000;
        score += Math.min(250, bucket.length);
      }
    }
    return score;
  }

  function solve() {
    if (nAssigned === slots.length) return true;
    solveNodes++;
    if (backtracks > budget || solveNodes > nodeBudget) {
      searchCutoff = true;
      return false;
    }
    if (searchCutoff) return false;
    if (stats) stats.solveNodes++;
    if (progress && stats && (stats.solveNodes & 4095) === 0) progress("fill");
    var pick = pickSlot();
    if (pick.id === -1) return true;
    var slot = slots[pick.id];
    var cands = candidates(slot, 0);
    if (cands.length === 0) { backtracks++; return false; }
    var scored = [];
    for (var si = 0; si < cands.length; si++) {
      scored.push({ word: cands[si], score: scoreCandidate(slot, cands[si], rnd()) });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    var tryMax = Math.min(cands.length, slot.len >= 7 ? 90 : 55);
    for (var ci = 0; ci < tryMax; ci++) {
      var word = scored[ci].word;
      var touched = placeFix(slot, word);
      nAssigned++;
      var fcOk = true;
      var cr = crossOf[slot.id];
      for (var x = 0; x < cr.length; x++) {
        if (assigned[cr[x]] !== null) continue;
        if (fixedCount[cr[x]] > 0 && candidateCount(slots[cr[x]], 1) === 0) { fcOk = false; break; }
      }
      if (fcOk && solve()) return true;
      unplaceFix(slot, word, touched);
      nAssigned--;
      if (searchCutoff || backtracks > budget) return false;
    }
    backtracks++;
    return false;
  }

  var ok = solve();
  if (stats) {
    stats.backtracks += backtracks;
    if (searchCutoff) stats.searchCutoffs++;
  }
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

function isVowelChar(ch) {
  return ch === "A" || ch === "E" || ch === "I" || ch === "O" || ch === "U";
}

function parallelVowelAlternationScore(res) {
  function scoreList(words, horizontal) {
    var score = 0;
    for (var a = 0; a < words.length; a++) {
      for (var b = a + 1; b < words.length; b++) {
        var wa = words[a], wb = words[b];
        if (horizontal) {
          if (Math.abs(wa.row - wb.row) !== 1) continue;
          var c0 = Math.max(wa.col, wb.col);
          var c1 = Math.min(wa.col + wa.len, wb.col + wb.len);
          if (c1 - c0 < 3) continue;
          for (var c = c0; c < c1; c++) {
            score += (isVowelChar(wa.answer.charAt(c - wa.col)) !==
              isVowelChar(wb.answer.charAt(c - wb.col))) ? 8 : -3;
          }
        } else {
          if (Math.abs(wa.col - wb.col) !== 1) continue;
          var r0 = Math.max(wa.row, wb.row);
          var r1 = Math.min(wa.row + wa.len, wb.row + wb.len);
          if (r1 - r0 < 3) continue;
          for (var r = r0; r < r1; r++) {
            score += (isVowelChar(wa.answer.charAt(r - wa.row)) !==
              isVowelChar(wb.answer.charAt(r - wb.row))) ? 8 : -3;
          }
        }
      }
    }
    return score;
  }
  return scoreList(res.across, true) + scoreList(res.down, false);
}

function chooseSeedCross(bank, W, H, rnd, opts) {
  opts = opts || {};
  if (W < 7 || H < 7) return null;
  var maxAcross = Math.min(W - 2, opts.maxLen || W, Math.max(5, Math.ceil(W * 0.55)), 12);
  var maxDown = Math.min(H - 2, opts.maxLen || H, Math.max(5, Math.ceil(H * 0.55)), 10);
  var minAcross = Math.max(4, Math.min(maxAcross, Math.floor(W * 0.30)));
  var minDown = Math.max(4, Math.min(maxDown, Math.floor(H * 0.30)));
  var minAlternatives = opts.seedMinAlternatives || 16;

  function lengths(minLen, maxLen) {
    var arr = [], L;
    for (L = maxLen; L >= minLen; L--) {
      if (bank.byLen[L] && bank.byLen[L].length >= minAlternatives) arr.push(L);
    }
    if (!arr.length) {
      for (L = maxLen; L >= minLen; L--) if (bank.byLen[L] && bank.byLen[L].length) arr.push(L);
    }
    return arr;
  }

  var acrossLens = lengths(minAcross, maxAcross);
  var downLens = lengths(minDown, maxDown);
  if (!acrossLens.length || !downLens.length) return null;

  var centerR = Math.floor(H / 2);
  var centerC = Math.floor(W / 2);
  var maxRun = opts.maxRun || 7;
  var bestSeed = null;
  var bestScore = -Infinity;

  function letterFlex(maxLen, fixedCoord, span, ch) {
    var score = 0;
    var maxL = Math.min(maxLen, maxRun);
    for (var L = 2; L <= maxL; L++) {
      if (!bank.byLen[L]) continue;
      var pMin = Math.max(0, fixedCoord - (span - L));
      var pMax = Math.min(L - 1, fixedCoord);
      for (var p = pMin; p <= pMax; p++) {
        var arr = bank.posIndex[L] && bank.posIndex[L][p] && bank.posIndex[L][p].get(ch);
        if (arr) score += Math.min(80, arr.length);
      }
    }
    return score;
  }

  var tries = opts.seedTries || 160;
  function pickSeedLen(arr) {
    var n = Math.min(arr.length, 10);
    return arr[Math.floor(Math.pow(rnd(), 0.75) * n)];
  }
  while (tries-- > 0) {
    var aLen = pickSeedLen(acrossLens);
    var dLen = pickSeedLen(downLens);
    var aWords = bank.byLen[aLen];
    if (!aWords || !bank.byLen[dLen]) continue;
    var aWord = aWords[Math.floor(rnd() * aWords.length)];
    var aIxMin = Math.max(1, centerC - Math.min(W - aLen - 1, centerC));
    var aIxMax = Math.min(aLen - 2, centerC - 1);
    var dIxMin = Math.max(1, centerR - Math.min(H - dLen - 1, centerR));
    var dIxMax = Math.min(dLen - 2, centerR - 1);
    if (aIxMin > aIxMax || dIxMin > dIxMax) continue;
    var aIx = aIxMin + Math.floor(rnd() * (aIxMax - aIxMin + 1));
    var dIx = dIxMin + Math.floor(rnd() * (dIxMax - dIxMin + 1));
    var ch = aWord.charAt(aIx);
    var bucket = bank.posIndex[dLen] && bank.posIndex[dLen][dIx] && bank.posIndex[dLen][dIx].get(ch);
    if (!bucket || bucket.length < Math.min(3, minAlternatives)) continue;
    var dWord = bucket[Math.floor(rnd() * bucket.length)];
    if (dWord === aWord) continue;
    var seed = {
      row: centerR,
      col: centerC,
      across: { r: centerR, c: centerC - aIx, len: aLen, word: aWord },
      down: { r: centerR - dIx, c: centerC, len: dLen, word: dWord }
    };
    var score = (aLen + dLen) * 35 + Math.min(360, bucket.length * 14);
    var ai;
    for (ai = 0; ai < aLen; ai++) {
      if (ai === aIx) continue;
      score += letterFlex(H, centerR, H, aWord.charAt(ai));
    }
    for (ai = 0; ai < dLen; ai++) {
      if (ai === dIx) continue;
      score += letterFlex(W, centerC, W, dWord.charAt(ai));
    }
    score += rnd();
    if (score > bestScore) { bestScore = score; bestSeed = seed; }
  }
  return bestSeed;
}

function findForcedPlacements(slots, seedCross) {
  var out = [];
  if (!seedCross) return out;
  for (var s = 0; s < slots.length; s++) {
    var slot = slots[s];
    if (slot.dir === 0 && slot.r === seedCross.across.r && slot.c === seedCross.across.c &&
        slot.len === seedCross.across.len) {
      out.push({ slotId: slot.id, word: seedCross.across.word });
    }
    if (slot.dir === 1 && slot.r === seedCross.down.r && slot.c === seedCross.down.c &&
        slot.len === seedCross.down.len) {
      out.push({ slotId: slot.id, word: seedCross.down.word });
    }
  }
  return out;
}

function seedDomainCheck(slots, bank, forcedPlacements) {
  if (!forcedPlacements || !forcedPlacements.length) return { ok: true, score: 0 };
  var forcedBySlot = {};
  var fixedLetters = {};
  for (var fp = 0; fp < forcedPlacements.length; fp++) {
    forcedBySlot[forcedPlacements[fp].slotId] = true;
    var slot = slots[forcedPlacements[fp].slotId];
    var word = forcedPlacements[fp].word;
    for (var i = 0; i < slot.len; i++) fixedLetters[slot.cells[i]] = word.charAt(i);
  }
  var score = 0;
  for (var s = 0; s < slots.length; s++) {
    if (forcedBySlot[s]) continue;
    var slot2 = slots[s];
    var fixed = null, fcount = 0;
    for (var j = 0; j < slot2.len; j++) {
      var ch = fixedLetters[slot2.cells[j]];
      if (ch) {
        if (!fixed) fixed = [];
        fixed.push(j); fixed.push(ch);
        fcount++;
      }
    }
    if (!fcount) continue;
    var best = null;
    for (var f = 0; f < fcount; f++) {
      var b = bank.posIndex[slot2.len] && bank.posIndex[slot2.len][fixed[f * 2]] &&
        bank.posIndex[slot2.len][fixed[f * 2]].get(fixed[f * 2 + 1]);
      if (!b) return { ok: false, score: 0 };
      if (best === null || b.length < best.length) best = b;
    }
    var n = 0;
    for (var wi = 0; wi < best.length; wi++) {
      var w = best[wi], ok = true;
      for (var g = 0; g < fcount; g++) {
        if (w.charAt(fixed[g * 2]) !== fixed[g * 2 + 1]) { ok = false; break; }
      }
      if (ok) n++;
    }
    if (n === 0) return { ok: false, score: 0 };
    score += Math.min(500, n);
  }
  return { ok: true, score: score };
}

// ---------- entry point ----------
function attemptDense(bank, W, H, blackProb, maxRun, patternAttempts, fillBudget, seed, sampleTarget, stats, progress, limits) {
  var best = null;
  var sampled = 0;
  limits = limits || {};
  var maxBlackRatio = limits.maxBlackRatio || 1;
  var fillRetries = Math.max(1, limits.fillRetries || 1);
  var allowNearDuplicates = !!limits.allowNearDuplicates;
  var fillRetryJitter = limits.fillRetryJitter || 500;
  sampleTarget = sampleTarget || 4;
  for (var att = 0; att < patternAttempts; att++) {
    if (stats) stats.patterns++;
    if (progress && (att === 0 || att % 8 === 0)) progress("pattern");
    var rnd = mulberry32(seed + att * 2654435761);
    var bp = blackProb + (rnd() - 0.5) * 0.05;
    var seedCross = chooseSeedCross(bank, W, H, rnd, { maxLen: Math.max(W, H), maxRun: maxRun });
    var black = makePattern(W, H, bp, rnd, maxRun, seedCross);
    var quality = analyzePattern(black, W, H);
    if (!quality.whiteConnected) { if (stats) stats.rejectDisconnected++; continue; }
    if (quality.blackTotal / (W * H) > maxBlackRatio) {
      if (stats) stats.rejectDensity++;
      continue;
    }
    if (quality.blackSquares > 0) { if (stats) stats.rejectBlackSquares++; continue; }
    if (quality.maxBlackRun > 3) { if (stats) stats.rejectBlackRuns++; continue; }
    if (quality.maxBlackGroup > 2) { if (stats) stats.rejectBlackGroups++; continue; }
    var ex = extractSlots(black, W, H);
    if (ex.slots.length < 6) { if (stats) stats.rejectTooFewSlots++; continue; }
    var shortSlots = 0, twoSlots = 0;
    for (var ss = 0; ss < ex.slots.length; ss++) {
      if (ex.slots[ss].len <= 3) shortSlots++;
      if (ex.slots[ss].len === 2) twoSlots++;
    }
    var area = W * H;
    if (area >= 100 && area <= 169) {
      var maxShortShare = 0.42;
      var maxShortSlots = Math.max(10, Math.floor(ex.slots.length * maxShortShare));
      if (shortSlots > maxShortSlots) { if (stats) stats.rejectShortSlots++; continue; }
    }
    var feasible = true;
    for (var s = 0; s < ex.slots.length; s++) {
      var L = ex.slots[s].len;
      if (!bank.byLen[L] || bank.byLen[L].length === 0) { feasible = false; break; }
    }
    if (!feasible) { if (stats) stats.rejectNoLength++; continue; }
    var forcedPlacements = findForcedPlacements(ex.slots, seedCross);
    if (seedCross && forcedPlacements.length !== 2) { if (stats) stats.rejectSeedMismatch++; continue; }
    var seedCheck = seedDomainCheck(ex.slots, bank, forcedPlacements);
    if (!seedCheck.ok) { if (stats) stats.rejectSeedDomains++; continue; }
    var filled = null;
    var fillRnd = rnd;
    // Uno schema con poche nere e' costoso da trovare: una volta superati i
    // controlli di qualita', lo teniamo fermo e riproviamo il riempimento con
    // ordinamenti diversi prima di buttarlo via.
    for (var retry = 0; retry < fillRetries && !filled; retry++) {
      if (stats) stats.fillAttempts++;
      if (retry > 0) fillRnd = mulberry32(seed + att * 2654435761 + retry * 2246822519);
      filled = fillSlots(ex.slots, bank, W, H, fillRnd, fillBudget, forcedPlacements, stats, progress,
        allowNearDuplicates, retry > 0 ? fillRetryJitter : 1);
    }
    if (filled) {
      if (stats) stats.fillSuccess++;
      var res = finalizeDense(black, filled.letters, W, H, bank.answerToClues, fillRnd);
      var longest = 0, longWords = 0, totalLen = 0;
      var allWords = res.across.concat(res.down);
      for (var wi = 0; wi < allWords.length; wi++) {
        totalLen += allWords[wi].len;
        if (allWords[wi].len > longest) longest = allWords[wi].len;
        if (allWords[wi].len >= 7) longWords++;
      }
      var shortPenalty = shortSlots * 1450 + twoSlots * 850;
      var blackShapePenalty = (quality.blackElbows || 0) * 2600 + (quality.blackGroups3 || 0) * 20000;
      var vowelPatternScore = parallelVowelAlternationScore(res);
      var score = quality.whiteTotal * 1600 - quality.blackTotal * 900 +
        longest * 900 + longWords * 180 + totalLen * 12 +
        res.wordCount * 15 + vowelPatternScore * 18 - shortPenalty - blackShapePenalty -
        res.ghosts.length * 100000;
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
  var blackProb = opts.blackProb || 0.13;
  var maxRun = opts.maxRun || 7;
  var patternAttempts = opts.patternAttempts || 300;
  var fillBudget = opts.fillBudget || 16000;
  var minLen = opts.minLen || 2;
  var maxLen = opts.maxLen || Math.max(W, H);
  var minFallbackSide = opts.minFallbackSide || 5;
  var sampleTarget = opts.sampleTarget || 4;
  var maxBlackRatio = opts.maxBlackRatio || 1;
  var fillRetries = Math.max(1, opts.fillRetries || 1);
  var allowNearDuplicates = !!opts.allowNearDuplicates;
  var fillRetryJitter = opts.fillRetryJitter || 500;
  var area = W * H;
  if (area >= 100 && area <= 169 && sampleTarget < 2) sampleTarget = 2;
  var seed = (opts.seed != null) ? opts.seed : (Date.now() >>> 0);
  var wantsProgress = (typeof opts.onProgress === "function");
  var stats = (opts.collectStats || wantsProgress) ? {
    patterns: 0,
    rejectDisconnected: 0,
    rejectDensity: 0,
    rejectBlackSquares: 0,
    rejectBlackRuns: 0,
    rejectBlackGroups: 0,
    rejectTooFewSlots: 0,
    rejectNoLength: 0,
    rejectSeedMismatch: 0,
    rejectSeedDomains: 0,
    rejectShortSlots: 0,
    fillAttempts: 0,
    fillSuccess: 0,
    candidateCalls: 0,
    constrainedCandidateCalls: 0,
    candidateWords: 0,
    solveNodes: 0,
    backtracks: 0,
    searchCutoffs: 0,
    plans: []
  } : null;

  var bank = buildBank(rawEntries, minLen, maxLen);

  // cascata di configurazioni: dalla richiesta a fallback via via piu facili
  var largeGrid = area >= 160;
  var densityStep = largeGrid ? 0.01 : 0.015;
  var easierMaxRun = largeGrid ? Math.max(5, maxRun - 1) : maxRun;
  var lateBudgetBoost = largeGrid ? 6000 : 16000;
  var finalBudgetBoost = largeGrid ? 10000 : 20000;
  var plans = [
    { W: W, H: H, bp: blackProb, mr: maxRun, att: patternAttempts, bud: Math.max(6000, Math.floor(fillBudget * 0.35)) },
    { W: W, H: H, bp: blackProb + densityStep, mr: maxRun, att: patternAttempts, bud: Math.max(9000, Math.floor(fillBudget * 0.55)) },
    { W: W, H: H, bp: blackProb + densityStep * 2, mr: maxRun, att: patternAttempts, bud: fillBudget },
    { W: W, H: H, bp: blackProb + densityStep * 3, mr: easierMaxRun, att: patternAttempts, bud: fillBudget + lateBudgetBoost },
    { W: W, H: H, bp: blackProb + densityStep * 4, mr: easierMaxRun, att: patternAttempts, bud: fillBudget + finalBudgetBoost }
  ];
  // riduzione dimensione come ultima spiaggia
  var rW = Math.max(minFallbackSide, W - 2), rH = Math.max(minFallbackSide, H - 2);
  if (rW < W || rH < H) {
    plans.push({ W: rW, H: rH, bp: blackProb + densityStep, mr: maxRun, att: patternAttempts, bud: Math.max(9000, Math.floor(fillBudget * 0.55)) });
    plans.push({ W: rW, H: rH, bp: blackProb + densityStep * 2, mr: maxRun, att: patternAttempts, bud: fillBudget });
    plans.push({ W: rW, H: rH, bp: blackProb + densityStep * 3, mr: easierMaxRun, att: patternAttempts, bud: fillBudget + lateBudgetBoost });
  }

  var onProgress = wantsProgress ? opts.onProgress : null;
  var totalPatterns = 0;
  for (var tp = 0; tp < plans.length; tp++) totalPatterns += plans[tp].att;
  var lastProgressAt = 0;
  var maxProgress = 0;
  function emitProgress(kind, planIndex) {
    if (!onProgress) return;
    var now = Date.now();
    if (kind !== "done" && now - lastProgressAt < 180) return;
    lastProgressAt = now;
    var pl = plans[Math.min(planIndex || 0, plans.length - 1)];
    var completedPatterns = 0;
    for (var cp = 0; cp < (planIndex || 0); cp++) completedPatterns += plans[cp].att;
    var planPatterns = Math.max(0, Math.min(pl.att, stats.patterns - completedPatterns));
    var planPct = pl.att ? (planPatterns / pl.att) : 0;
    var globalPct = totalPatterns ? (stats.patterns / totalPatterns) : 0;
    var completedBacktracks = 0;
    for (var cb = 0; cb < (planIndex || 0) && cb < stats.plans.length; cb++) {
      completedBacktracks += stats.plans[cb].backtracks || 0;
    }
    var planBacktracks = Math.max(0, stats.backtracks - completedBacktracks);
    var backtrackPct = pl.bud ? Math.min(1, planBacktracks / Math.max(1, pl.bud * 4)) : 0;
    var pct = 6 + Math.max(globalPct * 34, planPct * 46, backtrackPct * 66) + (planIndex || 0) * 3;
    pct = Math.min(94, Math.max(maxProgress, pct));
    maxProgress = pct;
    var phase = "Schema " + ((planIndex || 0) + 1) + "/" + plans.length;
    var detail;
    if (kind === "fill") {
      detail = "Riempio la griglia: " + stats.fillAttempts + " tentativi, " +
        Math.floor(stats.backtracks / 1000) + "k ritorni.";
    } else if (kind === "done") {
      pct = 100; phase = "Completato"; detail = "Griglia pronta.";
    } else {
      detail = "Provo schemi " + pl.W + "x" + pl.H + " con poche nere.";
    }
    onProgress({ percent: pct, phase: phase, detail: detail });
  }

  for (var p = 0; p < plans.length; p++) {
    var pl = plans[p];
    emitProgress("pattern", p);
    var before = stats ? {
      patterns: stats.patterns,
      fillAttempts: stats.fillAttempts,
      fillSuccess: stats.fillSuccess,
      backtracks: stats.backtracks
    } : null;
    var r = attemptDense(bank, pl.W, pl.H, pl.bp, pl.mr, pl.att, pl.bud, seed + p * 7919, sampleTarget, stats, function (kind) {
      emitProgress(kind, p);
    }, { maxBlackRatio: maxBlackRatio, fillRetries: fillRetries, allowNearDuplicates: allowNearDuplicates,
      fillRetryJitter: fillRetryJitter });
    if (stats) {
      stats.plans.push({
        width: pl.W,
        height: pl.H,
        blackProb: pl.bp,
        patterns: stats.patterns - before.patterns,
        fillAttempts: stats.fillAttempts - before.fillAttempts,
        fillSuccess: stats.fillSuccess - before.fillSuccess,
        backtracks: stats.backtracks - before.backtracks,
        returned: !!r
      });
    }
    if (r && stats) r.stats = stats;
    if (r && r.ghosts.length === 0) { emitProgress("done", p); return r; }
    if (r && p === plans.length - 1) { emitProgress("done", p); return r; } // ultima spiaggia: accetta anche con ghost
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
      opts.onProgress = function (p) {
        self.postMessage({
          type: "progress",
          percent: p.percent,
          phase: p.phase,
          detail: p.detail
        });
      };
      var puzzle = generateDenseCrossword(entries, opts);
      self.postMessage({ ok: !!puzzle, puzzle: puzzle, ms: Date.now() - t0 });
    } catch (err) {
      self.postMessage({ ok: false, error: String(err && err.message || err) });
    }
  };
}
