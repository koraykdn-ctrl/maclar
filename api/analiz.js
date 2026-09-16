// api/analiz.js — MAÇ ANALİZİ (Google Gemini)
//
// Istemci macin verisini (yuzdeler, trendler, form, son maclar, canli skor)
// JSON olarak yollar; burada Gemini'ye Turkce bir istem ile gonderilir ve
// kisa bir yorum doner.
//
// Onemli: yapay zeka SONUC TAHMIN ETMEZ. Isi, elindeki sayilari okumak,
// celiskileri isaret etmek ve neyin zayif veriye dayandigini soylemek.
//
// Ortam degiskeni:  GEMINI_KEY   (opsiyonel: GEMINI_MODEL)
// Anahtar: aistudio.google.com/apikey  (ucretsiz katman)

const { acik: kvAcik, kvOku, kvYaz } = require("./_kv.js");

const KEY = process.env.GEMINI_KEY || process.env.GOOGLE_API_KEY || "";
const MODELLER = [process.env.GEMINI_MODEL, "gemini-3.6-flash", "gemini-2.5-flash", "gemini-flash-latest"].filter(Boolean);
const GUNLUK = 120;                       // gunluk analiz tavani
const OMUR = 3600;                        // ayni mac icin onbellek (saniye)

const sayacAnahtar = () => "ai:sayac:" + new Date().toISOString().slice(0, 10);
const kisa = s => String(s == null ? "" : s).slice(0, 400);

function govdeOku(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body) } catch { return {} } }
  return {};
}

/* Modelin onune konan veri: sayilar burada, yorum modelden */
function istem(m) {
  const s = [];
  s.push(`Maç: ${kisa(m.ev)} - ${kisa(m.dep)}`);
  if (m.lig) s.push(`Lig: ${kisa(m.ulke)} / ${kisa(m.lig)}`);
  if (m.saat) s.push(`Başlangıç: ${kisa(m.saat)}`);
  if (m.canli) s.push(`CANLI: ${kisa(m.canli)}`);
  if (m.form) s.push(`Form (son maçlar, G/B/M): ${kisa(m.ev)} ${kisa(m.form[0])} · ${kisa(m.dep)} ${kisa(m.form[1])}`);
  if (m.yuzde && Object.keys(m.yuzde).length) {
    s.push("Son 2 ay yüzdeleri (iki takımın ortak oranı):");
    for (const [k, v] of Object.entries(m.yuzde)) s.push(`  - ${kisa(k)}: %${Math.round(v * 100)}`);
  }
  if (m.takim) {
    s.push(`Takım bazında: ${kisa(m.ev)} → ${kisa(m.takim[0])}`);
    s.push(`               ${kisa(m.dep)} → ${kisa(m.takim[1])}`);
  }
  if (m.trend && m.trend.length) {
    s.push("Seriler (⇄ = iki takımda birden):");
    for (const t of m.trend.slice(0, 10)) s.push(`  - ${kisa(t)}`);
  }
  if (m.sonMac && m.sonMac.length) {
    s.push("Son maçlar:");
    for (const g of m.sonMac.slice(0, 10)) s.push(`  - ${kisa(g)}`);
  }
  if (m.ms) s.push(`Sitenin MS tahmini: 1 %${m.ms.e} · X %${m.ms.b} · 2 %${m.ms.d}`);
  return s.join("\n");
}

const TALIMAT = `Sen bir futbol veri analistisin. Sana bir maçın istatistikleri veriliyor.

Görevin SONUÇ TAHMİN ETMEK DEĞİL. Görevin elindeki sayıları okumak ve kullanıcının gözden kaçıracağı şeyleri göstermek.

Kurallar:
- Türkçe yaz, sade ve kısa. En fazla 120 kelime.
- Önce tek cümlede verinin genel resmini söyle.
- Sonra en fazla 3 madde: dikkat çeken uyum (birbirini destekleyen veriler) ve ÇELİŞKİ (birbirini tutmayan veriler).
- Örnek maç sayısı azsa (10'un altı) bunu mutlaka belirt; küçük örneklem yanıltır.
- Yüzde veriyorsan yalnızca sana verilenleri kullan, sayı UYDURMA.
- "Kesin", "garanti", "banko" gibi ifadeler kullanma. Bahis tavsiyesi verme, oynanacak kupon önerme.
- Veri zayıfsa bunu açıkça yaz: "bu veriyle güvenli bir şey söylenemez".`;

async function gemini(model, metin) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(KEY)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: TALIMAT }] },
      contents: [{ role: "user", parts: [{ text: metin }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error((j.error && j.error.message) || ("http " + r.status));
    e.kod = r.status;
    throw e;
  }
  const p = ((j.candidates || [])[0] || {}).content || {};
  return ((p.parts || []).map(x => x.text || "").join("").trim()) || "";
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, not: "POST gerekli" });
  if (!KEY) return res.status(200).json({ ok: false, not: "GEMINI_KEY tanımlı değil" });

  const m = govdeOku(req);
  if (!m || !m.ev || !m.dep) return res.status(400).json({ ok: false, not: "maç verisi eksik" });

  const anahtar = "ai:" + (m.url || `${m.ev}-${m.dep}`) + ":" + (m.canli ? "canli" : "on");

  // 1) onbellek
  if (kvAcik()) {
    const o = await kvOku([anahtar, sayacAnahtar()]);
    if (o[anahtar] && o[anahtar].metin)
      return res.status(200).json({ ok: true, kaynak: "önbellek", metin: o[anahtar].metin });
    var sayac = +(o[sayacAnahtar()] || 0);
    if (sayac >= GUNLUK)
      return res.status(200).json({ ok: false, not: "günlük analiz hakkı doldu" });
  } else var sayac = 0;

  // 2) modele sor (model adi degisirse sirayla dene)
  let metin = "", hata = null;
  for (const model of MODELLER) {
    try { metin = await gemini(model, istem(m)); if (metin) break }
    catch (e) { hata = e; if (e.kod !== 404 && e.kod !== 400) break }
  }
  if (!metin) return res.status(200).json({ ok: false, not: hata ? String(hata.message) : "boş yanıt" });

  if (kvAcik()) await kvYaz({ [anahtar]: { metin, t: Date.now() } }, OMUR).catch(() => {});
  if (kvAcik()) await kvYaz({ [sayacAnahtar()]: sayac + 1 }, 172800).catch(() => {});

  res.status(200).json({ ok: true, kaynak: "gemini", kalan: GUNLUK - sayac - 1, metin });
};

module.exports.config = { maxDuration: 30 };
