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

// ── Limpieza de HTML ───────────────────────────────────────────────
// FIX: el parser se probó con texto ya convertido a markdown, pero el
// scraper descarga HTML CRUDO. Las etiquetas separaban los números y
// rompían la prueba de compacidad. Además metían ruido de menús y
// paginaciones. Se elimina script/style/nav/footer y todas las etiquetas.
function limpiarHtml(html) {
  return html
    .replace(/<(script|style|nav|footer|header|aside|select|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/[ \t]+/g, ' ');
}

// ── Validación de sorteo real ──────────────────────────────────────
// El Baloto SOLO juega lunes, miércoles y sábado. Cualquier otra fecha
// es ruido (fecha de publicación, "actualizado el...", etc.).
function esDiaDeSorteo(iso) {
  const d = new Date(iso + 'T12:00:00').getDay();   // 0=DOM 1=LUN ... 6=SAB
  return d === 1 || d === 3 || d === 6;
}

// Rechaza combinaciones que son claramente artefactos de maquetación:
// 1-2-3-4-5 con superbalota 6 es una paginación, no un sorteo.
function esSecuenciaFalsa(b, sb) {
  let consec = true;
  for (let i = 1; i < b.length; i++) if (b[i] !== b[i-1] + 1) { consec = false; break; }
  return consec && (sb === b[4] + 1 || sb === b[0] - 1 || b[0] === 1);
}

function sorteoValido(iso, b, sb) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const y = +iso.slice(0, 4);
  if (y < 2017 || y > 2100) return false;
  if (new Date(iso + 'T12:00:00') > new Date()) return false;   // no futuras
  if (!esDiaDeSorteo(iso)) return false;
  if (b.length !== 5 || new Set(b).size !== 5) return false;
  if (!b.every(n => n >= 1 && n <= 43)) return false;
  if (!(sb >= 1 && sb <= 16)) return false;
  if (esSecuenciaFalsa(b, sb)) return false;
  return true;
}

// ── PARSER UNIVERSAL (idéntico al que corre en la app) ─────────────
function parseUniversal(htmlCrudo) {
  const txt = limpiarHtml(htmlCrudo);
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
    if (!sorteoValido(r.fecha, r.balotas, r.sb)) continue;
    if (vistos.has(r.fecha)) continue;
    vistos.add(r.fecha); fin2.push(r);
  }
  return fin2;
}

// ── Pozo acumulado ─────────────────────────────────────────────────
// No es deducible de los sorteos: lo publica la lotería en cada web.
//
// FALLO DE LA VERSIÓN ANTERIOR: buscaba un número cerca de la palabra
// "baloto" y capturó el AÑO. Tras limpiar etiquetas, un texto como
// "...de julio de 2026" quedaba pegado a la palabra "millones" de otro
// elemento, y 2026 pasaba el filtro porque un pozo de 2.026 millones es
// perfectamente plausible. El año se disfrazaba de cifra válida.
//
// AHORA exige pruebas fuertes y, ante la duda, devuelve null.
// Es preferible no mostrar pozo a mostrarlo mal.
function extraerPozo(htmlCrudo) {
  const t = limpiarHtml(htmlCrudo);
  const out = { baloto: null, revancha: null };

  // Un número con pinta de año (4 dígitos entre 1990 y 2100 y sin
  // separador de miles) nunca es un pozo. "54.400" sí lo es; "2026" no.
  const pareceAnio = crudo => /^\d{4}$/.test(crudo) && +crudo >= 1990 && +crudo <= 2100;

  const aMillones = (crudo, unidad) => {
    const v = parseFloat(crudo.replace(/\./g, '').replace(',', '.'));
    if (!isFinite(v)) return null;
    if (/mil\s*mill/i.test(unidad)) return v * 1000;
    if (/mill/i.test(unidad))       return v;
    if (v > 1e9)                    return v / 1e6;   // escrito en pesos
    return null;
  };

  // Se ancla en palabras de premio, no en "baloto"/"revancha" sueltas,
  // y exige el símbolo $ o una palabra de acumulado a menos de 40 caracteres.
  const RX = /(acumulad\w*|pozo|premio|bolsa|jackpot|baloto|revancha)[^.]{0,40}?\$\s*([\d.,]+)\s*(mil\s*millones|millones|mill\.?)/gi;
  const RX2 = /\$\s*([\d.,]+)\s*(mil\s*millones|millones)[^.]{0,40}?(acumulad\w*|pozo|premio)/gi;

  const hallazgos = [];
  for (const rx of [RX, RX2]) {
    for (const m of t.matchAll(rx)) {
      const crudo  = rx === RX ? m[2] : m[1];
      const unidad = rx === RX ? m[3] : m[2];
      if (pareceAnio(crudo)) continue;
      const v = aMillones(crudo, unidad);
      // Rango real del Baloto: mínimo ~2.000M, histórico máximo ~200.000M
      if (v === null || v < 1500 || v > 400000) continue;
      hallazgos.push({ v, pos: m.index, fin: m.index + m[0].length });
    }
  }
  if (!hallazgos.length) return out;

  // Asigna cada cifra a Baloto o Revancha según qué palabra esté más cerca.
  // Solo hacia ATRÁS: en "Baloto llega a $54.400 millones y la Revancha
  // a $9.200" mirar hacia adelante hacía que el pozo del Baloto viera la
  // palabra "Revancha" posterior y se la adjudicara.
  // Ventana: 220 caracteres previos MÁS el propio texto capturado.
  // En "acumulado de Baloto llega a $54.400 millones" la palabra "Baloto"
  // está DENTRO de la coincidencia, no antes. Pero no se mira más allá del
  // final: si no, el pozo del Baloto vería una "Revancha" posterior.
  const cerca = (h, palabra) => {
    const ini = Math.max(0, h.pos - 220);
    const ctx = t.slice(ini, h.fin).toLowerCase();
    const i = ctx.lastIndexOf(palabra);
    return i === -1 ? 1e9 : Math.abs(h.pos - (ini + i));
  };
  for (const h of hallazgos) {
    const dR = cerca(h, 'revancha');
    const dB = cerca(h, 'baloto');
    if (dR < dB && dR < 220) { if (!out.revancha) out.revancha = Math.round(h.v); }
    else if (dB < 220)       { if (!out.baloto)   out.baloto   = Math.round(h.v); }
  }
  // El pozo de la Revancha siempre es menor que el del Baloto.
  if (out.baloto && out.revancha && out.revancha > out.baloto) {
    [out.baloto, out.revancha] = [out.revancha, out.baloto];
  }
  return out;
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
const pozo = { baloto: null, revancha: null };

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
    if (!pozo.baloto || !pozo.revancha) {
      const p = extraerPozo(html);
      if (!pozo.baloto && p.baloto) pozo.baloto = p.baloto;
      if (!pozo.revancha && p.revancha) pozo.revancha = p.revancha;
    }
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
      if (b.length === 5 && new Set(b).size === 5 && b.every(n => n >= 1 && n <= 43) && sb >= 1 && sb <= 16 && !esSecuenciaFalsa(b, sb)) {
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

// Purga: elimina registros inválidos que se hayan colado en ejecuciones
// anteriores (p. ej. el falso 2026-07-28 [1,2,3,4,5] SB:6 de un martes).
const antes = (previo.sorteos || []).length;
const limpios = (previo.sorteos || []).filter(s => sorteoValido(s.fecha, s.balotas, s.sb));
const purgados = antes - limpios.length;
if (purgados) console.log(`Purgados ${purgados} registro(s) invalido(s) del historico.`);

const acum = new Map(limpios.map(s => [s.fecha, s]));
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
    generador: 'GitHub Actions · scraper v3 (parser universal + pozo)',
    pozoBaloto: pozo.baloto,
    pozoRevancha: pozo.revancha
  },
  sorteos: lista
}, null, 1));

console.log(`\nTotal acumulado : ${lista.length}`);
console.log(`Nuevos agregados: ${agregados}`);
console.log(`Enriquecidos    : ${enriquecidos}`);
console.log(`Ultimo sorteo   : ${lista[0]?.fecha} -> [${lista[0]?.balotas}] SB:${lista[0]?.sb}`);
console.log(`Pozo Baloto     : ${pozo.baloto ? pozo.baloto.toLocaleString('es') + ' millones' : 'no detectado'}`);
console.log(`Pozo Revancha   : ${pozo.revancha ? pozo.revancha.toLocaleString('es') + ' millones' : 'no detectado'}`);

// Alarma: si el sorteo más reciente tiene más de 5 días, algo se rompió.
// Falla en ROJO en vez de quedarse callado como pasó en junio-julio.
const dias = Math.floor((Date.now() - new Date(lista[0].fecha + 'T12:00:00')) / 86400000);
if (dias > 5) {
  console.error(`\nAVISO: el sorteo mas reciente tiene ${dias} dias.`);
  console.error('Puede que las fuentes hayan cambiado de formato o de dominio.');
  process.exit(1);
}
