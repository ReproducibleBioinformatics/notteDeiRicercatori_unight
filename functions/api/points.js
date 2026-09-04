import { json, fail } from "../../shared/http.js";

// Il display chiede solo i punti nuovi: "since" e' l'id piu' alto che ha gia'.
// Cosi' il polling costa pochissimo anche dopo qualche centinaio di partecipanti.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const since = Math.max(0, parseInt(url.searchParams.get("since") || "0", 10) || 0);

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, cluster, x, y, ux, uy, created_at
       FROM participants WHERE id > ?1 ORDER BY id ASC LIMIT 400`
    )
      .bind(since)
      .all();

    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM participants").first();

    return json({ points: results || [], total: total?.n ?? 0 });
  } catch (err) {
    return fail(500, "Database non raggiungibile. Controlla il binding DB.");
  }
}
