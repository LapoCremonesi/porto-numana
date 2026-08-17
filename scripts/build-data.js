/**
 * Scarica la geometria reale del Porto di Numana da OpenStreetMap (Overpass API)
 * e la trasforma nel dataset usato dal sito:
 *
 *   data/porto-geo.json   moli, pontili, scogliere, costa, edifici, rete pedonale
 *
 * Uso:  npm run build:data
 *
 * I dati OSM sono © contributori OpenStreetMap, licenza ODbL.
 * Il file generato è già versionato: rilanciare lo script solo per aggiornarlo.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTO } from '../src/config.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const { bbox } = PORTO;
const BB = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;

const QUERY = `[out:json][timeout:90];
(
  way(${BB});
  node(${BB})[amenity];
  node(${BB})[shop];
  node(${BB})[tourism];
);
out geom;`;

/** Tipi di highway percorribili a piedi, con costo relativo (1 = ideale). */
const PEDONALI = {
  pedestrian: 0.9,
  footway: 0.95,
  path: 1.05,
  steps: 1.6,
  living_street: 1.0,
  residential: 1.1,
  service: 1.1,
  unclassified: 1.15,
  track: 1.3,
  tertiary: 1.25,
  secondary: 1.45,
};

async function overpass() {
  let ultimoErrore;
  for (const url of ENDPOINTS) {
    try {
      console.log(`[osm] richiesta a ${url} ...`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Overpass rifiuta le richieste senza User-Agent identificabile.
          'User-Agent': 'porto-numana/1.0 (script di build dataset OSM)',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ data: QUERY }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      ultimoErrore = err;
      console.warn(`[osm] fallito (${err.message}), provo il mirror successivo`);
    }
  }
  throw ultimoErrore;
}

/** Metri fra due coordinate geografiche (approssimazione equirettangolare, ok su 1 km). */
function metri(a, b) {
  const dy = (a[0] - b[0]) * 111320;
  const dx = (a[1] - b[1]) * 111320 * Math.cos((PORTO.centro.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/** Distanza dal centro porto, in metri. */
const dalCentro = (lat, lon) => metri([lat, lon], [PORTO.centro.lat, PORTO.centro.lon]);

const arrotonda = (g) => g.map((p) => [Number(p.lat.toFixed(6)), Number(p.lon.toFixed(6))]);

const chiusa = (g) =>
  g.length > 2 && g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1];

/** Altezza edificio: usa i tag OSM se ci sono, altrimenti stima dai piani. */
function altezzaEdificio(tags) {
  const h = parseFloat(tags.height ?? tags['building:height']);
  if (Number.isFinite(h)) return h;
  const piani = parseFloat(tags['building:levels']);
  if (Number.isFinite(piani)) return piani * 3.2 + 1;
  return null; // il client stima in base all'area
}

function main_extract(osm) {
  const out = {
    generato: new Date().toISOString(),
    fonte: 'OpenStreetMap / Overpass API — © contributori OSM, licenza ODbL',
    centro: PORTO.centro,
    bbox,
    moli: [], // man_made=breakwater (linee) — le dighe foranee
    scogliere: [], // man_made=breakwater con area=yes — i frangiflutti a pettine
    pontili: [], // man_made=pier — i pontili di ormeggio
    costa: [], // natural=coastline
    banchine: [], // piazzali e parcheggi del porto
    edifici: [],
    strade: [], // rete percorribile a piedi (per il calcolo del percorso)
    poi: [], // punti di interesse OSM vicini al porto
  };

  for (const el of osm.elements) {
    const tags = el.tags ?? {};

    if (el.type === 'node') {
      const categoria = tags.amenity ?? tags.shop ?? tags.tourism ?? tags.leisure;
      if (!categoria || !tags.name) continue;
      const d = dalCentro(el.lat, el.lon);
      if (d > PORTO.raggioPoi) continue;
      out.poi.push({
        nome: tags.name,
        categoria,
        lat: Number(el.lat.toFixed(6)),
        lon: Number(el.lon.toFixed(6)),
      });
      continue;
    }

    const geom = el.geometry;
    if (!geom || geom.length < 2) continue;
    const punti = arrotonda(geom);
    const centroide = [
      punti.reduce((s, p) => s + p[0], 0) / punti.length,
      punti.reduce((s, p) => s + p[1], 0) / punti.length,
    ];
    const distanza = dalCentro(centroide[0], centroide[1]);

    if (tags.man_made === 'breakwater') {
      (tags.area === 'yes' || chiusa(punti) ? out.scogliere : out.moli).push({
        id: el.id,
        materiale: tags.material ?? 'rock',
        punti,
      });
      continue;
    }

    if (tags.man_made === 'pier') {
      out.pontili.push({ id: el.id, nome: tags.name ?? null, punti });
      continue;
    }

    if (tags.natural === 'coastline') {
      out.costa.push({ id: el.id, punti });
      continue;
    }

    if (tags.amenity === 'parking' && distanza < PORTO.raggioScena) {
      out.banchine.push({ id: el.id, tipo: 'parcheggio', punti });
      continue;
    }

    if (tags.building && distanza < PORTO.raggioScena) {
      out.edifici.push({
        id: el.id,
        nome: tags.name ?? null,
        tipo: tags.building,
        altezza: altezzaEdificio(tags),
        punti,
      });
      continue;
    }

    if (tags.highway && PEDONALI[tags.highway] !== undefined) {
      if (tags.access === 'private' || tags.foot === 'no') continue;
      if (distanza > PORTO.raggioRete) continue;
      out.strade.push({
        id: el.id,
        nome: tags.name ?? null,
        tipo: tags.highway,
        costo: PEDONALI[tags.highway],
        punti,
      });
    }
  }

  return out;
}

/**
 * I pontili sono camminabili: li aggiungiamo alla rete pedonale così il
 * percorso può arrivare fino all'ormeggio e non si ferma sulla banchina.
 */
function collegaPontili(dati) {
  for (const p of dati.pontili) {
    dati.strade.push({
      id: p.id,
      nome: p.nome ?? 'Pontile',
      tipo: 'pier',
      costo: 1.0,
      punti: p.punti,
    });
  }
  for (const m of dati.moli) {
    dati.strade.push({ id: m.id, nome: 'Molo', tipo: 'pier', costo: 1.1, punti: m.punti });
  }
}

const osm = await overpass();
console.log(`[osm] ${osm.elements.length} elementi ricevuti`);

const dati = main_extract(osm);
collegaPontili(dati);

console.log(
  `[osm] estratti: ${dati.moli.length} moli, ${dati.scogliere.length} scogliere, ` +
    `${dati.pontili.length} pontili, ${dati.costa.length} tratti di costa, ` +
    `${dati.edifici.length} edifici, ${dati.strade.length} archi pedonali, ${dati.poi.length} POI`
);

const file = resolve(root, 'data/porto-geo.json');
await writeFile(file, JSON.stringify(dati, null, 1));
console.log(`[osm] scritto ${file}`);
