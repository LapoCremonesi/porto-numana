/**
 * Mappa 2D con Leaflet: immagine satellitare attuale del porto, marker delle
 * aziende, geometria OSM sovrapposta e disegno animato del percorso.
 *
 * Leaflet è caricato come script globale (window.L) da index.html.
 */
const L = window.L;

/** Basemap disponibili: la satellitare è quella che mostra il porto "com'è oggi". */
const SFONDI = {
  satellite: {
    etichetta: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribuzione: 'Imagery © Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  mappa: {
    etichetta: 'Mappa',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribuzione: '© contributori OpenStreetMap',
    maxZoom: 19,
  },
};

export class MappaPorto {
  constructor(idContenitore, { centro, alSelezionare }) {
    this.alSelezionare = alSelezionare;
    this.marker = new Map();

    this.mappa = L.map(idContenitore, {
      center: [centro.lat, centro.lon],
      zoom: 17,
      zoomControl: true,
      attributionControl: true,
    });

    this.sfondoCorrente = 'satellite';
    this.livelloSfondo = this._creaSfondo('satellite').addTo(this.mappa);

    this.gruppoGeometria = L.layerGroup().addTo(this.mappa);
    this.gruppoMarker = L.layerGroup().addTo(this.mappa);
    this.gruppoPercorso = L.layerGroup().addTo(this.mappa);
  }

  _creaSfondo(nome) {
    const s = SFONDI[nome];
    return L.tileLayer(s.url, { attribution: s.attribuzione, maxZoom: s.maxZoom });
  }

  cambiaSfondo(nome) {
    if (!SFONDI[nome] || nome === this.sfondoCorrente) return;
    this.mappa.removeLayer(this.livelloSfondo);
    this.sfondoCorrente = nome;
    this.livelloSfondo = this._creaSfondo(nome).addTo(this.mappa);
    this.livelloSfondo.bringToBack();
  }

  /** Disegna moli, pontili e scogliere sopra la foto satellitare. */
  disegnaGeometria(geo) {
    this.gruppoGeometria.clearLayers();

    // Bianco a bassa opacità: sulla foto satellitare la geometria deve leggersi
    // come un lucido sovrapposto, non competere con l'immagine.
    const stili = {
      molo: { color: '#ffffff', weight: 4, opacity: 0.45 },
      scogliera: { color: '#ffffff', weight: 1.5, opacity: 0.5, fillOpacity: 0.1 },
      pontile: { color: '#ffffff', weight: 2, opacity: 0.65, dashArray: '2 5', lineCap: 'round' },
    };

    for (const m of geo.moli) {
      L.polyline(m.punti, stili.molo)
        .bindTooltip('Diga foranea / molo di sopraflutto')
        .addTo(this.gruppoGeometria);
    }
    for (const s of geo.scogliere) {
      L.polygon(s.punti, stili.scogliera)
        .bindTooltip('Scogliera frangiflutti')
        .addTo(this.gruppoGeometria);
    }
    for (const p of geo.pontili) {
      L.polyline(p.punti, stili.pontile)
        .bindTooltip(p.nome ?? 'Pontile di ormeggio')
        .addTo(this.gruppoGeometria);
    }
  }

  /**
   * Crea i marker delle aziende.
   * Un solo segno per tutte le categorie: la distinzione sta nella scheda, non
   * in sei colori diversi sparsi sulla foto.
   */
  disegnaAziende(aziende, categorie) {
    this.gruppoMarker.clearLayers();
    this.marker.clear();

    const icona = L.divIcon({
      className: 'marker-azienda',
      html: '<span class="marker-punto"></span>',
      iconSize: [11, 11],
      iconAnchor: [5.5, 5.5],
      popupAnchor: [0, -8],
    });

    for (const a of aziende) {
      const cat = categorie[a.categoria];
      const marker = L.marker([a.lat, a.lon], { icon: icona, title: a.nome })
        .addTo(this.gruppoMarker)
        .bindPopup(`<b>${a.nome}</b><br><span>${a.settore ?? cat.etichetta}</span>`);

      marker.on('click', () => this.alSelezionare?.(a.id));
      this.marker.set(a.id, marker);
    }
  }

  /** Mostra solo le aziende passate (filtro categorie / ricerca). */
  filtra(idVisibili) {
    for (const [id, marker] of this.marker) {
      const visibile = idVisibili.has(id);
      const el = marker.getElement();
      if (el) el.classList.toggle('marker-nascosto', !visibile);
      if (visibile) marker.setOpacity(1);
      else marker.setOpacity(0);
    }
  }

  evidenzia(id) {
    for (const [k, marker] of this.marker) {
      marker.getElement()?.classList.toggle('marker-attivo', k === id);
    }
  }

  vaiA(lat, lon, zoom = 18) {
    this.mappa.flyTo([lat, lon], zoom, { duration: 0.9 });
  }

  /**
   * Disegna il percorso con un'animazione di "tracciamento": la polilinea
   * cresce punto per punto invece di comparire tutta insieme.
   */
  disegnaPercorso(punti, { anima = true } = {}) {
    this.gruppoPercorso.clearLayers();
    if (!punti?.length) return;

    // Alone bianco sotto, tratto d'accento sopra: leggibile sulla foto senza
    // introdurre un secondo colore nella tavolozza.
    L.polyline(punti, { color: '#ffffff', weight: 7, opacity: 0.9 }).addTo(this.gruppoPercorso);
    const linea = L.polyline([], {
      color: '#31596b',
      weight: 3,
      opacity: 1,
      lineJoin: 'round',
    }).addTo(this.gruppoPercorso);

    // Partenza: anello vuoto. Arrivo: pieno. Stessa logica dei marker.
    L.circleMarker(punti[0], {
      radius: 5,
      color: '#31596b',
      weight: 2,
      fillColor: '#ffffff',
      fillOpacity: 1,
    })
      .bindTooltip('Partenza')
      .addTo(this.gruppoPercorso);

    L.circleMarker(punti[punti.length - 1], {
      radius: 5.5,
      color: '#ffffff',
      weight: 2,
      fillColor: '#31596b',
      fillOpacity: 1,
    })
      .bindTooltip('Arrivo')
      .addTo(this.gruppoPercorso);

    if (!anima) {
      linea.setLatLngs(punti);
    } else {
      let i = 0;
      const passo = Math.max(1, Math.round(punti.length / 60));
      const avanza = () => {
        i = Math.min(punti.length, i + passo);
        linea.setLatLngs(punti.slice(0, i));
        if (i < punti.length) requestAnimationFrame(avanza);
      };
      avanza();
    }

    // Il pannello di dettaglio copre la fascia destra: lo compensiamo con un
    // padding asimmetrico, altrimenti metà percorso finisce sotto la scheda.
    const pannello = document.querySelector('.dettaglio.aperto');
    const margineDestro = pannello ? pannello.offsetWidth + 40 : 60;

    this.mappa.flyToBounds(L.latLngBounds(punti), {
      duration: 1,
      paddingTopLeft: [60, 60],
      paddingBottomRight: [margineDestro, 80],
    });
  }

  pulisciPercorso() {
    this.gruppoPercorso.clearLayers();
  }

  ridimensiona() {
    this.mappa.invalidateSize();
  }
}
