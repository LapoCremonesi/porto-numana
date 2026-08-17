/**
 * Porto di Numana — logica dell'interfaccia.
 *
 * Tiene insieme i tre pezzi: elenco/ricerca delle aziende, mappa satellitare
 * Leaflet e ricostruzione 3D three.js, con le animazioni di anime.js.
 */
import anime from '../vendor/anime.es.js';
import { MappaPorto } from './mappa.js';
import { ScenaPorto } from './scena3d.js';
import { formattaDistanza } from './geo.js';

const stato = {
  porto: null,
  geo: null,
  catalogo: null,
  categorieAttive: new Set(),
  ricerca: '',
  selezionata: null,
  partenza: null, // [lat, lon] scelta dall'utente, altrimenti l'ingresso del porto
  vista: 'satellite',
};

let mappa;
let scena;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// --------------------------------------------------------------- caricamento

async function carica() {
  const [porto, catalogo] = await Promise.all([
    fetch('/api/porto').then((r) => r.json()),
    fetch('/api/aziende').then((r) => r.json()),
  ]);

  stato.porto = porto.scheda;
  stato.geo = porto.geo;
  stato.catalogo = catalogo;
  stato.categorieAttive = new Set(Object.keys(catalogo.categorie));
  stato.partenza = [porto.scheda.ingressoTerra.lat, porto.scheda.ingressoTerra.lon];
}

// ------------------------------------------------------------------- filtri

function aziendeFiltrate() {
  const q = stato.ricerca.trim().toLowerCase();
  return stato.catalogo.aziende.filter((a) => {
    if (!stato.categorieAttive.has(a.categoria)) return false;
    if (!q) return true;
    return [a.nome, a.descrizione, a.settore, a.indirizzo, ...(a.dettagli ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  });
}

function applicaFiltri({ anima = true } = {}) {
  const visibili = aziendeFiltrate();
  const ids = new Set(visibili.map((a) => a.id));

  mappa.filtra(ids);
  scena.filtra(ids);
  renderElenco(visibili, { anima });

  $('#conteggio').textContent =
    visibili.length === stato.catalogo.aziende.length
      ? `${visibili.length} attività`
      : `${visibili.length} di ${stato.catalogo.aziende.length} attività`;
}

// ------------------------------------------------------------------- elenco

function renderElenco(aziende, { anima: conAnimazione = true } = {}) {
  const contenitore = $('#elenco');
  contenitore.innerHTML = '';

  if (!aziende.length) {
    contenitore.innerHTML =
      '<p class="vuoto">Nessuna attività corrisponde ai filtri impostati.</p>';
    return;
  }

  const cat = stato.catalogo.categorie;
  for (const a of aziende) {
    const c = cat[a.categoria];
    const voce = document.createElement('article');
    voce.className = 'scheda-azienda';
    voce.dataset.id = a.id;
    voce.style.setProperty('--tinta', c.colore);
    voce.innerHTML = `
      <div class="scheda-icona" aria-hidden="true">${c.icona}</div>
      <div class="scheda-corpo">
        <h3>${a.nome}</h3>
        <p class="scheda-settore">${a.settore ?? c.etichetta}</p>
      </div>
      <span class="scheda-freccia" aria-hidden="true">›</span>
    `;
    voce.addEventListener('click', () => seleziona(a.id));
    contenitore.appendChild(voce);
  }

  if (conAnimazione) {
    anime({
      targets: '.scheda-azienda',
      opacity: [0, 1],
      translateX: [-14, 0],
      delay: anime.stagger(26),
      duration: 420,
      easing: 'easeOutQuad',
    });
  }
}

// ---------------------------------------------------------------- selezione

function seleziona(id) {
  const a = stato.catalogo.aziende.find((x) => x.id === id);
  if (!a) return;

  stato.selezionata = a;
  mappa.evidenzia(id);
  scena.evidenzia(id);

  $$('.scheda-azienda').forEach((el) =>
    el.classList.toggle('scheda-attiva', el.dataset.id === id)
  );

  if (stato.vista === 'satellite') mappa.vaiA(a.lat, a.lon);
  else scena.inquadra(a.lat, a.lon);

  mostraDettaglio(a);
}

function mostraDettaglio(a) {
  const c = stato.catalogo.categorie[a.categoria];
  const pannello = $('#dettaglio');

  const riga = (etichetta, valore) =>
    valore ? `<div class="riga"><dt>${etichetta}</dt><dd>${valore}</dd></div>` : '';

  const precisione =
    a.precisione === 'osm'
      ? '<span class="badge badge-ok" title="Coordinate rilevate su OpenStreetMap">Posizione da OSM</span>'
      : '<span class="badge badge-stima" title="Punto collocato sulla banchina indicata dall\'indirizzo pubblicato: margine di alcune decine di metri">Posizione stimata</span>';

  pannello.innerHTML = `
    <button class="chiudi" id="chiudi-dettaglio" aria-label="Chiudi scheda">×</button>
    <header class="dettaglio-testa" style="--tinta:${c.colore}">
      <span class="dettaglio-icona">${c.icona}</span>
      <div>
        <p class="dettaglio-categoria">${c.etichetta}</p>
        <h2>${a.nome}</h2>
      </div>
    </header>

    <p class="dettaglio-descrizione">${a.descrizione}</p>

    ${
      a.dettagli?.length
        ? `<ul class="tag-lista">${a.dettagli.map((d) => `<li>${d}</li>`).join('')}</ul>`
        : ''
    }

    <dl class="dettaglio-righe">
      ${riga('Dove', a.settore)}
      ${riga('Indirizzo', a.indirizzo)}
      ${riga('Telefono', a.telefono ? `<a href="tel:${a.telefono.replace(/\s/g, '')}">${a.telefono}</a>` : '')}
      ${riga('Cellulare', a.cellulare ? `<a href="tel:${a.cellulare.replace(/\s/g, '')}">${a.cellulare}</a>` : '')}
      ${riga('Email', a.email ? `<a href="mailto:${a.email}">${a.email}</a>` : '')}
      ${riga('Orari', a.orari)}
      ${riga('Sito', a.sito ? `<a href="${a.sito}" target="_blank" rel="noopener">${new URL(a.sito).hostname}</a>` : '')}
      ${riga('Coordinate', `${a.lat.toFixed(5)}, ${a.lon.toFixed(5)} ${precisione}`)}
    </dl>

    <div class="dettaglio-azioni">
      <button class="bottone bottone-primario" id="btn-percorso">Mostrami il percorso</button>
      <button class="bottone" id="btn-3d">Vedi in 3D</button>
    </div>

    <div id="risultato-percorso" class="risultato-percorso"></div>
  `;

  pannello.classList.add('aperto');
  anime({
    targets: pannello,
    translateY: [18, 0],
    opacity: [0, 1],
    duration: 380,
    easing: 'easeOutCubic',
  });
  anime({
    targets: pannello.querySelectorAll('.tag-lista li'),
    opacity: [0, 1],
    scale: [0.9, 1],
    delay: anime.stagger(40, { start: 120 }),
    duration: 300,
    easing: 'easeOutBack',
  });

  $('#chiudi-dettaglio').addEventListener('click', chiudiDettaglio);
  $('#btn-percorso').addEventListener('click', () => calcolaPercorso(a));
  $('#btn-3d').addEventListener('click', () => {
    cambiaVista('3d');
    scena.inquadra(a.lat, a.lon);
  });
}

function chiudiDettaglio() {
  const pannello = $('#dettaglio');
  anime({
    targets: pannello,
    translateY: [0, 18],
    opacity: [1, 0],
    duration: 240,
    easing: 'easeInQuad',
    complete: () => {
      pannello.classList.remove('aperto');
      pannello.innerHTML = '';
    },
  });
  stato.selezionata = null;
  mappa.evidenzia(null);
  scena.evidenzia(null);
  mappa.pulisciPercorso();
  scena.pulisciPercorso();
  $$('.scheda-azienda').forEach((el) => el.classList.remove('scheda-attiva'));
}

// ---------------------------------------------------------------- percorso

async function calcolaPercorso(a) {
  const box = $('#risultato-percorso');
  box.innerHTML = '<p class="caricamento">Calcolo del percorso a piedi…</p>';

  const [daLat, daLon] = stato.partenza;
  const url = `/api/percorso?a=${encodeURIComponent(a.id)}&daLat=${daLat}&daLon=${daLon}`;

  try {
    const res = await fetch(url);
    const dati = await res.json();

    if (!res.ok) {
      box.innerHTML = `<p class="errore">${dati.errore}${
        dati.dettaglio ? `<br><small>${dati.dettaglio}</small>` : ''
      }</p>`;
      return;
    }

    mappa.disegnaPercorso(dati.punti);
    scena.disegnaPercorso(dati.punti);

    const vie = dati.vie.length
      ? `<p class="percorso-vie"><strong>Lungo:</strong> ${dati.vie.slice(0, 6).join(' → ')}</p>`
      : '';

    box.innerHTML = `
      <div class="percorso-riepilogo">
        <div class="percorso-cifra"><span data-conta="${dati.metri}">0</span><small>metri</small></div>
        <div class="percorso-cifra"><span data-conta="${dati.minuti}">0</span><small>min a piedi</small></div>
      </div>
      <p class="percorso-da">Da: <strong>${nomePartenza()}</strong></p>
      ${vie}
      <p class="percorso-nota">Percorso calcolato sulla rete pedonale OpenStreetMap con algoritmo di Dijkstra. Gli ultimi ${
        dati.scostamentoArrivo
      } m fino all'ingresso non sono su strada mappata.</p>
    `;

    // Contatori animati: leggono il valore finale da data-conta.
    anime({
      targets: box.querySelectorAll('[data-conta]'),
      innerHTML: (el) => [0, Number(el.dataset.conta)],
      round: 1,
      duration: 900,
      easing: 'easeOutExpo',
    });
    anime({
      targets: box.querySelector('.percorso-riepilogo'),
      scale: [0.94, 1],
      opacity: [0, 1],
      duration: 420,
      easing: 'easeOutCubic',
    });
  } catch (err) {
    box.innerHTML = `<p class="errore">Errore nel calcolo del percorso: ${err.message}</p>`;
  }
}

function nomePartenza() {
  const ing = stato.porto.ingressoTerra;
  if (stato.partenza[0] === ing.lat && stato.partenza[1] === ing.lon) {
    return 'Ingresso del porto (Piazzale S. Massaccesi)';
  }
  return `posizione scelta (${stato.partenza[0].toFixed(4)}, ${stato.partenza[1].toFixed(4)})`;
}

function usaPosizione() {
  const btn = $('#btn-posizione');
  if (!navigator.geolocation) {
    btn.textContent = 'Geolocalizzazione non disponibile';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Rilevamento in corso…';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      stato.partenza = [pos.coords.latitude, pos.coords.longitude];
      btn.disabled = false;
      btn.textContent = 'Partenza: la mia posizione';
      btn.classList.add('attivo');
      if (stato.selezionata) calcolaPercorso(stato.selezionata);
    },
    () => {
      btn.disabled = false;
      btn.textContent = 'Posizione non concessa — uso l\'ingresso del porto';
      setTimeout(() => (btn.textContent = 'Parti dalla mia posizione'), 3200);
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// -------------------------------------------------------------------- viste

function cambiaVista(vista) {
  stato.vista = vista;
  $$('.tab').forEach((t) => t.classList.toggle('tab-attivo', t.dataset.vista === vista));
  $$('.vista').forEach((v) => v.classList.toggle('vista-attiva', v.dataset.vista === vista));

  if (vista === '3d') {
    scena.avvia();
    scena.ridimensiona();
  } else {
    scena.ferma();
  }
  if (vista === 'satellite') mappa.ridimensiona();

  // La scheda tecnica è a tutta larghezza: il pannello di dettaglio la coprirebbe.
  if (vista === 'info' && stato.selezionata) chiudiDettaglio();
}

// --------------------------------------------------------------------- info

function renderInfo() {
  const s = stato.porto.scheda;
  const g = stato.geo;

  $('#scheda-porto').innerHTML = `
    <div class="dati-griglia">
      ${[
        ['Posti barca', s.postiBarca, ''],
        ['Lunghezza max', s.lunghezzaMax, 'm'],
        ['Pescaggio', `${s.pescaggioMin}–${s.pescaggioMax}`, 'm'],
        ['Fondale', s.fondale, ''],
      ]
        .map(
          ([k, v, u]) =>
            `<div class="dato"><span class="dato-valore">${v}<small>${u}</small></span><span class="dato-chiave">${k}</span></div>`
        )
        .join('')}
    </div>
    <dl class="dettaglio-righe">
      <div class="riga"><dt>Classificazione</dt><dd>${s.classificazione}</dd></div>
      <div class="riga"><dt>Coordinate</dt><dd>${s.coordinate}</dd></div>
      <div class="riga"><dt>Accesso</dt><dd>${s.accesso}</dd></div>
      <div class="riga"><dt>Venti</dt><dd>${s.venti}</dd></div>
      <div class="riga"><dt>Stagione</dt><dd>${s.stagione}</dd></div>
    </dl>

    <h3>Come è costruito il modello 3D</h3>
    <p class="testo">
      La scena three.js non è un disegno a mano libera: ogni volume è generato
      dalla geometria reale di OpenStreetMap ed estruso in altezza. Da questa
      area sono stati letti
      <strong>${g.moli.length} moli</strong>,
      <strong>${g.scogliere.length} scogliere frangiflutti</strong>,
      <strong>${g.pontili.length} pontili</strong>,
      <strong>${g.costa.length} tratti di linea di costa</strong> e
      <strong>${g.edifici.length} edifici</strong>.
      Le <strong>altezze</strong> degli edifici non taggate su OSM sono stimate
      dall'impronta a terra, e le barche agli ormeggi sono rappresentative:
      il porto dichiara circa ${s.postiBarca} posti, non ne è mappato il singolo natante.
    </p>

    <h3>Come viene calcolato il percorso</h3>
    <p class="testo">
      La rete pedonale OSM (${g.strade.length} archi caricati, pontili e moli inclusi)
      viene trasformata in un grafo pesato: la lunghezza di ogni segmento è
      moltiplicata per un costo che dipende dal tipo di percorso — una scalinata
      "costa" più di un lungomare. Il cammino minimo è calcolato con l'algoritmo
      di Dijkstra lato server.
    </p>

    <h3>Fonti</h3>
    <ul class="fonti">
      ${stato.catalogo.fonti
        .map(
          (f) =>
            `<li><a href="${f.url}" target="_blank" rel="noopener">${f.titolo}</a></li>`
        )
        .join('')}
    </ul>
    <p class="testo piccolo">${stato.catalogo.nota}</p>
    <p class="testo piccolo">Dati geografici © contributori OpenStreetMap, licenza ODbL. Immagini satellitari © Esri, Maxar, Earthstar Geographics. Ultimo aggiornamento del dataset aziende: ${stato.catalogo.aggiornato}.</p>
  `;
}

// --------------------------------------------------------------------- avvio

function collegaControlli() {
  $('#ricerca').addEventListener('input', (e) => {
    stato.ricerca = e.target.value;
    applicaFiltri({ anima: false });
  });

  const filtri = $('#filtri');
  for (const [chiave, c] of Object.entries(stato.catalogo.categorie)) {
    const b = document.createElement('button');
    b.className = 'filtro filtro-attivo';
    b.style.setProperty('--tinta', c.colore);
    b.dataset.categoria = chiave;
    b.innerHTML = `<span>${c.icona}</span> ${c.etichetta}`;
    b.addEventListener('click', () => {
      if (stato.categorieAttive.has(chiave)) stato.categorieAttive.delete(chiave);
      else stato.categorieAttive.add(chiave);
      b.classList.toggle('filtro-attivo');
      anime({ targets: b, scale: [0.92, 1], duration: 260, easing: 'easeOutBack' });
      applicaFiltri({ anima: false });
    });
    filtri.appendChild(b);
  }

  $$('.tab').forEach((t) => t.addEventListener('click', () => cambiaVista(t.dataset.vista)));

  $$('[data-sfondo]').forEach((b) =>
    b.addEventListener('click', () => {
      $$('[data-sfondo]').forEach((x) => x.classList.toggle('attivo', x === b));
      mappa.cambiaSfondo(b.dataset.sfondo);
    })
  );

  $('#btn-posizione').addEventListener('click', usaPosizione);
  $('#btn-panoramica').addEventListener('click', () => scena.vistaGenerale());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stato.selezionata) chiudiDettaglio();
  });
}

async function avvia() {
  await carica();

  mappa = new MappaPorto('mappa', {
    centro: stato.porto.centro,
    alSelezionare: seleziona,
  });
  mappa.disegnaGeometria(stato.geo);
  mappa.disegnaAziende(stato.catalogo.aziende, stato.catalogo.categorie);

  scena = new ScenaPorto($('#scena'), {
    centro: stato.porto.centro,
    alSelezionare: (id) => {
      seleziona(id);
    },
  });
  scena.costruisci(stato.geo);
  scena.creaSegnaposti(stato.catalogo.aziende, stato.catalogo.categorie);

  collegaControlli();
  applicaFiltri();
  renderInfo();

  // Il caricamento si chiude solo quando tutto è pronto: niente porto a metà.
  anime({
    targets: '#caricamento',
    opacity: [1, 0],
    duration: 520,
    easing: 'easeOutQuad',
    complete: () => $('#caricamento').remove(),
  });
  anime({
    targets: ['.intestazione', '.pannello-laterale', '.area-viste'],
    opacity: [0, 1],
    translateY: [12, 0],
    delay: anime.stagger(90),
    duration: 620,
    easing: 'easeOutCubic',
  });
}

avvia().catch((err) => {
  console.error(err);
  const c = document.getElementById('caricamento');
  if (c) {
    c.innerHTML = `<div class="caricamento-errore"><h2>Impossibile caricare i dati del porto</h2><p>${err.message}</p></div>`;
  }
});
