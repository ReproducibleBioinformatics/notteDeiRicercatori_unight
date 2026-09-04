#!/usr/bin/env python3
"""
Genera il "modello" statico usato dall'app della Notte dei Ricercatori.

Idea: le 10 domande a risposta multipla vengono codificate one-hot (40 dimensioni).
Su una popolazione sintetica di riferimento si calcola UNA VOLTA PER TUTTE:
  - la PCA (media + loadings)  -> proiezione lineare, quindi deterministica
  - l'embedding UMAP dei punti di riferimento
  - i centroidi dei cluster (gli archetipi con cui e' stata generata la popolazione)

A runtime il Worker NON rifitta nulla: proietta il nuovo punto con i loadings
gia' calcolati e lo posiziona nella UMAP interpolando i k vicini di riferimento.
Risultato: la mappa non cambia mai e i colori dei cluster restano fissi.

Uso:
    python3 tools/build_model.py
Output:
    shared/questions.js
    shared/model.js
"""

import json
import math
import os
import sys

import numpy as np

SEED = 20260926          # data della Notte dei Ricercatori 2026 (venerdi')
N_REF = 1200             # punti della popolazione di riferimento
N_PC = 8                 # componenti principali conservate
UMAP_NEIGHBORS = 25
UMAP_MIN_DIST = 0.25

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# ---------------------------------------------------------------------------
# 1. Le domande
# ---------------------------------------------------------------------------

QUESTIONS = [
    {
        "id": "mattina",
        "text": "Come parte di solito la tua giornata?",
        "options": [
            "Caffè al volo e si va",
            "Colazione lenta, senza fretta",
            "Sveglia presto e movimento",
            "Suona la sveglia cinque volte",
        ],
    },
    {
        "id": "weekend",
        "text": "Il weekend perfetto è...",
        "options": [
            "Un sentiero e un panorama",
            "Un museo, una mostra, una libreria",
            "Cena lunga con un sacco di gente",
            "Divano, coperta, serie tv",
        ],
    },
    {
        "id": "problema",
        "text": "Hai davanti un problema che non torna. Cosa fai?",
        "options": [
            "Lo smonto in pezzi e faccio uno schema",
            "Provo a tentativi finché non esce",
            "Chiedo a qualcuno che ne sa più di me",
            "Lo lascio decantare, poi torna da solo",
        ],
    },
    {
        "id": "scrivania",
        "text": "Com'è la tua scrivania adesso?",
        "options": [
            "Tutto al suo posto, anche le etichette",
            "Un ordine mio, che funziona",
            "Caos, ma caos produttivo",
            "Dipende dalla settimana",
        ],
    },
    {
        "id": "musica",
        "text": "Cosa metti quando vuoi carica?",
        "options": [
            "Rock o metal",
            "Pop o dance",
            "Classica o jazz",
            "Rap o hip hop",
        ],
    },
    {
        "id": "vacanza",
        "text": "In vacanza...",
        "options": [
            "Ho l'itinerario giorno per giorno",
            "Ho un'idea di massima",
            "Decido la mattina stessa",
            "Mi faccio trascinare dagli altri",
        ],
    },
    {
        "id": "cena",
        "text": "Stasera si mangia:",
        "options": [
            "Pizza, sempre pizza",
            "Qualcosa che non ho mai provato",
            "Il piatto che faceva mia nonna",
            "Sushi",
        ],
    },
    {
        "id": "palco",
        "text": "Ti chiedono di parlare davanti a cento persone.",
        "options": [
            "Ci vado volentieri",
            "Me la cavo, dai",
            "Solo se proprio devo",
            "Preferisco sparire",
        ],
    },
    {
        "id": "superpotere",
        "text": "Scegli un superpotere:",
        "options": [
            "Volare",
            "Fermare il tempo",
            "Leggere nel pensiero",
            "Teletrasporto",
        ],
    },
    {
        "id": "esperimento",
        "text": "Hai un laboratorio e fondi illimitati. Cosa fai?",
        "options": [
            "Mando qualcosa nello spazio",
            "Costruisco un robot",
            "Creo una forma di vita nuova",
            "Cerco un farmaco che oggi non esiste",
        ],
    },
]

# ---------------------------------------------------------------------------
# 2. Gli archetipi = i cluster. Sono fissi, quindi i colori non cambiano mai.
#    "pref" = indice dell'opzione preferita per ciascuna delle 10 domande.
# ---------------------------------------------------------------------------

ARCHETYPES = [
    {
        "id": 0,
        "name": "Esploratori",
        "blurb": "Scarponi pronti, programma no.",
        "color": "#FF6B4A",
        "pref": [2, 0, 1, 1, 0, 2, 1, 1, 3, 0],
        "purity": 0.62,
        "weight": 1.05,
    },
    {
        "id": 1,
        "name": "Architetti",
        "blurb": "Prima lo schema, poi tutto il resto.",
        "color": "#4ECDC4",
        "pref": [0, 1, 0, 0, 2, 0, 3, 1, 1, 1],
        "purity": 0.68,
        "weight": 1.0,
    },
    {
        "id": 2,
        "name": "Contemplativi",
        "blurb": "Le idee migliori arrivano stando fermi.",
        "color": "#A78BFA",
        "pref": [1, 1, 3, 3, 2, 1, 2, 3, 0, 2],
        "purity": 0.60,
        "weight": 0.95,
    },
    {
        "id": 3,
        "name": "Disordine creativo",
        "blurb": "Sembra caos. Non lo toccare.",
        "color": "#FFD166",
        "pref": [3, 3, 1, 2, 3, 3, 0, 2, 1, 1],
        "purity": 0.63,
        "weight": 0.9,
    },
    {
        "id": 4,
        "name": "Calamite sociali",
        "blurb": "Arrivano da soli, escono in dieci.",
        "color": "#F472B6",
        "pref": [0, 2, 2, 1, 1, 3, 0, 0, 2, 3],
        "purity": 0.64,
        "weight": 1.0,
    },
    {
        "id": 5,
        "name": "Curiosi seriali",
        "blurb": "Sempre la porta che non hanno ancora aperto.",
        "color": "#6EE7A7",
        "pref": [2, 1, 0, 2, 3, 1, 1, 0, 2, 2],
        "purity": 0.61,
        "weight": 1.1,
    },
]

# ---------------------------------------------------------------------------


def build_probabilities(rng):
    """Per ogni archetipo e ogni domanda: distribuzione di probabilita' sulle opzioni."""
    probs = []
    for arch in ARCHETYPES:
        per_question = []
        for qi, q in enumerate(QUESTIONS):
            k = len(q["options"])
            pref = arch["pref"][qi]
            w = arch["purity"]
            # il resto della massa e' distribuito in modo non uniforme,
            # cosi' due archetipi con la stessa preferenza restano comunque diversi
            rest = rng.dirichlet(np.ones(k - 1) * 2.5) * (1.0 - w)
            p = np.zeros(k)
            p[pref] = w
            others = [i for i in range(k) if i != pref]
            for slot, idx in enumerate(others):
                p[idx] = rest[slot]
            per_question.append(p / p.sum())
        probs.append(per_question)
    return probs


def sample_population(rng, probs):
    weights = np.array([a["weight"] for a in ARCHETYPES], dtype=float)
    weights /= weights.sum()
    labels = rng.choice(len(ARCHETYPES), size=N_REF, p=weights)
    answers = np.zeros((N_REF, len(QUESTIONS)), dtype=int)
    for i, lab in enumerate(labels):
        for qi, q in enumerate(QUESTIONS):
            answers[i, qi] = rng.choice(len(q["options"]), p=probs[lab][qi])
    return answers, labels


def one_hot(answers):
    offsets = []
    total = 0
    for q in QUESTIONS:
        offsets.append(total)
        total += len(q["options"])
    X = np.zeros((answers.shape[0], total), dtype=float)
    for i in range(answers.shape[0]):
        for qi in range(len(QUESTIONS)):
            X[i, offsets[qi] + answers[i, qi]] = 1.0
    return X, offsets, total


def main():
    rng = np.random.default_rng(SEED)

    probs = build_probabilities(rng)
    answers, labels = sample_population(rng, probs)
    X, offsets, dim = one_hot(answers)

    # ---- PCA a mano con la SVD: mean + loadings, niente altro ----
    mean = X.mean(axis=0)
    Xc = X - mean
    U, S, Vt = np.linalg.svd(Xc, full_matrices=False)
    components = Vt[:N_PC]                       # (N_PC, dim)
    scores = Xc @ components.T                   # (N_REF, N_PC)
    var = (S ** 2) / (X.shape[0] - 1)
    explained = (var / var.sum())[:N_PC]

    # segno delle componenti stabile: la prima coordinata positiva "grande" comanda
    for j in range(N_PC):
        if components[j][np.argmax(np.abs(components[j]))] < 0:
            components[j] *= -1
            scores[:, j] *= -1

    # ---- UMAP sullo spazio PCA ----
    import umap

    reducer = umap.UMAP(
        n_neighbors=UMAP_NEIGHBORS,
        min_dist=UMAP_MIN_DIST,
        n_components=2,
        metric="euclidean",
        random_state=SEED,
    )
    emb = reducer.fit_transform(scores)

    # ---- normalizzo entrambe le viste in un riquadro comune [-1, 1] ----
    def fit_box(coords):
        cx, cy = coords[:, 0].mean(), coords[:, 1].mean()
        centered = coords - np.array([cx, cy])
        s = np.percentile(np.abs(centered), 99.0)
        return {"cx": float(cx), "cy": float(cy), "s": float(s)}

    pca_box = fit_box(scores[:, :2])
    umap_box = fit_box(emb)

    def apply_box(coords, box):
        return (coords - np.array([box["cx"], box["cy"]])) / box["s"]

    pca2 = apply_box(scores[:, :2], pca_box)
    umap2 = apply_box(emb, umap_box)

    # ---- centroidi dei cluster nello spazio PCA completo (per assegnare i nuovi) ----
    centroids = []
    for arch in ARCHETYPES:
        pts = scores[labels == arch["id"]]
        centroids.append(pts.mean(axis=0))
    centroids = np.array(centroids)

    # controllo: quanto e' accurata l'assegnazione al centroide piu' vicino?
    d = ((scores[:, None, :] - centroids[None, :, :]) ** 2).sum(axis=2)
    pred = d.argmin(axis=1)
    acc = float((pred == labels).mean())

    # ---- etichette degli assi: opzioni con loading estremo su PC1 e PC2 ----
    flat_labels = []
    for q in QUESTIONS:
        for opt in q["options"]:
            flat_labels.append(opt)

    def axis_hint(j):
        comp = components[j]
        order = np.argsort(comp)
        neg = [flat_labels[i] for i in order[:2]]
        pos = [flat_labels[i] for i in order[-2:]][::-1]
        return {"pos": pos, "neg": neg}

    axes = {"pc1": axis_hint(0), "pc2": axis_hint(1)}

    # -----------------------------------------------------------------
    # scrittura dei file
    # -----------------------------------------------------------------
    def r(x, n=4):
        return round(float(x), n)

    questions_payload = [
        {"id": q["id"], "text": q["text"], "options": q["options"]} for q in QUESTIONS
    ]

    with open(os.path.join(ROOT, "shared", "questions.js"), "w", encoding="utf-8") as f:
        f.write("// GENERATO DA tools/build_model.py - non modificare a mano.\n")
        f.write("// Per cambiare le domande: modifica QUESTIONS in build_model.py e rilancia lo script.\n")
        f.write("export const QUESTIONS = ")
        f.write(json.dumps(questions_payload, ensure_ascii=False, indent=2))
        f.write(";\n")

    model = {
        "version": 1,
        "seed": SEED,
        "dim": dim,
        "offsets": offsets,
        "nPC": N_PC,
        "knn": 15,
        "mean": [r(v, 5) for v in mean],
        "components": [[r(v, 5) for v in row] for row in components],
        "pcaBox": {k: r(v, 5) for k, v in pca_box.items()},
        "umapBox": {k: r(v, 5) for k, v in umap_box.items()},
        "explained": [r(v, 4) for v in explained],
        "axes": axes,
        "clusters": [
            {
                "id": a["id"],
                "name": a["name"],
                "blurb": a["blurb"],
                "color": a["color"],
                "centroid": [r(v, 4) for v in centroids[a["id"]]],
            }
            for a in ARCHETYPES
        ],
        "ref": {
            "pc": [[r(v, 3) for v in row] for row in scores],
            "xy": [[r(v, 4) for v in row] for row in pca2],
            "uxy": [[r(v, 4) for v in row] for row in umap2],
            "cluster": [int(v) for v in labels],
        },
    }

    with open(os.path.join(ROOT, "shared", "model.js"), "w", encoding="utf-8") as f:
        f.write("// GENERATO DA tools/build_model.py - non modificare a mano.\n")
        f.write("// PCA + UMAP calcolate una volta sola su una popolazione sintetica.\n")
        f.write("// Finche' questo file non cambia, la mappa e i colori restano identici.\n")
        f.write("export const MODEL = ")
        f.write(json.dumps(model, ensure_ascii=False, separators=(",", ":")))
        f.write(";\n")

    size = os.path.getsize(os.path.join(ROOT, "shared", "model.js")) / 1024
    print(f"OK  varianza spiegata PC1={explained[0]:.1%} PC2={explained[1]:.1%} "
          f"(prime 2: {explained[:2].sum():.1%})")
    print(f"OK  assegnazione al centroide piu' vicino: {acc:.1%} corretta")
    print(f"OK  shared/questions.js  ({len(QUESTIONS)} domande, {dim} dimensioni one-hot)")
    print(f"OK  shared/model.js      ({size:.0f} KB, {N_REF} punti di riferimento)")


if __name__ == "__main__":
    sys.exit(main())
