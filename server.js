/**
 * Porto di Numana — server Node.js/Express.
 *
 * Serve il sito statico e tre API:
 *   GET /api/porto      scheda tecnica + geometria OSM del porto
 *   GET /api/aziende    elenco delle aziende e degli operatori portuali
 *   GET /api/percorso   percorso pedonale fra due punti (Dijkstra su rete OSM)
 */
import express from 'express';
import compression from 'compression';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTO } from './src/config.js';
import { creaGrafo, componentePrincipale, calcolaPercorso, distanza } from './src/routing.js';

const root = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const leggiJson = (rel) => readFile(resolve(root, rel), 'utf8').then(JSON.parse);

const geo = await leggiJson('data/porto-geo.json');
const catalogo = await leggiJson('data/aziende.json');

const grafo = componentePrincipale(creaGrafo(geo));
console.log(`[grafo] rete pedonale: ${grafo.nodi.size} nodi nella componente principale`);

const app = express();
app.use(compression());
app.use(
  express.static(resolve(root, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  })
);

app.get('/api/porto', (_req, res) => {
  res.json({ scheda: PORTO, geo });
});

app.get('/api/aziende', (_req, res) => {
  res.json(catalogo);
});

/**
 * GET /api/percorso?daLat=&daLon=&a=<id azienda>
 * oppure  ?daLat=&daLon=&aLat=&aLon=
 *
 * Senza coordinate di partenza usa l'ingresso pedonale del porto.
 */
app.get('/api/percorso', (req, res) => {
  const num = (v) => (v === undefined ? undefined : Number(v));

  let partenza = [num(req.query.daLat), num(req.query.daLon)];
  if (!partenza.every(Number.isFinite)) {
    partenza = [PORTO.ingressoTerra.lat, PORTO.ingressoTerra.lon];
  }

  let arrivo;
  let azienda = null;
  if (req.query.a) {
    azienda = catalogo.aziende.find((x) => x.id === req.query.a);
    if (!azienda) return res.status(404).json({ errore: `Azienda "${req.query.a}" non trovata` });
    arrivo = [azienda.lat, azienda.lon];
  } else {
    arrivo = [num(req.query.aLat), num(req.query.aLon)];
    if (!arrivo.every(Number.isFinite)) {
      return res.status(400).json({ errore: 'Indicare ?a=<id azienda> oppure aLat e aLon' });
    }
  }

  // Fuori area coperta dai dati OSM il risultato non sarebbe attendibile.
  const lontananza = distanza(partenza, [PORTO.centro.lat, PORTO.centro.lon]);
  if (lontananza > PORTO.raggioRete * 1.5) {
    return res.status(422).json({
      errore: 'Punto di partenza fuori dall\'area mappata',
      dettaglio: `La rete pedonale caricata copre circa ${PORTO.raggioRete} m dal centro del porto; il punto indicato dista ${Math.round(lontananza)} m.`,
    });
  }

  const percorso = calcolaPercorso(grafo, partenza, arrivo);
  if (!percorso) {
    return res.status(422).json({ errore: 'Nessun percorso pedonale trovato fra i due punti' });
  }

  res.json({
    partenza,
    arrivo,
    azienda: azienda && { id: azienda.id, nome: azienda.nome, categoria: azienda.categoria },
    ...percorso,
  });
});

app.listen(PORT, () => {
  console.log(`Porto di Numana — server attivo su http://localhost:${PORT}`);
});
