// api/toplu.js — maç sayfalarını toplu çeker, SUNUCUDA ayrıştırır ve KV'de saklar.
//
// Akis:  istemci 6 yol yollar
//        -> KV'de varsa oradan (ag trafigi yok, ~10 ms)
//        -> yoksa footballzz'den cek, ayristir, KV'ye yaz (12 saat)
//        -> istemciye HTML degil, ayristirilmis JSON doner (~1 KB/mac)
//
// KV bagli degilse her sey calismaya devam eder, sadece her istek siteye gider.

const { h2hJson } = require("./_ayristir.js");
const { acik: kvAcik, kvOku, kvYaz } = require("./_kv.js");

const SITE = {
  fz: "https://footballzz.co.uk",
  afr: "https://afootballreport.com",
};

const BASLIK = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,tr;q=0.8",
  Referer: "https://footballzz.co.uk/",
};

const EN_FAZLA = 8;           // tek istekte islenecek yol sayisi
const ES_ZAMAN = 4;           // ayni anda kac sayfa cekilsin
const SAYFA_SURE = 6000;      // her sayfa icin zaman asimi
const BUTCE = 9000;           // fonksiyonun toplam suresi
const OMUR = 12 * 3600;       // KV kaydi kac saniye yasasin

const anahtar = (site, yol) => `h2h:${site}:${yol}`;

async function cek(site, yol) {
  const r = await fetch(SITE[site] + yol, {
    headers: BASLIK,
    redirect: "follow",
    signal: AbortSignal.timeout(SAYFA_SURE),
  });
  if (!r.ok) return null;
  return h2hJson(await r.text());
}

module.exports = async (req, res) => {
  const site = req.query.site === "afr" ? "afr" : "fz";
  const yollar = String(req.query.yol || "")
    .split("|")
    .map(y => y.trim())
    .filter(y => y.startsWith("/head-to-head/"))
    .slice(0, EN_FAZLA);

  res.setHeader("Access-Control-Allow-Origin", "*");
  if (!yollar.length) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).json({ hata: "yol yok" });
  }

  const sonuc = {};
  let kvIsabet = 0;

  // 1) KV'de olanlari al
  const bellek = await kvOku(yollar.map(y => anahtar(site, y)));
  const eksik = [];
  for (const y of yollar) {
    const v = bellek[anahtar(site, y)];
    if (v) { sonuc[y] = v; kvIsabet++ } else eksik.push(y);
  }

  // 2) Kalanlari siteden cek
  const yeni = {};
  const bitis = Date.now() + BUTCE;
  const sira = [...eksik];
  await Promise.all(Array.from({ length: ES_ZAMAN }, async () => {
    while (sira.length) {
      const y = sira.shift();
      if (Date.now() > bitis) { sonuc[y] = null; continue }   // butce bitti: istemci tek tek dener
      try {
        const d = await cek(site, y);
        sonuc[y] = d;
        if (d) yeni[anahtar(site, y)] = d;
      } catch { sonuc[y] = null }
    }
  }));

  // 3) Yenileri KV'ye yaz (yanit beklemeden donmeyelim, kayit kaybolmasin)
  if (Object.keys(yeni).length) await kvYaz(yeni, OMUR);

  res.setHeader("X-KV", kvAcik() ? `${kvIsabet}/${yollar.length}` : "kapali");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=600, stale-while-revalidate=1800");
  res.status(200).json(sonuc);
};

// Vercel: bu fonksiyonun azami calisma suresi (vercel.json'a gerek kalmadan)
module.exports.config = { maxDuration: 15 };
