/**
 * Parametri geografici del Porto di Numana.
 * Condivisi fra lo script di build dei dati, il server e il client.
 */
export const PORTO = {
  nome: 'Porto Turistico di Numana',
  comune: 'Numana (AN) — Marche, Riviera del Conero',

  /** Centro dello specchio acqueo portuale (fra i pontili e il molo di levante). */
  centro: { lat: 43.5096, lon: 13.6253 },

  /** Imboccatura sud: unico ingresso navigabile del porto. */
  imboccatura: { lat: 43.50795, lon: 13.62628 },

  /** Ingresso pedonale/carrabile da Piazzale Silvio Massaccesi. */
  ingressoTerra: { lat: 43.51068, lon: 13.62409 },

  /** Area scaricata da Overpass. */
  bbox: { south: 43.505, west: 13.615, north: 43.516, east: 13.633 },

  /** Raggi (in metri dal centro) usati per filtrare i dati OSM. */
  raggioScena: 420, // edifici e banchine da ricostruire in 3D
  raggioRete: 900, // rete pedonale per il calcolo percorso
  raggioPoi: 450, // punti di interesse OSM da mostrare

  /** Dati tecnici del porto (fonti citate nella pagina "Info"). */
  scheda: {
    classificazione: 'Porto di 2ª categoria, 4ª classe',
    postiBarca: 800,
    lunghezzaMax: 25, // metri
    pescaggioMin: 1.5, // metri
    pescaggioMax: 2.8, // metri
    fondale: 'Sabbioso',
    stagione: '1 maggio – 30 settembre (servizi a pieno regime)',
    coordinate: "43°30′33″ N — 13°37′28″ E",
    accesso: "Solo dall'imboccatura sud; dal varco nord è consentita la sola uscita",
    venti: 'Ridosso esposto a levante e scirocco: risacca forte in inverno',
  },
};

export default PORTO;
