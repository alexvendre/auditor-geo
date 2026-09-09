#!/usr/bin/env node
/**
 * auditor-geo.js — Auditoría de GEO y AEO para cualquier URL pública.
 *
 * Comprueba si una web está preparada para que ChatGPT, Perplexity, Gemini o las
 * respuestas generadas de Google puedan encontrarla, entenderla y citarla.
 *
 * No necesita instalar nada: solo Node 18 o superior (fetch nativo).
 *
 *   node auditor-geo.js https://tudominio.com
 *   node auditor-geo.js https://tudominio.com --json
 *
 * Escrito por Alex Vendrell Torres · alexvendrell.wordpress.com
 *
 * POR QUÉ EXISTE
 * Las auditorías automáticas comerciales dan falsos positivos en la comprobación
 * más importante: dicen que bloqueas a los bots de IA cuando lo que ocurre es que
 * tu alojamiento verifica la IP de origen. Este script lo distingue comparando el
 * comportamiento con Googlebot, que es el control que ninguna herramienta hace.
 */

const BOTS_IA = ['GPTBot/1.0', 'OAI-SearchBot/1.0', 'ChatGPT-User/1.0', 'ClaudeBot/1.0', 'PerplexityBot/1.0', 'CCBot/2.0'];
const UA_NAVEGADOR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const c = { ok: '\x1b[32m', mal: '\x1b[31m', avi: '\x1b[33m', dim: '\x1b[2m', neg: '\x1b[1m', off: '\x1b[0m' };
const resultados = [];

function anota(categoria, estado, titulo, detalle) {
  resultados.push({ categoria, estado, titulo, detalle });
}

async function pedir(url, ua, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': ua }, redirect: 'follow', signal: ctrl.signal });
    const cuerpo = await r.text();
    return { status: r.status, headers: r.headers, cuerpo };
  } catch (e) {
    return { status: 0, error: String(e.message || e), cuerpo: '' };
  } finally {
    clearTimeout(t);
  }
}

const sinEtiquetas = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const entre = (h, re) => { const m = h.match(re); return m ? m[1].trim() : null; };

/* ---------------------------------------------------------------- 1. ACCESO */
async function comprobarAcceso(base, html) {
  // robots.txt: es la fuente autoritativa, no el código de respuesta
  const robots = await pedir(new URL('/robots.txt', base).href, UA_NAVEGADOR);
  if (robots.status === 200) {
    const bloqueados = [];
    const bloques = robots.cuerpo.split(/\n(?=User-agent:)/i);
    for (const b of bloques) {
      const agente = entre(b, /User-agent:\s*([^\n\r]+)/i);
      if (!agente) continue;
      const esIA = /gptbot|oai-searchbot|chatgpt-user|claudebot|claude-web|perplexitybot|ccbot|google-extended|bytespider|meta-externalagent|anthropic/i.test(agente);
      if (esIA && /Disallow:\s*\/\s*$/im.test(b)) bloqueados.push(agente.trim());
    }
    if (bloqueados.length) {
      anota('Acceso', 'mal', 'robots.txt bloquea rastreadores de IA', bloqueados.join(', ') + '. Si los bloqueas, renuncias a que te citen.');
    } else {
      anota('Acceso', 'ok', 'robots.txt permite a los rastreadores de IA', 'Ninguna regla Disallow global para agentes de IA.');
    }
  } else {
    anota('Acceso', 'avi', 'Sin robots.txt accesible', `Respuesta ${robots.status}. Sin robots.txt todo se considera permitido, pero conviene tenerlo.`);
  }

  // La comprobación que las herramientas comerciales hacen mal
  const control = await pedir(base, 'Googlebot/2.1 (+http://www.google.com/bot.html)');
  const pruebas = [];
  for (const ua of BOTS_IA) {
    const r = await pedir(base, ua);
    pruebas.push({ bot: ua.split('/')[0], status: r.status });
  }
  const bloqueadosIA = pruebas.filter(p => p.status === 403 || p.status === 429);

  if (bloqueadosIA.length === 0) {
    anota('Acceso', 'ok', 'Los bots de IA reciben respuesta correcta', pruebas.map(p => `${p.bot}:${p.status}`).join('  '));
  } else if (control.status === 403 || control.status === 429) {
    anota('Acceso', 'ok', 'FALSO POSITIVO descartado: no hay bloqueo de IA',
      `Los bots de IA reciben ${bloqueadosIA[0].status}, pero Googlebot también (${control.status}). ` +
      'Es verificación de IP antisuplantación del alojamiento, no un bloqueo. La fuente que manda es robots.txt.');
  } else {
    anota('Acceso', 'mal', 'Posible bloqueo real de bots de IA',
      `${bloqueadosIA.map(p => p.bot + ':' + p.status).join(', ')} — y Googlebot sí pasa (${control.status}). Revisa tu firewall o WAF.`);
  }
}

/* ----------------------------------------------------- 2. DATOS ESTRUCTURADOS */
function comprobarDatos(html) {
  const bloques = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  if (bloques.length) {
    let validos = 0; const tipos = [];
    for (const b of bloques) {
      try {
        const j = JSON.parse(b.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, ''));
        validos++;
        const rec = (o) => { if (!o || typeof o !== 'object') return; if (o['@type']) tipos.push([].concat(o['@type']).join('/')); if (o['@graph']) o['@graph'].forEach(rec); };
        rec(j);
      } catch { /* JSON inválido */ }
    }
    anota('Datos estructurados', validos === bloques.length ? 'ok' : 'avi',
      `${bloques.length} bloque(s) JSON-LD, ${validos} válido(s)`, tipos.length ? 'Tipos: ' + [...new Set(tipos)].join(', ') : 'Sin @type reconocible.');
  } else {
    // El fallo silencioso: el alojamiento quita <script> pero deja el JSON como texto
    const texto = sinEtiquetas(html);
    const fugado = /[«"']@context[»"']\s*:|[«"']@graph[»"']\s*:/.test(texto);
    if (fugado) {
      anota('Datos estructurados', 'mal', 'JSON-LD FUGADO COMO TEXTO VISIBLE',
        'Tu alojamiento ha quitado la etiqueta <script> pero ha dejado el JSON en la página, visible para cualquiera. Quítalo: es peor que no tenerlo.');
    } else {
      anota('Datos estructurados', 'avi', 'Sin datos estructurados JSON-LD',
        'Un modelo tiene que deducir qué eres en vez de leerlo. Si tu plan filtra <script>, compénsalo con texto explícito y FAQ en texto plano.');
    }
  }
}

/* ------------------------------------------------------------- 3. CITABILIDAD */
function comprobarCitabilidad(html) {
  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  anota('Citabilidad', h1 === 1 ? 'ok' : 'mal', `${h1} etiqueta(s) <h1>`,
    h1 === 1 ? 'Correcto: un solo H1.' : h1 === 0 ? 'Sin H1: el modelo no sabe de qué va la página.' : 'Varios H1 diluyen el tema principal.');

  const title = entre(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    const n = title.replace(/&#?\w+;/g, 'x').length;
    anota('Citabilidad', n <= 62 ? 'ok' : 'avi', `Title de ${n} caracteres`,
      n <= 62 ? title : `Google corta hacia los 62. Se pierde: "…${title.slice(58)}"`);
  } else anota('Citabilidad', 'mal', 'Sin <title>', 'Es lo primero que lee cualquier sistema.');

  const desc = entre(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  if (desc) {
    const n = desc.length;
    anota('Citabilidad', n >= 110 && n <= 165 ? 'ok' : 'avi', `Meta description de ${n} caracteres`,
      n < 110 ? 'Corta: desaprovechas espacio.' : n > 165 ? 'Larga: se cortará.' : 'En rango.');
  } else anota('Citabilidad', 'avi', 'Sin meta description', 'No posiciona, pero decide si entran.');

  // Respuesta directa al principio: los modelos citan fragmentos, no páginas.
  // Se mira solo a partir del <h1> para no confundir el menú de navegación con
  // el primer párrafo del contenido: ese error lo cometen muchas herramientas.
  const desdeH1 = html.slice(Math.max(0, html.search(/<h1[\s>]/i)));
  const cuerpo = desdeH1 || html;
  const esNavegacion = (t) => {
    const enlaces = (t.match(/·|\|/g) || []).length;
    return enlaces >= 3 || /^(inicio|home)\b/i.test(t);
  };
  const parrafos = [...cuerpo.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => sinEtiquetas(m[1]))
    .filter(t => t.length > 60 && !esNavegacion(t));
  if (parrafos.length) {
    const primero = parrafos[0];
    // Ojo con los límites de palabra: "consiste" no casa con "consisten".
    const esDirecto = primero.length <= 400 &&
      /\b(es|son|eres|consist\w+|signific\w+|se trata|sirve\w*|permit\w+|ayud\w+)\b/i.test(primero.slice(0, 220));
    anota('Citabilidad', esDirecto ? 'ok' : 'avi', esDirecto ? 'Responde pronto y en corto' : 'El primer párrafo no responde directamente',
      esDirecto ? `"${primero.slice(0, 110)}…"` : 'Pon la respuesta en el primer párrafo: un modelo no lee 800 palabras para encontrarla.');
  }

  const palabras = sinEtiquetas(html).split(' ').length;
  anota('Citabilidad', palabras >= 300 ? 'ok' : 'avi', `~${palabras} palabras`,
    palabras >= 300 ? 'Suficiente para tener algo que citar.' : 'Poco contenido: difícil que un modelo saque nada.');
}

/* ------------------------------------------------------------------ 4. ENTIDAD */
function comprobarEntidad(html) {
  const autor = /rel=["']author["']/i.test(html) || /itemprop=["']author["']/i.test(html) || /"author"\s*:/.test(html);
  anota('Entidad', autor ? 'ok' : 'avi', autor ? 'Autoría identificable' : 'Sin señal de autoría',
    autor ? 'Hay rel="author" o author en los datos.' : 'Añade una firma visible con rel="author". Es de lo que más sube el E-E-A-T con menos esfuerzo.');

  const og = ['og:title', 'og:description', 'og:image', 'og:url'].filter(p => new RegExp(`property=["']${p}["']`, 'i').test(html));
  anota('Entidad', og.length >= 3 ? 'ok' : 'avi', `Open Graph: ${og.length}/4`,
    og.length >= 3 ? 'Suficiente para que se comparta bien.' : 'Faltan etiquetas: al compartirlo se verá pobre.');

  const tel = /href=["']tel:/i.test(html);
  const mail = /href=["']mailto:/i.test(html);
  anota('Entidad', tel && mail ? 'ok' : 'avi', `Contacto: ${tel ? 'teléfono' : 'sin teléfono'}, ${mail ? 'email' : 'sin email'}`,
    tel && mail ? 'Datos de contacto verificables en la página.' : 'Un negocio sin teléfono visible pierde credibilidad ante buscadores y personas.');

  const lang = entre(html, /<html[^>]+lang=["']([^"']+)["']/i);
  anota('Entidad', lang ? 'ok' : 'avi', lang ? `Idioma declarado: ${lang}` : 'Sin atributo lang',
    lang ? '' : 'Declara el idioma en <html lang="es">.');
}

/* -------------------------------------------------------------- 5. AUXILIARES */
async function comprobarAuxiliares(base) {
  for (const [ruta, nombre, critico] of [['/sitemap.xml', 'sitemap.xml', true], ['/llms.txt', 'llms.txt', false]]) {
    const r = await pedir(new URL(ruta, base).href, UA_NAVEGADOR);
    const existe = r.status === 200 && r.cuerpo.length > 20;
    anota('Auxiliares', existe ? 'ok' : (critico ? 'avi' : 'dim'), `${nombre}: ${existe ? 'presente' : 'no encontrado'}`,
      existe ? '' : critico ? 'Sin sitemap, la indexación depende del rastreo.' : 'Convención emergente, aún no estándar. Su ausencia no es un fallo.');
  }
}

/* ------------------------------------------------------------------- INFORME */
function informe(url, json) {
  if (json) { console.log(JSON.stringify({ url, fecha: new Date().toISOString(), resultados }, null, 2)); return; }
  const icono = { ok: c.ok + '  OK  ' + c.off, mal: c.mal + ' FALLO' + c.off, avi: c.avi + ' AVISO' + c.off, dim: c.dim + '  --  ' + c.off };
  console.log(`\n${c.neg}Auditoría GEO y AEO${c.off}  ${c.dim}${url}${c.off}\n`);
  let cat = '';
  for (const r of resultados) {
    if (r.categoria !== cat) { cat = r.categoria; console.log(`${c.neg}${cat}${c.off}`); }
    console.log(`  ${icono[r.estado]}  ${r.titulo}`);
    if (r.detalle) console.log(`         ${c.dim}${r.detalle}${c.off}`);
  }
  const fallos = resultados.filter(r => r.estado === 'mal').length;
  const avisos = resultados.filter(r => r.estado === 'avi').length;
  const oks = resultados.filter(r => r.estado === 'ok').length;
  console.log(`\n${c.neg}Resumen:${c.off} ${c.ok}${oks} correctos${c.off} · ${c.avi}${avisos} avisos${c.off} · ${c.mal}${fallos} fallos${c.off}\n`);
}

/* ---------------------------------------------------------------------- MAIN */
(async () => {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const url = args.find(a => !a.startsWith('--'));
  if (!url) { console.error('Uso: node auditor-geo.js https://tudominio.com [--json]'); process.exit(1); }

  const destino = url.startsWith('http') ? url : 'https://' + url;
  const r = await pedir(destino, UA_NAVEGADOR);
  if (r.status !== 200) { console.error(`No se pudo leer ${destino} (respuesta ${r.status}${r.error ? ': ' + r.error : ''})`); process.exit(1); }

  await comprobarAcceso(destino, r.cuerpo);
  comprobarDatos(r.cuerpo);
  comprobarCitabilidad(r.cuerpo);
  comprobarEntidad(r.cuerpo);
  await comprobarAuxiliares(destino);

  informe(destino, json);
})();
