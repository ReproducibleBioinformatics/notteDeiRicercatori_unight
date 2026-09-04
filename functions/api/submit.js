import { projectAnswers } from "../../shared/project.js";
import { QUESTIONS } from "../../shared/questions.js";
import { MODEL } from "../../shared/model.js";
import { json, fail, cleanName, hashIp } from "../../shared/http.js";

const COOLDOWN_MS = 12000; // una risposta ogni 12 secondi dallo stesso dispositivo

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Richiesta non leggibile.");
  }

  const name = cleanName(body?.name);
  if (!name) return fail(400, "Serve un nome, anche di fantasia.");

  const answers = body?.answers;
  if (!Array.isArray(answers) || answers.length !== QUESTIONS.length) {
    return fail(400, `Servono ${QUESTIONS.length} risposte.`);
  }
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    if (!Number.isInteger(a) || a < 0 || a >= QUESTIONS[i].options.length) {
      return fail(400, `Risposta non valida alla domanda ${i + 1}.`);
    }
  }

  const ip = request.headers.get("cf-connecting-ip") || "";
  const ipHash = await hashIp(ip, env.HASH_SALT);
  const now = Date.now();

  const recent = await env.DB.prepare(
    "SELECT created_at FROM participants WHERE ip_hash = ?1 ORDER BY id DESC LIMIT 1"
  )
    .bind(ipHash)
    .first();

  if (recent && now - recent.created_at < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (now - recent.created_at)) / 1000);
    return fail(429, `Aspetta ${wait} secondi prima di rispondere di nuovo.`);
  }

  const seed = (now % 100000) + name.length * 31;
  const p = projectAnswers(answers, seed);

  const row = await env.DB.prepare(
    `INSERT INTO participants (name, answers, cluster, x, y, ux, uy, ip_hash, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     RETURNING id`
  )
    .bind(name, JSON.stringify(answers), p.cluster, p.x, p.y, p.ux, p.uy, ipHash, now)
    .first();

  const cluster = MODEL.clusters[p.cluster];
  const twins = await env.DB.prepare(
    `SELECT name FROM participants
     WHERE cluster = ?1 AND id != ?2
     ORDER BY (x - ?3) * (x - ?3) + (y - ?4) * (y - ?4)
     LIMIT 3`
  )
    .bind(p.cluster, row.id, p.x, p.y)
    .all();

  return json({
    id: row.id,
    name,
    x: p.x,
    y: p.y,
    ux: p.ux,
    uy: p.uy,
    cluster: p.cluster,
    clusterName: cluster.name,
    clusterBlurb: cluster.blurb,
    clusterColor: cluster.color,
    twins: (twins.results || []).map((t) => t.name),
  });
}
