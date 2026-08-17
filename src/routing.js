/**
 * Calcolo del percorso pedonale sulla rete stradale reale di Numana.
 *
 * Il grafo viene costruito una sola volta dalle way OSM di data/porto-geo.json:
 * ogni vertice della polilinea è un nodo, ogni segmento un arco bidirezionale
 * pesato sulla lunghezza in metri moltiplicata per il costo del tipo di strada
 * (le scale costano di più di una passeggiata sul lungomare).
 *
 * Le way OSM condividono gli stessi nodi agli incroci, ma le coordinate arrivano
 * arrotondate: la chiave del nodo è la coordinata a 6 decimali (~11 cm), che è
 * sufficiente a far combaciare gli incroci senza fondere strade distinte.
 */

/** Raggio terrestre medio, in metri. */
const R = 6371008.8;

const rad = (d) => (d * Math.PI) / 180;

/** Distanza in metri fra due punti [lat, lon] (haversine). */
export function distanza(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const lat1 = rad(a[0]);
  const lat2 = rad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const chiave = ([lat, lon]) => `${lat.toFixed(6)},${lon.toFixed(6)}`;

/**
 * Costruisce il grafo pedonale.
 * @param {{strade: Array<{punti: number[][], costo: number, nome: string|null, tipo: string}>}} geo
 */
export function creaGrafo(geo) {
  /** @type {Map<string, {coord: number[], archi: Array<{a: string, peso: number, metri: number, nome: string|null}>}>} */
  const nodi = new Map();

  const aggiungiNodo = (coord) => {
    const k = chiave(coord);
    let n = nodi.get(k);
    if (!n) {
      n = { coord, archi: [] };
      nodi.set(k, n);
    }
    return k;
  };

  for (const strada of geo.strade) {
    const costo = strada.costo ?? 1;
    for (let i = 0; i < strada.punti.length - 1; i++) {
      const ka = aggiungiNodo(strada.punti[i]);
      const kb = aggiungiNodo(strada.punti[i + 1]);
      if (ka === kb) continue;
      const m = distanza(strada.punti[i], strada.punti[i + 1]);
      const peso = m * costo;
      nodi.get(ka).archi.push({ a: kb, peso, metri: m, nome: strada.nome });
      nodi.get(kb).archi.push({ a: ka, peso, metri: m, nome: strada.nome });
    }
  }

  return { nodi };
}

/**
 * La rete OSM può contenere tratti isolati (un vicolo mappato senza connessione).
 * Teniamo solo la componente connessa più grande, così il router non fallisce
 * per colpa di un nodo di partenza agganciato a un frammento scollegato.
 */
export function componentePrincipale(grafo) {
  const visti = new Set();
  let migliore = new Set();

  for (const start of grafo.nodi.keys()) {
    if (visti.has(start)) continue;
    const comp = new Set([start]);
    const stack = [start];
    visti.add(start);
    while (stack.length) {
      const k = stack.pop();
      for (const arco of grafo.nodi.get(k).archi) {
        if (!visti.has(arco.a)) {
          visti.add(arco.a);
          comp.add(arco.a);
          stack.push(arco.a);
        }
      }
    }
    if (comp.size > migliore.size) migliore = comp;
  }

  for (const k of grafo.nodi.keys()) {
    if (!migliore.has(k)) grafo.nodi.delete(k);
  }
  return grafo;
}

/** Nodo del grafo più vicino a una coordinata [lat, lon]. */
export function nodoPiuVicino(grafo, punto) {
  let migliore = null;
  let minima = Infinity;
  for (const [k, n] of grafo.nodi) {
    const d = distanza(punto, n.coord);
    if (d < minima) {
      minima = d;
      migliore = k;
    }
  }
  return { chiave: migliore, distanza: minima };
}

/** Coda di priorità a heap binario: evita la scansione lineare su ~3000 nodi. */
class CodaPriorita {
  constructor() {
    this.dati = [];
  }
  get dimensione() {
    return this.dati.length;
  }
  push(elemento, priorita) {
    this.dati.push({ elemento, priorita });
    let i = this.dati.length - 1;
    while (i > 0) {
      const padre = (i - 1) >> 1;
      if (this.dati[padre].priorita <= this.dati[i].priorita) break;
      [this.dati[padre], this.dati[i]] = [this.dati[i], this.dati[padre]];
      i = padre;
    }
  }
  pop() {
    const cima = this.dati[0];
    const ultimo = this.dati.pop();
    if (this.dati.length) {
      this.dati[0] = ultimo;
      let i = 0;
      for (;;) {
        const s = 2 * i + 1;
        const d = s + 1;
        let min = i;
        if (s < this.dati.length && this.dati[s].priorita < this.dati[min].priorita) min = s;
        if (d < this.dati.length && this.dati[d].priorita < this.dati[min].priorita) min = d;
        if (min === i) break;
        [this.dati[min], this.dati[i]] = [this.dati[i], this.dati[min]];
        i = min;
      }
    }
    return cima.elemento;
  }
}

/**
 * Percorso a piedi fra due coordinate.
 * @returns {{punti: number[][], metri: number, minuti: number, vie: string[]}|null}
 */
export function calcolaPercorso(grafo, partenza, arrivo, { velocita = 1.35 } = {}) {
  const da = nodoPiuVicino(grafo, partenza);
  const a = nodoPiuVicino(grafo, arrivo);
  if (!da.chiave || !a.chiave) return null;

  const dist = new Map([[da.chiave, 0]]);
  const prec = new Map();
  const chiusi = new Set();
  const coda = new CodaPriorita();
  coda.push(da.chiave, 0);

  while (coda.dimensione) {
    const k = coda.pop();
    if (chiusi.has(k)) continue;
    chiusi.add(k);
    if (k === a.chiave) break;

    for (const arco of grafo.nodi.get(k).archi) {
      if (chiusi.has(arco.a)) continue;
      const nuovo = dist.get(k) + arco.peso;
      if (nuovo < (dist.get(arco.a) ?? Infinity)) {
        dist.set(arco.a, nuovo);
        prec.set(arco.a, { da: k, nome: arco.nome });
        coda.push(arco.a, nuovo);
      }
    }
  }

  if (!dist.has(a.chiave)) return null;

  // Ricostruzione del cammino dall'arrivo alla partenza.
  const catena = [];
  const vieAttraversate = [];
  let cur = a.chiave;
  while (cur !== da.chiave) {
    catena.push(grafo.nodi.get(cur).coord);
    const p = prec.get(cur);
    if (!p) break;
    if (p.nome && vieAttraversate[vieAttraversate.length - 1] !== p.nome) {
      vieAttraversate.push(p.nome);
    }
    cur = p.da;
  }
  catena.push(grafo.nodi.get(da.chiave).coord);
  catena.reverse();
  vieAttraversate.reverse();

  // Agganciamo i punti reali richiesti alle estremità del percorso di rete.
  const punti = [partenza, ...catena, arrivo];

  let metri = 0;
  for (let i = 0; i < punti.length - 1; i++) metri += distanza(punti[i], punti[i + 1]);

  return {
    punti,
    metri: Math.round(metri),
    minuti: Math.max(1, Math.round(metri / velocita / 60)),
    vie: [...new Set(vieAttraversate)],
    scostamentoPartenza: Math.round(da.distanza),
    scostamentoArrivo: Math.round(a.distanza),
  };
}
