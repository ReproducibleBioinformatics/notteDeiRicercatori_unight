import { json, fail } from "../../shared/http.js";

// Cancella una singola persona. Serve il token: impostalo come variabile
// ADMIN_TOKEN su Cloudflare (npx wrangler pages secret put ADMIN_TOKEN).
export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_TOKEN) return fail(503, "ADMIN_TOKEN non configurato.");
  if (request.headers.get("x-admin-token") !== env.ADMIN_TOKEN) {
    return fail(401, "Token non valido.");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Richiesta non leggibile.");
  }

  const id = Number(body?.id);
  if (!Number.isInteger(id) || id < 1) return fail(400, "Id non valido.");

  const res = await env.DB.prepare("DELETE FROM participants WHERE id = ?1").bind(id).run();
  const tolti = res?.meta?.changes ?? 0;
  if (!tolti) return fail(404, "Nessuno con quell'id.");

  return json({ ok: true, id });
}
