// Builder del database: legge voci.csv, normalizza, deduplica,
// valida (solo A-Z, lunghezza >= 2) e produce cruciverba_db.json.
const fs = require("fs");
const path = require("path");

const inputPath = path.join(__dirname, "voci.csv");
const outputPath = path.join(__dirname, "cruciverba_db.json");

function norm(s){
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
          .toUpperCase().replace(/[^A-Z]/g,"");
}

function parseCsv(text){
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for(let i=0;i<text.length;i++){
    const ch = text[i];
    if(quoted){
      if(ch === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; }
        else quoted = false;
      } else {
        field += ch;
      }
      continue;
    }

    if(ch === '"') quoted = true;
    else if(ch === ","){ row.push(field); field = ""; }
    else if(ch === "\n"){
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if(ch !== "\r") {
      field += ch;
    }
  }

  if(quoted) throw new Error("CSV non valido: virgolette non chiuse");
  if(field || row.length){
    row.push(field);
    rows.push(row);
  }
  return rows;
}

if(!fs.existsSync(inputPath)){
  throw new Error("File voci.csv non trovato");
}

const rows = parseCsv(fs.readFileSync(inputPath, "utf8"));
const header = rows.shift() || [];
if(header[0] !== "soluzione" || header[1] !== "definizione"){
  throw new Error("Intestazione CSV attesa: soluzione,definizione");
}

const seen = new Map();   // soluzione -> definizione (prima vince)
const out = [];
let dupes = 0, invalid = 0, malformed = 0;

for (const row of rows) {
  if(row.length === 1 && !row[0].trim()) continue;
  if(row.length !== 2){ malformed++; continue; }

  const [w, clue] = row;
  const sol = norm(w);
  const cleanClue = String(clue || "").trim();
  if (sol.length < 2) { invalid++; continue; }
  if (!cleanClue) { invalid++; continue; }
  if (seen.has(sol)) { dupes++; continue; }
  seen.set(sol, cleanClue);
  out.push([sol, cleanClue]);
}

// ordina per lunghezza poi alfabetico (comodita di lettura)
out.sort((a,b)=> a[0].length-b[0].length || a[0].localeCompare(b[0]));

fs.writeFileSync(outputPath, JSON.stringify(out, null, 0));

// distribuzione
const byLen={};
for(const [w] of out){ byLen[w.length]=(byLen[w.length]||0)+1; }
console.log("Totale voci:", out.length);
console.log("Scartate (dup/invalid/malformed):", dupes, "/", invalid, "/", malformed);
console.log("Distribuzione:", JSON.stringify(byLen));
