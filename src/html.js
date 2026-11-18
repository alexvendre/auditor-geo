'use strict';
/**
 * Analizador HTML ligero, sin dependencias.
 *
 * No construye un DOM completo: extrae lo que una auditoría necesita (metadatos,
 * encabezados, enlaces, imágenes, scripts, JSON-LD, texto del contenido principal)
 * de forma tolerante a HTML mal formado. Es la misma información que obtiene un
 * rastreador que no ejecuta JavaScript, que es exactamente lo que nos interesa:
 * la mayoría de rastreadores de IA leen el HTML tal como llega del servidor.
 */

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·', euro: '€', copy: '©', reg: '®', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', ccedil: 'ç', iquest: '¿', iexcl: '¡', agrave: 'à', egrave: 'è', ograve: 'ò' };

function decodificar(s) {
  if (!s) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    const v = ENTIDADES[e] !== undefined ? ENTIDADES[e] : ENTIDADES[e.toLowerCase()];
    return v !== undefined ? v : m;
  });
}

function atributos(cadena) {
  const attrs = {};
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(cadena)) !== null) {
    const nombre = m[1].toLowerCase();
    if (attrs[nombre] !== undefined) continue;
    const valor = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
    attrs[nombre] = decodificar(valor);
  }
  return attrs;
}

function etiquetas(html, nombre) {
  const re = new RegExp(`<${nombre}\\b([^>]*)>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push({ attrs: atributos(m[1]), raw: m[0], pos: m.index });
  return out;
}

function bloques(html, nombre) {
  const re = new RegExp(`<${nombre}\\b([^>]*)>([\\s\\S]*?)<\\/${nombre}\\s*>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push({ attrs: atributos(m[1]), inner: m[2], pos: m.index, raw: m[0] });
  return out;
}

function texto(html) {
  return decodificar(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

const contarPalabras = (t) => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length;

/** Quita bloques de navegación, cabecera, pie y barras laterales. */
function quitarPlantilla(html) {
  let h = html;
  for (const t of ['nav', 'header', 'footer', 'aside', 'form']) {
    h = h.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}\\s*>`, 'gi'), ' ');
  }
  // Patrones habituales de plantillas que no usan etiquetas semánticas
  h = h.replace(/<(div|section)\b[^>]*(?:id|class)=["'][^"']*\b(cookie|cmplz|gdpr|consent|site-header|site-footer|main-navigation|menu-principal)\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, ' ');
  return h;
}

/** Contenido principal: <main>, si no <article>, si no el body sin plantilla. */
function contenidoPrincipal(html) {
  const sinCom = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const main = bloques(sinCom, 'main');
  if (main.length) {
    const mayor = main.sort((a, b) => b.inner.length - a.inner.length)[0];
    return { html: quitarPlantilla(mayor.inner), origen: 'main' };
  }
  const art = bloques(sinCom, 'article');
  if (art.length === 1) return { html: quitarPlantilla(art[0].inner), origen: 'article' };
  const body = bloques(sinCom, 'body')[0];
  return { html: quitarPlantilla(body ? body.inner : sinCom), origen: 'body' };
}

/**
 * Analiza un documento y devuelve una estructura con todo lo que miran las comprobaciones.
 */
function analizar(html, urlBase) {
  const sinCom = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const head = (bloques(sinCom, 'head')[0] || { inner: sinCom.slice(0, Math.max(0, sinCom.search(/<body\b/i))) }).inner || '';

  const abs = (u) => {
    if (!u) return null;
    try { return new URL(u.trim(), urlBase).href; } catch { return null; }
  };

  const metas = etiquetas(sinCom, 'meta').map(t => t.attrs);
  const meta = (nombre) => {
    const n = nombre.toLowerCase();
    const m = metas.find(a => (a.name || '').toLowerCase() === n || (a.property || '').toLowerCase() === n);
    return m ? (m.content || '').trim() : null;
  };
  const metasTodas = (nombre) => metas.filter(a => (a.name || '').toLowerCase() === nombre.toLowerCase()).map(a => a.content || '');

  const links = etiquetas(sinCom, 'link').map(t => t.attrs);
  const rel = (r) => links.filter(l => (l.rel || '').toLowerCase().split(/\s+/).includes(r));

  const titulos = bloques(sinCom, 'title');
  const title = titulos.length ? decodificar(titulos[0].inner).replace(/\s+/g, ' ').trim() : null;

  const encabezados = [];
  const reH = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1\s*>/gi;
  let m;
  while ((m = reH.exec(sinCom)) !== null) encabezados.push({ nivel: Number(m[1]), texto: texto(m[3]), pos: m.index });

  const principal = contenidoPrincipal(html);
  const textoPrincipal = texto(principal.html);

  const anclas = bloques(sinCom, 'a').map(a => ({
    href: a.attrs.href || '',
    abs: abs(a.attrs.href),
    texto: texto(a.inner),
    rel: (a.attrs.rel || '').toLowerCase(),
    title: a.attrs.title || '',
    aria: a.attrs['aria-label'] || a.attrs['aria-labelledby'] || '',
    imgAlt: (a.inner.match(/<img\b[^>]*\balt=["']([^"']*)["']/i) || [])[1] || '',
    pos: a.pos
  }));
  const anclasPrincipal = bloques(principal.html, 'a').map(a => ({ href: a.attrs.href || '', abs: abs(a.attrs.href), texto: texto(a.inner), rel: (a.attrs.rel || '').toLowerCase() }));

  const imagenes = etiquetas(sinCom, 'img').map(t => ({
    ...t.attrs,
    srcAbs: abs(t.attrs.src || t.attrs['data-src'] || ''),
    tieneAlt: Object.prototype.hasOwnProperty.call(t.attrs, 'alt'),
    pos: t.pos
  }));

  const finHead = sinCom.search(/<\/head>/i);
  const scripts = bloques(sinCom, 'script').map(s => ({ ...s.attrs, inner: s.inner, pos: s.pos, enHead: finHead > 0 && s.pos < finHead }));
  const jsonld = scripts.filter(s => /application\/ld\+json/i.test(s.type || '')).map(s => {
    try { return { ok: true, datos: JSON.parse(s.inner.trim()) }; } catch (e) { return { ok: false, error: e.message, crudo: s.inner.slice(0, 200) }; }
  });

  const htmlAttrs = (etiquetas(sinCom, 'html')[0] || { attrs: {} }).attrs;
  const bodyHtml = (bloques(sinCom, 'body')[0] || { inner: sinCom }).inner;
  const textoCompleto = texto(bodyHtml);

  const parrafos = bloques(principal.html, 'p').map(p => texto(p.inner)).filter(Boolean);

  return {
    html, head, title,
    lang: htmlAttrs.lang || null,
    doctype: /^\s*(<\?xml[^>]*>\s*)?<!doctype html/i.test(html),
    charset: !!metas.find(a => a.charset) || /<meta[^>]+http-equiv=["']content-type["'][^>]+charset=/i.test(head),
    metas, meta, metasTodas, links, rel, abs,
    canonical: rel('canonical').map(l => abs(l.href)).filter(Boolean),
    hreflang: rel('alternate').filter(l => l.hreflang).map(l => ({ lang: l.hreflang, href: abs(l.href) })),
    encabezados,
    h1: encabezados.filter(h => h.nivel === 1),
    anclas, anclasPrincipal, imagenes, scripts, jsonld,
    estilos: links.filter(l => (l.rel || '').toLowerCase() === 'stylesheet'),
    principal: { ...principal, texto: textoPrincipal, palabras: contarPalabras(textoPrincipal) },
    textoCompleto,
    palabrasTotal: contarPalabras(textoCompleto),
    parrafos,
    listas: (principal.html.match(/<(ul|ol)\b/gi) || []).length,
    tablas: (principal.html.match(/<table\b/gi) || []).length,
    microdatos: /\bitemscope\b/i.test(sinCom),
    rdfa: /\btypeof=["']/i.test(sinCom),
    iframes: etiquetas(sinCom, 'iframe').map(t => t.attrs)
  };
}

module.exports = { analizar, texto, contarPalabras, decodificar, atributos, bloques, etiquetas, contenidoPrincipal };
