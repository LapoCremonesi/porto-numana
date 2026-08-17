/**
 * Ricostruzione 3D del Porto di Numana con three.js.
 *
 * Non è un modello artistico inventato: ogni volume nasce dalla geometria
 * reale di OpenStreetMap (linea di costa, moli, scogliere, pontili, sagome
 * degli edifici), proiettata in metri e poi estrusa in altezza. Le altezze
 * non mappate su OSM sono stimate ed è indicato nella pagina "Info".
 */
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { creaProiezione, concatenaCoste } from './geo.js';

/** Quote (in metri) usate dalla ricostruzione. */
const Q = {
  mare: 0,
  banchina: 2.2, // altezza della banchina sul livello medio del mare
  pontile: 0.75, // pontili galleggianti
  molo: 3.4, // coronamento della diga foranea
  scogliera: 2.6,
};

const COLORI = {
  banchina: 0xb9b3a5,
  moloRoccia: 0x8d8579,
  pontile: 0xd8cbb4,
  edificio: 0xe8e0d2,
  tetto: 0xb4553f,
  scafo: 0xf5f5f2,
};

export class ScenaPorto {
  constructor(contenitore, { centro, alSelezionare }) {
    this.contenitore = contenitore;
    this.alSelezionare = alSelezionare;
    this.proiezione = creaProiezione(centro);
    this.segnaposti = new Map(); // id azienda -> { gruppo, etichetta, posizione }
    this.orologio = new THREE.Clock();
    this.attiva = false;
    this._raf = null;

    this._initRenderer();
    this._initScena();
    this._initLuci();
    this._initInterazione();
  }

  // ---------------------------------------------------------------- setup

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.contenitore.clientWidth, this.contenitore.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.contenitore.appendChild(this.renderer.domElement);

    this.overlay = document.createElement('div');
    this.overlay.className = 'etichette-3d';
    this.contenitore.appendChild(this.overlay);
  }

  _initScena() {
    this.scena = new THREE.Scene();
    this.scena.background = new THREE.Color(0x8fbcd9);
    this.scena.fog = new THREE.Fog(0x9cc4dd, 700, 2000);

    this.camera = new THREE.PerspectiveCamera(
      50,
      this.contenitore.clientWidth / this.contenitore.clientHeight,
      0.5,
      4000
    );
    // Vista di apertura dal mare, verso l'imboccatura sud: si vedono i pontili,
    // la diga foranea e il paese alle spalle del porto.
    this.camera.position.set(300, 215, 330);

    this.controlli = new OrbitControls(this.camera, this.renderer.domElement);
    this.controlli.enableDamping = true;
    this.controlli.dampingFactor = 0.06;
    this.controlli.maxPolarAngle = Math.PI / 2.12; // niente sguardo da sotto il mare
    this.controlli.minDistance = 40;
    this.controlli.maxDistance = 1100;
    this.controlli.target.set(0, 0, 0);

    this.gruppoPorto = new THREE.Group();
    this.scena.add(this.gruppoPorto);

    this.gruppoPercorso = new THREE.Group();
    this.scena.add(this.gruppoPercorso);
  }

  _initLuci() {
    this.scena.add(new THREE.HemisphereLight(0xcfe6f5, 0x6b6455, 1.15));

    const sole = new THREE.DirectionalLight(0xfff3dd, 2.1);
    sole.position.set(-260, 380, 180);
    sole.castShadow = true;
    sole.shadow.mapSize.set(2048, 2048);
    const c = sole.shadow.camera;
    c.left = -520;
    c.right = 520;
    c.top = 520;
    c.bottom = -520;
    c.near = 10;
    c.far = 1200;
    sole.shadow.bias = -0.0006;
    this.scena.add(sole);
    this.sole = sole;
  }

  _initInterazione() {
    this.raycaster = new THREE.Raycaster();
    const puntatore = new THREE.Vector2();

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      this._trascinato = false;
      this._giu = { x: e.clientX, y: e.clientY };
    });

    this.renderer.domElement.addEventListener('pointermove', (e) => {
      if (!this._giu) return;
      if (Math.hypot(e.clientX - this._giu.x, e.clientY - this._giu.y) > 5) this._trascinato = true;
    });

    this.renderer.domElement.addEventListener('pointerup', (e) => {
      this._giu = null;
      if (this._trascinato) return; // era una rotazione della camera, non un click

      const r = this.renderer.domElement.getBoundingClientRect();
      puntatore.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      puntatore.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      this.raycaster.setFromCamera(puntatore, this.camera);

      const bersagli = [...this.segnaposti.values()]
        .filter((s) => s.gruppo.visible)
        .map((s) => s.gruppo);
      const colpi = this.raycaster.intersectObjects(bersagli, true);
      if (colpi.length) {
        let o = colpi[0].object;
        while (o && !o.userData.idAzienda) o = o.parent;
        if (o?.userData.idAzienda) this.alSelezionare?.(o.userData.idAzienda);
      }
    });

    this._onResize = () => this.ridimensiona();
    window.addEventListener('resize', this._onResize);
  }

  // ------------------------------------------------------------ costruzione

  /** Converte [lat, lon] in un THREE.Vector2 (x, z) in metri. */
  _p(coord) {
    const { x, z } = this.proiezione.avanti(coord[0], coord[1]);
    return new THREE.Vector2(x, z);
  }

  /** Estrude un poligono orizzontale (array di Vector2 x/z) fino ad altezza h. */
  _estrudi(punti2d, h, materiale, { ombre = true } = {}) {
    if (punti2d.length < 3) return null;
    const forma = new THREE.Shape(punti2d);
    const geo = new THREE.ExtrudeGeometry(forma, { depth: h, bevelEnabled: false });
    // ExtrudeGeometry lavora sul piano XY: la ruotiamo per portarla sul piano XZ.
    geo.rotateX(Math.PI / 2);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, materiale);
    mesh.castShadow = ombre;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Costruisce un nastro di larghezza costante lungo una polilinea:
   * serve per moli, pontili e per il tracciato del percorso.
   */
  _nastro(punti2d, larghezza) {
    const met = larghezza / 2;
    const sinistra = [];
    const destra = [];

    for (let i = 0; i < punti2d.length; i++) {
      const prec = punti2d[Math.max(0, i - 1)];
      const succ = punti2d[Math.min(punti2d.length - 1, i + 1)];
      const dir = new THREE.Vector2().subVectors(succ, prec);
      if (dir.lengthSq() === 0) dir.set(1, 0);
      dir.normalize();
      const n = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(met);
      sinistra.push(new THREE.Vector2(punti2d[i].x + n.x, punti2d[i].y + n.y));
      destra.push(new THREE.Vector2(punti2d[i].x - n.x, punti2d[i].y - n.y));
    }

    return sinistra.concat(destra.reverse());
  }

  /**
   * Punto d'ingresso: costruisce l'intera scena dai dati OSM.
   * @param {object} geo dataset di data/porto-geo.json
   */
  costruisci(geo) {
    this._costruisciMare();
    this._costruisciTerra(geo);
    this._costruisciMoli(geo);
    this._costruisciPontili(geo);
    this._costruisciEdifici(geo);
    this._costruisciBarche(geo);
    this._bussola();
  }

  _costruisciMare() {
    // Maglia larga: serve solo alla silhouette delle onde lunghe. Il dettaglio
    // fine viene dal fragment shader, che non dipende dalla densità dei vertici.
    const geo = new THREE.PlaneGeometry(3600, 3600, 300, 300);
    geo.rotateX(-Math.PI / 2);

    // Le stesse onde sono definite in GLSL una volta sola e incluse nei due shader:
    // il vertex le somma per spostare i vertici, il fragment ne calcola la derivata
    // analitica per ottenere una normale liscia (niente moiré da maglia grossa).
    const ONDE = /* glsl */ `
      // dir.xy, lunghezza d'onda, ampiezza, velocità
      const vec4 ONDA[5] = vec4[5](
        vec4( 0.970,  0.243,  62.0, 0.42),
        vec4( 0.707, -0.707,  31.0, 0.20),
        vec4(-0.259,  0.966,  17.0, 0.10),
        vec4( 0.500,  0.866,   8.5, 0.045),
        vec4(-0.866,  0.500,   4.3, 0.022)
      );
      const float VELOCITA[5] = float[5](0.75, 1.15, 1.60, 2.30, 3.10);

      float altezzaOnde(vec2 p, float t, int quante) {
        float h = 0.0;
        for (int i = 0; i < 5; i++) {
          if (i >= quante) break;
          vec2 dir = ONDA[i].xy;
          float k = 6.28318 / ONDA[i].z;
          h += sin(dot(dir, p) * k + t * VELOCITA[i]) * ONDA[i].w;
        }
        return h;
      }

      // Derivata analitica: gradiente esatto, indipendente dalla maglia.
      vec2 pendenzaOnde(vec2 p, float t, int quante) {
        vec2 g = vec2(0.0);
        for (int i = 0; i < 5; i++) {
          if (i >= quante) break;
          vec2 dir = ONDA[i].xy;
          float k = 6.28318 / ONDA[i].z;
          float c = cos(dot(dir, p) * k + t * VELOCITA[i]) * ONDA[i].w * k;
          g += dir * c;
        }
        return g;
      }
    `;

    this.materialeMare = new THREE.ShaderMaterial({
      uniforms: {
        tempo: { value: 0 },
        coloreProfondo: { value: new THREE.Color(0x156b8d) },
        coloreBasso: { value: new THREE.Color(0x33a0c0) },
        coloreCresta: { value: new THREE.Color(0x63c8d8) },
        cielo: { value: new THREE.Color(0xa8cfe4) },
        dirSole: { value: new THREE.Vector3(-260, 380, 180).normalize() },
        nebbiaColore: { value: new THREE.Color(0x9cc4dd) },
        nebbiaVicino: { value: 700 },
        nebbiaLontano: { value: 2000 },
      },
      vertexShader: /* glsl */ `
        uniform float tempo;
        varying vec3 vPos;
        ${ONDE}

        void main() {
          vec3 pos = position;
          // Solo le 3 onde lunghe deformano la maglia: le corte sarebbero
          // comunque sotto la risoluzione dei vertici.
          pos.y += altezzaOnde(pos.xz, tempo, 3);
          vPos = pos;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float tempo;
        uniform vec3 coloreProfondo;
        uniform vec3 coloreBasso;
        uniform vec3 coloreCresta;
        uniform vec3 cielo;
        uniform vec3 dirSole;
        uniform vec3 nebbiaColore;
        uniform float nebbiaVicino;
        uniform float nebbiaLontano;
        varying vec3 vPos;
        ${ONDE}

        void main() {
          float distanza = length(cameraPosition - vPos);

          // In lontananza le onde corte diventano rumore: le smorziamo con la
          // distanza, così l'orizzonte resta pulito invece di brulicare.
          float dettaglio = 1.0 - smoothstep(120.0, 900.0, distanza);

          vec2 pendLunghe = pendenzaOnde(vPos.xz, tempo, 3);
          vec2 pendTutte = pendenzaOnde(vPos.xz, tempo, 5);
          vec2 pend = mix(pendLunghe, pendTutte, dettaglio);
          vec3 n = normalize(vec3(-pend.x, 1.0, -pend.y));

          float h = mix(altezzaOnde(vPos.xz, tempo, 3), altezzaOnde(vPos.xz, tempo, 5), dettaglio);

          // L'altezza dell'onda sposta il colore solo di poco: se la si lega
          // troppo strettamente al colore, il mare diventa una scacchiera.
          vec3 colore = mix(coloreProfondo, coloreBasso, smoothstep(-1.1, 0.9, h));
          colore = mix(colore, coloreCresta, smoothstep(0.45, 1.15, h) * 0.45);

          // Il grosso della variazione viene dal cielo riflesso: alle incidenze
          // radenti l'acqua fa da specchio, in verticale si vede il fondo.
          vec3 vista = normalize(cameraPosition - vPos);
          float fresnel = pow(1.0 - max(dot(n, vista), 0.0), 4.0);
          colore = mix(colore, cielo, clamp(fresnel, 0.0, 1.0) * 0.8);

          vec3 mezzo = normalize(dirSole + vista);
          float spec = pow(max(dot(n, mezzo), 0.0), 160.0);
          colore += vec3(1.0, 0.96, 0.86) * spec * 1.1;

          float diffusa = max(dot(n, dirSole), 0.0);
          colore *= 0.90 + diffusa * 0.16;

          float nebbia = smoothstep(nebbiaVicino, nebbiaLontano, distanza);
          colore = mix(colore, nebbiaColore, nebbia);

          gl_FragColor = vec4(colore, 1.0);
        }
      `,
    });

    const mare = new THREE.Mesh(geo, this.materialeMare);
    mare.position.y = Q.mare;
    mare.receiveShadow = false;
    this.scena.add(mare);
  }

  /**
   * Terraferma: la linea di costa OSM viene chiusa verso ovest (l'entroterra)
   * per ottenere un poligono estrudibile. Gli anelli di costa già chiusi —
   * in OSM il molo sud è mappato così — diventano isole a sé.
   */
  _costruisciTerra(geo) {
    const catene = concatenaCoste(geo.costa);
    const materiale = new THREE.MeshStandardMaterial({
      color: COLORI.banchina,
      roughness: 0.95,
      metalness: 0,
    });

    const LIMITE_OVEST = -1400; // metri a ovest del centro: bordo interno della scena
    let principaleFatta = false;

    for (const catena of catene) {
      const punti = catena.punti.map((c) => this._p(c));
      if (punti.length < 3) continue;

      if (catena.chiusa) {
        const mesh = this._estrudi(punti, Q.banchina, materiale);
        if (mesh) {
          mesh.position.y = Q.banchina;
          mesh.userData.tipo = 'molo-terra';
          this.gruppoPorto.add(mesh);
        }
        continue;
      }

      // Solo la catena più lunga rappresenta il litorale: le altre sono frammenti.
      if (principaleFatta) continue;
      principaleFatta = true;

      const chiusa = punti.slice();
      chiusa.push(new THREE.Vector2(LIMITE_OVEST, punti[punti.length - 1].y));
      chiusa.push(new THREE.Vector2(LIMITE_OVEST, punti[0].y));

      const mesh = this._estrudi(chiusa, Q.banchina, materiale, { ombre: false });
      if (mesh) {
        mesh.position.y = Q.banchina;
        mesh.userData.tipo = 'terraferma';
        this.gruppoPorto.add(mesh);
      }
    }
  }

  /** Diga foranea e scogliere frangiflutti: massi, quindi volumi grezzi e opachi. */
  _costruisciMoli(geo) {
    const materiale = new THREE.MeshStandardMaterial({
      color: COLORI.moloRoccia,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });

    for (const molo of geo.moli) {
      const punti = molo.punti.map((c) => this._p(c));
      if (punti.length < 2) continue;

      // Base larga sott'acqua + coronamento stretto: il profilo di una scogliera.
      const base = this._estrudi(this._nastro(punti, 22), Q.molo * 0.75, materiale);
      if (base) {
        base.position.y = Q.molo * 0.75 - 1.5;
        this.gruppoPorto.add(base);
      }
      const cima = this._estrudi(this._nastro(punti, 11), Q.molo, materiale);
      if (cima) {
        cima.position.y = Q.molo;
        cima.userData.tipo = 'molo';
        this.gruppoPorto.add(cima);
      }

      this._fanale(punti[punti.length - 1], 0xef4444);
      this._fanale(punti[0], 0x22c55e);
    }

    for (const scogliera of geo.scogliere) {
      const punti = scogliera.punti.map((c) => this._p(c));
      const mesh = this._estrudi(punti, Q.scogliera, materiale);
      if (mesh) {
        mesh.position.y = Q.scogliera;
        mesh.userData.tipo = 'scogliera';
        this.gruppoPorto.add(mesh);
      }
    }
  }

  /** Fanale rosso/verde di imboccatura. */
  _fanale(p, colore) {
    const gruppo = new THREE.Group();
    const palo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.5, 5, 8),
      new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.6 })
    );
    palo.position.y = 2.5;
    palo.castShadow = true;

    const luce = new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 12, 10),
      new THREE.MeshStandardMaterial({ color: colore, emissive: colore, emissiveIntensity: 1.4 })
    );
    luce.position.y = 5.4;

    gruppo.add(palo, luce);
    gruppo.position.set(p.x, Q.molo, p.y);
    gruppo.userData.lampeggiante = luce;
    this.gruppoPorto.add(gruppo);
    (this._fanali ??= []).push(luce);
  }

  /** Pontili galleggianti di ormeggio. */
  _costruisciPontili(geo) {
    const materiale = new THREE.MeshStandardMaterial({
      color: COLORI.pontile,
      roughness: 0.85,
      metalness: 0,
    });

    this.pontili = [];
    for (const pontile of geo.pontili) {
      const punti = pontile.punti.map((c) => this._p(c));
      if (punti.length < 2) continue;
      const mesh = this._estrudi(this._nastro(punti, 2.6), 0.45, materiale);
      if (!mesh) continue;
      mesh.position.y = Q.pontile;
      mesh.userData.tipo = 'pontile';
      this.gruppoPorto.add(mesh);
      this.pontili.push(punti);
    }
  }

  /** Sagome degli edifici OSM, estruse all'altezza dichiarata o stimata. */
  _costruisciEdifici(geo) {
    const muri = new THREE.MeshStandardMaterial({
      color: COLORI.edificio,
      roughness: 0.9,
      metalness: 0,
    });
    const tetti = new THREE.MeshStandardMaterial({
      color: COLORI.tetto,
      roughness: 0.85,
      metalness: 0,
    });

    for (const ed of geo.edifici) {
      const punti = ed.punti.map((c) => this._p(c));
      if (punti.length < 3) continue;

      // Senza tag height/levels stimiamo dall'impronta: capannoni bassi, case più alte.
      let h = ed.altezza;
      if (!h) {
        const area = Math.abs(THREE.ShapeUtils.area(punti));
        h = area > 600 ? 6.5 : area > 220 ? 9.5 : 7.5;
      }

      const corpo = this._estrudi(punti, h, muri);
      if (!corpo) continue;
      corpo.position.y = Q.banchina + h;
      corpo.userData.tipo = 'edificio';
      this.gruppoPorto.add(corpo);

      // Falda accennata: una lastra sottile sopra il volume, per staccare i tetti.
      const falda = this._estrudi(punti, 0.6, tetti);
      if (falda) {
        falda.position.y = Q.banchina + h + 0.7;
        falda.scale.set(1.02, 1, 1.02);
        this.gruppoPorto.add(falda);
      }
    }
  }

  /**
   * Barche ormeggiate lungo i pontili.
   * Il porto dichiara ~800 posti: qui ne rappresentiamo un campione ordinato
   * lungo i pontili reali, non la posizione del singolo natante.
   */
  _costruisciBarche(geo) {
    const scafo = new THREE.MeshStandardMaterial({ color: COLORI.scafo, roughness: 0.45 });
    const coperta = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.7 });
    const albero = new THREE.MeshStandardMaterial({ color: 0xd6dee6, roughness: 0.5 });

    // Un solo geometria riusata per tutte le barche: molte istanze, poco costo.
    const geoScafo = new THREE.CapsuleGeometry(1.05, 4.2, 4, 10);
    geoScafo.scale(1, 1, 0.55);
    const geoCabina = new THREE.BoxGeometry(1.5, 0.9, 2.0);
    const geoAlbero = new THREE.CylinderGeometry(0.09, 0.13, 9, 6);

    this.barche = [];
    let seme = 20260817; // sequenza deterministica: la scena è identica a ogni caricamento
    const casuale = () => {
      seme = (seme * 1103515245 + 12345) & 0x7fffffff;
      return seme / 0x7fffffff;
    };

    for (const punti of this.pontili ?? []) {
      const a = punti[0];
      const b = punti[punti.length - 1];
      const lung = a.distanceTo(b);
      const passo = 7;
      const n = Math.max(1, Math.floor(lung / passo) - 1);

      const dir = new THREE.Vector2().subVectors(b, a).normalize();
      const nor = new THREE.Vector2(-dir.y, dir.x);
      const angolo = Math.atan2(dir.x, dir.y);

      for (let i = 1; i <= n; i++) {
        for (const lato of [1, -1]) {
          if (casuale() < 0.22) continue; // qualche posto libero

          const t = (i * lung) / (n + 1);
          const off = 3.6 + casuale() * 0.6;
          const x = a.x + dir.x * t + nor.x * off * lato;
          const z = a.y + dir.y * t + nor.y * off * lato;

          const barca = new THREE.Group();
          const corpo = new THREE.Mesh(geoScafo, scafo);
          corpo.rotation.z = Math.PI / 2;
          corpo.castShadow = true;
          barca.add(corpo);

          const cabina = new THREE.Mesh(geoCabina, coperta);
          cabina.position.set(0, 0.85, -0.3);
          cabina.castShadow = true;
          barca.add(cabina);

          if (casuale() < 0.42) {
            const m = new THREE.Mesh(geoAlbero, albero);
            m.position.y = 5;
            barca.add(m);
          }

          const scala = 0.85 + casuale() * 0.75;
          barca.scale.setScalar(scala);
          barca.position.set(x, Q.mare + 0.35, z);
          barca.rotation.y = angolo + (Math.PI / 2) * lato;
          barca.userData.fase = casuale() * Math.PI * 2;
          barca.userData.baseY = Q.mare + 0.35;

          this.gruppoPorto.add(barca);
          this.barche.push(barca);
        }
      }
    }
  }

  /** Rosa dei venti a terra, per orientarsi. */
  _bussola() {
    const materiale = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
    const punti = [
      new THREE.Vector3(0, 0.2, -260),
      new THREE.Vector3(0, 0.2, 260),
      new THREE.Vector3(0, 0.2, 0),
      new THREE.Vector3(260, 0.2, 0),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(punti);
    this.scena.add(new THREE.LineSegments(geo, materiale));
  }

  // -------------------------------------------------------------- segnaposti

  /** Crea i segnaposto 3D delle aziende, con etichetta HTML sovrapposta. */
  creaSegnaposti(aziende, categorie) {
    for (const { gruppo, etichetta } of this.segnaposti.values()) {
      this.gruppoPorto.remove(gruppo);
      etichetta.remove();
    }
    this.segnaposti.clear();

    const geoAsta = new THREE.CylinderGeometry(0.35, 0.35, 14, 8);
    const geoTesta = new THREE.SphereGeometry(2.4, 16, 14);
    const geoAnello = new THREE.RingGeometry(3.2, 4.4, 28);

    for (const a of aziende) {
      const cat = categorie[a.categoria];
      const tinta = new THREE.Color(cat.colore);
      const { x, z } = this.proiezione.avanti(a.lat, a.lon);

      const gruppo = new THREE.Group();
      gruppo.position.set(x, Q.banchina, z);
      gruppo.userData.idAzienda = a.id;

      const asta = new THREE.Mesh(
        geoAsta,
        new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 })
      );
      asta.position.y = 7;
      gruppo.add(asta);

      const testa = new THREE.Mesh(
        geoTesta,
        new THREE.MeshStandardMaterial({
          color: tinta,
          emissive: tinta,
          emissiveIntensity: 0.45,
          roughness: 0.35,
        })
      );
      testa.position.y = 15;
      testa.castShadow = true;
      gruppo.add(testa);

      const anello = new THREE.Mesh(
        geoAnello,
        new THREE.MeshBasicMaterial({
          color: tinta,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
        })
      );
      anello.rotation.x = -Math.PI / 2;
      anello.position.y = 0.35;
      gruppo.add(anello);

      this.gruppoPorto.add(gruppo);

      const etichetta = document.createElement('button');
      etichetta.className = 'etichetta-3d';
      etichetta.style.setProperty('--tinta', cat.colore);
      etichetta.innerHTML = `<span class="etichetta-icona">${cat.icona}</span><span>${a.nome}</span>`;
      etichetta.addEventListener('click', () => this.alSelezionare?.(a.id));
      this.overlay.appendChild(etichetta);

      this.segnaposti.set(a.id, {
        gruppo,
        etichetta,
        testa,
        anello,
        posizione: new THREE.Vector3(x, 18, z),
      });
    }
  }

  filtra(idVisibili) {
    for (const [id, s] of this.segnaposti) {
      const v = idVisibili.has(id);
      s.gruppo.visible = v;
      s.etichetta.style.display = v ? '' : 'none';
    }
  }

  evidenzia(id) {
    this.idAttivo = id;
    for (const [k, s] of this.segnaposti) {
      const attivo = k === id;
      s.etichetta.classList.toggle('etichetta-attiva', attivo);
      s.testa.scale.setScalar(attivo ? 1.6 : 1);
    }
  }

  /** Inquadra un'azienda con una transizione morbida della camera. */
  inquadra(lat, lon, { distanza = 130, altezza = 75 } = {}) {
    const { x, z } = this.proiezione.avanti(lat, lon);
    const bersaglio = new THREE.Vector3(x, 8, z);
    const posizione = new THREE.Vector3(x - distanza * 0.8, altezza, z + distanza * 0.8);
    this._transizioneCamera(posizione, bersaglio, 1100);
  }

  vistaGenerale() {
    this._transizioneCamera(
      new THREE.Vector3(300, 215, 330),
      new THREE.Vector3(0, 0, 0),
      1200
    );
  }

  _transizioneCamera(posFinale, targetFinale, durata) {
    const posIniziale = this.camera.position.clone();
    const targetIniziale = this.controlli.target.clone();
    const t0 = performance.now();
    // easeInOutCubic: parte e arriva lenta, come una ripresa da drone.
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    const passo = () => {
      const t = Math.min(1, (performance.now() - t0) / durata);
      const e = ease(t);
      this.camera.position.lerpVectors(posIniziale, posFinale, e);
      this.controlli.target.lerpVectors(targetIniziale, targetFinale, e);
      this.controlli.update();
      if (t < 1) requestAnimationFrame(passo);
    };
    passo();
  }

  // ---------------------------------------------------------------- percorso

  /** Disegna il percorso a piedi come nastro luminoso sopra la banchina. */
  disegnaPercorso(puntiLatLon) {
    this.pulisciPercorso();
    if (!puntiLatLon?.length) return;

    const punti3d = puntiLatLon.map(([lat, lon]) => {
      const { x, z } = this.proiezione.avanti(lat, lon);
      return new THREE.Vector3(x, Q.banchina + 1.2, z);
    });

    const curva = new THREE.CatmullRomCurve3(punti3d, false, 'centripetal', 0.3);
    const geo = new THREE.TubeGeometry(curva, Math.max(24, punti3d.length * 3), 1.4, 8, false);

    this.materialePercorso = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.7,
      roughness: 0.3,
      transparent: true,
      opacity: 0.95,
    });

    const tubo = new THREE.Mesh(geo, this.materialePercorso);
    tubo.castShadow = false;
    // drawRange animato: il percorso si "traccia" invece di apparire di colpo.
    this._indiciPercorso = geo.index.count;
    geo.setDrawRange(0, 0);
    this.gruppoPercorso.add(tubo);
    this._t0Percorso = performance.now();

    // Copia "fantasma" senza test di profondità: dove il percorso passa dietro
    // un edificio resta comunque leggibile, come su una mappa di navigazione.
    const fantasma = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.28,
        depthTest: false,
        depthWrite: false,
      })
    );
    fantasma.renderOrder = 999;
    this.gruppoPercorso.add(fantasma);

    const partenza = this._pallino(punti3d[0], 0x22c55e);
    const arrivo = this._pallino(punti3d[punti3d.length - 1], 0xf43f5e);
    this.gruppoPercorso.add(partenza, arrivo);
    this._curvaPercorso = curva;
  }

  _pallino(pos, colore) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 16, 12),
      new THREE.MeshStandardMaterial({ color: colore, emissive: colore, emissiveIntensity: 0.8 })
    );
    m.position.copy(pos);
    return m;
  }

  pulisciPercorso() {
    // Tubo e copia fantasma condividono la geometria: liberarla una volta sola.
    const liberate = new Set();
    for (const o of [...this.gruppoPercorso.children]) {
      if (o.geometry && !liberate.has(o.geometry)) {
        liberate.add(o.geometry);
        o.geometry.dispose();
      }
      o.material?.dispose();
      this.gruppoPercorso.remove(o);
    }
    this._curvaPercorso = null;
    this._indiciPercorso = 0;
  }

  // ------------------------------------------------------------------ ciclo

  avvia() {
    if (this.attiva) return;
    this.attiva = true;
    this.ridimensiona();
    const ciclo = () => {
      if (!this.attiva) return;
      this._raf = requestAnimationFrame(ciclo);
      this._aggiorna();
      this.renderer.render(this.scena, this.camera);
      this._posizionaEtichette();
    };
    ciclo();
  }

  ferma() {
    this.attiva = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _aggiorna() {
    const t = this.orologio.getElapsedTime();
    this.controlli.update();

    if (this.materialeMare) this.materialeMare.uniforms.tempo.value = t;

    // Le barche seguono il moto ondoso: stessa frequenza delle onde principali.
    for (const barca of this.barche ?? []) {
      const f = barca.userData.fase;
      barca.position.y = barca.userData.baseY + Math.sin(t * 1.15 + f) * 0.16;
      barca.rotation.z = Math.sin(t * 0.9 + f) * 0.035;
      barca.rotation.x = Math.cos(t * 1.3 + f) * 0.02;
    }

    // Fanali di imboccatura: lampeggio lento.
    for (let i = 0; i < (this._fanali?.length ?? 0); i++) {
      const l = this._fanali[i];
      l.material.emissiveIntensity = 0.4 + Math.pow(Math.sin(t * 1.6 + i * 1.7) * 0.5 + 0.5, 3) * 2.2;
    }

    // Segnaposto attivo: alone pulsante.
    for (const [id, s] of this.segnaposti) {
      if (!s.gruppo.visible) continue;
      const attivo = id === this.idAttivo;
      const p = attivo ? 1 + Math.sin(t * 3.4) * 0.22 : 1;
      s.anello.scale.setScalar(p);
      s.anello.material.opacity = attivo ? 0.35 + Math.sin(t * 3.4) * 0.2 : 0.32;
    }

    // Tracciamento progressivo del percorso.
    if (this._indiciPercorso && this.gruppoPercorso.children[0]) {
      const avanzamento = Math.min(1, (performance.now() - this._t0Percorso) / 1400);
      this.gruppoPercorso.children[0].geometry.setDrawRange(
        0,
        Math.floor(this._indiciPercorso * avanzamento)
      );
    }
  }

  /**
   * Proietta le etichette dei segnaposti sullo schermo.
   *
   * Con 19 attività su ~300 m di banchina le etichette si sovrappongono fino a
   * diventare illeggibili: quelle più vicine alla camera (e quella selezionata)
   * hanno la precedenza, le altre si nascondono se il rettangolo è già occupato.
   * Chi viene nascosto resta comunque cliccabile come segnaposto 3D.
   */
  _posizionaEtichette() {
    const w = this.contenitore.clientWidth;
    const h = this.contenitore.clientHeight;
    const v = new THREE.Vector3();

    const candidati = [];
    for (const [id, s] of this.segnaposti) {
      if (!s.gruppo.visible) {
        s.etichetta.style.opacity = '0';
        continue;
      }
      v.copy(s.posizione).project(this.camera);

      const dietro = v.z > 1;
      const fuori = v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1;
      if (dietro || fuori) {
        s.etichetta.style.opacity = '0';
        s.etichetta.style.pointerEvents = 'none';
        continue;
      }

      candidati.push({
        s,
        attivo: id === this.idAttivo,
        x: ((v.x + 1) / 2) * w,
        y: ((-v.y + 1) / 2) * h,
        distanza: this.camera.position.distanceTo(s.posizione),
      });
    }

    // Selezionata per prima, poi dalla più vicina alla più lontana.
    candidati.sort((a, b) =>
      a.attivo !== b.attivo ? (a.attivo ? -1 : 1) : a.distanza - b.distanza
    );

    const occupati = [];
    const ALTEZZA = 26;

    for (const c of candidati) {
      const larghezza = c.s.etichetta.offsetWidth || 140;
      // L'etichetta è ancorata in basso al centro del punto proiettato.
      const box = {
        x1: c.x - larghezza / 2,
        x2: c.x + larghezza / 2,
        y1: c.y - ALTEZZA,
        y2: c.y,
      };

      const collide = occupati.some(
        (o) => box.x1 < o.x2 && box.x2 > o.x1 && box.y1 < o.y2 && box.y2 > o.y1
      );

      if (collide && !c.attivo) {
        c.s.etichetta.style.opacity = '0';
        c.s.etichetta.style.pointerEvents = 'none';
        continue;
      }

      occupati.push(box);
      c.s.etichetta.style.opacity = c.distanza > 900 ? '0.4' : '1';
      c.s.etichetta.style.pointerEvents = 'auto';
      c.s.etichetta.style.transform = `translate(-50%, -100%) translate(${c.x}px, ${c.y}px)`;
      c.s.etichetta.style.zIndex = String(Math.round(10000 - c.distanza));
    }
  }

  ridimensiona() {
    const w = this.contenitore.clientWidth;
    const h = this.contenitore.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
