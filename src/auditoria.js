'use strict';
/**
 * Orquestador: decide qué páginas auditar, ejecuta las comprobaciones de sitio y
 * de página, y hace el análisis cruzado entre páginas (duplicados, huérfanas,
 * enlaces rotos, profundidad, coherencia).
 */

const { pedir, enParalelo, UA_NAVEGADOR } = require('./http');
const { analizar, contarPalabras } = require('./html');
const { auditarPagina, normalizarTexto } = require('./checks/pagina');
const S = require('./checks/sitio');
const { entrada } = require('./catalogo');
const VERSION = require('../package.json').version;

const EXT_NO_HTML = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|zip|rar|gz|mp4|mp3|webm|docx?|xlsx?|pptx?|csv|xml|json|txt|css|js|woff2?|ttf|eot)(\?|$)/i;

function clave(u) {
  try {
    const x = new URL(u);
    return (x.protocol + '//' + x.host.toLowerCase().replace(/^www\./, '') + x.pathname.replace(/\/+$/, '')).replace(/\/index\.(html?|php)$/, '') || '/';
  } catch { return u; }
}

async function renderizar(urls, avisar) {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch {
    avisar('La opción --render necesita Playwright (npm i -D playwright). Se omite la comparación.');
    return {};
  }
  const out = {};
  // Si el entorno sale a internet por un proxy, el navegador también tiene que usarlo
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const navegador = await chromium.launch(proxy ? { proxy: { server: proxy } } : {});
  try {
    for (const u of urls) {
      // Sin cambiar el user-agent: algunos alojamientos rechazan un UA que no cuadra con el navegador real
      const p = await navegador.newPage();
      try {
        const resp = await p.goto(u, { waitUntil: 'networkidle', timeout: 45000 });
        if (!resp || resp.status() !== 200) avisar(`El navegador recibió ${resp ? resp.status() : 'sin respuesta'} en ${u}: se omite la comparación.`);
        else out[u] = await p.content();
      } catch (e) { avisar(`No se pudo renderizar ${u}: ${e.message.split('\n')[0]}`); }
      await p.close();
    }
  } finally { await navegador.close(); }
  return out;
}

/**
 * @param {string} urlEntrada
 * @param {object} op { sitio, max, concurrencia, render, psi, cfg, progreso(fn), bots }
 */
async function auditar(urlEntrada, op = {}) {
  const t0 = Date.now();
  const cfg = op.cfg || {};
  const progreso = op.progreso || (() => {});
  const hallazgos = [];
  const avisos = [];
  const h = (url) => (id, severidad, detalle = '', evidencia = '') => {
    const e = entrada(id);
    hallazgos.push({ id, area: e.area, severidad, url, detalle, evidencia });
  };

  const inicial = /^https?:\/\//i.test(urlEntrada) ? urlEntrada : 'https://' + urlEntrada;
  progreso('Leyendo la página de entrada');
  const portada = await pedir(inicial, { ua: UA_NAVEGADOR });
  if (portada.status !== 200 || !portada.body) {
    const err = new Error(`No se pudo leer ${inicial}: respuesta ${portada.status}${portada.error ? ' (' + portada.error + ')' : ''}`);
    err.codigo = 'SIN_ACCESO';
    throw err;
  }
  const base = new URL(portada.finalUrl);
  const origen = base.origin;
  const hs = h(origen + '/');

  /* ── Sitio ── */
  progreso('robots.txt y política para rastreadores de IA');
  const rob = await S.robots(origen, hs);
  const sm = await S.sitemaps(origen, rob.parsed.sitemaps, hs);

  // Rutas de muestra para ver bloqueos parciales: la de entrada y algunas del sitemap
  const rutasMuestra = [...new Set([base.pathname, ...sm.urls.slice(0, 15).map(u => { try { return new URL(u.loc).pathname; } catch { return '/'; } })])];
  const politica = S.politicaIA(rob, rutasMuestra, hs);

  let acceso = null;
  if (op.bots !== false) { progreso('Probando el acceso real de los bots de IA'); acceso = await S.accesoBots(portada.finalUrl, politica, hs); }
  progreso('llms.txt, versiones del dominio y páginas de error');
  const llms = await S.llms(origen, hs);
  await S.versionesParaAgentes(origen, hs);
  await S.consolidacion(portada.finalUrl, hs);
  await S.soft404(origen, hs);
  if (base.protocol === 'https:' && !portada.headers.get('strict-transport-security')) hs('sin-hsts', 'bajo');

  /* ── Selección de páginas ── */
  const max = op.sitio ? (op.max || 100) : 1;
  const porClave = new Map(); // clave → registro de página
  const cola = [portada.finalUrl];
  const enSitemap = new Set(sm.urls.map(u => clave(u.loc)));
  if (op.sitio) {
    sm.urls.filter(u => new URL(u.loc).host.replace(/^www\./, '') === base.host.replace(/^www\./, '')).forEach(u => cola.push(u.loc));
  }
  const vistos = new Set();
  const analizadas = new Set();
  const paginas = [];
  const profundidad = new Map([[clave(portada.finalUrl), 0]]);

  const procesar = async (u) => {
    const res = u === portada.finalUrl ? portada : await pedir(u, { ua: UA_NAVEGADOR });
    const k = clave(u);
    const registro = { url: u, clave: k, status: res.status, finalUrl: res.finalUrl, cadena: res.cadena, res };
    porClave.set(k, registro);
    if (res.finalUrl && clave(res.finalUrl) !== k && !porClave.has(clave(res.finalUrl))) porClave.set(clave(res.finalUrl), registro);
    return registro;
  };

  progreso(op.sitio ? `Rastreando hasta ${max} páginas` : 'Analizando la página');
  while (cola.length && paginas.length < max) {
    const lote = [];
    while (cola.length && lote.length < (op.concurrencia || 4) && paginas.length + lote.length < max) {
      const u = cola.shift();
      const k = clave(u);
      if (vistos.has(k)) continue;
      vistos.add(k);
      lote.push(u);
    }
    if (!lote.length) break;
    const registros = await enParalelo(lote, op.concurrencia || 4, procesar);
    for (const reg of registros) {
      paginas.push(reg);
      const hp = h(reg.finalUrl || reg.url);
      if (reg.status !== 200) {
        h(reg.url)('http-error', reg.status >= 500 || reg.status === 0 ? 'critico' : 'alto', `HTTP ${reg.status}${reg.res.error ? ' — ' + reg.res.error : ''}`);
        continue;
      }
      if (!/html/i.test(reg.res.contentType || '')) { reg.noHtml = true; continue; }
      // Una URL que redirige a otra ya analizada no se vuelve a auditar (sería un duplicado falso)
      const kFinal = clave(reg.res.finalUrl);
      if (analizadas.has(kFinal)) { reg.redirigeA = reg.res.finalUrl; continue; }
      analizadas.add(kFinal);
      vistos.add(kFinal);
      const doc = analizar(reg.res.body, reg.res.finalUrl);
      const ctx = { h: hp, res: reg.res, doc, url: reg.res.finalUrl, cfg: { ...cfg, urlInicial: reg.url, modoSitio: !!op.sitio } };
      auditarPagina(ctx);
      Object.assign(reg, {
        doc, indexable: ctx.indexable, canonical: ctx.canonical, tipo: ctx.tipo, palabras: ctx.palabras, cargo: ctx.cargo,
        valores: ctx.valores, contacto: ctx.contacto, fecha: ctx.fecha, tiposLD: ctx.tiposLD || [], preguntas: ctx.preguntas
      });
      progreso(`${paginas.length}/${Math.min(max, paginas.length + cola.length)} ${reg.finalUrl}`);

      // Descubrimiento de enlaces internos
      reg.salientes = [];
      reg.contextuales = new Set();
      const p = profundidad.get(reg.clave) ?? profundidad.get(clave(reg.finalUrl)) ?? 0;
      const ctxClaves = new Set(doc.anclasPrincipal.map(a => a.abs && clave(a.abs.split('#')[0])));
      for (const a of doc.anclas) {
        if (!a.abs || !/^https?:/.test(a.abs) || /\bnofollow\b/.test(a.rel)) continue;
        const destino = a.abs.split('#')[0];
        const hostD = new URL(destino).host.replace(/^www\./, '');
        if (hostD !== base.host.replace(/^www\./, '') || EXT_NO_HTML.test(destino)) continue;
        if (/\?/.test(destino) && !cfg.seguirParametros) continue;
        if (/\/(wp-admin|wp-login|wp-json|feed|xmlrpc|cart|carrito|checkout|my-account|mi-cuenta)\b/i.test(destino)) continue;
        const kd = clave(destino);
        reg.salientes.push(destino);
        if (ctxClaves.has(kd)) reg.contextuales.add(kd);
        if (!profundidad.has(kd)) profundidad.set(kd, p + 1);
        if (op.sitio && !vistos.has(kd)) cola.push(destino);
      }
    }
  }

  const html = paginas.filter(p => p.doc);

  /* ── Formatos de imagen: muchos CDN (Cloudflare, Jetpack, Bunny…) sirven WebP/AVIF
     a la misma URL .jpg si el navegador lo acepta. Sin comprobarlo, el aviso es falso. ── */
  if (hallazgos.some(x => x.id === 'img-formato-antiguo')) {
    const muestras = [...new Set(html.flatMap(p => p.doc.imagenes.map(i => i.srcAbs)).filter(u => u && /\.(jpe?g|png)(\?|$)/i.test(u)))].slice(0, 3);
    const tipos = await enParalelo(muestras, 3, u => pedir(u, { ua: UA_NAVEGADOR, cabeceras: { Accept: 'image/avif,image/webp,image/*;q=0.8' } }).then(r => r.contentType || ''));
    if (tipos.length && tipos.filter(t => /webp|avif/i.test(t)).length >= Math.ceil(tipos.length / 2)) {
      for (let i = hallazgos.length - 1; i >= 0; i--) if (hallazgos[i].id === 'img-formato-antiguo') hallazgos.splice(i, 1);
      hs('img-formato-negociado', 'ok', `Muestra: ${tipos.join(', ')}`);
    }
  }

  /* ── Renderizado (opcional): ¿qué parte del texto depende de JavaScript? ── */
  if (op.render) {
    progreso('Renderizando con navegador para comparar con el HTML del servidor');
    const muestra = html.slice(0, op.sitio ? 5 : 1);
    const renders = await renderizar(muestra.map(p => p.res.finalUrl), (m) => avisos.push(m));
    for (const p of muestra) {
      const r = renders[p.res.finalUrl];
      if (!r) continue;
      const docR = analizar(r, p.res.finalUrl);
      const crudo = p.doc.principal.palabras;
      const render = docR.principal.palabras;
      p.render = { crudo, render };
      if (render > 150 && crudo < render * 0.6) {
        h(p.res.finalUrl)('ia-render-diferencia', crudo < render * 0.25 ? 'alto' : 'medio',
          `HTML del servidor: ~${crudo} palabras · Página renderizada: ~${render}. Un ${Math.round((1 - crudo / render) * 100)} % del texto solo existe tras ejecutar JavaScript.`);
      }
    }
  }

  /* ── PageSpeed Insights (opcional) ── */
  let psi = null;
  if (op.psi) { progreso('Consultando PageSpeed Insights'); psi = await S.pageSpeed(portada.finalUrl, hs); }

  /* ── Análisis entre páginas ── */
  if (op.sitio && html.length > 1) {
    progreso('Análisis cruzado entre páginas');
    await cruzado({ paginas, html, porClave, enSitemap, sm, profundidad, h, base, cfg, op });
  } else {
    // En modo página, la portada aporta también las páginas clave de la entidad
    const doc = html[0] && html[0].doc;
    if (doc && html[0].tipo.esPortada) paginasClave(doc.anclas.map(a => a.abs || ''), hs, doc.lang);
  }

  return {
    meta: {
      herramienta: 'auditor-geo', version: VERSION, url: portada.finalUrl, origen, fecha: new Date().toISOString(),
      modo: op.sitio ? 'sitio' : 'pagina', paginas: paginas.length, paginasHtml: html.length,
      duracionS: Math.round((Date.now() - t0) / 100) / 10, opciones: { render: !!op.render, psi: !!op.psi, max }
    },
    hallazgos,
    paginas: paginas.map(p => ({
      url: p.finalUrl || p.url, status: p.status, indexable: p.indexable, title: p.doc ? p.doc.title : null,
      h1: p.doc && p.doc.h1[0] ? p.doc.h1[0].texto : null, palabras: p.palabras ?? null, tiposLD: p.tiposLD || [],
      profundidad: profundidad.get(p.clave) ?? null, fecha: p.fecha || null, render: p.render || null
    })),
    sitio: {
      robots: { existe: rob.existe, sitemaps: rob.parsed.sitemaps, senales: rob.parsed.senales },
      bots: politica.map(b => ({ token: b.token, empresa: b.empresa, tipo: b.tipo, producto: b.producto, permitido: b.permitido, bloqueadoEn: b.bloqueadas })),
      acceso: acceso ? { googlebot: acceso.google, cloudflare: acceso.cloudflare, pruebas: acceso.pruebas.map(p => ({ token: p.bot.token, status: p.status, bloqueado: p.bloqueado })) } : null,
      sitemap: { archivos: sm.archivos, urls: sm.urls.length },
      llms: !!llms, psi
    },
    avisos
  };
}

function paginasClave(hrefs, h, lang) {
  const rutas = hrefs.map(u => { try { return decodeURIComponent(new URL(u).pathname).toLowerCase(); } catch { return ''; } });
  const tiene = (re) => rutas.some(r => re.test(r)) || hrefs.some(u => /^mailto:/i.test(u) && re.source.includes('contact'));
  if (!tiene(/contact|contacto|contactar|contacte|contactanos|hablemos|presupuesto/)) h('pagina-contacto-falta', 'bajo');
  if (!tiene(/sobre|about|quien|quienes|qui-som|nosotros|equipo|team|empresa|conoce|historia|trayectoria/)) h('pagina-sobre-falta', 'bajo');
  if (/^(es|ca|gl|eu)/i.test(lang || '') && !tiene(/legal|privacidad|privacitat|privacy/)) h('aviso-legal-falta', 'medio');
}

/** Similitud de Jaccard sobre trozos de 5 palabras: detecta páginas casi idénticas. */
function huella(textoPlano) {
  const p = normalizarTexto(textoPlano).split(' ');
  const s = new Set();
  for (let i = 0; i + 5 <= p.length; i++) s.add(p.slice(i, i + 5).join(' '));
  return s;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let comun = 0;
  const [menor, mayor] = a.size < b.size ? [a, b] : [b, a];
  for (const x of menor) if (mayor.has(x)) comun++;
  return comun / (a.size + b.size - comun);
}

async function cruzado({ paginas, html, porClave, enSitemap, sm, profundidad, h, base, cfg, op }) {
  const indexables = html.filter(p => p.indexable && (!p.canonical || clave(p.canonical) === clave(p.finalUrl)));
  // La paginación (/page/2/) repite title y H1 por diseño y Google lo considera correcto
  const paginables = indexables.filter(p => !/\/(page|pagina)\/\d+\/?$/i.test(new URL(p.finalUrl).pathname));
  const hs = h(base.origin + '/');

  // Duplicados de title, meta y H1
  const agrupar = (fn, id, sev) => {
    const g = new Map();
    for (const p of paginables) { const v = fn(p); if (!v) continue; const k = v.toLowerCase().trim(); if (!g.has(k)) g.set(k, []); g.get(k).push(p); }
    for (const [v, ps] of g) if (ps.length > 1) ps.forEach(p => h(p.finalUrl)(id, sev, `«${v.slice(0, 80)}» se repite en ${ps.length} páginas: ${ps.filter(x => x !== p).slice(0, 3).map(x => new URL(x.finalUrl).pathname).join(', ')}`));
  };
  agrupar(p => p.doc.title, 'duplicado-title', 'medio');
  agrupar(p => p.doc.meta('description'), 'duplicado-meta', 'bajo');
  agrupar(p => p.doc.h1[0] && p.doc.h1[0].texto, 'duplicado-h1', 'bajo');

  // Contenido casi idéntico
  const conTexto = indexables.filter(p => p.palabras >= 150).map(p => ({ p, f: huella(p.doc.principal.texto) }));
  for (let i = 0; i < conTexto.length; i++) {
    for (let j = i + 1; j < conTexto.length; j++) {
      const s = jaccard(conTexto[i].f, conTexto[j].f);
      if (s >= 0.8) {
        h(conTexto[j].p.finalUrl)('duplicado-contenido', s >= 0.9 ? 'alto' : 'medio', `${Math.round(s * 100)} % idéntico a ${new URL(conTexto[i].p.finalUrl).pathname}`);
      }
    }
  }

  // Enlaces entrantes
  const entrantes = new Map();
  const contextuales = new Map();
  for (const p of html) {
    for (const d of new Set(p.salientes || [])) {
      const k = clave(d);
      if (k === p.clave) continue;
      if (!entrantes.has(k)) entrantes.set(k, new Set());
      entrantes.get(k).add(p.finalUrl);
    }
    for (const k of p.contextuales || []) {
      if (k === p.clave) continue;
      if (!contextuales.has(k)) contextuales.set(k, new Set());
      contextuales.get(k).add(p.finalUrl);
    }
  }
  const adrede = (cfg.huerfanasAdrede || []).map(x => x.toLowerCase());
  for (const p of indexables) {
    const ruta = new URL(p.finalUrl).pathname.toLowerCase();
    if (p.tipo.esPortada || adrede.some(a => ruta.endsWith(a.toLowerCase()))) continue;
    if (!entrantes.has(p.clave) || entrantes.get(p.clave).size === 0) h(p.finalUrl)('huerfanas', 'medio', enSitemap.has(p.clave) ? 'Solo se descubre por el sitemap' : '');
    else if (!contextuales.has(p.clave) && !p.tipo.esLegal) h(p.finalUrl)('sin-enlaces-contextuales', 'info', `${entrantes.get(p.clave).size} enlace(s) entrante(s), todos desde menú, cabecera o pie`);
  }

  // Estado de los destinos enlazados: rotos y redirecciones
  const destinos = new Map();
  for (const p of html) for (const d of new Set(p.salientes || [])) { if (!destinos.has(clave(d))) destinos.set(clave(d), { url: d, desde: new Set() }); destinos.get(clave(d)).desde.add(p.finalUrl); }
  const sinComprobar = [...destinos.values()].filter(d => !porClave.has(clave(d.url))).slice(0, op.maxEnlaces || 300);
  await enParalelo(sinComprobar, op.concurrencia || 4, async (d) => {
    const r = await pedir(d.url, { ua: UA_NAVEGADOR });
    porClave.set(clave(d.url), { url: d.url, status: r.status, finalUrl: r.finalUrl, cadena: r.cadena, res: r });
  });
  const reportarEnlace = new Map();
  for (const [k, d] of destinos) {
    const reg = porClave.get(k);
    if (!reg) continue;
    const exacto = paginas.find(p => p.url === d.url) || reg;
    if (reg.status >= 400 || reg.status === 0) {
      for (const desde of d.desde) {
        const lista = reportarEnlace.get(desde) || []; lista.push(`${d.url} (${reg.status})`); reportarEnlace.set(desde, lista);
      }
    } else if (exacto.cadena && exacto.cadena.length > 1 && exacto.url === d.url && clave(exacto.finalUrl) !== clave(d.url)) {
      for (const desde of d.desde) h(desde)('enlace-a-redireccion', 'bajo', `${d.url} → ${exacto.finalUrl}`);
    }
  }
  for (const [desde, lista] of reportarEnlace) h(desde)('enlace-roto-interno', 'alto', lista.slice(0, 5).join(' · ') + (lista.length > 5 ? ` y ${lista.length - 5} más` : ''));

  // Profundidad
  for (const p of indexables) {
    const d = profundidad.get(p.clave);
    if (d != null && d > 3) h(p.finalUrl)('profundidad', 'bajo', `${d} clics desde la portada`);
  }

  // Sitemap frente a lo rastreado
  if (sm.urls.length) {
    for (const u of sm.urls) {
      const reg = porClave.get(clave(u.loc));
      if (!reg) continue;
      if (reg.status !== 200) h(u.loc)('sitemap-url-error', 'medio', `HTTP ${reg.status}`);
      else if (reg.cadena && reg.cadena.length > 1 && clave(reg.finalUrl) !== clave(u.loc)) h(u.loc)('sitemap-url-redirige', 'medio', `→ ${reg.finalUrl}`);
      else if (reg.doc && reg.indexable === false) h(u.loc)('sitemap-url-noindex', 'medio');
      else if (reg.canonical && clave(reg.canonical) !== clave(reg.finalUrl)) h(u.loc)('sitemap-url-canonical', 'medio', `Canonical: ${reg.canonical}`);
    }
    for (const p of indexables) {
      if (!enSitemap.has(p.clave) && !enSitemap.has(clave(p.url)) && !p.tipo.esLegal && !/\/(page|pagina)\/\d+\/?$/i.test(new URL(p.finalUrl).pathname)) h(p.finalUrl)('fuera-sitemap', 'bajo');
    }
  }

  // Páginas clave de la entidad, con todos los enlaces del sitio
  const todos = html.flatMap(p => p.doc.anclas.map(a => a.abs || a.href || ''));
  paginasClave([...new Set(todos)], hs, html[0].doc.lang);
  if (!html.some(p => p.contacto && (p.contacto.tel || p.contacto.mail))) hs('contacto-falta', 'medio', 'Ninguna página rastreada tiene un enlace tel: o mailto:');

  // Coherencia: cargo en firmas y datos configurados
  const cargos = {};
  html.forEach(p => { if (p.cargo) cargos[p.cargo] = (cargos[p.cargo] || 0) + 1; });
  if (Object.keys(cargos).length > 1) hs('incoherencia-cargo', 'medio', Object.entries(cargos).map(([v, n]) => `${n}× «${v.slice(0, 70)}»`).join(' · '));
  const valores = {};
  html.forEach(p => Object.entries(p.valores || {}).forEach(([nombre, vs]) => vs.forEach(v => { valores[nombre] = valores[nombre] || {}; valores[nombre][v] = (valores[nombre][v] || 0) + 1; })));
  for (const [nombre, vs] of Object.entries(valores)) {
    if (Object.keys(vs).length > 1) hs('incoherencia-dato', 'medio', `«${nombre}» aparece de ${Object.keys(vs).length} formas: ` + Object.entries(vs).map(([v, n]) => `${n}× «${v.slice(0, 60)}»`).join(' · '));
  }

  // Peso de las imágenes que se descargan al entrar en la portada
  const home = html.find(p => p.tipo.esPortada);
  if (home) {
    const imgs = home.doc.imagenes.filter(i => i.srcAbs && /^https?:/.test(i.srcAbs) && !/lazy/i.test(i.loading || '')).slice(0, 12);
    const pesos = await enParalelo(imgs, 4, i => pedir(i.srcAbs, { ua: UA_NAVEGADOR }).then(r => r.bytes || 0));
    const kb = Math.round(pesos.reduce((a, b) => a + b, 0) / 1024);
    if (kb > (cfg.maxKBInmediato || 500)) hs('imagenes-peso', kb > 1500 ? 'medio' : 'bajo', `${kb} KB en ${imgs.length} imágenes sin carga diferida en la portada`);
  }
}

module.exports = { auditar, clave, contarPalabras };
