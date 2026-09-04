// Proiezione di un nuovo partecipante sulla mappa gia' calcolata.
// Nessun fit, nessun apprendimento: solo algebra lineare con i loadings fissi.
// E' per questo che la mappa non si muove mai e i colori restano gli stessi.

import { MODEL } from "./model.js";
import { QUESTIONS } from "./questions.js";

/** Le 10 risposte diventano un vettore one-hot di 40 dimensioni. */
export function encodeAnswers(answers) {
  const v = new Float64Array(MODEL.dim);
  for (let q = 0; q < QUESTIONS.length; q++) {
    v[MODEL.offsets[q] + answers[q]] = 1;
  }
  return v;
}

/** Centra e moltiplica per i loadings: x_pc = (x - mean) . components^T */
export function toPrincipalComponents(vec) {
  const { mean, components, nPC } = MODEL;
  const centered = new Float64Array(MODEL.dim);
  for (let i = 0; i < MODEL.dim; i++) centered[i] = vec[i] - mean[i];

  const pc = new Array(nPC).fill(0);
  for (let j = 0; j < nPC; j++) {
    const row = components[j];
    let s = 0;
    for (let i = 0; i < MODEL.dim; i++) s += centered[i] * row[i];
    pc[j] = s;
  }
  return pc;
}

/** Cluster = centroide piu' vicino. I centroidi sono fissi, quindi il colore e' stabile. */
export function assignCluster(pc) {
  let best = 0;
  let bestDist = Infinity;
  for (const c of MODEL.clusters) {
    let d = 0;
    for (let j = 0; j < pc.length; j++) {
      const diff = pc[j] - c.centroid[j];
      d += diff * diff;
    }
    if (d < bestDist) {
      bestDist = d;
      best = c.id;
    }
  }
  return best;
}

function applyBox(x, y, box) {
  return [(x - box.cx) / box.s, (y - box.cy) / box.s];
}

/** PCA 2D: bastano le prime due componenti, riscalate come i punti di riferimento. */
export function pcaCoords(pc) {
  return applyBox(pc[0], pc[1], MODEL.pcaBox);
}

/**
 * UMAP 2D per un punto nuovo.
 * UMAP non e' una funzione invertibile come la PCA, quindi il punto nuovo viene
 * messo dove stanno i suoi vicini: media pesata delle coordinate UMAP dei k
 * punti di riferimento piu' simili nello spazio PCA.
 * Restituisce anche i vicini, utili per dire "hai risposto come questi".
 */
export function umapCoords(pc) {
  const k = MODEL.knn;
  const ref = MODEL.ref.pc;
  const heap = [];

  for (let i = 0; i < ref.length; i++) {
    const row = ref[i];
    let d = 0;
    for (let j = 0; j < pc.length; j++) {
      const diff = pc[j] - row[j];
      d += diff * diff;
    }
    if (heap.length < k) {
      heap.push({ i, d });
      if (heap.length === k) heap.sort((a, b) => b.d - a.d);
    } else if (d < heap[0].d) {
      heap[0] = { i, d };
      heap.sort((a, b) => b.d - a.d);
    }
  }

  let wx = 0;
  let wy = 0;
  let wsum = 0;
  for (const { i, d } of heap) {
    const w = 1 / (Math.sqrt(d) + 0.08);
    wx += MODEL.ref.uxy[i][0] * w;
    wy += MODEL.ref.uxy[i][1] * w;
    wsum += w;
  }
  return {
    xy: [wx / wsum, wy / wsum],
    neighbours: heap.sort((a, b) => a.d - b.d).map((h) => h.i),
  };
}

/** Rumore minimo e deterministico: due risposte identiche non si nascondono a vicenda. */
function jitter(seed, amount) {
  let h = seed * 2654435761 % 4294967296;
  h ^= h >>> 13;
  h = (h * 1274126177) % 4294967296;
  const a = (h % 3600) / 3600 * Math.PI * 2;
  const r = Math.sqrt(((h >>> 8) % 1000) / 1000); // uniforme sull'area, non sul raggio
  return [Math.cos(a) * r * amount, Math.sin(a) * r * amount];
}

/** Tutto insieme: dalle 10 risposte alle coordinate finali. */
export function projectAnswers(answers, seed = 1) {
  const pc = toPrincipalComponents(encodeAnswers(answers));
  const cluster = assignCluster(pc);
  const [px, py] = pcaCoords(pc);
  const { xy, neighbours } = umapCoords(pc);
  const jp = jitter(seed, 0.04);
  const ju = jitter(seed + 7919, 0.04);
  return {
    cluster,
    x: px + jp[0],
    y: py + jp[1],
    ux: xy[0] + ju[0],
    uy: xy[1] + ju[1],
    neighbours,
  };
}
