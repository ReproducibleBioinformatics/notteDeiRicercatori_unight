import { json, fail } from "../../shared/http.js";

// Svuota la mappa. Serve il token: impostalo come variabile ADMIN_TOKEN su Cloudflare.
//   curl -X POST https://tuo-sito.pages.dev/api/reset -H "x-admin-token: IL_TUO_TOKEN"
export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_TOKEN) return fail(503, "ADMIN_TOKEN non configurato.");
  if (request.headers.get("x-admin-token") !== env.ADMIN_TOKEN) {
    return fail(401, "Token non valido.");
  }
  await env.DB.prepare("DELETE FROM participants").run();
  await env.DB.prepare("DELETE FROM sqlite_sequence WHERE name = 'participants'").run();
  return json({ ok: true, message: "Mappa svuotata." });
}
