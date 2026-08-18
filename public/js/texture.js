/**
 * Texture procedurali per il modello 3D del porto.
 *
 * Sono generate su canvas al caricamento, non caricate da file: il sito
 * funziona senza rete e non trascina asset binari nel repository.
 *
 * Regola di fondo: restano dentro la palette. Ogni texture modula la luminanza
 * in una banda stretta attorno al bianco (il `color` del materiale resta il
 * tono), e il rilievo vero lo fa la bumpMap. Serve a dare materia — cemento,
 * roccia, intonaco, legno — non a colorare.
 */
import * as THREE from '../vendor/three.module.js';

/** PRNG deterministico: la scena è identica a ogni caricamento. */
function creaPrng(seme) {
  let s = seme >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const smussa = (t) => t * t * (3 - 2 * t);

/**
 * Rumore di valore su griglia ciclica: campionando con modulo sulle celle,
 * il risultato combacia sui bordi e la texture si ripete senza cuciture.
 */
function creaStrato(celle, prng) {
  const g = new Float32Array(celle * celle);
  for (let i = 0; i < g.length; i++) g[i] = prng();

  return (x, y) => {
    const fx = x * celle;
    const fy = y * celle;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smussa(fx - x0);
    const ty = smussa(fy - y0);
    const c0 = ((x0 % celle) + celle) % celle;
    const c1 = (c0 + 1) % celle;
    const r0 = ((y0 % celle) + celle) % celle;
    const r1 = (r0 + 1) % celle;
    const a = g[r0 * celle + c0];
    const b = g[r0 * celle + c1];
    const c = g[r1 * celle + c0];
    const d = g[r1 * celle + c1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

/** Somma di ottave: dettaglio fine sopra le variazioni larghe. */
function creaFbm(celleBase, ottave, seme) {
  const prng = creaPrng(seme);
  const strati = [];
  let ampiezza = 1;
  let somma = 0;
  for (let o = 0; o < ottave; o++) {
    strati.push({ campiona: creaStrato(celleBase * 2 ** o, prng), ampiezza });
    somma += ampiezza;
    ampiezza *= 0.5;
  }
  return (x, y) => {
    let v = 0;
    for (const s of strati) v += s.campiona(x, y) * s.ampiezza;
    return v / somma;
  };
}

/**
 * Disegna una texture su canvas.
 * @param {number} dim lato in pixel
 * @param {(x:number,y:number)=>number} campo funzione che ritorna 0..1 per uv
 */
function dipingi(dim, campo) {
  const canvas = document.createElement('canvas');
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(dim, dim);

  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const v = Math.max(0, Math.min(1, campo(x / dim, y / dim)));
      const b = Math.round(v * 255);
      const i = (y * dim + x) * 4;
      img.data[i] = b;
      img.data[i + 1] = b;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

function creaTexture(canvas, { ripetizione, anisotropia, colore = false }) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(ripetizione, ripetizione);
  t.anisotropy = anisotropia;
  // Le UV di ExtrudeGeometry sono in metri: la ripetizione è la scala reale.
  if (colore) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Costruisce l'insieme delle texture del porto.
 * @param {number} anisotropia renderer.capabilities.getMaxAnisotropy()
 */
export function creaTexturePorto(anisotropia) {
  const A = anisotropia;

  // --- Cemento della banchina: grana fine su chiazze larghe ---
  // Niente giunti di getto: su una banchina larga come questa il reticolo
  // regolare si legge come piastrellato e domina tutta la scena. La materia
  // la fanno la grana e le variazioni di tono, che non hanno un passo.
  const granaCemento = creaFbm(8, 5, 20260817);
  const chiazzeCemento = creaFbm(3, 3, 4471);
  const cemento = (x, y) =>
    0.88 + granaCemento(x, y) * 0.11 + (chiazzeCemento(x, y) - 0.5) * 0.13;

  // --- Roccia dei moli: contrasto più alto, blocchi irregolari ---
  const granaRoccia = creaFbm(5, 5, 90210);
  const blocchiRoccia = creaFbm(9, 2, 1337);
  const roccia = (x, y) =>
    0.78 + granaRoccia(x, y) * 0.2 + (blocchiRoccia(x, y) - 0.5) * 0.22;

  // --- Intonaco degli edifici: grana minuta, quasi piatta ---
  const granaIntonaco = creaFbm(16, 4, 5150);
  const intonaco = (x, y) => 0.93 + granaIntonaco(x, y) * 0.07;

  // --- Coperture: grana più sporca, con righe di falda ---
  const granaTetto = creaFbm(10, 4, 8080);
  const tetto = (x, y) => {
    const riga = Math.abs(((y * 14) % 1) - 0.5) < 0.06 ? 0.07 : 0;
    return 0.86 + granaTetto(x, y) * 0.12 - riga;
  };

  // --- Legno dei pontili: tavole lungo un asse, venatura lungo l'altro ---
  const venatura = creaFbm(4, 4, 3141);
  const finiVenatura = creaFbm(24, 3, 2718);
  const legno = (x, y) => {
    const tavole = 7;
    const p = y * tavole;
    const indice = Math.floor(p);
    const dentro = p - indice;
    // Ogni tavola ha il suo tono: il pontile non è una superficie unica.
    const tono = ((Math.sin(indice * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const fuga = dentro < 0.035 || dentro > 0.965 ? 0.16 : 0;
    const vena = venatura(x * 0.35, y * 3) * 0.08 + finiVenatura(x, y) * 0.05;
    return 0.87 + tono * 0.07 + vena - fuga;
  };

  const dim = 256;
  const mappa = (campo, ripetizione, seme) => {
    const canvas = dipingi(dim, campo);
    return {
      map: creaTexture(canvas, { ripetizione, anisotropia: A, colore: true }),
      bumpMap: creaTexture(canvas, { ripetizione, anisotropia: A }),
    };
  };

  return {
    // La ripetizione è in 1/metri: 1/6 = la texture copre 6 m di banchina.
    cemento: mappa(cemento, 1 / 6),
    roccia: mappa(roccia, 1 / 9),
    intonaco: mappa(intonaco, 1 / 4),
    tetto: mappa(tetto, 1 / 5),
    legno: mappa(legno, 1 / 3),
  };
}
