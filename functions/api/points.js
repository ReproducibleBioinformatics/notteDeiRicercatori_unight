import { json, fail } from "../../shared/http.js";

const PAGE = 400;

// Il display chiede solo i punti nuovi: "since" e' l'id piu' alto che ha gia'.
// Niente COUNT(*): scansionerebbe tutta la tabella a ogni giro di polling e da
// solo brucerebbe il tetto giornaliero di righe lette. Il totale se lo conta il
// display, che i punti li ha gia' tutti in memoria.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const since = Math.max(0, parseInt(url.searchParams.get("since") || "0", 10) || 0);

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, cluster, x, y, ux, uy, created_at
       FROM participants WHERE id > ?1 ORDER BY id ASC LIMIT ${PAGE}`
    )
      .bind(since)
      .all();

    const points = results || [];
    // se la pagina e' piena ce ne sono altri: il display richiede subito invece
    // di aspettare il prossimo giro (serve al primo caricamento a serata avviata)
    return json({ points, more: points.length === PAGE });
  } catch (err) {
    return fail(500, "Database non raggiungibile. Controlla il binding DB.");
  }
}