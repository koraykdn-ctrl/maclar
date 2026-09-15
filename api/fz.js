// api/fz.js — Vercel Serverless Function (Node 18+)
//
// /fz/<yol>  ve  /afr/<yol>  istekleri vercel.json ile buraya yonlendirilir.
// Duz "rewrite"ten farki:
//   1) Gercek tarayici basliklari gonderir -> bot/reklam duvarina takilmaz.
//   2) Yaniti CDN'de tutar (s-maxage) ve bir sure bayat surumu aninda verip
//      arkada tazeler -> ayni sayfayi ikinci kez isteyen beklemez.
//   3) script/style/yorum bloklarini atar -> ~180 KB sayfa ~40 KB'a duser.

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

function sadelestir(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/\s{2,}/g, " ");
}

module.exports = async (req, res) => {
  const site = req.query.site === "afr" ? "afr" : "fz";
  let yol = [].concat(req.query.yol || "/").join("/");
  if (!yol.startsWith("/")) yol = "/" + yol;
  const url = SITE[site] + yol;

  const ctrl = new AbortController();
  const zaman = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: BASLIK, redirect: "follow", signal: ctrl.signal });
    const ham = await r.text();
    const html = sadelestir(ham);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Kaynak", url);
    res.setHeader("X-Boy", `${ham.length}/${html.length}`);
    const kisa = /live-inplay/.test(yol);          // canli sayfa kisa sure onbellekte
    res.setHeader(
      "Cache-Control",
      kisa
        ? "public, max-age=30, s-maxage=45, stale-while-revalidate=120"
        : "public, max-age=60, s-maxage=300, stale-while-revalidate=900"
    );
    res.status(r.ok ? 200 : r.status).send(html);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).send("kaynak alinamadi: " + (e && e.message ? e.message : e));
  } finally {
    clearTimeout(zaman);
  }
};
