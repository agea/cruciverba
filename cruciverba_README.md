# Cruciverba — Documentazione tecnica e funzionale

Generatore e gioco di cruciverba in italiano, interamente lato browser (HTML/JS), senza backend né dipendenze esterne. Pensato per l'uso su iPad e desktop.

---

## 1. Descrizione funzionale

L'applicazione genera schemi di parole crociate in italiano e permette di risolverli direttamente nel browser:

- **Generazione automatica** di schemi con tre livelli di difficoltà (facile / medio / difficile), corrispondenti a griglie di dimensione e densità crescenti.
- **Risoluzione interattiva**: selezione della definizione, inserimento lettere da tastiera fisica o tastiera virtuale su schermo, evidenziazione della parola attiva e dell'incrocio.
- **Aiuti**: verifica delle lettere errate, rivelazione di una cella/parola, cancellazione.
- **Persistenza**: lo stato della partita viene salvato in `localStorage`, così si può riprendere dove si era rimasti.
- **Timer** di gioco e rilevamento automatico del completamento.
- Design "matita su carta", ottimizzato per il tocco e per il funzionamento **offline**.

---

## 2. Architettura tecnica

Tre componenti disaccoppiati:

1. **Database delle definizioni** (`cruciverba_db.json`) — dati puri, separati dalla logica.
2. **Generatore di schema** (`gen_dense.js`) — algoritmo di costruzione della griglia; gira in un **Web Worker** per non bloccare l'interfaccia.
3. **Interfaccia** (file HTML) — rendering della griglia, input, aiuti, persistenza.

Il Worker viene avviato da un Blob creato a runtime dal sorgente incorporato: questo consente di mantenere il funzionamento offline anche aprendo il file via `file://` su Safari/iPad.

---

## 3. Il database

`cruciverba_db.json` — array JSON compatto di coppie `["SOLUZIONE", "definizione"]`.

- **2080 voci** totali. Soluzioni in maiuscolo, solo lettere A–Z (accenti e spazi rimossi in fase di build).
- Distribuzione per lunghezza, calibrata per gli incroci fitti (abbondanza di parole corte):

| Lettere | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|
| Voci | 96 | 176 | 413 | 642 | 260 | 245 | 172 | 57 | 15 | 4 |

Le caselle corte (2–3 lettere) sfruttano lo stile classico della Settimana Enigmistica: sigle, targhe automobilistiche, note musicali e simboli chimici.

### Come estendere il database

1. Aggiungere righe in `voci.csv`, con intestazione `soluzione,definizione`.
2. Eseguire `node builddb.js`: legge il CSV, **normalizza** (NFD, maiuscolo, solo A–Z), **deduplica** (prima occorrenza vince), **scarta** voci non valide, ordina e riscrive `cruciverba_db.json`.

---

## 4. Il generatore denso (`gen_dense.js`)

Produce schemi densi in stile Settimana Enigmistica: griglia rettangolare piena con **caselle nere**, in cui ogni sequenza bianca di lunghezza ≥ 2 (orizzontale o verticale) è una parola del database con relativa definizione.

**Pipeline:**

1. **Word bank** — il DB viene indicizzato per lunghezza e per (posizione, lettera), per recuperare in fretta i candidati di uno slot parzialmente riempito.
2. **Pattern di caselle nere** — generazione casuale con densità controllata; i run bianchi troppo lunghi vengono spezzati (`maxRun`) per privilegiare slot di 3–6 lettere, dove il vocabolario è più ricco; le caselle bianche isolate vengono eliminate.
3. **Estrazione degli slot** — tutte le sequenze bianche ≥ 2, orizzontali e verticali, con la mappa cella → slot.
4. **Riempimento (backtracking)** — assegnazione con selezione dello slot più vincolato (propagazione dagli slot già riempiti + seme statico sui più incrociati), **forward-checking** sugli incroci e parole non ripetute.
5. **Cascata di fallback** — se una configurazione non si completa, si ritenta con più caselle nere e slot più corti, e in ultima istanza con griglia ridotta: garantisce che venga sempre restituito uno schema valido.

**Prestazioni** (misurate in Node sul DB reale, 100% di successo, zero parole prive di definizione):

| Difficoltà | Griglia | Tempo medio | Parole |
|---|---|---|---|
| Facile | 9×9 | ~0,2 s | ~29 |
| Medio | 11×11 | ~1,1 s | ~43 |
| Difficile | 13×13 | ~3,4 s (max ~6 s) | ~54 |

### Struttura dati prodotta

```
{
  width, height,
  cells: [[ null | { ch, num } , ... ], ...],  // null = casella nera
  across: [{ num, clue, answer, row, col, len }, ...],
  down:   [{ num, clue, answer, row, col, len }, ...],
  wordCount,
  ghosts  // parole senza definizione (atteso: 0)
}
```

---

## 5. File del progetto

| File | Ruolo | Stato |
|---|---|---|
| `voci.csv` | Sorgente del database | **Completo** |
| `cruciverba_db.json` | Database generato, 2080 voci | **Completo** |
| `gen_dense.js` | Generatore denso | **Completo e validato** |
| `builddb.js` | Script di build del DB | Completo |
| `cruciverba.html` | App giocabile | **v1** (free-form, DB esterno con fallback inline) |

---

## 6. Stato attuale e prossimi passi

Il **database** e il **generatore denso** sono pronti e collaudati. L'`cruciverba.html` attuale è la **versione 1**: usa il generatore a schema libero con il database incorporato e funziona offline.

**Da completare** per la versione densa con DB esterno:

1. Integrare `gen_dense.js` nell'HTML al posto del generatore free-form.
2. Caricare `cruciverba_db.json` esterno via `fetch`, con **fallback a selezione file** (`input file`) per l'uso via `file://` su iPad, dove Safari blocca le richieste a file locali.
3. Rendere le **caselle nere** nella griglia (oggi le celle vuote sono trasparenti).
4. Ricalibrare i parametri dei tre livelli di difficoltà sul nuovo generatore.

### Nota sull'uso offline del JSON esterno

Separando il database in un file `.json` caricato via `fetch`, l'apertura diretta via `file://` su Safari/iPad ne blocca la lettura per policy di sicurezza. Soluzioni previste: il **fallback a selezione manuale del file** (si sceglie il JSON una volta), oppure servire i due file tramite un piccolo server locale. In alternativa resta disponibile la versione "tutto-in-uno" con il database incorporato.
