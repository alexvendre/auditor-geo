'use strict';
/**
 * Análisis de registros de acceso del servidor: qué rastreadores (de IA y de
 * buscadores) visitan la web de verdad, qué páginas, con qué respuesta, y si
 * son quien dicen ser.
 *
 * Es la única prueba directa de rastreo. Todo lo demás (robots.txt, simular un
 * user-agent) dice si un bot PODRÍA entrar; los registros dicen si ENTRA.
 *
 * Formatos admitidos (también comprimidos en .gz):
 *  - Combined / Common Log Format (Apache, Nginx, la mayoría de alojamientos)
 *  - JSON por línea, con nombres de campo habituales (ip/remote_addr/user_ip,
 *    user_agent/ua, request_url/path/uri, status, date/timestamp/time)
 *
 * Privacidad: las IP se usan solo para verificar bots y nunca aparecen en el informe.
 */

const fs = require('fs');
const zlib = require('zlib');
const dns = require('dns').promises;
const R = require('./robots');
const { pedir } = require('./http');

/** Agentes a contar: los de IA del catálogo más los buscadores clásicos como referencia. */
const AGENTES = [
  ...R.BOTS_IA.filter(b => b.tipo !== 'token').map(b => ({ token: b.token, tipo: b.tipo, empresa: b.empresa })),
  { token: 'Googlebot', tipo: 'buscador', empresa: 'Google' },
  { token: 'GoogleOther', tipo: 'buscador', empresa: 'Google' },
  { token: 'YandexBot', tipo: 'buscador', empresa: 'Yandex' },
  { token: 'DuckDuckBot', tipo: 'buscador', empresa: 'DuckDuckGo' }
];

/** Rangos de IP publicados por cada empresa (para distinguir el bot real del que lo suplanta). */
const RANGOS = {
  'GPTBot': 'https://openai.com/gptbot.json',
  'OAI-SearchBot': 'https://openai.com/searchbot.json',
  'ChatGPT-User': 'https://openai.com/chatgpt-user.json',
  'PerplexityBot': 'https://www.perplexity.ai/perplexitybot.json',
  'Perplexity-User': 'https://www.perplexity.ai/perplexity-user.json',
  'Googlebot': 'https://developers.google.com/static/search/apis/ipranges/googlebot.json',
  'Bingbot': 'https://www.bing.com/toolbox/bingbot.json'
};
/** Verificación por DNS inverso + directo, el método que documentan Google, Bing y Apple. */
const DNS = { 'Googlebot': /\.(googlebot|google)\.com$/, 'GoogleOther': /\.(googlebot|google)\.com$/, 'Bingbot': /\.search\.msn\.com$/, 'Applebot': /\.applebot\.apple\.com$/ };

const MESES = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const RE_COMBINED = /^(\S+) \S+ \S+ \[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})\] "(?:(\S+) (\S+)(?: \S+)?|[^"]*)" (\d{3}) (\S+)(?: "([^"]*)" "([^"]*)")?/;

function parsearLinea(linea) {
  const l = linea.trim();
  if (!l) return null;
  if (l[0] === '{') {
    let o;
    try { o = JSON.parse(l); } catch { return null; }
    const v = (...ks) => { for (const k of ks) if (o[k] != null && o[k] !== '') return o[k]; return null; };
    const url = v('request_url', 'request_path', 'url', 'path', 'uri', 'request_uri', 'request');
    let ruta = url ? String(url).replace(/^[A-Z]+ /, '').replace(/ HTTP\/[\d.]+$/, '') : null;
    try { if (ruta && /^https?:\/\//.test(ruta)) ruta = new URL(ruta).pathname + new URL(ruta).search; } catch { /* nada */ }
    const fechaBruta = v('date', 'timestamp', 'time', '@timestamp', 'datetime');
    const fecha = typeof fechaBruta === 'number' ? new Date(fechaBruta < 1e12 ? fechaBruta * 1000 : fechaBruta) : new Date(fechaBruta);
    return { ip: v('user_ip', 'ip', 'remote_addr', 'client_ip', 'remote_ip', 'clientip'), fecha: isNaN(fecha) ? null : fecha, metodo: v('request_type', 'method', 'request_method'), ruta, status: Number(v('status', 'status_code', 'response_code', 'code')) || null, ua: v('user_agent', 'ua', 'http_user_agent', 'useragent', 'agent') || '' };
  }
  const m = l.match(RE_COMBINED);
  if (!m) return null;
  const [, ip, d, mes, a, h, mi, s, tz, metodo, ruta, status, , , ua] = m;
  const off = (tz[0] === '-' ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3)));
  const fecha = new Date(Date.UTC(+a, MESES[mes], +d, +h, +mi, +s) - off * 60000);
  return { ip, fecha, metodo: metodo || null, ruta: ruta || null, status: Number(status), ua: ua || '' };
}

function leerArchivo(ruta) {
  const buf = fs.readFileSync(ruta);
  const texto = (ruta.endsWith('.gz') || (buf[0] === 0x1f && buf[1] === 0x8b)) ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  // Algunas exportaciones son un único array JSON en vez de una línea por registro
  const t = texto.trimStart();
  if (t[0] === '[') { try { return JSON.parse(t).map(o => JSON.stringify(o)); } catch { /* sigue como texto */ } }
  return texto.split(/\r?\n/);
}

const agenteDe = (ua) => {
  const u = (ua || '').toLowerCase();
  // El token más largo primero: «Claude-SearchBot» antes que «ClaudeBot», «GoogleOther» antes que «Googlebot»
  return [...AGENTES].sort((a, b) => b.token.length - a.token.length).find(x => u.includes(x.token.toLowerCase())) || null;
};

/* ── Verificación de IP ── */
function ipANumero(ip) {
  if (ip.includes(':')) return null; // IPv6: se verifica por DNS o se deja sin verificar
  const p = ip.split('.').map(Number);
  return p.length === 4 && p.every(x => x >= 0 && x <= 255) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null;
}
function enRango(ip, cidr) {
  const [base, bits] = cidr.split('/');
  const a = ipANumero(ip), b = ipANumero(base);
  if (a == null || b == null) return false;
  const n = Number(bits);
  const mascara = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
  return ((a & mascara) >>> 0) === ((b & mascara) >>> 0);
}
async function cargarRangos(tokens) {
  const out = {};
  for (const t of tokens) {
    if (!RANGOS[t]) continue;
    const r = await pedir(RANGOS[t], { timeoutMs: 15000 });
    if (r.status !== 200) continue;
    try {
      const d = JSON.parse(r.body);
      out[t] = (d.prefixes || []).map(p => p.ipv4Prefix).filter(Boolean);
    } catch { /* nada */ }
  }
  return out;
}
async function verificarDNS(ip, re) {
  try {
    const nombres = await dns.reverse(ip);
    const nombre = nombres.find(n => re.test(n));
    if (!nombre) return false;
    const directas = await dns.resolve(nombre);
    return directas.includes(ip);
  } catch { return null; }
}

/**
 * @param {string[]} archivos rutas de registros
 * @param {object} op { verificar: bool, sitemap: [url], dominio, ahora }
 */
async function analizarLogs(archivos, op = {}) {
  const hallazgos = [];
  const h = (id, severidad, detalle = '') => hallazgos.push({ id, severidad, detalle, url: 'Registros del servidor' });
  const porBot = new Map();
  let lineas = 0, validas = 0, desde = null, hasta = null, conIP = 0;
  const otros = new Map();

  for (const a of archivos) {
    for (const linea of leerArchivo(a)) {
      if (!linea.trim()) continue;
      lineas++;
      const r = parsearLinea(linea);
      if (!r) continue;
      validas++;
      if (r.ip) conIP++;
      if (r.fecha) { if (!desde || r.fecha < desde) desde = r.fecha; if (!hasta || r.fecha > hasta) hasta = r.fecha; }
      const ag = agenteDe(r.ua);
      if (!ag) {
        const m = /([A-Za-z][\w.-]*(?:bot|crawler|spider|scraper|fetcher))[\/ ;]/i.exec(r.ua + ' ');
        if (m) otros.set(m[1], (otros.get(m[1]) || 0) + 1);
        continue;
      }
      if (!porBot.has(ag.token)) porBot.set(ag.token, { ...ag, visitas: 0, rutas: new Map(), estados: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }, codigos: {}, ips: new Map(), primera: null, ultima: null });
      const b = porBot.get(ag.token);
      b.visitas++;
      if (r.ruta) { const k = r.ruta.split('#')[0]; b.rutas.set(k, (b.rutas.get(k) || 0) + 1); }
      if (r.status) { b.estados[`${String(r.status)[0]}xx`] = (b.estados[`${String(r.status)[0]}xx`] || 0) + 1; b.codigos[r.status] = (b.codigos[r.status] || 0) + 1; }
      if (r.ip) b.ips.set(r.ip, (b.ips.get(r.ip) || 0) + 1);
      if (r.fecha) { if (!b.primera || r.fecha < b.primera) b.primera = r.fecha; if (!b.ultima || r.fecha > b.ultima) b.ultima = r.fecha; }
    }
  }
  if (!validas) throw new Error('No se ha reconocido ninguna línea. Formatos admitidos: Combined Log Format o JSON por línea.');

  // Verificación: ¿las visitas vienen de las IP de la empresa?
  if (op.verificar) {
    const rangos = await cargarRangos([...porBot.keys()]);
    for (const b of porBot.values()) {
      b.verificadas = 0; b.falsas = 0; b.sinVerificar = 0;
      const ipsUnicas = [...b.ips.keys()].slice(0, 200);
      for (const ip of ipsUnicas) {
        const n = b.ips.get(ip);
        let ok = null;
        if (rangos[b.token] && rangos[b.token].length) ok = rangos[b.token].some(c => enRango(ip, c));
        else if (DNS[b.token]) ok = await verificarDNS(ip, DNS[b.token]);
        if (ok === true) b.verificadas += n; else if (ok === false) b.falsas += n; else b.sinVerificar += n;
      }
    }
  }

  const dias = desde && hasta ? Math.max(1, Math.round((hasta - desde) / 864e5)) : null;
  const bots = [...porBot.values()].sort((a, b) => b.visitas - a.visitas).map(b => ({
    token: b.token, tipo: b.tipo, empresa: b.empresa, visitas: b.visitas, paginas: b.rutas.size, estados: b.estados, codigos: b.codigos,
    primera: b.primera && b.primera.toISOString(), ultima: b.ultima && b.ultima.toISOString(),
    top: [...b.rutas.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([ruta, n]) => ({ ruta, n })),
    verificadas: b.verificadas ?? null, falsas: b.falsas ?? null, sinVerificar: b.sinVerificar ?? null, rutas: b.rutas
  }));

  // Hallazgos
  const ia = bots.filter(b => ['busqueda', 'usuario', 'entrenamiento'].includes(b.tipo) && b.empresa !== 'Microsoft' && b.empresa !== 'Apple');
  const busquedaIA = bots.filter(b => b.tipo === 'busqueda' || b.tipo === 'usuario');
  const periodo = dias ? `${dias} días (${desde.toISOString().slice(0, 10)} a ${hasta.toISOString().slice(0, 10)})` : 'periodo desconocido';
  if (!ia.length) h('logs-sin-bots-ia', dias && dias >= 7 ? 'medio' : 'info', `Ninguna visita de rastreadores de IA en ${periodo}, sobre ${validas} peticiones.`);
  else h('logs-bots-ia', 'ok', ia.map(b => `${b.token}: ${b.visitas} visitas a ${b.paginas} páginas`).join(' · ') + ` (${periodo})`);

  for (const b of bots) {
    const errores = (b.estados['4xx'] || 0) + (b.estados['5xx'] || 0);
    const reales = b.falsas != null ? b.visitas - b.falsas : b.visitas;
    if (reales >= 5 && errores / b.visitas >= 0.1) {
      const cods = Object.entries(b.codigos).filter(([c]) => c >= 400).map(([c, n]) => `${c}×${n}`).join(', ');
      h('logs-bot-errores', ['busqueda', 'usuario', 'buscador'].includes(b.tipo) ? 'alto' : 'medio', `${b.token}: ${Math.round(errores / b.visitas * 100)} % de respuestas con error (${cods})${b.falsas ? ` — ojo: ${b.falsas} de sus visitas vienen de IP que no son de ${b.empresa}` : ''}`);
    }
    if (b.falsas && b.falsas / b.visitas > 0.2) h('logs-suplantacion', 'info', `${b.token}: ${b.falsas} de ${b.visitas} visitas desde IP que no pertenecen a ${b.empresa}. Son otros que se hacen pasar por él.`);
  }

  // Páginas del sitemap que ningún bot de búsqueda (IA o Google/Bing) ha visitado
  if (op.sitemap && op.sitemap.length) {
    const visitadas = new Set();
    bots.filter(b => ['busqueda', 'usuario', 'buscador'].includes(b.tipo)).forEach(b => b.rutas.forEach((_, r) => visitadas.add(r.replace(/\/+$/, '') || '/')));
    const sinVisitar = op.sitemap.map(u => { try { return new URL(u).pathname.replace(/\/+$/, '') || '/'; } catch { return null; } }).filter(r => r && !visitadas.has(r));
    // Con menos de una semana de registros, que una página no tenga visitas no dice nada:
    // los bots no pasan por todas las páginas cada día. Se informa, pero no se marca como problema.
    const corta = !dias || dias < 7;
    if (sinVisitar.length) h('logs-paginas-sin-visitar', corta ? 'info' : sinVisitar.length / op.sitemap.length > 0.5 ? 'medio' : 'bajo', `${sinVisitar.length} de ${op.sitemap.length} URLs del sitemap sin ninguna visita de bots de búsqueda en ${dias || '<1'} día(s)${corta ? ' (muestra demasiado corta para sacar conclusiones: usa al menos 7 días)' : ''}: ${sinVisitar.slice(0, 6).join(', ')}${sinVisitar.length > 6 ? '…' : ''}`);
    else h('logs-sitemap-cubierto', 'ok', `Las ${op.sitemap.length} URLs del sitemap han recibido visitas de bots de búsqueda`);
  }
  if (!busquedaIA.length && bots.some(b => b.tipo === 'entrenamiento')) h('logs-solo-entrenamiento', 'info', 'Solo llegan bots de entrenamiento; ninguno de búsqueda ni de petición de usuario.');

  bots.forEach(b => delete b.rutas);
  return { hallazgos, datos: { archivos: archivos.length, lineas, validas, desde: desde && desde.toISOString(), hasta: hasta && hasta.toISOString(), dias, bots, otros: [...otros.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([nombre, visitas]) => ({ nombre, visitas })), verificado: !!op.verificar && conIP > 0, conIP: conIP > 0 } };
}

module.exports = { analizarLogs, parsearLinea, agenteDe, enRango, AGENTES };
