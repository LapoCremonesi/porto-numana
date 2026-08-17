/**
 * Utilità geografiche condivise fra la mappa 2D e la scena 3D.
 *
 * Proiezione locale ENU: sull'estensione del porto (~1 km) l'approssimazione
 * equirettangolare ha un errore di pochi centimetri, quindi lavoriamo in metri
 * rispetto al centro del porto.
 *
 *   x = est  (+ verso il mare)
 *   z = sud  (+ verso sud, così il nord è -z come vuole three.js con Y in alto)
 */

const M_PER_GRADO = 111320;

export function creaProiezione(centro) {
  const k = Math.cos((centro.lat * Math.PI) / 180) * M_PER_GRADO;

  /** [lat, lon] -> {x, z} in metri */
  const avanti = (lat, lon) => ({
    x: (lon - centro.lon) * k,
    z: -(lat - centro.lat) * M_PER_GRADO,
  });

  /** {x, z} in metri -> [lat, lon] */
  const indietro = (x, z) => [centro.lat - z / M_PER_GRADO, centro.lon + x / k];

  return { avanti, indietro, centro };
}

/** Distanza in metri fra due [lat, lon] (haversine). */
export function distanza(a, b) {
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const vicini = (a, b, tol = 1e-5) =>
  Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;

/**
 * Unisce i tratti di costa OSM in polilinee continue.
 * OSM spezza la linea di costa in più way che condividono gli estremi: per
 * ricostruire la sagoma del litorale vanno riagganciate testa-coda.
 */
export function concatenaCoste(tratti) {
  const liberi = tratti.map((t) => t.punti.slice());
  const catene = [];

  while (liberi.length) {
    let catena = liberi.pop();

    // Anello già chiuso (in OSM il molo sud è mappato così): niente da unire.
    if (!vicini(catena[0], catena[catena.length - 1])) {
      let cresciuto = true;
      while (cresciuto) {
        cresciuto = false;
        for (let i = 0; i < liberi.length; i++) {
          const t = liberi[i];
          if (vicini(catena[catena.length - 1], t[0])) {
            catena = catena.concat(t.slice(1));
          } else if (vicini(catena[catena.length - 1], t[t.length - 1])) {
            catena = catena.concat(t.slice().reverse().slice(1));
          } else if (vicini(catena[0], t[t.length - 1])) {
            catena = t.slice(0, -1).concat(catena);
          } else if (vicini(catena[0], t[0])) {
            catena = t.slice().reverse().slice(0, -1).concat(catena);
          } else {
            continue;
          }
          liberi.splice(i, 1);
          cresciuto = true;
          break;
        }
      }
    }

    catene.push({ punti: catena, chiusa: vicini(catena[0], catena[catena.length - 1]) });
  }

  return catene.sort((a, b) => b.punti.length - a.punti.length);
}

/** Formatta una distanza in metri per l'interfaccia. */
export function formattaDistanza(m) {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}
