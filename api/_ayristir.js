// ÜRETİLMİŞ DOSYA — index.html'den çıkarıldı, elle düzenleme.
// Yeniden üretmek için: python3 uret_ayristir.py

const temizle = s => s.replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/\s+/g, " ").trim();
const sade = s => String(s).toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
const MAC_RE = /(\d{4}-\d{2}-\d{2})\s+(.{2,42}?)\s+-\s+(.{2,42}?)\s+(\d{1,2})\s*-\s*(\d{1,2})\s*\(\s*HT:?\s*(\d{1,2})\s*-\s*(\d{1,2})\s*\)\s*([WDL])/g;
const SERI_RE = /([A-Za-zÀ-ÿ0-9][^.|]{1,42}?)\s+(?:have|has)\s+(?:conceded\s+)?(over\s+[\d.]+\s+[a-z ]+?|under\s+[\d.]+\s+[a-z ]+?|[a-z][a-z ]{2,30}?)\s+in\s+(?:their|its)\s+last\s+(\d+)\s+games/gi;
const SERI_KG = /Both teams to score\s+in the last\s+(\d+)\s+games of\s+([^.|]{2,42})/gi;
function h2hEkstra(html, ham) {
  let t = temizle(html);
  if (!/last games/i.test(t) && ham) t = temizle(ham.replace(/\*\*/g, ""));
  if (!/last games/i.test(t)) return {};
  const sonuc = { maclar: [[], []], seri: [[], []], form: null };

  /* bolum sinirlari: "<takim> last games" ve "<takim> performance highlights" */
  const sinir = (re) => { const d = []; let e; const r = new RegExp(re, "gi"); while ((e = r.exec(t)) !== null) d.push(e.index); return d };
  const gunler = sinir("[\\wÀ-ÿ.'&-]+ last games");
  const one = sinir("performance highlights");
  const kesim = gunler.length ? gunler[0] : t.length;

  /* son maclar */
  MAC_RE.lastIndex = 0;
  let e;
  while ((e = MAC_RE.exec(t)) !== null) {
    const yer = (gunler.length > 1 && e.index > gunler[1]) ? 1 : 0;
    if (sonuc.maclar[yer].length < 6)
      sonuc.maclar[yer].push({ t: e[1], ev: e[2].trim(), dep: e[3].trim(), s: `${e[4]}-${e[5]}`, iy: `${e[6]}-${e[7]}`, sonuc: e[8] });
  }

  /* one cikan seriler */
  if (one.length) {
    const dilim = (i) => t.slice(one[i], i + 1 < one.length ? one[i + 1] : t.length);
    for (let i = 0; i < Math.min(2, one.length); i++) {
      const d = dilim(i);
      SERI_RE.lastIndex = 0;
      let x;
      while ((x = SERI_RE.exec(d)) !== null) {
        const ifade = (/conceded/i.test(x[0]) ? "conceded " : "") + x[2].trim();
        if (!sonuc.seri[i].some(y => sade(y.ifade) === sade(ifade))) sonuc.seri[i].push({ ifade, n: +x[3] });
      }
      SERI_KG.lastIndex = 0;
      while ((x = SERI_KG.exec(d)) !== null)
        if (!sonuc.seri[i].some(y => /both teams/i.test(y.ifade))) sonuc.seri[i].push({ ifade: "both teams to score", n: +x[1] });
    }
  }

  /* form: "L D L D L - L L W L W" (tablonun ust kisminda) */
  const f = t.slice(0, kesim).match(/([WDL](?:\s?[WDL]){3,5})\s*-\s*([WDL](?:\s?[WDL]){3,5})/);
  if (f) sonuc.form = [f[1].replace(/\s/g, ""), f[2].replace(/\s/g, "")];
  return sonuc;
}
function h2hAfr(satirlar) {
  const anah = l => {
    l = l.toLowerCase();
    if (l.startsWith("total games")) return "N";
    if (l.includes("both teams to score twice")) return null;
    if (l.includes("both teams to score")) return "KG";
    if (l.includes("scored in first half")) return "IYG";
    if (l.includes("scored in second half")) return "IIYG";
    if (l.includes("win with more than 1")) return "F1";
    const m = l.match(/over\s+(\d\.\d)/);
    if (!m) return null;
    const x = { "0.5": "05", "1.5": "15", "2.5": "25", "3.5": "35" }[m[1]];
    if (!x) return null;
    if (l.includes("first half")) return { "05": "IY05", "15": "IY15" }[x] || null;
    if (l.includes("team goals scored")) return "A" + x;
    if (l.includes("team goals conceded")) return "Y" + x;
    return { "05": "O05", "15": "O15", "25": "O25", "35": "O35" }[x] || null;
  };
  const ev = {}, dep = {};
  for (const hucre of satirlar) {
    if (!hucre || hucre.length < 3) continue;
    const k = anah(hucre[0]);
    if (!k) continue;
    const kalan = hucre.slice(1);
    const sayi = kalan.filter(c => /^\d+$/.test(c)).map(Number);
    const yuzde = kalan.filter(c => /^\d{1,3}\s*%$/.test(c)).map(c => parseInt(c, 10));
    if (k === "N") { if (sayi.length >= 2) { ev.N = sayi[0]; dep.N = sayi[1] } continue }
    if (sayi.length < 2 || !ev.N || !dep.N || k in ev) continue;
    ev[k] = [yuzde.length > 1 ? yuzde[0] : Math.round(100 * sayi[0] / ev.N), sayi[0]];
    dep[k] = [yuzde.length > 1 ? yuzde[1] : Math.round(100 * sayi[1] / dep.N), sayi[1]];
  }
  return ("N" in ev && "O15" in ev) ? { ev, dep } : null;
}
function h2hOku(html, ham) {
  const anahtar = (bolum, etiket) => {
    const e = etiket.toLowerCase();
    if (e.includes("scored in first half")) return "IYG";
    if (e.includes("scored in second half")) return "IIYG";
    if (e.includes("both teams to score twice")) return "KG2";
    if (e.includes("both teams to score")) return "KG";
    if (e.includes("win with more than 1")) return "F1";
    if (e.includes("win with more than 2")) return "F2";
    const m = e.match(/over\s+(\d\.\d)/);
    if (!m) return null;
    const x = m[1].replace(".", "").replace(/^(\d)(\d)$/, "$1$2");   // "0.5" -> "05"
    if (bolum.includes("total goals over")) return { "05": "O05", "15": "O15", "25": "O25", "35": "O35" }[x] ?? null;
    if (bolum.includes("first half goals")) return { "05": "IY05", "15": "IY15" }[x] ?? null;
    if (bolum.includes("team goals scored")) return { "05": "A05", "15": "A15", "25": "A25" }[x] ?? null;
    if (bolum.includes("team goals conceded")) return { "05": "Y05", "15": "Y15", "25": "Y25" }[x] ?? null;
    return null;
  };
  const PCT = /^(\d{1,3})%\s*\|?\s*(\d+)$/;
  const ev = {}, dep = {}; let bolum = "";
  // satirlar: once <tr> yapisi, yoksa ham metnin satirlari
  let satirlar = html.split(/<tr[\s>]/i).slice(1).map(x => x.split(/<\/tr>/i)[0]
    .split(/<t[dh](?=[\s>])/i).slice(1).map(c => temizle(c.replace(/^[^>]*>/, "").split(/<\/t[dh]>/i)[0])).filter(Boolean));
  if (!satirlar.some(r => r.length > 2) && ham) {
    satirlar = ham.replace(/\*\*/g, "").split(/\r?\n/).map(ln => {
      const parcalar = ln.includes("|") ? ln.split("|") : ln.split(/\s{2,}|\t/);
      const h = parcalar.map(c => temizle(c)).filter(Boolean);
      const bir = [];
      for (let i = 0; i < h.length; i++) {
        if (/^\d{1,3}%$/.test(h[i]) && /^\d+$/.test(h[i + 1] || "")) { bir.push(h[i] + " | " + h[i + 1]); i++ }
        else bir.push(h[i]);
      }
      return bir;
    });
  }
  for (const hucre of satirlar) {
    if (!hucre.length) continue;
    const es = hucre.map(h => h.match(PCT));
    const etiketler = hucre.filter((h, i) => !es[i] && !/^\d+$/.test(h) && h !== "-");
    const sayilar = hucre.filter(h => /^\d+$/.test(h));
    if (!etiketler.length) continue;
    const etiket = etiketler[0];
    if (etiket.toLowerCase().includes("total games")) {
      if (sayilar.length >= 2) { ev.N = +sayilar[0]; dep.N = +sayilar[sayilar.length - 1] }
      continue;
    }
    const bulunan = es.filter(Boolean);
    if (!bulunan.length) { bolum = etiket.toLowerCase(); continue }
    if (bulunan.length < 2) continue;
    const k = anahtar(bolum, etiket);
    if (k && !(k in ev)) {
      const b = bulunan[0], s = bulunan[bulunan.length - 1];
      ev[k] = [+b[1], +b[2]]; dep[k] = [+s[1], +s[2]];
    }
  }
  let ek = {}; try { ek = h2hEkstra(html, ham) } catch { ek = {} }
  if (!("O15" in ev)) { const a = h2hAfr(satirlar); if (a) return { ...a, ...ek } }   // AFR tablosu farkli dizilir
  if ("N" in ev && "O15" in ev) return { ev, dep, ...ek };
  // tablo okunamadi ama sayfa geldi: form + son maclar + seriler yine de gosterilsin
  if (ek.maclar && (ek.maclar[0].length || ek.seri[0].length)) return { ev: {}, dep: {}, kismi: true, ...ek };
  return null;
}

function h2hJson(html) {
  try { return h2hOku(html, html) } catch { return null }
}

module.exports = { h2hJson, h2hOku };
