import qrcode from "/assets/qrcode.mjs";

const POLL_MS = 2000;       // ogni quanto chiedere i punti nuovi
const RESYNC_MS = 45000;    // ogni quanto rileggere tutto, per accorgersi delle cancellazioni
const MORPH_MS = 1500;      // durata della transizione fra PCA e UMAP
const HIGHLIGHT_MS = 20000; // per quanto l'ultimo arrivato resta evidenziato
const MAX_NAMES = 10;       // quanti nomi al massimo, fra quelli inquadrati
const ZOOM_MIN = 1;
const ZOOM_MAX = 14;

const canvas = document.getElementById("plot");
const ctx = canvas.getContext("2d");
const wrap = canvas.parentElement;

const state = {
  model: null,
  points: [],
  byId: new Set(),
  lastId: 0,
  mode: "pca",
  morphFrom: 0,
  morphTo: 0,
  morphStart: -Infinity,
  view: { w: 0, h: 0, cx: 0, cy: 0, scale: 1 },
  cam: { k: 1, x: 0, y: 0 },
  firstLoad: true,
  lastResync: 0,
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ----------------------------------------------------------- dimensionamento */

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.view = { w, h, cx: w / 2, cy: h / 2, scale: Math.min(w, h) * 0.41 };
  clampCamera();
}

new ResizeObserver(resize).observe(wrap);
resize();

/* --------------------------------------------------------------- telecamera */

// mondo -> schermo, passando per zoom e spostamento
function project(x, y) {
  const v = state.view;
  const c = state.cam;
  return [v.cx + x * v.scale * c.k + c.x, v.cy - y * v.scale * c.k + c.y];
}

function clampCamera() {
  const c = state.cam;
  c.k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.k));
  // la nuvola non può uscire completamente dallo schermo
  const limX = state.view.scale * c.k * 1.15;
  const limY = state.view.scale * c.k * 1.15;
  c.x = Math.min(limX, Math.max(-limX, c.x));
  c.y = Math.min(limY, Math.max(-limY, c.y));
  const btn = document.getElementById("btnReset");
  if (btn) btn.hidden = c.k <= 1.005 && Math.abs(c.x) < 1 && Math.abs(c.y) < 1;
}

// zoom tenendo fermo il punto sotto il dito o il cursore
function zoomAt(sx, sy, factor) {
  const c = state.cam;
  const v = state.view;
  const k2 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.k * factor));
  c.x = sx - v.cx - ((sx - v.cx - c.x) * k2) / c.k;
  c.y = sy - v.cy - ((sy - v.cy - c.y) * k2) / c.k;
  c.k = k2;
  clampCamera();
}

function resetCamera() {
  state.cam = { k: 1, x: 0, y: 0 };
  clampCamera();
}

/* ------------------------------------------------- trascinamento e pizzicata */

const pointers = new Map();
let pinchDist = 0;
let pinchMid = null;

function localPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, localPoint(e));
  canvas.classList.add("dragging");
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  const now = localPoint(e);
  pointers.set(e.pointerId, now);

  if (pointers.size === 1) {
    state.cam.x += now.x - prev.x;
    state.cam.y += now.y - prev.y;
    clampCamera();
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (pinchDist > 0) {
      state.cam.x += mid.x - pinchMid.x;
      state.cam.y += mid.y - pinchMid.y;
      zoomAt(mid.x, mid.y, dist / pinchDist);
    }
    pinchDist = dist;
    pinchMid = mid;
  }
});

function releasePointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) {
    pinchDist = 0;
    pinchMid = null;
  }
  if (pointers.size === 0) canvas.classList.remove("dragging");
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const p = localPoint(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0016));
  },
  { passive: false }
);

canvas.addEventListener("dblclick", resetCamera);

/* ---------------------------------------------------------------- proiezione */

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function morphValue() {
  if (reduceMotion) return state.morphTo;
  const elapsed = Date.now() - state.morphStart;
  if (elapsed >= MORPH_MS) return state.morphTo;
  return state.morphFrom + (state.morphTo - state.morphFrom) * easeInOut(elapsed / MORPH_MS);
}

function setMode(mode) {
  if (mode === state.mode) return;
  state.morphFrom = morphValue();
  state.morphTo = mode === "umap" ? 1 : 0;
  state.morphStart = Date.now();
  state.mode = mode;
  updateModeUi();
}

function updateModeUi() {
  const m = state.model;
  const pca = state.mode === "pca";
  document.getElementById("btnPca").classList.toggle("is-on", pca);
  document.getElementById("btnUmap").classList.toggle("is-on", !pca);
  const note = document.getElementById("modeNote");
  if (pca) {
    const pct = m ? Math.round((m.explained[0] + m.explained[1]) * 100) : 0;
    note.textContent = `Le due direzioni lungo cui le persone si differenziano di più. Tengono il ${pct}% delle differenze totali.`;
  } else {
    note.textContent = "Conta solo chi ti somiglia di più: i gruppi si staccano.";
  }
}

/* ------------------------------------------------------------------ disegno */

function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function draw() {
  const m = state.model;
  const v = state.view;
  ctx.clearRect(0, 0, v.w, v.h);
  if (!m) return requestAnimationFrame(draw);

  const t = morphValue();
  const now = Date.now();
  const k = state.cam.k;

  // nuvola di riferimento: la popolazione simulata su cui la mappa è costruita
  const ref = m.ref;
  const r = Math.max(1.5, v.scale * 0.0075 * Math.min(2.2, Math.sqrt(k)));
  for (let i = 0; i < ref.xy.length; i++) {
    const x = ref.xy[i][0] + (ref.uxy[i][0] - ref.xy[i][0]) * t;
    const y = ref.xy[i][1] + (ref.uxy[i][1] - ref.xy[i][1]) * t;
    const [px, py] = project(x, y);
    if (px < -8 || px > v.w + 8 || py < -8 || py > v.h + 8) continue;
    ctx.fillStyle = withAlpha(m.clusters[ref.cluster[i]].color, 0.3);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // partecipanti
  const pr = Math.max(4, v.scale * 0.016 * Math.min(1.8, Math.sqrt(k)));
  const visibili = [];

  for (const p of state.points) {
    const x = p.x + (p.ux - p.x) * t;
    const y = p.y + (p.uy - p.y) * t;
    const [px, py] = project(x, y);
    if (px < -30 || px > v.w + 30 || py < -30 || py > v.h + 30) continue;

    const age = now - (p.arrivedAt || 0);
    const fresh = age < HIGHLIGHT_MS;
    const color = m.clusters[p.cluster].color;

    if (fresh && age < 1400 && !reduceMotion) {
      const q = age / 1400;
      ctx.strokeStyle = withAlpha(color, (1 - q) * 0.85);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(px, py, pr + q * v.scale * 0.13, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(px, py, fresh ? pr * 1.35 : pr, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = fresh ? 2.5 : 1.5;
    ctx.strokeStyle = fresh ? "#edf0ff" : "rgba(11,16,48,0.85)";
    ctx.stroke();

    visibili.push({ p, px, py, age, color, fresh });
  }

  // i nomi sono al massimo dieci, sempre i più recenti fra quelli inquadrati:
  // zoomando su una zona compaiono quelli di lì, che altrimenti non si vedrebbero
  visibili.sort((a, b) => b.p.id - a.p.id);
  drawLabels(visibili.slice(0, MAX_NAMES), pr);

  requestAnimationFrame(draw);
}

/**
 * I nomi degli ultimi arrivati.
 * Una targhetta cerca posto prima accanto al suo punto (destra, sinistra, sopra,
 * sotto) e solo dopo si allontana, di poco. Se resta staccata dal punto viene
 * disegnato un filo che li collega, altrimenti non si capisce di chi e' il nome.
 * Se dopo tutti i tentativi non c'e' spazio, il nome viene saltato: meglio sette
 * targhette leggibili che dieci sparse a caso.
 */
function drawLabels(labels, pr) {
  const v = state.view;
  const fs = Math.max(13, Math.min(28, v.scale * 0.05));
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${fs}px "Bricolage Grotesque", sans-serif`;

  const placed = [];
  const h = fs * 1.4;
  const gap = Math.max(5, fs * 0.34);
  const passo = h + 4;

  const libero = (x, y, w) =>
    x >= 2 && y >= 2 && x + w <= v.w - 2 && y + h <= v.h - 2 &&
    !placed.some((q) => x < q.x + q.w && x + w > q.x && y < q.y + q.h && y + h > q.y);

  for (const l of labels) {
    const w = ctx.measureText(l.p.name).width + fs * 0.6;
    const dx = pr + gap;

    // prima i quattro lati, poi scostamenti verticali sempre piu' ampi
    const candidati = [];
    for (let riga = 0; riga <= 3; riga++) {
      for (const segno of riga === 0 ? [0] : [1, -1]) {
        const dy = segno * riga * passo;
        candidati.push([l.px + dx, l.py - h / 2 + dy]);
        candidati.push([l.px - dx - w, l.py - h / 2 + dy]);
      }
      if (riga === 0) {
        candidati.push([l.px - w / 2, l.py - pr - gap - h]);
        candidati.push([l.px - w / 2, l.py + pr + gap]);
      }
    }

    const posto = candidati.find(([x, y]) => libero(x, y, w));
    if (!posto) continue;
    const [x, y] = posto;
    placed.push({ x, y, w, h });

    const fade = Math.min(1, l.age / 350);
    const cy = y + h / 2;

    // filo di collegamento, solo se la targhetta non tocca gia' il punto
    const vicino = x <= l.px + dx + 1 && x >= l.px - dx - w - 1 && Math.abs(cy - l.py) < h;
    if (!vicino) {
      const ax = x + (l.px > x + w / 2 ? w : 0);
      ctx.strokeStyle = withAlpha(l.color, 0.45 * fade);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ax, cy);
      ctx.lineTo(l.px, l.py);
      ctx.stroke();
    }

    ctx.fillStyle = `rgba(11, 16, 48, ${(l.fresh ? 0.88 : 0.72) * fade})`;
    roundRect(x, y, w, h, fs * 0.36);
    ctx.fill();
    ctx.fillStyle = withAlpha(l.color, (l.fresh ? 1 : 0.85) * fade);
    ctx.fillText(l.p.name, x + fs * 0.3, cy + 1);
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* -------------------------------------------------------------------- dati */

function renderLegend() {
  const el = document.getElementById("legend");
  el.innerHTML = "";
  state.model.clusters.forEach((c) => {
    const row = document.createElement("div");
    row.className = "legend-row";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = c.color;
    const name = document.createElement("span");
    name.textContent = c.name;
    const count = document.createElement("span");
    count.className = "legend-count";
    count.dataset.cluster = c.id;
    count.textContent = "0";
    row.append(dot, name, count);
    el.append(row);
  });
}

function updateCounts() {
  const counts = new Array(state.model.clusters.length).fill(0);
  state.points.forEach((p) => (counts[p.cluster] += 1));
  document.querySelectorAll(".legend-count").forEach((el) => {
    el.textContent = counts[Number(el.dataset.cluster)];
  });
  document.getElementById("counter").textContent = state.points.length;
}

async function poll() {
  const now = Date.now();
  // ogni tanto si rilegge tutto da capo: e' l'unico modo per accorgersi che
  // qualcuno e' stato tolto dalla mappa dalla pagina di moderazione
  const resync = now - state.lastResync > RESYNC_MS;

  try {
    if (resync) {
      const tutti = await leggiTutti();
      if (tutti) {
        const visti = new Map(state.points.map((p) => [p.id, p.arrivedAt]));
        state.points = tutti.map((p) => ({ ...p, arrivedAt: visti.get(p.id) ?? 0 }));
        state.byId = new Set(tutti.map((p) => p.id));
        state.lastId = tutti.length ? Math.max(...tutti.map((p) => p.id)) : 0;
        state.lastResync = now;
        state.firstLoad = false;
        updateCounts();
      }
    } else {
      const res = await fetch(`/api/points?since=${state.lastId}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        for (const p of data.points) {
          if (state.byId.has(p.id)) continue;
          state.byId.add(p.id);
          p.arrivedAt = state.firstLoad ? 0 : now; // al primo giro non si evidenzia lo storico
          state.points.push(p);
          state.lastId = Math.max(state.lastId, p.id);
        }
        state.firstLoad = false;
        updateCounts();
        if (data.more) return poll(); // pagina piena: ce ne sono altri, non aspettare
      }
    }
  } catch {
    /* rete ballerina alla serata: si riprova al giro dopo */
  }
  setTimeout(poll, POLL_MS);
}

/** Rilegge l'elenco completo, seguendo le pagine. */
async function leggiTutti() {
  const out = [];
  let since = 0;
  for (let giro = 0; giro < 30; giro++) {
    const res = await fetch(`/api/points?since=${since}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    out.push(...data.points);
    if (!data.more || !data.points.length) break;
    since = data.points[data.points.length - 1].id;
  }
  return out;
}

/* ---------------------------------------------------------------------- QR */

function renderQr() {
  const url = new URL("/quiz", window.location.origin).toString();
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  document.getElementById("qr").innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0 });
}

/* -------------------------------------------------------------------- avvio */

document.getElementById("btnPca").onclick = () => setMode("pca");
document.getElementById("btnUmap").onclick = () => setMode("umap");
document.getElementById("btnReset").onclick = resetCamera;

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "p") setMode("pca");
  if (k === "u") setMode("umap");
  if (k === "0") resetCamera();
  if (k === "f") document.documentElement.requestFullscreen?.();
  if (k === " ") {
    e.preventDefault();
    setMode(state.mode === "pca" ? "umap" : "pca");
  }
});

(async function init() {
  renderQr();
  updateModeUi();
  const res = await fetch("/api/model");
  state.model = await res.json();
  renderLegend();
  updateModeUi();
  poll();
  requestAnimationFrame(draw);
})();
