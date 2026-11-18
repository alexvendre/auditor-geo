'use strict';
/**
 * Comprobaciones de sitio: se hacen una vez por dominio, no por página.
 * robots.txt, política para rastreadores de IA, acceso real de los bots,
 * llms.txt, sitemaps, consolidación de http/https y www, soft 404 y PageSpeed.
 */

const { pedir, enParalelo, UA_NAVEGADOR } = require('../http');
const R = require('../robots');

const RE_DESAFIO = /cf-chl|challenge-platform|just a moment\.\.\.|attention required|captcha|access denied|ddos protection/i;

async function robots(origen, h) {
  const res = await pedir(origen + '/robots.txt', { ua: UA_NAVEGADOR });
  const out = { res, parsed: R.parsear(''), existe: false };
  if (res.status >= 500 || res.status === 0) {
    h('robots-error-servidor', 'critico', `/robots.txt responde ${res.status}${res.error ? ' (' + res.error + ')' : ''}`);
    return out;
  }
  if (res.status !== 200 || /<html/i.test(res.body.slice(0, 500))) {
    h('robots-falta', 'bajo', `/robots.txt responde ${res.status}${res.status === 200 ? ' pero devuelve HTML' : ''}`);
    return out;
  }
  out.existe = true;
  out.parsed = R.parsear(res.body);
  const p = out.parsed;
  const todo = R.permitido(p, 'Googlebot', '/');
  const comodin = R.permitido(p, '*', '/');
  if (!comodin.permitido) h('robots-bloqueo-global', 'critico', `Regla: ${comodin.regla.tipo}: ${comodin.regla.ruta}`);
  else if (!todo.permitido) h('robots-bloqueo-global', 'critico', `Googlebot bloqueado: ${todo.regla.tipo}: ${todo.regla.ruta}`);
  if (p.errores.length) h('robots-sintaxis', 'bajo', p.errores.slice(0, 4).map(e => `línea ${e.linea}: «${e.texto}»`).join(' · '));
  if (!p.sitemaps.length) h('robots-sin-sitemap', 'bajo');
  if (comodin.permitido && todo.permitido && !p.errores.length && p.sitemaps.length) h('robots-ok', 'ok', `${p.grupos.length} grupo(s), ${p.sitemaps.length} sitemap(s) declarado(s)`);
  return out;
}

/** Qué dice robots.txt de cada bot de IA, en la portada y en las rutas de muestra. */
function politicaIA(rob, rutas, h) {
  const p = rob.parsed;
  const resultado = [];
  for (const bot of R.BOTS_IA) {
    const bloqueadas = rutas.filter(r => !R.permitido(p, bot.token, r).permitido);
    const raiz = R.permitido(p, bot.token, '/');
    resultado.push({ ...bot, permitido: raiz.permitido, especifico: raiz.especifico, bloqueadas, regla: raiz.regla });
  }
  const porTipo = (tipos) => resultado.filter(b => tipos.includes(b.tipo) && (!b.permitido || b.bloqueadas.length));
  const describe = (lista) => lista.map(b => `${b.token} (${b.producto})${b.permitido ? ` — bloqueado en ${b.bloqueadas.length} ruta(s) de muestra` : ''}`).join(' · ');

  const busqueda = porTipo(['busqueda']);
  const usuario = porTipo(['usuario']);
  const entreno = porTipo(['entrenamiento', 'token']);
  if (busqueda.length) h('ia-robots-busqueda-bloqueado', busqueda.some(b => !b.permitido) ? 'alto' : 'medio', describe(busqueda));
  if (usuario.length) h('ia-robots-usuario-bloqueado', 'medio', describe(usuario));
  if (entreno.length) h('ia-robots-entrenamiento-bloqueado', 'info', describe(entreno));
  if (!busqueda.length && !usuario.length) h('ia-robots-ok', 'ok', `${resultado.length} agentes revisados` + (entreno.length ? ` (bloqueas ${entreno.length} de entrenamiento, que es una decisión aparte)` : ''));

  for (const s of p.senales) {
    const no = /\b(search|ai-input)\s*=\s*no\b/i.test(s);
    h('ia-content-signal', no ? 'alto' : 'info', `Content-Signal: ${s}`);
  }
  return resultado;
}

/**
 * Acceso real: pide la portada con el user-agent de cada bot y lo compara con
 * Googlebot y con un navegador. Es la comprobación que distingue un bloqueo real
 * de la verificación de IP del alojamiento.
 */
async function accesoBots(url, politica, h) {
  const nav = await pedir(url, { ua: UA_NAVEGADOR });
  const google = await pedir(url, { ua: R.GOOGLEBOT, usarCache: false });
  const bots = R.BOTS_IA.filter(b => b.ua && politica.find(p => p.token === b.token)?.permitido);
  const pruebas = await enParalelo(bots, 4, async (b) => {
    const r = await pedir(url, { ua: b.ua, usarCache: false });
    const desafio = r.status === 200 && RE_DESAFIO.test(r.body.slice(0, 5000)) && !RE_DESAFIO.test(nav.body.slice(0, 5000));
    return { bot: b, status: r.status, bloqueado: [401, 403, 406, 429, 451, 503].includes(r.status) || r.status === 0 || desafio, desafio };
  });
  const resumen = pruebas.map(p => `${p.bot.token}:${p.status}${p.desafio ? '(desafío)' : ''}`).join('  ');
  const bloqueados = pruebas.filter(p => p.bloqueado);
  const googlePasa = google.status === 200 && !(RE_DESAFIO.test(google.body.slice(0, 5000)) && !RE_DESAFIO.test(nav.body.slice(0, 5000)));
  const cloudflare = /cloudflare/i.test(nav.headers.get('server') || '') || !!nav.headers.get('cf-ray');

  if (!bloqueados.length) { h('ia-acceso-ok', 'ok', resumen); return { pruebas, google: google.status, cloudflare }; }

  if (!googlePasa) {
    h('ia-acceso-falso-positivo', 'ok', `Bots de IA: ${resumen} · Googlebot simulado: ${google.status} · Navegador: ${nav.status}. ` +
      'El servidor rechaza a cualquiera que diga ser un bot desde una IP que no le corresponde.');
    return { pruebas, google: google.status, cloudflare };
  }

  const importantes = bloqueados.filter(p => ['busqueda', 'usuario'].includes(p.bot.tipo));
  const sev = importantes.some(p => p.bot.tipo === 'busqueda') ? 'alto' : importantes.length ? 'medio' : 'info';
  const detalle = `Bloqueados: ${bloqueados.map(p => `${p.bot.token} ${p.status}${p.desafio ? ' (página de desafío)' : ''}`).join(', ')} · Googlebot simulado: ${google.status}. ` +
    'Nota: la prueba se hace desde la IP del auditor; un bloqueo por user-agent es casi seguro, uno por IP no se puede descartar ni confirmar desde fuera.';
  h(cloudflare ? 'ia-acceso-cloudflare' : 'ia-acceso-bloqueado', sev, detalle);
  return { pruebas, google: google.status, cloudflare };
}

async function llms(origen, h) {
  const r = await pedir(origen + '/llms.txt', { ua: UA_NAVEGADOR });
  const esHTML = /<html|<!doctype/i.test(r.body.slice(0, 300));
  if (r.status !== 200 || esHTML || r.body.trim().length < 20) { h('llms-falta', 'info', r.status === 200 && esHTML ? 'La URL responde 200 pero con una página HTML (posible soft 404).' : ''); return null; }
  const lineas = r.body.replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const problemas = [];
  if (!/^#\s+\S/.test(lineas[0] || '')) problemas.push('no empieza con un título «# Nombre»');
  if (!lineas.some(l => l.startsWith('>'))) problemas.push('sin resumen en cita (> …)');
  const enlaces = (r.body.match(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g) || []).length;
  if (!enlaces) problemas.push('sin enlaces en formato Markdown');
  if (problemas.length) h('llms-formato', 'bajo', problemas.join(' · '));
  else h('llms-ok', 'ok', `${enlaces} enlaces, ${Math.round(r.body.length / 1024 * 10) / 10} KB`);
  return { enlaces };
}

/** Localiza y lee los sitemaps (índices incluidos). Devuelve [{loc, lastmod}] */
async function sitemaps(origen, declarados, h) {
  const candidatos = [...new Set([...declarados, origen + '/sitemap.xml', origen + '/sitemap_index.xml', origen + '/wp-sitemap.xml'])];
  const visitados = new Set();
  const urls = new Map();
  const leidos = [];
  const cola = [];

  for (const c of candidatos) {
    const r = await pedir(c, { ua: UA_NAVEGADOR });
    if (r.status === 200 && /<(urlset|sitemapindex)\b/i.test(r.body)) { cola.push(r); break; }
    if (declarados.includes(c) && r.status !== 200) h('sitemap-url-error', 'medio', `El sitemap declarado en robots.txt ${c} responde ${r.status}`);
  }
  while (cola.length && visitados.size < 60) {
    const r = cola.shift();
    if (visitados.has(r.finalUrl)) continue;
    visitados.add(r.finalUrl);
    leidos.push(r.finalUrl);
    if (/<sitemapindex\b/i.test(r.body)) {
      const hijos = [...r.body.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1].replace(/&amp;/g, '&'));
      const resp = await enParalelo(hijos.filter(u => !visitados.has(u)).slice(0, 60), 4, u => pedir(u, { ua: UA_NAVEGADOR }));
      resp.filter(x => x.status === 200 && /<urlset\b/i.test(x.body)).forEach(x => cola.push(x));
    } else {
      for (const m of r.body.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
        const loc = (m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/i) || [])[1];
        if (!loc) continue;
        const lastmod = (m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i) || [])[1] || null;
        urls.set(loc.replace(/&amp;/g, '&'), { loc: loc.replace(/&amp;/g, '&'), lastmod });
      }
    }
  }
  const lista = [...urls.values()];
  if (!leidos.length) h('sitemap-falta', 'medio', `Probados: ${candidatos.map(c => c.replace(origen, '')).join(', ')}`);
  else {
    const sinLastmod = lista.filter(u => !u.lastmod).length;
    h('sitemap-ok', 'ok', `${leidos.length} archivo(s), ${lista.length} URLs` + (sinLastmod ? ` (${sinLastmod} sin lastmod)` : ''));
  }
  return { archivos: leidos, urls: lista };
}

async function consolidacion(urlFinal, h) {
  const u = new URL(urlFinal);
  const problemas = [];
  // http → https
  if (u.protocol === 'https:') {
    const r = await pedir(`http://${u.host}${u.pathname}`, { ua: UA_NAVEGADOR, timeoutMs: 10000 });
    if (r.status === 200 && r.finalUrl.startsWith('http://')) { h('http-a-https', 'alto', `http://${u.host}/ responde 200 sin redirigir`); problemas.push(1); }
    else if (r.cadena[0] && [302, 307].includes(r.cadena[0].status)) h('redireccion-temporal', 'bajo', `http://${u.host}/ redirige con ${r.cadena[0].status}`);
  }
  // www / sin www
  const otro = u.hostname.startsWith('www.') ? u.hostname.slice(4) : 'www.' + u.hostname;
  const r2 = await pedir(`${u.protocol}//${otro}${u.pathname}`, { ua: UA_NAVEGADOR, timeoutMs: 10000 });
  if (r2.status === 200 && new URL(r2.finalUrl).hostname === otro) { h('host-duplicado', 'alto', `${otro} responde 200 sin redirigir a ${u.hostname}`); problemas.push(1); }
  if (!problemas.length) h('host-ok', 'ok', r2.status ? `${otro} → ${new URL(r2.finalUrl || urlFinal).hostname}` : `${otro} no resuelve`);
  if (u.protocol === 'https:' && !u.hostname.match(/^(localhost|127\.)/)) {
    // HSTS se mide en la respuesta de la portada
  }
}

async function soft404(origen, h) {
  const r = await pedir(`${origen}/auditor-geo-comprobacion-${Date.now().toString(36)}-no-existe/`, { ua: UA_NAVEGADOR });
  if (r.status === 200) h('soft-404', 'medio', 'Una URL inventada responde 200');
  else if ([404, 410].includes(r.status)) h('404-ok', 'ok', `Responde ${r.status}`);
}

/** PageSpeed Insights: datos de campo (CrUX) y laboratorio. Opcional. */
async function pageSpeed(url, h) {
  const clave = process.env.PSI_API_KEY ? `&key=${encodeURIComponent(process.env.PSI_API_KEY)}` : '';
  const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance${clave}`;
  const r = await pedir(api, { timeoutMs: 90000, usarCache: false });
  if (r.status !== 200) { h('psi-error', 'info', `Respuesta ${r.status}${r.status === 429 ? ' (límite sin clave: define PSI_API_KEY)' : ''}`); return null; }
  let d;
  try { d = JSON.parse(r.body); } catch { h('psi-error', 'info', 'Respuesta no válida'); return null; }
  const campo = (d.loadingExperience && d.loadingExperience.metrics && Object.keys(d.loadingExperience.metrics).length) ? d.loadingExperience
    : (d.originLoadingExperience && d.originLoadingExperience.metrics && Object.keys(d.originLoadingExperience.metrics).length) ? d.originLoadingExperience : null;
  const out = { campo: null, lab: null };
  if (campo) {
    const ambito = campo === d.loadingExperience ? 'esta URL' : 'todo el origen';
    const m = campo.metrics;
    const lcp = m.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
    const inp = m.INTERACTION_TO_NEXT_PAINT?.percentile;
    const cls = m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;
    out.campo = { ambito, lcp, inp, cls: cls != null ? cls / 100 : null };
    if (lcp != null) h('cwv-lcp', lcp <= 2500 ? 'ok' : lcp <= 4000 ? 'medio' : 'alto', `${(lcp / 1000).toFixed(1)} s (p75, usuarios reales, ${ambito})`);
    if (inp != null) h('cwv-inp', inp <= 200 ? 'ok' : inp <= 500 ? 'medio' : 'alto', `${inp} ms (p75, usuarios reales, ${ambito})`);
    if (cls != null) h('cwv-cls', cls / 100 <= 0.1 ? 'ok' : cls / 100 <= 0.25 ? 'medio' : 'alto', `${(cls / 100).toFixed(2)} (p75, usuarios reales, ${ambito})`);
  } else h('cwv-sin-datos', 'info');
  const lh = d.lighthouseResult;
  if (lh && lh.categories && lh.categories.performance) {
    const a = lh.audits || {};
    out.lab = {
      puntuacion: Math.round(lh.categories.performance.score * 100),
      lcp: a['largest-contentful-paint']?.displayValue, cls: a['cumulative-layout-shift']?.displayValue, tbt: a['total-blocking-time']?.displayValue
    };
    h('psi-lab', out.lab.puntuacion >= 90 ? 'ok' : out.lab.puntuacion >= 50 ? 'info' : 'bajo',
      `Puntuación ${out.lab.puntuacion}/100 · LCP ${out.lab.lcp} · CLS ${out.lab.cls} · TBT ${out.lab.tbt}`);
  }
  return out;
}

module.exports = { robots, politicaIA, accesoBots, llms, sitemaps, consolidacion, soft404, pageSpeed };
