// Builder del database: unisce voci esistenti + nuove, normalizza, deduplica,
// valida (solo A-Z, lunghezza >= 2) e produce cruciverba_db.json.
const fs = require("fs");
const path = require("path");
const existing = fs.existsSync(path.join(__dirname, "cruciverba_db.json"))
  ? require("./cruciverba_db.json")
  : [];
const NEW = require("./newvoci.js");      // nuove voci (blocchi appesi)

function norm(s){
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
          .toUpperCase().replace(/[^A-Z]/g,"");
}

const seen = new Map();   // soluzione -> definizione (prima vince)
const out = [];
let dupes = 0, invalid = 0;

for (const src of [existing, NEW]) {
  for (const [w, clue] of src) {
    const sol = norm(w);
    if (sol.length < 2) { invalid++; continue; }
    if (!clue || !String(clue).trim()) { invalid++; continue; }
    if (seen.has(sol)) { dupes++; continue; }
    seen.set(sol, clue);
    out.push([sol, String(clue).trim()]);
  }
}

// ordina per lunghezza poi alfabetico (comodita di lettura)
out.sort((a,b)=> a[0].length-b[0].length || a[0].localeCompare(b[0]));

fs.writeFileSync(path.join(__dirname, "cruciverba_db.json"),
  JSON.stringify(out, null, 0));

// distribuzione
const byLen={};
for(const [w] of out){ byLen[w.length]=(byLen[w.length]||0)+1; }
console.log("Totale voci:", out.length);
console.log("Scartate (dup/invalid):", dupes, "/", invalid);
console.log("Distribuzione:", JSON.stringify(byLen));
