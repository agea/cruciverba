// def_booster.js — strumenti per moltiplicare le definizioni del cruciverba.
//
// Uso:
//   node def_booster.js pick [N]    Estrae le N (default 100) soluzioni con MENO
//                                   definizioni, escludendo quelle gia' segnate
//                                   come esaurite. Stampa parola, n. def e le def
//                                   attuali; salva l'elenco in def_booster_batch.txt
//   node def_booster.js mark        Sposta le parole del batch corrente nel registro
//                                   definizioni_processate.txt (non verranno piu'
//                                   riprocessate) e svuota il batch.
//   node def_booster.js stats       Distribuzione del numero di definizioni per voce.
//
// Flusso: pick  ->  (si scrivono le definizioni alternative e si aggiungono ai
// voci/*.csv)  ->  si rilancia builddb.js  ->  mark. Ripetibile all'infinito.

const fs = require("fs");
const path = require("path");
const DB = path.join(__dirname, "cruciverba_db.json");
const PROCESSED = path.join(__dirname, "definizioni_processate.txt");
const BATCH = path.join(__dirname, "def_booster_batch.txt");

function norm(s){
  return s.normalize("NFD").replace(/[̀-ͯ]/g,"")
          .toUpperCase().replace(/[^A-Z]/g,"");
}
function loadProcessed(){
  if(!fs.existsSync(PROCESSED)) return new Set();
  return new Set(fs.readFileSync(PROCESSED,"utf8").split("\n").map(s=>s.trim()).filter(Boolean));
}

const cmd = process.argv[2] || "pick";

if(cmd === "pick"){
  const N = parseInt(process.argv[3] || "100", 10);
  const db = JSON.parse(fs.readFileSync(DB,"utf8"));
  const processed = loadProcessed();
  const rows = db.map(([w,c]) => ({ w, defs: Array.isArray(c)?c:[c] }))
                 .filter(r => !processed.has(r.w));
  rows.sort((a,b)=> a.defs.length-b.defs.length || a.w.length-b.w.length || a.w.localeCompare(b.w));
  const batch = rows.slice(0, N);
  const out = batch.map(r => `${r.w}\t[${r.defs.length}]\t${r.defs.join(" | ")}`).join("\n");
  console.log(out);
  fs.writeFileSync(BATCH, batch.map(r=>r.w).join("\n")+"\n");
  console.error(`\n[pick] ${batch.length} parole scelte (gia' esaurite e saltate: ${processed.size}). Elenco in ${path.basename(BATCH)}.`);
}
else if(cmd === "mark"){
  if(!fs.existsSync(BATCH)){ console.error("[mark] Nessun batch: esegui prima 'pick'."); process.exit(1); }
  const batch = fs.readFileSync(BATCH,"utf8").split("\n").map(s=>s.trim()).filter(Boolean);
  const processed = loadProcessed();
  let added=0;
  for(const w of batch){ if(!processed.has(w)){ processed.add(w); added++; } }
  fs.writeFileSync(PROCESSED, [...processed].sort().join("\n")+"\n");
  fs.writeFileSync(BATCH, "");
  console.error(`[mark] ${added} parole aggiunte al registro (totale esaurite: ${processed.size}).`);
}
else if(cmd === "stats"){
  const db = JSON.parse(fs.readFileSync(DB,"utf8"));
  const hist = {};
  for(const [,c] of db){ const n=Array.isArray(c)?c.length:1; hist[n]=(hist[n]||0)+1; }
  console.log("Definizioni per voce -> numero di voci:");
  for(const k of Object.keys(hist).sort((a,b)=>a-b)) console.log(`  ${k} def: ${hist[k]}`);
  console.log("Esaurite (registro):", loadProcessed().size);
}
else {
  console.error("Comando sconosciuto. Usa: pick [N] | mark | stats");
  process.exit(1);
}
