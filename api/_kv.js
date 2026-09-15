// api/_kv.js — Upstash Redis (Vercel KV) REST istemcisi.
// Ortam degiskenleri yoksa sessizce devre disi kalir; uygulama eskisi gibi calisir.

const URL_ =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.REDIS_REST_URL ||
  "";
const TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.REDIS_REST_TOKEN ||
  "";

const acik = () => !!(URL_ && TOKEN);

async function komut(govde, sure = 4000) {
  if (!acik()) return null;
  try {
    const r = await fetch(URL_ + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(govde),
      signal: AbortSignal.timeout(sure),
    });
    if (!r.ok) return null;
    return await r.json();          // [{result: ...}, ...]
  } catch {
    return null;
  }
}

/* Birden cok anahtari tek istekte okur -> { anahtar: nesne|null } */
async function kvOku(anahtarlar) {
  const cikti = {};
  if (!acik() || !anahtarlar.length) return cikti;
  const y = await komut(anahtarlar.map(k => ["GET", k]));
  if (!Array.isArray(y)) return cikti;
  anahtarlar.forEach((k, i) => {
    const v = y[i] && y[i].result;
    if (typeof v !== "string") return;
    try { cikti[k] = JSON.parse(v) } catch {}
  });
  return cikti;
}

/* { anahtar: nesne } yazar, saniye cinsinden omur verir */
async function kvYaz(kayitlar, omur = 43200) {
  const ciftler = Object.entries(kayitlar);
  if (!acik() || !ciftler.length) return false;
  const y = await komut(ciftler.map(([k, v]) => ["SET", k, JSON.stringify(v), "EX", String(omur)]));
  return Array.isArray(y);
}

module.exports = { acik, kvOku, kvYaz };
