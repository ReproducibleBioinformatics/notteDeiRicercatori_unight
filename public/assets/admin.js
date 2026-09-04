// Pagina di moderazione: elenca le persone sulla mappa e permette di toglierne una.
// Il token resta nella sessione del browser, non viene mai salvato su disco.

const app = document.getElementById("app");
const state = { animals: [], token: sessionStorage.getItem("adminToken") || "", punti: [], clusters: [], filtro: "", errore: "" };

async function carica() {
  const [modello, punti] = await Promise.all([
    fetch("/api/model").then((r) => r.json()),
    tuttiIPunti(),
  ]);
  state.clusters = modello.clusters;
  state.animals = modello.animals || [];
  state.punti = punti.sort((a, b) => b.id - a.id); // dal piu' recente
  render();
}

// /api/points restituisce al massimo una pagina per volta: si continua finche' ce n'e'
async function tuttiIPunti() {
  const out = [];
  let since = 0;
  for (let giro = 0; giro < 30; giro++) {
    const r = await fetch(`/api/points?since=${since}`, { cache: "no-store" });
    if (!r.ok) break;
    const d = await r.json();
    out.push(...d.points);
    if (!d.more || !d.points.length) break;
    since = d.points[d.points.length - 1].id;
  }
  return out;
}

function ora(ms) {
  return new Date(ms).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function render() {
  const visibili = state.punti.filter((p) =>
    p.name.toLowerCase().includes(state.filtro.toLowerCase())
  );

  app.innerHTML = `
    <h1>Moderazione</h1>
    <p class="sub">${state.punti.length} persone sulla mappa. Il più recente in cima.</p>

    <div class="toolbar">
      <input id="token" type="password" placeholder="Token di amministrazione"
             value="${state.token}" autocomplete="off" />
      <button class="ghost" id="ricarica">Aggiorna</button>
    </div>

    <div class="toolbar">
      <input id="filtro" type="search" placeholder="Cerca un nome" value="${state.filtro}" />
    </div>

    ${state.errore ? `<p class="error">${state.errore}</p>` : ""}

    ${
      visibili.length
        ? visibili
            .map((p) => {
              const c = state.clusters.find((c) => c.id === p.cluster);
              return `
                <div class="row" data-id="${p.id}">
                  <span class="dot" style="background:${c ? c.color : "#888"}"></span>
                  <span class="nome">${state.animals[p.animal]?.emoji || ""} ${escape(p.name)} <span class="meta">#${p.id}</span></span>
                  <span class="meta">${ora(p.created_at)}</span>
                  <button data-del="${p.id}">Togli</button>
                </div>`;
            })
            .join("")
        : `<p class="empty">${state.punti.length ? "Nessun nome corrisponde." : "Ancora nessuno sulla mappa."}</p>`
    }

    <div class="danger">
      <button id="svuota">Svuota tutta la mappa</button>
    </div>
  `;

  const token = document.getElementById("token");
  token.oninput = () => {
    state.token = token.value;
    sessionStorage.setItem("adminToken", state.token);
  };
  document.getElementById("filtro").oninput = (e) => {
    state.filtro = e.target.value;
    render();
    document.getElementById("filtro").focus();
  };
  document.getElementById("ricarica").onclick = carica;
  document.getElementById("svuota").onclick = svuota;
  app.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => togli(Number(b.dataset.del));
  });
}

function escape(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function togli(id) {
  const p = state.punti.find((x) => x.id === id);
  if (!p || !confirm(`Togliere "${p.name}" dalla mappa?`)) return;
  state.errore = "";
  try {
    const r = await fetch("/api/delete", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": state.token },
      body: JSON.stringify({ id }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Non ci sono riuscito.");
    state.punti = state.punti.filter((x) => x.id !== id);
  } catch (e) {
    state.errore = e.message;
  }
  render();
}

async function svuota() {
  if (!confirm("Cancellare TUTTE le persone dalla mappa?")) return;
  state.errore = "";
  try {
    const r = await fetch("/api/reset", {
      method: "POST",
      headers: { "x-admin-token": state.token },
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Non ci sono riuscito.");
    state.punti = [];
  } catch (e) {
    state.errore = e.message;
  }
  render();
}

carica();
