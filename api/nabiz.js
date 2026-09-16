// api/nabiz.js — CANLI MAÇ NABZI
//
// Nabiz tek bir anlik veriden cikmaz, DEGISIMDEN cikar. Bu uc her macin
// istatistigini belirli araliklarla ceker, onceki olcumu KV'de saklar ve iki
// olcum arasindaki farki puanlar:
//
//   puan = 3·Δisabetli şut + 1.5·Δtoplam şut + 1·Δkorner + 10·ΔxG
//   nabiz = 10 dakikaya normalize edilmis (ev + dep) puani, 0-100 arasi
//
// Ucretsiz plan gunde 100 istek verdigi icin:
//   - en fazla MAC_SAYISI mac izlenir
//   - her mac en fazla ARALIK saniyede bir sorgulanir
//   - gunluk sayac canli.js ile ORTAKTIR, GUNLUK tavaninda durur
//
// GET /api/nabiz            -> otomatik secim
// GET /api/nabiz?ids=1,2,3  -> istemcinin gosterdigi maclar oncelikli

const { acik: kvAcik, kvOku, kvYaz } = require("./_kv.js");

const UC_CANLI = "https://v3.football.api-sports.io/fixtures?live=all";
const UC_IST = "https://v3.football.api-sports.io/fixtures/statistics?fixture=";

const MAC_SAYISI = 6;         // ucretsiz planda es zamanli izlenecek mac
const ARALIK = 600;           // saniye: ayni maci bundan once tekrar sorma
const GUNLUK = 85;            // canli.js ile ortak gunluk tavan (plan 100)
const OMUR = 4 * 3600;

const sayacAnahtar = () => "af:sayac:" + new Date().toISOString().slice(0, 10);
const nabAnahtar = id => "af:nab:" + id;

const KEY = process.env.APIFOOTBALL_KEY || process.env.API_FOOTBALL_KEY || "";
const basliklar = { "x-apisports-key": KEY };

/* API-Football istatistik adlari -> bizim alanlar.
   Not: "tehlikeli atak" bu APIde yok; nabiz sut, korner ve xG uzerinden kurulur. */
function olcum(bloklar) {
  const bos = { sut: 0, isabet: 0, korner: 0, xg: 0, topla: 0 };
  const cikti = [];
  for (const b of bloklar || []) {
    const o = { ...bos };
    for (const s of b.statistics || []) {
      const ad = String(s.type || "").toLowerCase();
      const d = s.value;
      const sayi = typeof d === "string" ? parseFloat(d) : d;
      if (sayi == null || Number.isNaN(sayi)) continue;
      if (ad === "shots on goal") o.isabet = sayi;
      else if (ad === "total shots") o.sut = sayi;
      else if (ad === "corner kicks") o.korner = sayi;
      else if (ad.includes("expected_goals") || ad.includes("expected goals")) o.xg = sayi;
      else if (ad === "ball possession") o.topla = sayi;
    }
    cikti.push(o);
  }
  return cikti.slice(0, 2);
}

const puanla = (a, b) => {
  const d = (x, y) => Math.max(0, (y || 0) - (x || 0));
  return 3 * d(a.isabet, b.isabet) + 1.5 * d(a.sut, b.sut) + 1 * d(a.korner, b.korner) + 10 * d(a.xg, b.xg);
};

async function cek(url) {
  const r = await fetch(url, { headers: basliklar, signal: AbortSignal.timeout(7000) });
  if (!r.ok) throw new Error("http " + r.status);
  const j = await r.json();
  if (j.errors && Object.keys(j.errors).length) throw new Error("api: " + JSON.stringify(j.errors).slice(0, 100));
  return j;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (!KEY) return res.status(200).json({ ok: false, not: "API anahtarı tanımlı değil", mac: [] });
  if (!kvAcik()) return res.status(200).json({ ok: false, not: "Nabız için KV deposu gerekli", mac: [] });

  const simdi = Math.floor(Date.now() / 1000);
  const istenen = String(req.query.ids || "").split(",").map(x => +x).filter(Boolean);

  // 1) canli mac listesi: canli.js'in yazdigi onbellekten (ek istek yok)
  const on = await kvOku(["af:canli", sayacAnahtar()]);
  let sayac = +(on[sayacAnahtar()] || 0);
  let canliKayit = on["af:canli"];
  if (!canliKayit || simdi - canliKayit.t > 300) {
    if (sayac >= GUNLUK) return res.status(200).json({ ok: false, not: "günlük istek hakkı doldu", mac: [] });
    try {
      const j = await cek(UC_CANLI);
      const mac = (j.response || []).map(f => ({
        id: f.fixture.id, ev: f.teams.home.name, dep: f.teams.away.name,
        dk: f.fixture.status.elapsed, durum: f.fixture.status.short,
        skor: [f.goals.home || 0, f.goals.away || 0],
        ulke: f.league.country, lig: f.league.name,
      }));
      canliKayit = { t: simdi, mac };
      sayac++;
      await kvYaz({ "af:canli": canliKayit, [sayacAnahtar()]: sayac }, 172800);
    } catch (e) {
      return res.status(200).json({ ok: false, not: String(e.message || e), mac: [] });
    }
  }

  const canlilar = (canliKayit.mac || []).filter(m => m.dk != null && m.dk >= 5 && m.dk <= 88);

  // 2) izlenecek maclar: istemcinin gonderdikleri once, sonra en cok golsuz/aktif olanlar
  const sirali = [
    ...canlilar.filter(m => istenen.includes(m.id)),
    ...canlilar.filter(m => !istenen.includes(m.id)),
  ].slice(0, MAC_SAYISI);

  // 3) kayitlari oku
  const kayitlar = await kvOku(sirali.map(m => nabAnahtar(m.id)));

  // 4) suresi gelenleri guncelle (kota elverdigince)
  const yazilacak = {};
  for (const m of sirali) {
    const k = kayitlar[nabAnahtar(m.id)] || null;
    if (k && simdi - k.t < ARALIK) continue;
    if (sayac >= GUNLUK) break;
    try {
      const j = await cek(UC_IST + m.id);
      const o = olcum(j.response);
      if (o.length < 2) { sayac++; continue }
      sayac++;
      let nabiz = null, yon = null, fark = null;
      if (k && k.o) {
        const dk = Math.max(1, (m.dk || 0) - (k.dk || 0));           // gecen mac dakikasi
        const pe = puanla(k.o[0], o[0]), pd = puanla(k.o[1], o[1]);
        const toplam = ((pe + pd) * 10) / dk;                        // 10 dakikaya normalize
        nabiz = Math.max(0, Math.min(100, Math.round(toplam * 5)));
        yon = pe === pd ? "denge" : (pe > pd ? "ev" : "dep");
        fark = {
          dk,
          ev: { sut: o[0].sut - k.o[0].sut, isabet: o[0].isabet - k.o[0].isabet, korner: o[0].korner - k.o[0].korner },
          dep: { sut: o[1].sut - k.o[1].sut, isabet: o[1].isabet - k.o[1].isabet, korner: o[1].korner - k.o[1].korner },
        };
      }
      yazilacak[nabAnahtar(m.id)] = { t: simdi, dk: m.dk, o, nabiz, yon, fark };
      kayitlar[nabAnahtar(m.id)] = yazilacak[nabAnahtar(m.id)];
    } catch (e) { sayac++ }
  }
  if (Object.keys(yazilacak).length) await kvYaz({ ...yazilacak, [sayacAnahtar()]: sayac }, OMUR);

  // 5) sonuc
  const mac = sirali.map(m => {
    const k = kayitlar[nabAnahtar(m.id)] || {};
    return {
      id: m.id, ev: m.ev, dep: m.dep, dk: m.dk, durum: m.durum, skor: m.skor,
      ulke: m.ulke, lig: m.lig,
      nabiz: k.nabiz == null ? null : k.nabiz,
      yon: k.yon || null, fark: k.fark || null,
      yas: k.t ? simdi - k.t : null,
      toplam: k.o ? { ev: k.o[0], dep: k.o[1] } : null,
    };
  }).sort((a, b) => (b.nabiz == null ? -1 : b.nabiz) - (a.nabiz == null ? -1 : a.nabiz));

  res.status(200).json({ ok: true, izlenen: sirali.length, canliSayisi: canlilar.length, kalan: GUNLUK - sayac, aralik: ARALIK, mac });
};

module.exports.config = { maxDuration: 30 };
