'use strict';
/**
 * Comprobaciones que se hacen sobre una página concreta.
 * Cada función recibe el contexto y emite hallazgos con h(id, severidad, detalle, evidencia).
 * Severidades: critico | alto | medio | bajo | info | ok
 */

const J = require('../jsonld');
const { texto, contarPalabras, bloques } = require('../html');

const SEPARADORES_TITLE = /\s[|–—·•:»\-]\s(?!.*\s[|–—·•:»\-]\s)/;
const RE_PREGUNTA = /\?\s*$|^¿|^(qu[eé]|c[oó]mo|cu[aá]nto|cu[aá]ndo|cu[aá]l|d[oó]nde|por qu[eé]|para qu[eé]|qui[eé]n|quin|com|per qu[eè]|quant|on|what|how|why|when|which|who|where|is|are|can|do|does|should)\b/i;
const RE_RESPUESTA = /\b(es|son|eres|soy|somos|era|consist\w+|signific\w+|se trata|sirve\w*|permit\w+|ayud\w+|cuesta\w*|vale|dura|tarda\w*|depende|s[ií]\b|no\b|és|són|serveix|is|are|means|costs?|takes|helps?)\b/i;
const RE_GENERICO = /^(haz clic aqu[ií]|clic aqu[ií]|click aqu[ií]|pincha aqu[ií]|aqu[ií]|leer m[aá]s|lee m[aá]s|ver m[aá]s|saber m[aá]s|m[aá]s informaci[oó]n|m[aá]s info|continuar leyendo|seguir leyendo|enlace|link|click here|here|read more|learn more|more|m[eé]s informaci[oó]|llegir m[eé]s|veure m[eé]s|clica aqu[ií])\.?$/i;
const RE_LEGAL = /privacidad|privacitat|privacy|cookies|aviso-legal|avis-legal|legal|terminos|condiciones|terms|gracias|thank|gr[aà]cies|confirmacion|404/i;

const normalizarTel = (t) => (t || '').replace(/[^\d+]/g, '').replace(/^(\+?34|0034)/, '');
const normalizarTexto = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

function tipoPagina(ctx) {
  const { doc, nodosLD, url } = ctx;
  // og:type no sirve: Yoast y otros plugins ponen «article» en todas las páginas interiores.
  const ruta = new URL(url).pathname;
  const esArticulo = nodosLD.some(n => J.esTipo(n, J.TIPOS_ARTICULO)) || /\/(19|20)\d{2}\/\d{2}\//.test(ruta);
  const esArchivo = /\/(page|pagina)\/\d+\/?$|\/(category|categoria|tag|etiqueta|author|autor)\//i.test(ruta) || nodosLD.some(n => J.esTipo(n, ['CollectionPage', 'ProfilePage']));
  const esPortada = new URL(url).pathname.replace(/\/+$/, '') === '';
  const h1 = doc.h1[0] ? doc.h1[0].texto : '';
  const esInformativa = esArticulo || RE_PREGUNTA.test(h1) || /\b(gu[ií]a|qu[eé] es|c[oó]mo|tutorial|preguntas frecuentes|faq)\b/i.test(h1 + ' ' + (doc.title || ''));
  const esLegal = RE_LEGAL.test(ruta);
  return { esArticulo, esPortada, esInformativa: esInformativa && !esArchivo, esLegal, esArchivo };
}

/* ───────────────────────────── Rastreo e indexación ───────────────────────────── */
function rastreo(ctx) {
  const { h, res, doc, url, cfg } = ctx;

  if (res.cadena.length > 2) {
    h('redireccion-cadena', 'medio', res.cadena.map(c => `${c.status} ${c.url}`).join(' → ') + ` → ${res.finalUrl}`);
  }
  const temporales = res.cadena.filter(c => [302, 303, 307].includes(c.status));
  if (temporales.length && cfg.urlInicial === url) {
    h('redireccion-temporal', 'bajo', `${temporales.map(t => t.status + ' desde ' + t.url).join(', ')}`);
  }

  const directivas = [
    ...doc.metasTodas('robots'), ...doc.metasTodas('googlebot'), res.headers.get('x-robots-tag') || ''
  ].join(', ').toLowerCase();
  ctx.indexable = !/\bnoindex\b|\bnone\b/.test(directivas);
  if (!ctx.indexable) h('noindex', ctx.tipo.esPortada ? 'critico' : 'alto', `Directivas: ${directivas}`);
  if (/\bnofollow\b/.test(directivas) && !/\bnone\b/.test(directivas)) h('nofollow-pagina', 'medio', `Directivas: ${directivas}`);

  // AEO: control de fragmentos
  const maxSnippet = directivas.match(/max-snippet\s*:\s*(-?\d+)/);
  if (/\bnosnippet\b/.test(directivas) || (maxSnippet && Number(maxSnippet[1]) >= 0 && Number(maxSnippet[1]) < 50)) {
    h('snippet-restringido', 'alto', `Directivas: ${directivas}`);
  }
  const dataNoSnippet = (doc.html.match(/\bdata-nosnippet\b/gi) || []).length;
  if (dataNoSnippet > 3) h('snippet-restringido', 'medio', `${dataNoSnippet} bloques marcados con data-nosnippet: ese texto no se usará en fragmentos ni respuestas.`);

  const canon = [...new Set(doc.canonical)];
  if (!canon.length) {
    if (ctx.indexable) h('canonical-falta', 'medio');
  } else if (canon.length > 1) {
    h('canonical-multiple', 'alto', canon.join(' · '));
  } else {
    const c = canon[0];
    ctx.canonical = c;
    const sinBarra = (u) => u.replace(/\/+$/, '').replace(/^https?:\/\//, '').toLowerCase();
    if (c.startsWith('http://') && url.startsWith('https://')) h('canonical-http', 'medio', c);
    if (sinBarra(c) !== sinBarra(res.finalUrl)) h('canonical-otra', ctx.tipo.esPortada ? 'alto' : 'medio', `Canonical: ${c}`);
    else h('canonical-ok', 'ok');
  }
}

/* ───────────────────────────── On-page ───────────────────────────── */
function onpage(ctx) {
  const { h, doc } = ctx;

  // Title: se mide sin el sufijo de marca, que es lo primero que corta Google.
  if (!doc.title) h('title-falta', 'alto');
  else {
    const total = doc.title.length;
    const partes = doc.title.split(SEPARADORES_TITLE);
    const propio = partes.length > 1 && partes[1].length <= 40 ? partes[0].trim() : doc.title;
    ctx.titlePropio = propio;
    if (total > 65 && propio.length > 60) h('title-largo', 'medio', `${total} caracteres (${propio.length} sin la marca). Se perdería: «…${doc.title.slice(57)}»`, doc.title);
    else if (total > 65) h('title-largo', 'bajo', `${total} caracteres. Se cortaría la marca (${propio.length} sin ella), que es lo menos grave.`, doc.title);
    else if (propio.length < 20 && !ctx.tipo.esPortada && !ctx.tipo.esLegal && !ctx.tipo.esArchivo) h('title-corto', 'bajo', `${propio.length} caracteres: «${doc.title}»`);
    else h('title-ok', 'ok', `${total} car.: «${doc.title}»`);
  }

  const metas = doc.metasTodas('description');
  if (!metas.length || !metas[0].trim()) h('meta-falta', ctx.tipo.esLegal ? 'bajo' : 'medio');
  else {
    if (new Set(metas.map(m => m.trim())).size > 1) h('meta-multiple', 'medio', metas.map(m => `«${m.slice(0, 60)}…»`).join(' · '));
    const n = metas[0].trim().length;
    if (n > 160) h('meta-larga', 'bajo', `${n} caracteres`, metas[0]);
    else if (n < 70) h('meta-corta', 'bajo', `${n} caracteres: «${metas[0]}»`);
    else h('meta-ok', 'ok', `${n} caracteres`);
  }

  const h1 = doc.h1;
  if (!h1.length) h('h1-falta', 'alto');
  else if (h1.every(x => !x.texto)) h('h1-vacio', 'alto');
  else if (h1.length > 1) h('h1-varios', 'bajo', h1.map(x => `«${x.texto.slice(0, 50)}»`).join(' · '));
  else h('h1-ok', 'ok', `«${h1[0].texto.slice(0, 90)}»`);

  // Saltos de nivel (H2 → H4), contados solo en el contenido
  const saltos = [];
  let anterior = 0;
  for (const e of doc.encabezados) {
    if (anterior && e.nivel > anterior + 1) saltos.push(`H${anterior}→H${e.nivel} («${e.texto.slice(0, 40)}»)`);
    anterior = e.nivel;
  }
  if (saltos.length) h('jerarquia-saltos', 'bajo', saltos.slice(0, 4).join(', ') + (saltos.length > 4 ? ` y ${saltos.length - 4} más` : ''));

  const og = ['og:title', 'og:description', 'og:image', 'og:url'].filter(p => !doc.meta(p));
  if (og.length) h('og-incompleto', og.includes('og:image') ? 'medio' : 'bajo', `Faltan: ${og.join(', ')}`);
  else h('og-ok', 'ok');

  if (!doc.meta('viewport')) h('viewport-falta', 'alto');
  if (!doc.lang) h('lang-falta', 'medio');
  if (!doc.charset && !/charset=/i.test(ctx.res.headers.get('content-type') || '')) h('charset-falta', 'bajo');
  if (!doc.doctype) h('doctype-falta', 'bajo');
  if (ctx.tipo.esPortada && !doc.links.some(l => /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/i.test(l.rel || ''))) h('favicon-falta', 'bajo');

  // Enlaces
  const vaciasReales = doc.anclas.filter(a => a.href && !a.href.startsWith('#') && !/^javascript:/i.test(a.href) && !a.texto && !a.imgAlt && !a.aria && !a.title);
  if (vaciasReales.length) h('anclas-vacias', 'medio', `${vaciasReales.length}: ${[...new Set(vaciasReales.map(a => a.href))].slice(0, 4).join(', ')}`);
  const genericas = doc.anclasPrincipal.filter(a => RE_GENERICO.test(a.texto.trim()));
  if (genericas.length) h('anclas-genericas', 'bajo', [...new Set(genericas.map(a => `«${a.texto}»`))].join(', ') + ` (${genericas.length})`);
  const host = new URL(ctx.url).host;
  // Los enlaces con parámetros (?share=, ?replytocom=…) son botones de la plataforma, no páginas
  const internosNofollow = doc.anclas.filter(a => a.abs && new URL(a.abs).host === host && !new URL(a.abs).search && /\bnofollow\b/.test(a.rel));
  if (internosNofollow.length) h('enlaces-internos-nofollow', 'bajo', `${internosNofollow.length}: ${[...new Set(internosNofollow.map(a => a.abs))].slice(0, 3).join(', ')}`);

  // Imágenes
  const imgs = doc.imagenes.filter(i => i.srcAbs && !(ctx.cfg.imagenesIgnoradas || []).some(re => re.test(i.srcAbs)) && !/^data:/.test(i.src || ''));
  const sinAlt = imgs.filter(i => !i.tieneAlt);
  if (sinAlt.length) h('img-sin-alt', sinAlt.length > 3 ? 'medio' : 'bajo', `${sinAlt.length} de ${imgs.length}: ${sinAlt.slice(0, 3).map(i => nombreArchivo(i.srcAbs)).join(', ')}`);
  const genericos = imgs.map(i => nombreArchivo(i.srcAbs)).filter(f => /^(img|image|imagen|foto|photo|dsc|dscn|pxl|screenshot|captura|whatsapp[-_ ]image|unnamed|untitled|sin[-_ ]titulo|[0-9a-f-]{20,})[-_ ]?[\d_-]*(-\d+x\d+)?(-scaled)?\.(png|jpe?g|webp|gif|avif)$/i.test(f));
  if (genericos.length) h('img-nombre-generico', 'bajo', [...new Set(genericos)].slice(0, 4).join(', '));

  // Texto provisional y restos
  const visible = doc.textoCompleto;
  const pend = visible.match(/\[(PENDIENTE|TODO|TBD|POR COMPLETAR|XXX)\]|lorem ipsum|dolor sit amet/i);
  if (pend) h('marcadores-pendientes', 'alto', `«${pend[0]}»`);
  const restos = (doc.html.match(/&lt;!--\s*\/?wp:|\/div&gt;|\[\/?(vc_|et_pb_|fusion_)\w*/g) || []);
  if (restos.length) h('restos-editor', 'alto', `${restos.length} restos, p. ej. «${restos[0]}»`);
}

const nombreArchivo = (u) => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop()); } catch { return u; } };

/* ───────────────────────────── Datos estructurados ───────────────────────────── */
function datos(ctx) {
  const { h, doc, nodosLD } = ctx;
  const bloquesLD = doc.jsonld;

  if (!bloquesLD.length) {
    // El fallo silencioso: el alojamiento quita <script> pero deja el JSON como texto
    if (/[«"“']@context[»"”']\s*:|[«"“']@graph[»"”']\s*:/.test(doc.textoCompleto)) h('jsonld-fugado', 'alto');
    else if (!doc.microdatos && !doc.rdfa) h('jsonld-falta', ctx.tipo.esLegal ? 'bajo' : 'medio');
  }
  if (doc.microdatos || doc.rdfa) h('microdatos', 'info', doc.microdatos ? 'itemscope/itemprop detectado' : 'RDFa detectado');

  const invalidos = bloquesLD.filter(b => !b.ok);
  if (invalidos.length) h('jsonld-invalido', 'alto', invalidos.map(b => b.error).join(' · '), invalidos[0].crudo);

  const sinContext = bloquesLD.filter(b => b.ok && ![].concat(b.datos).every(d => d && typeof d === 'object' && /schema\.org/i.test(JSON.stringify(d['@context'] || ''))));
  if (sinContext.length) h('jsonld-sin-context', 'medio', `${sinContext.length} bloque(s)`);

  if (nodosLD.length) {
    // La ficha de la entidad (Organization, Person, WebSite) se repite en todas las páginas:
    // se valida una vez, en la portada, para no repetir el mismo aviso en cada URL.
    const aValidar = (ctx.tipo.esPortada || !ctx.cfg.modoSitio) ? nodosLD : nodosLD.filter(n => !J.esTipo(n, [...J.TIPOS_ENTIDAD, 'WebSite']));
    const problemas = J.validar(aValidar);
    const req = problemas.filter(p => p.nivel === 'req');
    const rec = problemas.filter(p => p.nivel === 'rec');
    if (req.length) h('jsonld-req', 'medio', req.map(p => `${p.tipo}: ${p.prop}${p.nota ? ' (' + p.nota + ')' : ''}`).join(' · '));
    if (rec.length) h('jsonld-rec', 'bajo', rec.map(p => `${p.tipo}: ${p.prop}${p.nota ? ' (' + p.nota + ')' : ''}`).join(' · '));
    const AUXILIARES = ['ListItem', 'ReadAction', 'SearchAction', 'EntryPoint', 'PropertyValueSpecification', 'ImageObject', 'PostalAddress', 'GeoCoordinates', 'ContactPoint', 'OpeningHoursSpecification', 'Offer', 'Rating', 'AggregateRating', 'Answer', 'Question', 'Place', 'Country', 'City', 'State', 'AdministrativeArea', 'MonetaryAmount', 'QuantitativeValue', 'Language', 'DefinedTerm', 'CreativeWork', 'Thing', 'PriceSpecification'];
    const tipos = [...new Set(nodosLD.flatMap(J.tiposDe))].filter(t => !AUXILIARES.includes(t));
    if (!req.length && !invalidos.length) h('jsonld-ok', 'ok', 'Tipos: ' + tipos.join(', '));
    ctx.tiposLD = tipos;

    if (tipos.includes('HowTo')) h('howto-obsoleto', 'info');
    const faq = nodosLD.filter(n => J.esTipo(n, ['FAQPage']));
    if (faq.length) {
      h('faq-rich-limitado', 'info');
      const preguntas = nodosLD.filter(n => J.esTipo(n, ['Question'])).map(q => q.name).filter(Boolean);
      const visibleNorm = normalizarTexto(doc.textoCompleto);
      const noVisibles = preguntas.filter(p => !visibleNorm.includes(normalizarTexto(p).slice(0, 60)));
      if (preguntas.length && noVisibles.length / preguntas.length > 0.3) {
        h('faq-no-visible', 'alto', `${noVisibles.length} de ${preguntas.length} no aparecen en el texto: «${noVisibles[0].slice(0, 80)}»`);
      }
    }
  }
}

/* ───────────────────────────── Contenido, GEO y AEO ───────────────────────────── */
function contenido(ctx) {
  const { h, doc, tipo, cfg, nodosLD } = ctx;
  const palabras = doc.principal.palabras;
  ctx.palabras = palabras;

  // ¿El contenido está en el HTML o lo pinta JavaScript?
  const raiz = /<div[^>]+id=["'](root|app|__next|__nuxt|___gatsby|svelte)["'][^>]*>\s*<\/div>/i.test(doc.html);
  const scriptsPesados = doc.scripts.filter(s => s.src).length;
  if (doc.palabrasTotal < 80 && (raiz || scriptsPesados >= 3)) {
    h('ia-depende-js', 'critico', `Solo ${doc.palabrasTotal} palabras en el HTML del servidor${raiz ? ' y un contenedor de aplicación vacío' : ''}. Lo que ve un rastreador de IA es prácticamente una página en blanco.`);
  }

  const exenta = tipo.esLegal || (cfg.exentasDeLongitud || []).some(p => ctx.url.includes(p));
  if (!exenta && !tipo.esPortada && !tipo.esArchivo && palabras < (cfg.minPalabras || 300)) {
    h('contenido-escaso', palabras < 120 ? 'medio' : 'bajo', `~${palabras} palabras en el contenido principal (medido en <${doc.principal.origen}>, sin menú ni pie)`);
  }

  // Párrafos largos y bloques sin subtítulo (unidades de extracción)
  const largos = doc.parrafos.filter(p => contarPalabras(p) > 150);
  if (largos.length) h('parrafos-largos', 'bajo', `${largos.length} párrafo(s) de más de 150 palabras. El primero empieza: «${largos[0].slice(0, 70)}…»`);
  if (palabras > 600) {
    const subtitulos = doc.encabezados.filter(e => e.nivel >= 2 && e.nivel <= 4).length;
    const ratio = palabras / Math.max(1, subtitulos);
    if (ratio > 400) h('secciones-largas', 'bajo', `${palabras} palabras y ${subtitulos} subtítulos: una sección cada ~${Math.round(ratio)} palabras.`);
  }

  if (tipo.esLegal) return;

  // AEO: respuesta directa al principio (solo en páginas informativas: en una portada o
  // una página de servicio no tiene sentido exigir «X es…» y daba falsos avisos).
  if (tipo.esInformativa && doc.parrafos.length) {
    const esNavegacion = (t) => (t.match(/·|\|/g) || []).length >= 3 || /^(inicio|home)\b/i.test(t);
    const primero = doc.parrafos.find(t => t.length > 60 && !esNavegacion(t) && !/^(publicado|actualizado|por |escrito por|by |\d{1,2} de )/i.test(t));
    if (primero) {
      const temaH1 = normalizarTexto(doc.h1[0] ? doc.h1[0].texto : doc.title || '').split(' ').filter(w => w.length >= 3 && !['que','como','para','por','los','las','del','una','con','sin','mas','tus','sus','the','and','for'].includes(w));
      const inicio = normalizarTexto(primero.split(/(?<=[.!?:])\s/)[0]).split(' ').slice(0, 20);
      const retomaTema = temaH1.filter(w => inicio.includes(w)).length >= Math.min(2, temaH1.length);
      const directo = contarPalabras(primero) <= 80 && (RE_RESPUESTA.test(primero.slice(0, 240)) || retomaTema);
      if (directo) h('respuesta-directa-ok', 'ok', `«${primero.slice(0, 120)}…»`);
      else h('respuesta-directa-falta', 'bajo', `Empieza: «${primero.slice(0, 140)}…» (${contarPalabras(primero)} palabras)`);
    }
  }

  // AEO: subtítulos en forma de pregunta y longitud de la respuesta que les sigue
  const htmlP = doc.principal.html;
  const reH = /<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
  const preguntas = [];
  let m;
  while ((m = reH.exec(htmlP)) !== null) {
    const t = texto(m[2]);
    if (!RE_PREGUNTA.test(t)) continue;
    const resto = htmlP.slice(m.index + m[0].length);
    const corte = resto.search(/<h[1-6]\b/i);
    const seccion = corte >= 0 ? resto.slice(0, corte) : resto;
    const p = bloques(seccion, 'p').map(b => texto(b.inner)).find(Boolean) || texto(seccion).slice(0, 2000);
    preguntas.push({ pregunta: t, palabras: contarPalabras(p) });
  }
  ctx.preguntas = preguntas.length;
  const largas = preguntas.filter(p => p.palabras > 90);
  if (largas.length) h('preguntas-respuesta-larga', 'bajo', `${largas.length} de ${preguntas.length}. P. ej.: «${largas[0].pregunta}» → ${largas[0].palabras} palabras en el primer párrafo.`);
  if (!preguntas.length && palabras > 800 && tipo.esInformativa) h('preguntas-sin-encabezados', 'info', `${palabras} palabras y ningún H2–H4 formulado como pregunta.`);

  if (palabras > 800 && !doc.listas && !doc.tablas) h('estructura-sin-listas', 'info', `${palabras} palabras sin listas ni tablas.`);

  // GEO: fuentes externas y datos concretos (heurísticas: informativas, no veredictos)
  if (tipo.esInformativa && palabras > 700) {
    const host = new URL(ctx.url).host.replace(/^www\./, '');
    const redes = /(facebook|twitter|x\.com|linkedin|instagram|youtube|tiktok|pinterest|whatsapp|wa\.me|t\.me|google\.com\/maps)/i;
    const externas = doc.anclasPrincipal.filter(a => a.abs && /^https?:/.test(a.abs) && !new URL(a.abs).host.endsWith(host) && !redes.test(a.abs));
    if (!externas.length) h('fuentes-externas-faltan', 'bajo', `${palabras} palabras sin ningún enlace a una fuente externa.`);
    const cifras = (doc.principal.texto.match(/\b\d+(?:[.,]\d+)?\s?(%|€|euros?|eur|\$|d[ií]as|meses|años|horas|minutos|km|m²)|\b(19|20)\d{2}\b/gi) || []).length;
    if (cifras < 2) h('datos-concretos-faltan', 'info', `Se han encontrado ${cifras} dato(s) numérico(s) en ${palabras} palabras.`);
  }

  // GEO / E-E-A-T: fecha y autor en artículos
  if (tipo.esArticulo) {
    const fechas = [];
    nodosLD.filter(n => J.esTipo(n, J.TIPOS_ARTICULO) || J.esTipo(n, ['WebPage'])).forEach(n => { if (n.dateModified) fechas.push(n.dateModified); if (n.datePublished) fechas.push(n.datePublished); });
    ['article:modified_time', 'article:published_time', 'og:updated_time'].forEach(p => { if (doc.meta(p)) fechas.push(doc.meta(p)); });
    const timeTag = doc.html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
    if (timeTag) fechas.push(timeTag[1]);
    const validas = fechas.map(f => new Date(f)).filter(d => !isNaN(d));
    if (!validas.length) h('frescura-sin-fecha', 'bajo');
    else {
      const ultima = new Date(Math.max(...validas));
      const meses = (Date.now() - ultima) / (30.44 * 864e5);
      ctx.fecha = ultima.toISOString().slice(0, 10);
      if (meses > 18) h('frescura-antigua', 'bajo', `Última fecha: ${ctx.fecha} (hace ${Math.round(meses)} meses)`);
    }

    const autorLD = nodosLD.some(n => J.esTipo(n, J.TIPOS_ARTICULO) && n.author);
    const autorHTML = /rel=["'][^"']*\bauthor\b/i.test(doc.html) || /itemprop=["']author["']/i.test(doc.html) || doc.meta('author');
    if (!autorLD && !autorHTML) h('autor-falta', 'medio');
    else h('autor-ok', 'ok', autorLD ? 'author en JSON-LD' : 'firma en HTML');
  }
}

/* ───────────────────────────── Entidad ───────────────────────────── */
function entidad(ctx) {
  const { h, doc, nodosLD, tipo } = ctx;
  const tels = doc.anclas.filter(a => /^tel:/i.test(a.href)).map(a => normalizarTel(a.href.slice(4)));
  const mails = doc.anclas.filter(a => /^mailto:/i.test(a.href));
  ctx.contacto = { tel: tels.length > 0, mail: mails.length > 0 };

  if (tipo.esPortada) {
    const entidades = nodosLD.filter(n => J.esTipo(n, J.TIPOS_ENTIDAD) && Object.keys(n).some(k => !k.startsWith('@')));
    if (!entidades.length) h('entidad-falta', 'medio');
    else {
      const idx = J.indicePorId(nodosLD);
      const conSameAs = entidades.some(n => { const c = n['@id'] && idx.has(n['@id']) ? idx.get(n['@id']) : n; return [].concat(c.sameAs || []).length > 0; });
      if (!conSameAs) h('entidad-sin-sameas', 'bajo', 'Entidades: ' + [...new Set(entidades.flatMap(J.tiposDe))].join(', '));
      else h('entidad-ok', 'ok', [...new Set(entidades.flatMap(J.tiposDe))].join(', '));
    }
    if (!tels.length && !mails.length && !/\b(\+34|0034)?[\s.]?[6789]\d{2}[\s.]?\d{2,3}[\s.]?\d{2,3}[\s.]?\d{0,3}\b/.test(doc.textoCompleto)) h('contacto-falta', 'medio');
  }

  // NAP: el teléfono del marcado debería aparecer también en la página
  const telsLD = nodosLD.map(n => n.telephone).filter(Boolean).flat().map(normalizarTel).filter(t => t.length >= 9);
  const visible = doc.textoCompleto.replace(/[^\d]/g, '');
  if (telsLD.length && (tels.length || /\d{9}/.test(visible))) {
    const coincide = telsLD.some(t => tels.includes(t) || visible.includes(t.replace(/^\+/, '')));
    if (!coincide) h('nap-incoherente', 'medio', `Marcado: ${[...new Set(telsLD)].join(', ')} · Página: ${[...new Set(tels)].join(', ') || 'sin enlace tel:'}`);
  }
}

/* ───────────────────────────── Rendimiento ───────────────────────────── */
function rendimiento(ctx) {
  const { h, res, doc } = ctx;
  if (res.ttfb > 1800) h('ttfb-lento', 'alto', `${res.ttfb} ms hasta las cabeceras (una medición desde el auditor)`);
  else if (res.ttfb > 800) h('ttfb-lento', 'medio', `${res.ttfb} ms hasta las cabeceras (una medición desde el auditor)`);

  const kb = Math.round(res.bytes / 1024);
  if (kb > 1500) h('html-pesado', 'medio', `${kb} KB de HTML`);
  else if (kb > 600) h('html-pesado', 'bajo', `${kb} KB de HTML`);

  const enc = res.headers.get('content-encoding');
  if (!enc && kb > 10) h('sin-compresion', 'medio', `${kb} KB sin Content-Encoding`);

  const bloqueantes = doc.scripts.filter(s => s.enHead && s.src && !('async' in s) && !('defer' in s) && !/module/i.test(s.type || ''));
  if (bloqueantes.length >= 3) h('bloqueo-render', bloqueantes.length >= 6 ? 'medio' : 'bajo', `${bloqueantes.length} scripts: ${bloqueantes.slice(0, 3).map(s => nombreArchivo(s.src)).join(', ')}…`);

  const imgs = doc.imagenes.filter(i => i.srcAbs && !/^data:/.test(i.src || '') && !(ctx.cfg.imagenesIgnoradas || []).some(re => re.test(i.srcAbs)));
  const sinDim = imgs.filter(i => !(i.width && i.height) && !/aspect-ratio/i.test(i.style || ''));
  if (sinDim.length) h('img-sin-dimensiones', sinDim.length > 5 ? 'medio' : 'bajo', `${sinDim.length} de ${imgs.length}: ${sinDim.slice(0, 3).map(i => nombreArchivo(i.srcAbs)).join(', ')}`);

  // La primera imagen de contenido no debería tener lazy: suele ser el LCP.
  const primera = imgs.find(i => !/logo|icon|avatar|gravatar|emoji/i.test(i.srcAbs + ' ' + (i.class || '') + ' ' + (i.alt || '')) && Number(i.width || 999) >= 200);
  if (primera && /lazy/i.test(primera.loading || '') ) h('img-lcp-lazy', 'medio', nombreArchivo(primera.srcAbs));

  const umbral = ctx.cfg.imagenesEager ?? 3;
  const sinLazy = imgs.slice(umbral + 1).filter(i => !/lazy/i.test(i.loading || '') && !/lazy/i.test(i.class || '') && !i['data-src']);
  if (sinLazy.length >= 3) h('img-sin-lazy', 'bajo', `${sinLazy.length} imágenes a partir de la ${umbral + 2}ª: ${sinLazy.slice(0, 3).map(i => nombreArchivo(i.srcAbs)).join(', ')}`);

  const antiguas = imgs.filter(i => /\.(jpe?g|png|gif|bmp)(\?|$)/i.test(i.srcAbs) && !/\.(webp|avif)/i.test(i.srcset || ''));
  if (antiguas.length >= 3 && antiguas.length / imgs.length > 0.5) h('img-formato-antiguo', 'bajo', `${antiguas.length} de ${imgs.length} en JPEG/PNG/GIF sin alternativa WebP/AVIF en srcset.`);
}

/* ───────────────────────────── Seguridad ───────────────────────────── */
function seguridad(ctx) {
  const { h, doc, res } = ctx;
  if (res.finalUrl.startsWith('http://')) { h('sin-https', 'critico', res.finalUrl); return; }
  const mixtos = [
    ...doc.imagenes.map(i => i.src || ''),
    ...doc.scripts.map(s => s.src || ''),
    ...doc.estilos.map(l => l.href || ''),
    ...doc.iframes.map(f => f.src || '')
  ].filter(u => /^http:\/\//i.test(u));
  if (mixtos.length) h('contenido-mixto', 'medio', `${mixtos.length}: ${mixtos.slice(0, 3).join(', ')}`);
}

/* ───────────────────────────── Internacional ───────────────────────────── */
function internacional(ctx) {
  const { h, doc, res } = ctx;
  if (!doc.hreflang.length) return;
  const invalidos = doc.hreflang.filter(x => !/^(x-default|[a-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|\d{3}))?)$/i.test(x.lang) || /_/.test(x.lang));
  if (invalidos.length) h('hreflang-invalido', 'medio', invalidos.map(x => x.lang).join(', '));
  const propia = res.finalUrl.replace(/\/+$/, '');
  if (!doc.hreflang.some(x => (x.href || '').replace(/\/+$/, '') === propia)) h('hreflang-sin-autorreferencia', 'medio', `${doc.hreflang.length} alternativas, ninguna es esta URL.`);
  if (!doc.hreflang.some(x => x.lang.toLowerCase() === 'x-default')) h('hreflang-sin-xdefault', 'info');
}

/* ───────────────────────────── Coherencia configurable ───────────────────────────── */
function coherencia(ctx) {
  const { h, doc, cfg, url } = ctx;
  // Términos de un posicionamiento abandonado, buscados también fuera del cuerpo
  if ((cfg.terminosProhibidos || []).length && !(cfg.listaBlancaTerminos || []).some(p => url.includes(p))) {
    const alts = doc.imagenes.map(i => i.alt || '');
    const meta = doc.meta('description') || '';
    const h1 = doc.h1.map(x => x.texto).join(' ');
    for (const term of cfg.terminosProhibidos) {
      const re = new RegExp(term, 'i');
      if (!re.test(doc.html)) continue;
      const donde = [];
      if (re.test(doc.title || '')) donde.push('el title');
      if (re.test(meta)) donde.push('la meta description');
      if (re.test(h1)) donde.push('el H1');
      if (alts.some(a => re.test(a))) donde.push('un alt de imagen');
      if (!donde.length) donde.push('el cuerpo');
      h('terminos-prohibidos', donde.includes('el cuerpo') ? 'medio' : 'alto', `«${term}» en ${donde.join(' y ')}`);
    }
  }

  // Cargo en la firma: "Por <a rel=author>Nombre</a>, cargo…"
  const firma = doc.html.match(/rel=["'][^"']*\bauthor\b[^"']*["'][^>]*>[^<]*<\/a>\s*(,[^<]{5,120})/i);
  if (firma) ctx.cargo = texto(firma[1]).trim().replace(/\s+/g, ' ').replace(/\.\s+.*$/, '.');

  // Datos que deben decirse igual en todas las páginas
  ctx.valores = {};
  for (const [nombre, patron] of Object.entries(cfg.coherencia || {})) {
    const re = new RegExp(patron, 'g');
    let m;
    while ((m = re.exec(doc.textoCompleto)) !== null) {
      (ctx.valores[nombre] = ctx.valores[nombre] || []).push((m[1] || m[0]).trim().slice(0, 95));
      if (!re.global) break;
    }
  }
}

function auditarPagina(ctx) {
  ctx.nodosLD = ctx.doc.jsonld.filter(b => b.ok).flatMap(b => J.nodos(b.datos));
  ctx.tipo = tipoPagina(ctx);
  rastreo(ctx);
  onpage(ctx);
  datos(ctx);
  contenido(ctx);
  entidad(ctx);
  rendimiento(ctx);
  seguridad(ctx);
  internacional(ctx);
  coherencia(ctx);
}

module.exports = { auditarPagina, normalizarTexto, nombreArchivo };
