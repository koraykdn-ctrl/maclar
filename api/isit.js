// api/isit.js — ÖN ISITMA (Vercel Cron)
//
// Gunun liste sayfalarini okur, ictindeki h2h baglantilarini cikarir ve
// KV'de olmayanlari arka planda cekip ayristirarak yazar. Sen uygulamayi
// actiginda kazilacak bir sey kalmaz: /api/toplu her seyi KV'den doner.
//
// vercel.json icindeki "crons" bunu gunde iki kez cagirir.
// Elle de calistirabilirsin: ADRES/api/isit  (tarayicidan)

const { h2hJson } = require("./_ayristir.js");
const { acik: kvAcik, kvOku, kvYaz } = require("./_kv.js");

const KOK = "https://footballzz.co.uk";

const BASLIK = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,tr;q=0.8",
  Referer: KOK + "/",
};

// Istemcideki KAYNAK.seri ile ayni liste sayfalari
const LISTE = [
  "/over-0.5-first-half-goals-football-predictions-and-tips/",
  "/over-1.5-goals-football-predictions-and-tips/",
  "/over-2.5-goals-football-predictions-and-tips/",
  "/both-teams-to-score-football-predictions-and-tips/",
  "/over-9.5-corners-football-predictions-and-tips/",
  "/over-3.5-cards-football-predictions-and-tips/",
];

const ES_ZAMAN = 6;
const BUTCE = 50000;          // vercel.json'da maxDuration 60 sn
const OMUR = 12 * 3600;
const YAZ_BOYU = 20;          // KV'ye kacarli yazilsin

const anahtar = yol => `h2h:fz:${yol}`;

async function metin(yol, sure = 8000) {
  try {
    const r = await fetch(KOK + yol, { headers: BASLIK, redirect: "follow", signal: AbortSignal.timeout(sure) });
    return r.ok ? await r.text() : "";
  } catch { return "" }
}

function yollariCikar(html) {
  const cikti = new Set();
  const re = /href="([^"]*\/head-to-head\/[^"]*)"/gi;
  let e;
  while ((e = re.exec(html)) !== null) {
    let y = e[1].replace(/&amp;/g, "&");
    const i = y.indexOf("/head-to-head/");
    if (i < 0) continue;
    y = y.slice(i).split("?")[0];
    if (y.split("/").filter(Boolean).length >= 6) cikti.add(y);
  }
  return [...cikti];
}

module.exports = async (req, res) => {
  const t0 = Date.now();
  res.setHeader("Cache-Control", "no-store");
  if (!kvAcik()) return res.status(200).json({ ok: false, not: "KV bağlı değil; ön ısıtmanın etkisi olmaz." });

  // 1) liste sayfalarindan maclari topla
  const sayfalar = await Promise.all(LISTE.map(y => metin(y)));
  const tumu = new Set();
  for (const h of sayfalar) for (const y of yollariCikar(h)) tumu.add(y);
  const hepsi = [...tumu];

  // 2) KV'de olmayanlari ayikla
  const bellek = await kvOku(hepsi.map(anahtar));
  const eksik = hepsi.filter(y => !bellek[anahtar(y)]);

  // 3) butce bitene kadar cek + ayristir
  const sira = [...eksik];
  let okunan = 0, basarisiz = 0;
  let paket = {};
  const bosalt = async () => { if (Object.keys(paket).length) { await kvYaz(paket, OMUR); paket = {} } };

  await Promise.all(Array.from({ length: ES_ZAMAN }, async () => {
    while (sira.length && Date.now() - t0 < BUTCE) {
      const y = sira.shift();
      const html = await metin(y, 7000);
      const d = html ? h2hJson(html) : null;
      if (d) { paket[anahtar(y)] = d; okunan++ } else basarisiz++;
      if (Object.keys(paket).length >= YAZ_BOYU) await bosalt();
    }
  }));
  await bosalt();

  res.status(200).json({
    ok: true,
    mac: hepsi.length,
    zatenVardi: hepsi.length - eksik.length,
    isitilan: okunan,
    basarisiz,
    kalan: sira.length,
    sn: +((Date.now() - t0) / 1000).toFixed(1),
  });
};

// Vercel: bu fonksiyonun azami calisma suresi (vercel.json'a gerek kalmadan)
module.exports.config = { maxDuration: 60 };
