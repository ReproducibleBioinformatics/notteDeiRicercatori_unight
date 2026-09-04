const app = document.getElementById("app");

const state = {
  questions: [],
  answers: [],
  step: -1, // -1 introduzione, 0..n-1 domande, n nome
  name: "",
  sending: false,
  error: "",
  result: null,
  model: null,
};

/* ------------------------------------------------------------- caricamento */

async function boot() {
  render();
  try {
    const res = await fetch("/api/questions");
    const data = await res.json();
    state.questions = data.questions;
    state.answers = new Array(data.questions.length).fill(null);
    render();
  } catch {
    state.error = "Non riesco a caricare le domande. Controlla la connessione e ricarica.";
    render();
  }
  // la mappa serve solo alla fine: la scarichiamo intanto che si risponde
  fetch("/api/model")
    .then((r) => r.json())
    .then((m) => (state.model = m))
    .catch(() => {});
}

/* --------------------------------------------------------------- schermate */

function render() {
  if (state.result) return renderResult();
  if (!state.questions.length) return renderLoading();
  if (state.step === -1) return renderIntro();
  if (state.step < state.questions.length) return renderQuestion();
  return renderName();
}

function el(html) {
  app.innerHTML = html;
}

function renderLoading() {
  el(`
    <p class="step-index">Un attimo</p>
    <h1 class="question">Sto preparando le domande</h1>
    ${state.error ? `<p class="error">${state.error}</p>` : ""}
  `);
}

function renderIntro() {
  el(`
    <p class="step-index">Notte dei Ricercatori</p>
    <h1 class="question">Dieci domande, e finisci sullo schermo</h1>
    <p class="note" style="font-size:16px">
      Nessuna risposta è giusta o sbagliata. Le tue dieci scelte diventano un punto su una
      mappa, insieme a tutte le altre persone di stasera. Ci vuole meno di un minuto.
    </p>
    <div class="quiz-foot">
      <button class="primary" id="go">Comincia</button>
      <p class="note">Chiediamo solo un nome, quello che vuoi. Niente altro.</p>
    </div>
  `);
  document.getElementById("go").onclick = () => {
    state.step = 0;
    render();
  };
}

function progressBar() {
  return `<div class="progress">${state.questions
    .map((_, i) => {
      const cls = i < state.step ? "done" : i === state.step ? "current" : "";
      return `<span class="${cls}"></span>`;
    })
    .join("")}</div>`;
}

function renderQuestion() {
  const i = state.step;
  const q = state.questions[i];
  el(`
    ${progressBar()}
    <p class="step-index">Domanda ${i + 1} di ${state.questions.length}</p>
    <h1 class="question">${q.text}</h1>
    <div class="options">
      ${q.options
        .map(
          (opt, j) =>
            `<button class="option ${state.answers[i] === j ? "picked" : ""}" data-j="${j}">${opt}</button>`
        )
        .join("")}
    </div>
    <div class="quiz-foot">
      ${i > 0 ? `<button class="back" id="back">← domanda precedente</button>` : ""}
    </div>
  `);

  app.querySelectorAll(".option").forEach((btn) => {
    btn.onclick = () => {
      state.answers[i] = Number(btn.dataset.j);
      state.step += 1;
      window.scrollTo(0, 0);
      render();
    };
  });
  const back = document.getElementById("back");
  if (back) back.onclick = () => {
    state.step -= 1;
    render();
  };
}

function renderName() {
  el(`
    ${progressBar()}
    <p class="step-index">Ultimo passo</p>
    <h1 class="question">Come ti chiamiamo sullo schermo?</h1>
    <div class="field">
      <label for="name">Nome, soprannome, quello che preferisci</label>
      <input id="name" type="text" maxlength="22" autocomplete="off"
             autocapitalize="words" placeholder="Es. Giulia" value="${state.name}" />
    </div>
    <button class="primary" id="send" ${state.sending ? "disabled" : ""}>
      ${state.sending ? "Ti sto mettendo sulla mappa…" : "Mettimi sulla mappa"}
    </button>
    ${state.error ? `<p class="error">${state.error}</p>` : ""}
    <p class="note">
      Il nome resta sullo schermo per la serata e poi viene cancellato. Non salviamo altro.
    </p>
    <div class="quiz-foot">
      <button class="back" id="back">← torna alle domande</button>
    </div>
  `);

  const input = document.getElementById("name");
  input.oninput = () => (state.name = input.value);
  input.onkeydown = (e) => {
    if (e.key === "Enter") submit();
  };
  document.getElementById("send").onclick = submit;
  document.getElementById("back").onclick = () => {
    state.step -= 1;
    state.error = "";
    render();
  };
  input.focus();
}

async function submit() {
  const name = state.name.trim();
  if (!name) {
    state.error = "Scrivi un nome, anche inventato.";
    return render();
  }
  state.sending = true;
  state.error = "";
  render();

  try {
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, answers: state.answers }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Qualcosa non ha funzionato.");
    state.result = data;
  } catch (err) {
    state.error = err.message;
  }
  state.sending = false;
  render();
}

/* ------------------------------------------------------------------ esito */

function renderResult() {
  const r = state.result;
  const twins = r.twins || [];
  el(`
    <p class="step-index">Ci sei, guarda lo schermo</p>
    <p class="result-cluster" style="color:${r.clusterColor}">${r.clusterName}</p>
    <p class="result-blurb">${r.clusterBlurb}</p>
    <canvas class="mini" id="mini" width="620" height="620"></canvas>
    <p class="mini-caption">
      Il punto grande sei tu.${
        twins.length
          ? ` Le persone che stasera ti somigliano di più: ${twins.join(", ")}.`
          : " Per ora sei fra i primi: torna a guardare fra un po'."
      }
    </p>
    <div class="explainer">
      <h2>Cos'hai appena visto</h2>
      <p>
        Le tue dieci risposte non sono due numeri, sono quaranta: una casella per ogni
        opzione possibile. Quaranta dimensioni non si disegnano. Servono due.
      </p>
      <p>
        La <strong>PCA</strong> cerca le due direzioni lungo cui le persone si distinguono di
        più e proietta tutti là sopra, come l'ombra di un oggetto su un muro. È fedele alle
        distanze grandi, ma schiaccia il resto.
      </p>
      <p>
        La <strong>UMAP</strong> fa un'altra scelta: si preoccupa solo di tenere vicino chi è
        vicino. Le distanze fra i gruppi contano meno, ma i gruppi si vedono nettamente. Sullo
        schermo la mappa passa dall'una all'altra: sono gli stessi dati, guardati in due modi.
      </p>
      <p>
        È esattamente quello che facciamo con le cellule: al posto delle dieci domande ci sono
        ventimila geni, e al posto tuo una cellula.
      </p>
    </div>
  `);
  drawMini();
}

function drawMini() {
  const m = state.model;
  const c = document.getElementById("mini");
  if (!c) return;
  const ctx = c.getContext("2d");
  const S = c.width;
  ctx.clearRect(0, 0, S, S);

  if (!m) {
    ctx.fillStyle = "#8c97c9";
    ctx.font = "20px 'IBM Plex Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("mappa non disponibile", S / 2, S / 2);
    return;
  }

  const scale = S * 0.4;
  const to = (x, y) => [S / 2 + x * scale, S / 2 - y * scale];

  for (let i = 0; i < m.ref.uxy.length; i++) {
    const [px, py] = to(m.ref.uxy[i][0], m.ref.uxy[i][1]);
    const col = m.clusters[m.ref.cluster[i]].color;
    const n = parseInt(col.slice(1), 16);
    ctx.fillStyle = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.32)`;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  const r = state.result;
  const [px, py] = to(r.ux, r.uy);
  ctx.strokeStyle = r.clusterColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = r.clusterColor;
  ctx.beginPath();
  ctx.arc(px, py, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#edf0ff";
  ctx.stroke();
}

boot();
