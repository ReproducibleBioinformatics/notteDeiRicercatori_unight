import qrcode from "/assets/qrcode.mjs";

const POLL_MS = 2000;        // ogni quanto chiedere i punti nuovi
const AUTO_SWITCH_MS = 45000; // ogni quanto passare da PCA a UMAP e viceversa
const MORPH_MS = 1500;        // durata della transizione
const HIGHLIGHT_MS = 20000;   // per quanto un arrivo resta evidenziato
const NAME_COUNT = 10;        // quanti degli ultimi arrivati mostrano il nome

const canvas = document.getElementById("plot");
const ctx = canvas.getContext("2d");

const state = {
  model: null,
  points: [],
  byId: new Set(),
  lastId: 0,
  total: 0,
  mode: "pca",
  morphFrom: 0,
  morphTo: 0,
  morphStart: -Infinity,
  lastSwitch: Date.now(),
  view: { w: 0, h: 0, cx: 0, cy: 0, scale: 1, dpr: 1 },
  firstLoad: true,
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------------------------------------------------------- setup */

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.view = {
    w,
    h,
    cx: w / 2,
    cy: h / 2,
    scale: Math.min(w, h) * 0.41,
    dpr,
  };
}

window.addEventListener("resize", resize);
resize();

function project(x, y) {
  const v = state.view;
  return [v.cx + x * v.scale, v.cy - y * v.scale];
}

/* --------------------------------------------------------------- morphing */

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function morphValue() {
  if (reduceMotion) return state.morphTo;
  const elapsed = Date.now() - state.morphStart;
  if (elapsed >= MORPH_MS) return state.morphTo;
  const t = easeInOut(elapsed / MORPH_MS);
  return state.morphFrom + (state.morphTo - state.morphFrom) * t;
}

function setMode(mode) {
  if (mode === state.mode) return;
  state.morphFrom = morphValue();
  state.morphTo = mode === "umap" ? 1 : 0;
  state.morphStart = Date.now();
  state.mode = mode;
  state.lastSwitch = Date.now();
  updateModeText();
}

function updateModeText() {
  const m = state.model;
  const nameEl = document.getElementById("modeName");
  const noteEl = document.getElementById("modeNote");
  if (state.mode === "pca") {
    const pct = m ? Math.round((m.explained[0] + m.explained[1]) * 100) : 0;
    nameEl.textContent = "PCA";
    noteEl.textContent = `le due direzioni che spiegano più differenze fra le persone (${pct}% del totale)`;
  } else {
    nameEl.textContent = "UMAP";
    noteEl.textContent = "conta solo chi ti somiglia di più: i gruppi si staccano";
  }
}

/* --------------------------------------------------------------- disegno */

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

  // nuvola di riferimento: la popolazione simulata su cui la mappa è stata costruita
  const ref = m.ref;
  const r = Math.max(1.6, v.scale * 0.0075);
  for (let i = 0; i < ref.xy.length; i++) {
    const x = ref.xy[i][0] + (ref.uxy[i][0] - ref.xy[i][0]) * t;
    const y = ref.xy[i][1] + (ref.uxy[i][1] - ref.xy[i][1]) * t;
    const [px, py] = project(x, y);
    ctx.fillStyle = withAlpha(m.clusters[ref.cluster[i]].color, 0.3);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // partecipanti
  const pr = Math.max(4, v.scale * 0.016);

  // gli ultimi arrivati tengono il nome finché non li spingono fuori quelli dopo
  const named = new Set(state.points.slice(-NAME_COUNT).map((p) => p.id));

  const labels = [];
  for (const p of state.points) {
    const x = p.x + (p.ux - p.x) * t;
    const y = p.y + (p.uy - p.y) * t;
    const [px, py] = project(x, y);
    const age = now - (p.arrivedAt || 0);
    const fresh = age < HIGHLIGHT_MS;
    const color = m.clusters[p.cluster].color;

    if (fresh && age < 1400 && !reduceMotion) {
      const k = age / 1400;
      ctx.strokeStyle = withAlpha(color, (1 - k) * 0.85);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(px, py, pr + k * v.scale * 0.13, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(px, py, fresh ? pr * 1.35 : pr, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = fresh ? 2.5 : 1.5;
    ctx.strokeStyle = fresh ? "#edf0ff" : "rgba(11,16,48,0.85)";
    ctx.stroke();

    if (named.has(p.id)) labels.push({ p, px, py, age, color, fresh });
  }

  drawLabels(labels, pr);

  if (!reduceMotion && now - state.lastSwitch > AUTO_SWITCH_MS) {
    setMode(state.mode === "pca" ? "umap" : "pca");
  }

  requestAnimationFrame(draw);
}

/**
 * I nomi degli ultimi arrivati. Se due punti sono vicini le targhette si
 * accavallerebbero, quindi ognuna scivola in verticale finché trova posto.
 */
function drawLabels(labels, pr) {
  const v = state.view;
  const fs = Math.max(15, v.scale * 0.055);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${fs}px "Bricolage Grotesque", sans-serif`;

  const placed = [];
  const h = fs * 1.44;

  // i più recenti si piazzano per primi e tengono il posto migliore
  labels.sort((a, b) => a.age - b.age);

  for (const l of labels) {
    const w = ctx.measureText(l.p.name).width + fs * 0.6;
    let x = Math.min(l.px + pr + fs * 0.45, v.w - w - 6);
    let y = l.py - h / 2;

    for (let attempt = 0; attempt < 14; attempt++) {
      const hit = placed.find(
        (q) => x < q.x + q.w && x + w > q.x && y < q.y + q.h && y + h > q.y
      );
      if (!hit) break;
      y = attempt % 2 === 0 ? hit.y + h + 3 : l.py - h / 2 - (attempt + 1) * (h + 3);
    }
    y = Math.max(6, Math.min(v.h - h - 6, y));
    placed.push({ x, y, w, h });

    const fade = Math.min(1, l.age / 350);
    ctx.fillStyle = `rgba(11, 16, 48, ${(l.fresh ? 0.82 : 0.62) * fade})`;
    roundRect(x, y, w, h, fs * 0.36);
    ctx.fill();
    ctx.fillStyle = withAlpha(l.color, (l.fresh ? 1 : 0.82) * fade);
    ctx.fillText(l.p.name, x + fs * 0.3, y + h / 2 + 1);
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

/* ------------------------------------------------------------------ dati */

function renderLegend() {
  const m = state.model;
  const el = document.getElementById("legend");
  el.innerHTML = "";
  m.clusters.forEach((c) => {
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
  document.getElementById("counter").textContent = state.total;
}

async function poll() {
  try {
    const res = await fetch(`/api/points?since=${state.lastId}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const now = Date.now();
      for (const p of data.points) {
        if (state.byId.has(p.id)) continue;
        state.byId.add(p.id);
        // al primo caricamento non evidenziamo tutti gli storici
        p.arrivedAt = state.firstLoad ? 0 : now;
        state.points.push(p);
        state.lastId = Math.max(state.lastId, p.id);
      }
      state.total = data.total;
      state.firstLoad = false;
      updateCounts();
    }
  } catch {
    /* rete ballerina alla serata: si riprova al giro dopo */
  }
  setTimeout(poll, POLL_MS);
}

/* -------------------------------------------------------------------- QR */

function renderQr() {
  const url = new URL("/quiz", window.location.origin).toString();
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  document.getElementById("qr").innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0 });
  document.getElementById("qrUrl").textContent = url.replace(/^https?:\/\//, "");
}

/* ------------------------------------------------------------------ avvio */

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "p") setMode("pca");
  if (k === "u") setMode("umap");
  if (k === " ") {
    e.preventDefault();
    setMode(state.mode === "pca" ? "umap" : "pca");
  }
  if (k === "f") document.documentElement.requestFullscreen?.();
});

canvas.addEventListener("click", () => setMode(state.mode === "pca" ? "umap" : "pca"));

(async function init() {
  renderQr();
  const res = await fetch("/api/model");
  state.model = await res.json();
  renderLegend();
  updateModeText();
  poll();
  requestAnimationFrame(draw);
})();