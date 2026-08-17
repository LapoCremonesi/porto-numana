/**
 * Copia le librerie di terze parti da node_modules a public/vendor,
 * così il sito funziona anche senza CDN / senza rete.
 *
 * Eseguito automaticamente da `npm install` (postinstall).
 */
import { copyFile, mkdir, cp, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** [sorgente in node_modules, destinazione in public/vendor, ricorsivo?] */
const ASSETS = [
  ['three/build/three.module.js', 'three.module.js', false],
  ['three/examples/jsm/controls/OrbitControls.js', 'OrbitControls.js', false],
  ['three/examples/jsm/libs/stats.module.js', 'stats.module.js', false],
  ['animejs/lib/anime.es.js', 'anime.es.js', false],
  ['leaflet/dist/leaflet.js', 'leaflet.js', false],
  ['leaflet/dist/leaflet.css', 'leaflet.css', false],
  ['leaflet/dist/images', 'images', true],
];

const exists = async (p) => access(p).then(() => true, () => false);

async function main() {
  const dest = resolve(root, 'public/vendor');
  await mkdir(dest, { recursive: true });

  for (const [from, to, recursive] of ASSETS) {
    const src = resolve(root, 'node_modules', from);
    if (!(await exists(src))) {
      console.warn(`[vendor] saltato (non trovato): ${from}`);
      continue;
    }
    const out = resolve(dest, to);
    if (recursive) {
      await cp(src, out, { recursive: true });
    } else {
      await copyFile(src, out);
    }
    console.log(`[vendor] ${from} -> public/vendor/${to}`);
  }

  // OrbitControls importa 'three' come bare specifier: lo riscriviamo al file locale.
  const controls = resolve(dest, 'OrbitControls.js');
  if (await exists(controls)) {
    const { readFile, writeFile } = await import('node:fs/promises');
    const code = await readFile(controls, 'utf8');
    await writeFile(controls, code.replace(/from\s+['"]three['"]/g, "from './three.module.js'"));
  }
}

main().catch((err) => {
  console.error('[vendor] errore:', err);
  process.exitCode = 1;
});
