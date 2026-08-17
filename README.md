# Porto di Numana — sito interattivo

Sito web interattivo dedicato al **Porto Turistico di Numana** (Riviera del Conero, provincia di Ancona):

- **immagine satellitare attuale** del porto, con moli, scogliere e pontili tracciati sopra;
- **ricostruzione 3D** dello specchio portuale generata dalla geometria reale di OpenStreetMap;
- **marker delle aziende e degli operatori** che lavorano al porto;
- **calcolo del percorso a piedi** per raggiungere una specifica attività, disegnato sia sulla mappa sia nella scena 3D.

Stack: **Node.js + Express** per il server e le API, **three.js** per il 3D, **anime.js** per le animazioni di interfaccia, **Leaflet** per la mappa.

## Impostazione visiva

Una sola palette in tutto il progetto — interfaccia e scena 3D — definita nelle variabili CSS
di `public/css/style.css` e ripresa in `COLORI` di `public/js/scena3d.js`: grigi caldi neutri
più **un unico accento**, il blu-ardesia `#31596b`. Nessun gradiente e nessuna ombra diffusa:
la gerarchia si regge su spaziatura, peso tipografico e filetti da 1px.

L'accento è riservato a ciò che il sito deve far trovare — segnaposti e percorso — così sul
plastico grigio l'occhio va dove serve. Le categorie non hanno un colore proprio: si leggono
nella scheda, non in sei tinte sparse sulla mappa.

L'interfaccia ha pochi comandi, e uno solo è davvero necessario: **selezionare un'attività**.
Da lì partono da sole scheda, inquadratura e calcolo del percorso, che è la domanda per cui
esiste il sito. Elenco e scheda si alternano nella stessa colonna, così nessun pannello
galleggiante copre mai la mappa.

---

## Avvio

```bash
npm install     # installa le dipendenze e copia le librerie in public/vendor
npm start       # server su http://localhost:3000
```

Per lo sviluppo con ricarica automatica del server:

```bash
npm run dev
```

Le librerie di terze parti vengono copiate da `node_modules` a `public/vendor` dallo script
`postinstall`, quindi il front-end **non dipende da CDN esterne**. Le uniche risorse remote
sono le tile della mappa 2D (satellite Esri e OpenStreetMap): senza rete la scena 3D e il
calcolo dei percorsi continuano a funzionare, la mappa resta senza sfondo.

---

## Struttura

```
server.js                 server Express + API
src/config.js             coordinate del porto, raggi di estrazione, scheda tecnica
src/routing.js            grafo pedonale e Dijkstra
scripts/build-data.js     scarica la geometria del porto da Overpass (OpenStreetMap)
scripts/copy-vendor.js    copia three.js / anime.js / Leaflet in public/vendor
data/porto-geo.json       geometria estratta (versionata: rigenerabile)
data/aziende.json         aziende e operatori del porto, con fonti
public/js/scena3d.js      ricostruzione 3D con three.js
public/js/mappa.js        mappa Leaflet
public/js/app.js          interfaccia, filtri, percorsi, animazioni anime.js
public/js/geo.js          proiezione locale e utilità geografiche
```

---

## API

| Endpoint | Descrizione |
|---|---|
| `GET /api/porto` | scheda tecnica del porto + geometria OSM |
| `GET /api/aziende` | elenco delle attività, categorie e fonti |
| `GET /api/percorso?a=<id>` | percorso pedonale dall'ingresso del porto all'azienda |
| `GET /api/percorso?a=<id>&daLat=&daLon=` | percorso da una posizione specifica |
| `GET /api/percorso?aLat=&aLon=&daLat=&daLon=` | percorso fra due coordinate qualsiasi |

Risposta di `/api/percorso`:

```json
{
  "metri": 179,
  "minuti": 2,
  "vie": ["Via del Pincetto", "Via della Torre"],
  "punti": [[43.51068, 13.62409], "..."],
  "scostamentoPartenza": 23,
  "scostamentoArrivo": 12
}
```

`scostamentoPartenza` / `scostamentoArrivo` sono i metri fra il punto richiesto e il nodo
della rete OSM più vicino: sono esposti apposta, perché indicano quanta parte del tragitto
**non** è coperta da strade mappate.

---

## Come funziona

### Ricostruzione 3D

La scena non è modellata a mano. `scripts/build-data.js` interroga l'**Overpass API** di
OpenStreetMap su un riquadro attorno al porto ed estrae linea di costa, moli, scogliere
frangiflutti, pontili, sagome degli edifici e rete stradale. Il client proietta le coordinate
in metri (proiezione locale equirettangolare, errore di pochi centimetri su 1 km) ed estrude
i poligoni in volumi con `THREE.ExtrudeGeometry`.

Il mare usa uno `ShaderMaterial` dedicato: la stessa somma di onde è definita una volta in
GLSL e condivisa fra vertex e fragment shader — il vertex sposta i vertici (solo con le onde
lunghe, le uniche che la maglia può risolvere), il fragment calcola la **derivata analitica**
per ricavare una normale liscia, così il dettaglio dell'acqua non dipende dalla densità della
mesh e non compaiono artefatti a scacchiera.

**Cosa è reale e cosa è stimato**, per non confondere le due cose:

| Elemento | Origine |
|---|---|
| Pianta di moli, scogliere, pontili, costa, edifici | geometria OpenStreetMap |
| Altezza degli edifici | tag OSM `height`/`building:levels` se presenti, altrimenti **stimata** dall'impronta a terra |
| Quote di banchina, molo e pontili | **valori convenzionali** scelti per la leggibilità della scena |
| Barche agli ormeggi | **rappresentative**: il porto dichiara ~800 posti, non è mappato il singolo natante |

### Calcolo del percorso

Le way pedonali OSM (più pontili e moli, che si percorrono a piedi) diventano un grafo pesato:
ogni segmento pesa la sua lunghezza in metri moltiplicata per un costo che dipende dal tipo di
percorso — una scalinata costa 1,6, un'area pedonale 0,9. Viene tenuta solo la componente
connessa più grande, così un vicolo mappato isolato non manda in errore il router. Il cammino
minimo è calcolato con **Dijkstra** (coda di priorità a heap binario) lato server.

---

## Dati e fonti

Le informazioni sulle aziende sono raccolte da fonti pubbliche — siti ufficiali degli operatori,
Guardia Costiera, portali turistici — ed elencate in `data/aziende.json`, che riporta anche la
lista completa delle fonti mostrata nella pagina "Scheda & fonti" del sito.

Ogni attività ha un campo `precisione`:

- `osm` — coordinate rilevate su OpenStreetMap;
- `stimata` — punto collocato sulla banchina o sul molo indicato dall'indirizzo pubblicato,
  con un margine di alcune decine di metri.

La distinzione è mostrata anche nell'interfaccia, accanto alle coordinate. **Contatti, orari e
prezzi cambiano**: vanno sempre verificati sul sito dell'operatore prima di farci affidamento.

Per aggiornare la geometria dopo modifiche su OpenStreetMap:

```bash
npm run build:data
```

### Licenze dei dati

- Dati geografici © contributori **OpenStreetMap**, licenza **ODbL**.
- Immagini satellitari © **Esri, Maxar, Earthstar Geographics** (basemap World Imagery), usate
  tramite il servizio di tile pubblico e attribuite nella mappa.
