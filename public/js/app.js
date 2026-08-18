/**
 * Porto di Numana — logica dell'interfaccia.
 *
 * Tiene insieme elenco/ricerca delle attività, mappa satellitare Leaflet e
 * ricostruzione 3D three.js. Le animazioni (anime.js) sono deliberatamente
 * sobrie: servono a rendere leggibile un cambio di stato, non a decorare.
 */
import anime from '../vendor/anime.es.js';
import { MappaPorto } from './mappa.js';
import { ScenaPorto } from './scena3d.js';

const stato = {
  porto: null,
  geo: null,
  catalogo: null,
  categoria: 'tutte',
  ricerca: '',
  selezionata: null,
  partenza: null, // [lat, lon]: l'ingresso del porto finché l'utente non sceglie altro
  daGeolocalizzazione: false,
  vista: 'satellite',
};

let mappa;
let scena;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// --------------------------------------------------------------- caricamento

async function carica() {
  const [porto, catalogo] = await Promise.all([
    fetch('/api/porto').then((r) => r.json()),
    fetch('/api/aziende').then((r) => r.json()),
  ]);

  stato.porto = porto.scheda;
  stato.geo = porto.geo;
  stato.catalogo = catalogo;
  stato.partenza = [porto.scheda.ingressoTerra.lat, porto.scheda.ingressoTerra.lon];
}

// ------------------------------------------------------------------- filtri

function aziendeFiltrate() {
  const q = stato.ricerca.trim().toLowerCase();
  return stato.catalogo.aziende.filter((a) => {
    if (stato.categoria !== 'tutte' && a.categoria !== stato.categoria) return false;
    if (!q) return true;
    return [a.nome, a.descrizione, a.settore, a.indirizzo, ...(a.dettagli ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  });
}

function applicaFiltri() {
  const visibili = aziendeFiltrate();
  const ids = new Set(visibili.map((a) => a.id));

  mappa.filtra(ids);
  scena.filtra(ids);
  renderElenco(visibili);

  const totale = stato.catalogo.aziende.length;
  $('#conteggio').textContent =
    visibili.length === totale ? `${totale} attività` : `${visibili.length} / ${totale}`;
}

// ------------------------------------------------------------------- elenco

function renderElenco(aziende) {
  const contenitore = $('#elenco');

  if (!aziende.length) {
    contenitore.innerHTML = '<p class="vuoto">Nessuna attività corrisponde alla ricerca.</p>';
    return;
  }

  contenitore.innerHTML = aziende
    .map(
      (a) => `
      <button class="voce" data-id="${a.id}">
        <h3>${escapeHtml(a.nome)}</h3>
        <p>${escapeHtml(a.settore ?? stato.catalogo.categorie[a.categoria].etichetta)}</p>
      </button>`
    )
    .join('');

  for (const el of contenitore.querySelectorAll('.voce')) {
    el.addEventListener('click', () => seleziona(el.dataset.id));
  }
}

// ---------------------------------------------------------------- selezione

/**
 * Selezionare un'attività è l'unica azione dell'interfaccia: apre la scheda,
 * la inquadra nella vista corrente e calcola subito il percorso a piedi —
 * che è la domanda per cui esiste il sito, non un passaggio da richiedere.
 */
function seleziona(id) {
  const a = stato.catalogo.aziende.find((x) => x.id === id);
  if (!a) return;

  stato.selezionata = a;
  mappa.evidenzia(id);
  scena.evidenzia(id);

  mostraDettaglio(a);

  if (stato.vista === '3d') scena.inquadra(a.lat, a.lon);
  else if (stato.vista === 'info') cambiaVista('satellite');

  calcolaPercorso(a);
}

function mostraDettaglio(a) {
  const categoria = stato.catalogo.categorie[a.categoria];
  const corpo = $('#dettaglio-corpo');

  const riga = (chiave, valore) =>
    valore ? `<div class="dato-riga"><dt>${chiave}</dt><dd>${valore}</dd></div>` : '';

  const link = (href, testo) =>
    `<a href="${href}" target="_blank" rel="noopener">${escapeHtml(testo)}</a>`;

  const precisione =
    a.precisione === 'osm'
      ? 'Coordinate rilevate su OpenStreetMap.'
      : 'Posizione stimata sulla banchina indicata dall\'indirizzo pubblicato: margine di alcune decine di metri.';

  corpo.innerHTML = `
    <p class="etichetta-micro">${escapeHtml(categoria.etichetta)}</p>
    <h2>${escapeHtml(a.nome)}</h2>
    <p class="dettaglio-descrizione">${escapeHtml(a.descrizione)}</p>

    ${
      a.dettagli?.length
        ? `<ul class="elenco-semplice">${a.dettagli
            .map((d) => `<li>${escapeHtml(d)}</li>`)
            .join('')}</ul>`
        : ''
    }

    <dl class="dati">
      ${riga('Dove', a.settore ? escapeHtml(a.settore) : '')}
      ${riga('Indirizzo', a.indirizzo ? escapeHtml(a.indirizzo) : '')}
      ${riga('Telefono', a.telefono ? link(`tel:${a.telefono.replace(/\s/g, '')}`, a.telefono) : '')}
      ${riga('Cellulare', a.cellulare ? link(`tel:${a.cellulare.replace(/\s/g, '')}`, a.cellulare) : '')}
      ${riga('Email', a.email ? link(`mailto:${a.email}`, a.email) : '')}
      ${riga('Orari', a.orari ? escapeHtml(a.orari) : '')}
      ${riga('Sito', a.sito ? link(a.sito, new URL(a.sito).hostname.replace(/^www\./, '')) : '')}
      ${riga(
        'Posizione',
        `${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}<span class="nota-precisione">${precisione}</span>`
      )}
    </dl>

    <section class="percorso">
      <p class="etichetta-micro">Percorso a piedi</p>
      <div id="esito-percorso"></div>
    </section>
  `;

  $('#pagina-elenco').hidden = true;
  $('#pagina-dettaglio').hidden = false;

  anime({
    targets: corpo,
    opacity: [0, 1],
    translateY: [6, 0],
    duration: 260,
    easing: 'easeOutQuad',
  });
}

function tornaAllElenco() {
  $('#pagina-dettaglio').hidden = true;
  $('#pagina-elenco').hidden = false;

  stato.selezionata = null;
  mappa.evidenzia(null);
  scena.evidenzia(null);
  mappa.pulisciPercorso();
  scena.pulisciPercorso();

  anime({
    targets: '#pagina-elenco',
    opacity: [0, 1],
    duration: 200,
    easing: 'easeOutQuad',
  });
}

// ---------------------------------------------------------------- percorso

async function calcolaPercorso(a) {
  const box = $('#esito-percorso');
  if (!box) return;
  box.innerHTML = '<p class="attesa">Calcolo in corso…</p>';

  const [daLat, daLon] = stato.partenza;
  const url = `/api/percorso?a=${encodeURIComponent(a.id)}&daLat=${daLat}&daLon=${daLon}`;

  let dati;
  try {
    const res = await fetch(url);
    dati = await res.json();
    if (!res.ok) {
      box.innerHTML = `<p class="errore">${escapeHtml(dati.errore)}</p>${bottonePartenza()}`;
      collegaBottonePartenza();
      return;
    }
  } catch (err) {
    box.innerHTML = `<p class="errore">Percorso non disponibile: ${escapeHtml(err.message)}</p>`;
    return;
  }

  mappa.disegnaPercorso(dati.punti);
  scena.disegnaPercorso(dati.punti);

  const vie = dati.vie.length
    ? `<p class="percorso-testo">Lungo <strong>${dati.vie.slice(0, 4).map(escapeHtml).join(', ')}</strong>.</p>`
    : '';

  box.innerHTML = `
    <div class="percorso-cifre">
      <span class="percorso-cifra"><b data-conta="${dati.metri}">0</b><span>m</span></span>
      <span class="percorso-cifra"><b data-conta="${dati.minuti}">0</b><span>min</span></span>
    </div>
    <p class="percorso-testo">Da <strong>${escapeHtml(nomePartenza())}</strong>.</p>
    ${vie}
    <p class="percorso-testo">Calcolato sulla rete pedonale OpenStreetMap. Gli ultimi ${dati.scostamentoArrivo} m fino all'ingresso non sono su strada mappata.</p>
    ${bottonePartenza()}
  `;

  anime({
    targets: box.querySelectorAll('[data-conta]'),
    innerHTML: (el) => [0, Number(el.dataset.conta)],
    round: 1,
    duration: 700,
    easing: 'easeOutExpo',
  });

  collegaBottonePartenza();
}

function bottonePartenza() {
  return stato.daGeolocalizzazione
    ? '<button class="link-azione" id="btn-partenza">Riparti dall\'ingresso del porto</button>'
    : '<button class="link-azione" id="btn-partenza">Calcola dalla mia posizione</button>';
}

function nomePartenza() {
  return stato.daGeolocalizzazione
    ? 'la tua posizione'
    : "l'ingresso del porto, Piazzale S. Massaccesi";
}

function collegaBottonePartenza() {
  const btn = $('#btn-partenza');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (stato.daGeolocalizzazione) {
      stato.daGeolocalizzazione = false;
      stato.partenza = [stato.porto.ingressoTerra.lat, stato.porto.ingressoTerra.lon];
      if (stato.selezionata) calcolaPercorso(stato.selezionata);
      return;
    }

    if (!navigator.geolocation) {
      btn.disabled = true;
      btn.textContent = 'Geolocalizzazione non disponibile';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Rilevamento…';

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        stato.partenza = [pos.coords.latitude, pos.coords.longitude];
        stato.daGeolocalizzazione = true;
        if (stato.selezionata) calcolaPercorso(stato.selezionata);
      },
      () => {
        btn.disabled = false;
        btn.textContent = 'Posizione non concessa';
        setTimeout(() => {
          if ($('#btn-partenza') === btn) btn.textContent = 'Calcola dalla mia posizione';
        }, 3000);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

// -------------------------------------------------------------------- viste

function cambiaVista(vista) {
  stato.vista = vista;
  $$('.tab').forEach((t) => t.classList.toggle('tab-attivo', t.dataset.vista === vista));
  $$('.vista').forEach((v) => v.classList.toggle('vista-attiva', v.dataset.vista === vista));

  if (vista === '3d') {
    scena.avvia();
    scena.ridimensiona();
    if (stato.selezionata) scena.inquadra(stato.selezionata.lat, stato.selezionata.lon);
  } else {
    scena.ferma();
  }

  if (vista === 'satellite') {
    mappa.ridimensiona();
    if (stato.selezionata) mappa.vaiA(stato.selezionata.lat, stato.selezionata.lon);
  }
}

// --------------------------------------------------------------------- info

function renderInfo() {
  const s = stato.porto.scheda;
  const g = stato.geo;

  const numero = (valore, unita, chiave) =>
    `<div class="numero"><b>${valore}${unita ? `<i> ${unita}</i>` : ''}</b><span class="etichetta-micro">${chiave}</span></div>`;

  const riga = (k, v) => `<div class="dato-riga"><dt>${k}</dt><dd>${v}</dd></div>`;

  $('#scheda-porto').innerHTML = `
    <h2>Scheda del porto</h2>

    <div class="numeri">
      ${numero(s.postiBarca, '', 'Posti barca')}
      ${numero(s.lunghezzaMax, 'm', 'Lunghezza max')}
      ${numero(`${s.pescaggioMin}–${s.pescaggioMax}`, 'm', 'Pescaggio')}
      ${numero(s.fondale, '', 'Fondale')}
    </div>

    <dl class="tabella">
      ${riga('Classificazione', s.classificazione)}
      ${riga('Coordinate', s.coordinate)}
      ${riga('Accesso', s.accesso)}
      ${riga('Venti', s.venti)}
      ${riga('Stagione', s.stagione)}
    </dl>

    <h3>Come è costruito il modello 3D</h3>
    <p>
      La scena non è disegnata a mano: ogni volume nasce dalla geometria reale di
      OpenStreetMap, proiettata in metri ed estrusa in altezza. Da quest'area sono
      stati letti <strong>${g.moli.length} moli</strong>,
      <strong>${g.scogliere.length} scogliere frangiflutti</strong>,
      <strong>${g.pontili.length} pontili</strong>,
      <strong>${g.costa.length} tratti di linea di costa</strong> e
      <strong>${g.edifici.length} edifici</strong>.
    </p>
    <p>
      Sono invece <strong>stimate</strong> le altezze degli edifici non taggate su OSM,
      ricavate dall'impronta a terra, e le quote di banchina e pontili, scelte per la
      leggibilità della scena. Le barche agli ormeggi sono rappresentative: il porto
      dichiara circa ${s.postiBarca} posti, ma non è mappato il singolo natante.
    </p>

    <h3>Come viene calcolato il percorso</h3>
    <p>
      La rete pedonale OpenStreetMap — ${g.strade.length} archi, pontili e moli inclusi
      perché si percorrono a piedi — diventa un grafo pesato: la lunghezza di ogni
      segmento è moltiplicata per un costo che dipende dal tipo di percorso, così una
      scalinata "costa" più di un lungomare. Il cammino minimo è calcolato con
      l'algoritmo di Dijkstra.
    </p>

    <h3>Posizione delle attività</h3>
    <p>
      Non tutte le attività sono mappate su OpenStreetMap. Dove lo sono, le coordinate
      sono rilevate; altrimenti il punto è collocato sulla banchina indicata
      dall'indirizzo pubblicato, con un margine di alcune decine di metri. La scheda di
      ogni attività dichiara quale dei due casi si applica.
    </p>
    <p class="piccolo">
      Contatti, orari e prezzi cambiano: vanno verificati sul sito dell'operatore.
      Ultimo aggiornamento dei dati: ${stato.catalogo.aggiornato}.
    </p>

    <h3>Fonti</h3>
    <ul class="fonti">
      ${stato.catalogo.fonti
        .map((f) => `<li><a href="${f.url}" target="_blank" rel="noopener">${escapeHtml(f.titolo)}</a></li>`)
        .join('')}
    </ul>

    <h3>Licenze</h3>
    <p class="piccolo">
      Dati geografici © contributori OpenStreetMap, licenza ODbL.
      Immagini satellitari © Esri, Maxar, Earthstar Geographics.
    </p>
  `;
}

// --------------------------------------------------------------------- avvio

function collegaControlli() {
  $('#ricerca').addEventListener('input', (e) => {
    stato.ricerca = e.target.value;
    applicaFiltri();
  });

  const select = $('#categoria');
  select.innerHTML =
    '<option value="tutte">Tutte le categorie</option>' +
    Object.entries(stato.catalogo.categorie)
      .map(([k, c]) => `<option value="${k}">${escapeHtml(c.etichetta)}</option>`)
      .join('');
  select.addEventListener('change', (e) => {
    stato.categoria = e.target.value;
    applicaFiltri();
  });

  $('#indietro').addEventListener('click', tornaAllElenco);
  $$('.tab').forEach((t) => t.addEventListener('click', () => cambiaVista(t.dataset.vista)));
  $('#btn-panoramica').addEventListener('click', () => scena.vistaGenerale());

  // Un solo pulsante che alterna i due sfondi, invece di due sempre presenti.
  const btnSfondo = $('#cambia-sfondo');
  const didascalie = {
    satellite:
      'Immagine satellitare attuale. Sopra sono tracciati diga foranea, scogliere e pontili come mappati su OpenStreetMap.',
    mappa:
      'Mappa stradale OpenStreetMap, con diga foranea, scogliere e pontili evidenziati.',
  };
  btnSfondo.addEventListener('click', () => {
    const nuovo = mappa.sfondoCorrente === 'satellite' ? 'mappa' : 'satellite';
    mappa.cambiaSfondo(nuovo);
    // Il pulsante nomina lo sfondo su cui si passa, la didascalia quello attivo.
    btnSfondo.textContent = nuovo === 'satellite' ? 'Mappa' : 'Satellite';
    $('#didascalia-mappa').textContent = didascalie[nuovo];
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stato.selezionata) tornaAllElenco();
  });
}

async function avvia() {
  await carica();

  mappa = new MappaPorto('mappa', { centro: stato.porto.centro, alSelezionare: seleziona });
  mappa.disegnaGeometria(stato.geo);
  mappa.disegnaAziende(stato.catalogo.aziende, stato.catalogo.categorie);

  scena = new ScenaPorto($('#scena'), { centro: stato.porto.centro, alSelezionare: seleziona });
  scena.costruisci(stato.geo);
  scena.creaSegnaposti(stato.catalogo.aziende);

  collegaControlli();
  applicaFiltri();
  renderInfo();

  anime({
    targets: '#caricamento',
    opacity: [1, 0],
    duration: 320,
    easing: 'easeOutQuad',
    complete: () => $('#caricamento').remove(),
  });
}

avvia().catch((err) => {
  console.error(err);
  const c = document.getElementById('caricamento');
  if (c) {
    c.innerHTML = `<div class="caricamento-errore"><h2>Impossibile caricare i dati del porto</h2><p>${escapeHtml(err.message)}</p></div>`;
  }
});
