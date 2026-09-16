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

/* Modelin onune konan veri: pazar secimini KOD yapar, model yalnizca yorumlar */
function istem(m) {
  const s = [];
  s.push(`Maç: ${kisa(m.ev)} - ${kisa(m.dep)}`);
  if (m.lig) s.push(`Lig: ${kisa(m.ulke)} / ${kisa(m.lig)}`);
  if (m.saat) s.push(`Başlangıç: ${kisa(m.saat)}`);
  if (m.canli) s.push(`CANLI: ${kisa(m.canli)}`);
  if (m.form) s.push(`Form (son maçlar): ${kisa(m.ev)} ${kisa(m.form[0])} · ${kisa(m.dep)} ${kisa(m.form[1])}`);

  const sirali = Object.entries(m.yuzde || {})
    .filter(([, v]) => typeof v === "number")
    .sort((a, b) => b[1] - a[1]);

  if (sirali.length) {
    s.push("");
    s.push("GOL PAZARLARI — yüzdeye göre sıralı (iki takımın ortak oranı, son 2 ay):");
    sirali.forEach(([k, v], i) =>
      s.push(`  ${i + 1}. ${kisa(k)}: %${Math.round(v * 100)}`));
    s.push("");
    s.push(`>>> ÖNERİLECEK PAZAR: ${kisa(sirali[0][0])} (%${Math.round(sirali[0][1] * 100)}) <<<`);
    if (sirali[0][1] < 0.6) s.push(">>> UYARI: en yüksek oran bile %60'ın altında, güvenli bir öneri yok. <<<");
    const dusuk = sirali.filter(([, v]) => v < 0.35).map(([k]) => k);
    if (dusuk.length) s.push(`Kaçınılacak (düşük oranlı): ${dusuk.join(", ")}`);
  }

  if (m.takim) s.push(`Örneklem: ${kisa(m.ev)} ${kisa(m.takim[0])}, ${kisa(m.dep)} ${kisa(m.takim[1])}`);
  if (m.trend && m.trend.length) {
    s.push("Seriler (⇄ = iki takımda birden):");
    for (const t of m.trend.slice(0, 10)) s.push(`  - ${kisa(t)}`);
  }
  if (m.sonMac && m.sonMac.length) {
    s.push("Son maçlar:");
    for (const g of m.sonMac.slice(0, 10)) s.push(`  - ${kisa(g)}`);
  }
  return s.join("\n");
}

const TALIMAT = `Sen bir futbol veri analistisin. Sana bir maçın gol istatistikleri YÜZDEYE GÖRE SIRALI verilir.

EN ÖNEMLİ KURAL: Önereceğin pazarı sen seçmezsin. ">>> ÖNERİLECEK PAZAR" satırında yazan pazarı önerirsin. Listede daha aşağıdaki bir pazarı asla öne çıkarma. %60 altındaki hiçbir pazarı önerme.

Yalnızca gol pazarları konuşulur (İY 0.5/1.5 Üst, İY KG, maç 1.5/2.5/3.5 Üst ve Alt, KG Var/Yok, 2. yarı 0.5 Üst). Maç sonucu (1X2), korner, kart, handikap yok.

Biçim:
1. satır: "Öne çıkan: <pazar> %<oran>" ve tek cümle gerekçe.
2-4. maddeler (en fazla 3): bu oranı destekleyen seri/form verisi, varsa çelişen veri, ve listenin altındaki hangi pazardan uzak durulmalı.

Kurallar:
- Türkçe, sade, en fazla 110 kelime.
- Yalnızca sana verilen sayıları kullan, sayı UYDURMA, yüzdeleri değiştirme.
- Örneklem 10 maçın altındaysa bunu yaz; küçük örneklem yanıltır.
- "UYARI: en yüksek oran bile %60'ın altında" satırını görürsen öneri verme, "bu veriyle gol tarafında güvenli bir şey söylenemez" de ve nedenini yaz.
- "Kesin", "garanti", "banko" deme. Kupon kurma.`;

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
