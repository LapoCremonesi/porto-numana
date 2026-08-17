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

    const stili = {
      molo: { color: '#f8fafc', weight: 5, opacity: 0.55 },
      scogliera: { color: '#cbd5e1', weight: 2, opacity: 0.7, fillOpacity: 0.18 },
      pontile: { color: '#7dd3fc', weight: 3, opacity: 0.85, dashArray: '1 6', lineCap: 'round' },
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

  /** Crea i marker delle aziende. */
  disegnaAziende(aziende, categorie) {
    this.gruppoMarker.clearLayers();
    this.marker.clear();

    for (const a of aziende) {
      const cat = categorie[a.categoria];
      const icona = L.divIcon({
        className: 'marker-azienda',
        html: `<span class="marker-pin" style="--tinta:${cat.colore}">
                 <span class="marker-icona">${cat.icona}</span>
               </span>`,
        iconSize: [34, 42],
        iconAnchor: [17, 40],
        popupAnchor: [0, -36],
      });

      const marker = L.marker([a.lat, a.lon], { icon: icona, title: a.nome })
        .addTo(this.gruppoMarker)
        .bindPopup(
          `<strong>${a.nome}</strong><br><span class="popup-cat">${cat.etichetta}</span>` +
            (a.settore ? `<br><span class="popup-settore">${a.settore}</span>` : '')
        );

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

    // Alone scuro sotto, linea colorata sopra: si legge anche sul satellite.
    L.polyline(punti, { color: '#0b1120', weight: 9, opacity: 0.55 }).addTo(this.gruppoPercorso);
    const linea = L.polyline([], {
      color: '#38bdf8',
      weight: 4,
      opacity: 0.95,
      lineJoin: 'round',
    }).addTo(this.gruppoPercorso);

    L.circleMarker(punti[0], {
      radius: 7,
      color: '#f8fafc',
      weight: 2,
      fillColor: '#22c55e',
      fillOpacity: 1,
    })
      .bindTooltip('Partenza')
      .addTo(this.gruppoPercorso);

    L.circleMarker(punti[punti.length - 1], {
      radius: 7,
      color: '#f8fafc',
      weight: 2,
      fillColor: '#f43f5e',
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
