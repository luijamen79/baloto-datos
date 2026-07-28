#!/usr/bin/env node
/**
 * ══════════════════════════════════════════════════════════════
 *  BALOTO QUANTUM — Scraper automático v2
 *  Corre en GitHub Actions, NO en el navegador. Sin CORS.
 *
 *  POR QUÉ CAMBIÓ FRENTE A v1:
 *  v1 usaba un regex distinto por sitio. En julio de 2026
 *  resultadodelaloteria.com rediseñó su tabla:
 *      antes → | 2661 | 25/05/2026 | **12-14-37-38-39-16** |
 *      ahora → | 2687 | [25 de julio de 2026](url) | **06 - 08 - ...** 09 |
 *  y el patrón dejó de coincidir EN SILENCIO durante 47 días.
 *
 *  v2 usa un PARSER UNIVERSAL: localiza fechas, extrae enteros de
 *  1-2 dígitos delimitados y elige la ventana de 6 más COMPACTA que
 *  forme una combinación válida. Sobrevive a rediseños porque no
 *  depende del marcado, solo de la cercanía entre fecha y números.
 *  El mismo algoritmo corre dentro de la app.
 * ══════════════════════════════════════════════════════════════
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'baloto.json';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const MESES = {
  enero:'01', febrero:'02', marzo:'03', abril:'04', mayo:'05', junio:'06',
  julio:'07', agosto:'08', septiembre:'09', setiembre:'09', octubre:'10',
  noviembre:'11', diciembre:'12'
};
const nrm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

async function get(url, ms = 25000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'es-CO,es;q=0.9' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

// ── PARSER UNIVERSAL (idéntico al que corre en la app) ─────────────
function parseUniversal(txt) {
  const anclas = [];
  const add = (iso, end) => { if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) anclas.push({ iso, end }); };

  for (const m of txt.matchAll(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/g))
    add(`${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`, m.index + m[0].length);
  for (const m of txt.matchAll(/(\d{4})-(\d{2})-(\d{2})/g))
    add(`${m[1]}-${m[2]}-${m[3]}`, m.index + m[0].length);
  for (const m of txt.matchAll(/(\d{1,2})\s+de\s+([a-zA-ZáéíóúÁÉÍÓÚ]+)\s+de\s+(\d{4})/gi)) {
    const mm = MESES[nrm(m[2])]; if (!mm) continue;
    add(`${m[3]}-${mm}-${String(m[1]).padStart(2,'0')}`, m.index + m[0].length);
  }
  if (!anclas.length) return [];
  anclas.sort((a, b) => a.end - b.end);

  const ok = (b, sb) => b.length === 5 && new Set(b).size === 5 &&
    b.every(n => n >= 1 && n <= 43) && sb >= 1 && sb <= 16;

  const res = [];
  for (let i = 0; i < anclas.length; i++) {
    const ini = anclas[i].end;
    const fin = i + 1 < anclas.length ? anclas[i + 1].end - 10 : Math.min(txt.length, ini + 400);
    const seg = txt.slice(ini, Math.max(ini, fin));

    const tok = [];
    for (const m of seg.matchAll(/\b(\d{1,2})\b/g)) tok.push({ v: +m[1], pos: m.index, len: m[0].length });
    if (tok.length < 6) continue;

    let mejor = null;
    for (let k = 0; k + 6 <= tok.length; k++) {
      const w = tok.slice(k, k + 6);
      const b = w.slice(0, 5).map(t => t.v).sort((p, q) => p - q);
      if (!ok(b, w[5].v)) continue;
      let sep = 0;
      for (let j = 1; j < 6; j++) sep = Math.max(sep, w[j].pos - (w[j-1].pos + w[j-1].len));
      if (sep > 25) continue;
      if (!mejor || sep < mejor.sep) mejor = { b, sb: w[5].v, sep };
    }
    if (mejor) res.push({ fecha: anclas[i].iso, balotas: mejor.b, sb: mejor.sb });
  }

  const vistos = new Set(), fin2 = [];
  for (const r of res) {
    const y = +r.fecha.slice(0, 4);
    if (y < 2017 || y > 2100) continue;
    if (vistos.has(r.fecha)) continue;
    vistos.add(r.fecha); fin2.push(r);
  }
  return fin2;
}

const FUENTES = [
  ['resultadodelaloteria', 'https://resultadodelaloteria.com/colombia/baloto'],
  ['elespectador',         'https://www.elespectador.com/resultados-loterias/baloto/'],
  ['resultadobaloto',      'https://www.resultadobaloto.com/index.php'],
  ['balotoresultados',     'https://www.balotoresultados.co/historico']
];

// ── MAIN ───────────────────────────────────────────────────────────
const map = new Map();
const informe = [];

for (const [nombre, url] of FUENTES) {
  try {
    const html = await get(url);
    const filas = parseUniversal(html);
    let n = 0;
    for (const f of filas) {
      const prev = map.get(f.fecha) || { fecha: f.fecha, fuentes: [] };
      prev.balotas = f.balotas; prev.sb = f.sb;
      if (!prev.fuentes.includes(nombre)) prev.fuentes.push(nombre);
      map.set(f.fecha, prev); n++;
    }
    informe.push(`  ${n ? '\u2713' : '\u00b7'} ${nombre}: ${n} registros`);
  } catch (e) {
    informe.push(`  \u2717 ${nombre}: ${e.message}`);
  }
}

// Revancha del último sorteo (solo la portada de resultadodelaloteria la trae)
try {
  const html = await get(FUENTES[0][1]);
  const i = html.search(/Revancha/i);
  if (i > 0) {
    const seg = html.slice(i, i + 300);
    const tok = [...seg.matchAll(/\b(\d{1,2})\b/g)].map(m => +m[1]);
    for (let k = 0; k + 6 <= tok.length; k++) {
      const b = tok.slice(k, k + 5).sort((x, y) => x - y), sb = tok[k + 5];
      if (b.length === 5 && new Set(b).size === 5 && b.every(n => n >= 1 && n <= 43) && sb >= 1 && sb <= 16) {
        const ult = [...map.keys()].sort().pop();
        const e = map.get(ult);
        if (e) { e.revancha = b; e.rsb = sb; }
        break;
      }
    }
  }
} catch { /* opcional */ }

console.log('Fuentes consultadas:');
console.log(informe.join('\n'));

const nuevos = [...map.values()]
  .filter(e => Array.isArray(e.balotas) && e.balotas.length === 5)
  .sort((a, b) => b.fecha.localeCompare(a.fecha));

if (!nuevos.length) {
  console.error('\nERROR: ninguna fuente devolvio datos validos. Revisa si cambiaron de dominio.');
  process.exit(1);
}

let previo = { sorteos: [] };
if (existsSync(OUT)) { try { previo = JSON.parse(readFileSync(OUT, 'utf8')); } catch {} }
const acum = new Map((previo.sorteos || []).map(s => [s.fecha, s]));
let agregados = 0, enriquecidos = 0;
for (const s of nuevos) {
  const old = acum.get(s.fecha);
  if (!old) { acum.set(s.fecha, s); agregados++; }
  else if (!old.revancha && s.revancha) { acum.set(s.fecha, { ...old, ...s }); enriquecidos++; }
}

const lista = [...acum.values()].sort((a, b) => b.fecha.localeCompare(a.fecha));
writeFileSync(OUT, JSON.stringify({
  meta: {
    actualizado: new Date().toISOString(),
    total: lista.length,
    ultimo: lista[0]?.fecha || null,
    generador: 'GitHub Actions · scraper v2 (parser universal)'
  },
  sorteos: lista
}, null, 1));

console.log(`\nTotal acumulado : ${lista.length}`);
console.log(`Nuevos agregados: ${agregados}`);
console.log(`Enriquecidos    : ${enriquecidos}`);
console.log(`Ultimo sorteo   : ${lista[0]?.fecha} -> [${lista[0]?.balotas}] SB:${lista[0]?.sb}`);

// Alarma: si el sorteo más reciente tiene más de 5 días, algo se rompió.
// Falla en ROJO en vez de quedarse callado como pasó en junio-julio.
const dias = Math.floor((Date.now() - new Date(lista[0].fecha + 'T12:00:00')) / 86400000);
if (dias > 5) {
  console.error(`\nAVISO: el sorteo mas reciente tiene ${dias} dias.`);
  console.error('Puede que las fuentes hayan cambiado de formato o de dominio.');
  process.exit(1);
}
