export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": init.cache || "no-store",
      ...(init.headers || {}),
    },
  });
}

export function fail(status, message) {
  return json({ error: message }, { status });
}

/** Nome ripulito: niente caratteri di controllo, massimo 22 caratteri. */
export function cleanName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 22);
  if (name.length < 1) return null;
  const lowered = name.toLowerCase();
  const blocked = ["cazzo", "merda", "stronz", "puttan", "fanculo", "coglion", "figa", "troia"];
  if (blocked.some((w) => lowered.includes(w))) return "Anonimo";
  return name;
}

/** Hash corto dell'IP: serve solo per il rate limit, non identifica nessuno. */
export async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(`${salt || "nr"}:${ip || "?"}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
