// api/canli.js — API-Football'dan canlı skor, dakika ve devre skoru.
//
// Ucretsiz plan gunde 100 istek verir; "fixtures?live=all" TEK istekte o an
// oynanan butun maclari dondurur. Bu yuzden:
//   - yanit KV'de saklanir, 90 saniyeden taze ise siteye gidilmez
//   - gunluk sayac 85'te durur, sonrasinda bayat veri servis edilir
// Boylece sekmeyi acik biraksan bile kota bitmez.
//
// Ortam degiskeni:  APIFOOTBALL_KEY   (Vercel > Settings > Environment Variables)

const { acik: kvAcik, kvOku, kvYaz } = require("./_kv.js");

const UC = "https://v3.football.api-sports.io/fixtures?live=all";
const TAZE = 90;              // saniye: bundan yeni ise KV'den ver
const GUNLUK = 85;            // gunluk istek tavani (plan 100)
const ANAHTAR = "af:canli";
const sayacAnahtar = () => "af:sayac:" + new Date().toISOString().slice(0, 10);

let bellek = null;            // KV yoksa lambda icinde tut

function sadelestir(j) {
  const cikti = [];
  for (const f of (j && j.response) || []) {
    const d = f.fixture || {}, t = f.teams || {}, g = f.goals || {}, s = f.score || {};
    const durum = (d.status || {}).short || "";
    if (["FT", "AET", "PEN", "PST", "CANC", "ABD", "NS"].includes(durum)) continue;
    cikti.push({
      id: d.id,
      ev: (t.home || {}).name || "",
      dep: (t.away || {}).name || "",
      ulke: (f.league || {}).country || "",
      lig: (f.league || {}).name || "",
      ko: d.date || null,
      dk: (d.status || {}).elapsed,
      ek: (d.status || {}).extra || 0,          // uzatma dakikasi
      durum,                                     // 1H | HT | 2H | ET | BT | LIVE
      skor: [g.home == null ? 0 : g.home, g.away == null ? 0 : g.away],
      iy: [((s.halftime || {}).home), ((s.halftime || {}).away)],
    });
  }
  return cikti;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=30, s-maxage=60");

  const key = process.env.APIFOOTBALL_KEY || process.env.API_FOOTBALL_KEY || "";
  if (!key) return res.status(200).json({ ok: false, not: "API anahtarı tanımlı değil", mac: [] });

  const simdi = Math.floor(Date.now() / 1000);

  // 1) onbellek
  let kayit = null;
  if (kvAcik()) {
    const o = await kvOku([ANAHTAR, sayacAnahtar()]);
    kayit = o[ANAHTAR] || null;
    var sayac = +(o[sayacAnahtar()] || 0);
  } else {
    kayit = bellek; var sayac = 0;
  }
  if (kayit && simdi - kayit.t < TAZE)
    return res.status(200).json({ ok: true, kaynak: "önbellek", yas: simdi - kayit.t, mac: kayit.mac });

  // 2) gunluk tavan
  if (sayac >= GUNLUK)
    return res.status(200).json({
      ok: true, kaynak: "bayat", not: "günlük istek hakkı doldu",
      yas: kayit ? simdi - kayit.t : null, mac: kayit ? kayit.mac : [],
    });

  // 3) siteden cek
  try {
    const r = await fetch(UC, {
      headers: { "x-apisports-key": key },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error("http " + r.status);
    const j = await r.json();
    if (j.errors && Object.keys(j.errors).length)
      throw new Error(JSON.stringify(j.errors).slice(0, 120));

    const mac = sadelestir(j);
    const yeni = { t: simdi, mac };
    bellek = yeni;
    if (kvAcik()) await kvYaz({ [ANAHTAR]: yeni, [sayacAnahtar()]: sayac + 1 }, 172800);

    res.status(200).json({ ok: true, kaynak: "api", yas: 0, kalan: GUNLUK - sayac - 1, mac });
  } catch (e) {
    res.status(200).json({
      ok: false, not: String(e && e.message ? e.message : e),
      yas: kayit ? simdi - kayit.t : null, mac: kayit ? kayit.mac : [],
    });
  }
};

module.exports.config = { maxDuration: 15 };
