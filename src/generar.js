'use strict';
/**
 * Generadores: no solo decir qué falla, sino dar un primer borrador del arreglo.
 * Todo lo generado es un BORRADOR para revisar: los huecos que la herramienta no
 * puede conocer se marcan con [COMPLETAR] en vez de inventarse.
 */

const { pedir, enParalelo, UA_NAVEGADOR } = require('./http');
const { analizar } = require('./html');
const J = require('./jsonld');
const R = require('./robots');
const S = require('./checks/sitio');
const { PLATAFORMAS } = require('./marca');

const nada = () => {};
const sinMarca = (t) => (t || '').split(/\s[|–—·•\-]\s/)[0].trim();
const md = (s) => String(s || '').replace(/([\[\]()])/g, '\\$1').replace(/\s+/g, ' ').trim();

async function portada(url) {
  const inicial = /^https?:\/\//.test(url) ? url : 'https://' + url;
  const r = await pedir(inicial, { ua: UA_NAVEGADOR });
  if (r.status !== 200) throw new Error(`No se pudo leer ${inicial} (${r.status || r.error})`);
  const origen = new URL(r.finalUrl).origin;
  const home = await pedir(origen + '/', { ua: UA_NAVEGADOR });
  const doc = analizar(home.body || r.body, origen + '/');
  const nodos = doc.jsonld.filter(b => b.ok).flatMap(b => J.nodos(b.datos));
  const entidad = nodos.find(n => J.esTipo(n, J.TIPOS_ENTIDAD) && n.name);
  const nombre = doc.meta('og:site_name') || (entidad && entidad.name) || sinMarca(doc.title) || new URL(origen).host;
  return { origen, doc, nodos, entidad, nombre };
}

/** llms.txt a partir del sitemap: título y descripción de cada página, agrupados. */
async function generarLlms(url, { max = 80 } = {}) {
  const { origen, doc, nombre } = await portada(url);
  const rob = await S.robots(origen, nada);
  const sm = await S.sitemaps(origen, rob.parsed.sitemaps, nada);
  const urls = sm.urls.map(u => u.loc).filter(u => u.startsWith(origen) && new URL(u).pathname !== '/').slice(0, max);
  const paginas = (await enParalelo(urls, 4, async (u) => {
    const r = await pedir(u, { ua: UA_NAVEGADOR });
    if (r.status !== 200 || !/html/i.test(r.contentType || '')) return null;
    const d = analizar(r.body, r.finalUrl);
    if (/noindex/i.test(d.metasTodas('robots').join(' '))) return null;
    const ruta = new URL(r.finalUrl).pathname;
    const articulo = /\/(19|20)\d{2}\/\d{2}\//.test(ruta) || d.jsonld.some(b => b.ok && J.nodos(b.datos).some(n => J.esTipo(n, J.TIPOS_ARTICULO)));
    const opcional = /privacidad|cookies|aviso-legal|legal|terminos|gracias|\/(category|tag|author|page)\//i.test(ruta);
    return { url: r.finalUrl, titulo: sinMarca(d.title) || (d.h1[0] && d.h1[0].texto) || ruta, desc: d.meta('description') || '', grupo: opcional ? 'Opcional' : articulo ? 'Artículos' : 'Páginas' };
  })).filter(Boolean);

  const L = [`# ${nombre}`, ''];
  L.push(`> ${md(doc.meta('description')) || '[COMPLETAR: una o dos frases que digan quién eres, qué ofreces y para quién]'}`, '');
  L.push('[COMPLETAR (opcional): contexto que ayude a un modelo a entender el sitio: zona de trabajo, especialidad, cómo contactar.]', '');
  for (const g of ['Páginas', 'Artículos', 'Opcional']) {
    const ps = paginas.filter(p => p.grupo === g);
    if (!ps.length) continue;
    L.push(`## ${g}`, '');
    ps.forEach(p => L.push(`- [${md(p.titulo)}](${p.url})${p.desc ? `: ${md(p.desc)}` : ''}`));
    L.push('');
  }
  return { texto: L.join('\n'), paginas: paginas.length, sitemap: sm.urls.length };
}

/** Bloque de robots.txt para rastreadores de IA, con la decisión de entrenamiento explícita. */
async function generarRobots(url) {
  const { origen } = await portada(url);
  const rob = await S.robots(origen, nada);
  const L = [
    '# ── Rastreadores de IA (generado por auditor-geo: revísalo antes de publicarlo) ──',
    '# Búsqueda y peticiones de usuario: permitirlos es lo que hace posible que te citen.'
  ];
  R.BOTS_IA.filter(b => ['busqueda', 'usuario'].includes(b.tipo)).forEach(b => L.push(`User-agent: ${b.token}`));
  L.push('Allow: /', '', '# Entrenamiento de modelos: decisión de negocio. Por defecto se permite;',
    '# para bloquearlo, cambia «Allow: /» por «Disallow: /» en este grupo.');
  R.BOTS_IA.filter(b => ['entrenamiento', 'token'].includes(b.tipo)).forEach(b => L.push(`User-agent: ${b.token}`));
  L.push('Allow: /', '');
  const sitemaps = rob.parsed.sitemaps.length ? rob.parsed.sitemaps : [origen + '/sitemap.xml'];
  sitemaps.forEach(s => L.push(`Sitemap: ${s}`));
  const aviso = rob.existe
    ? 'Ya tienes robots.txt: añade este bloque sin borrar tus reglas actuales, y comprueba que ningún grupo «User-agent: *» con «Disallow: /» lo contradice.'
    : 'No hay robots.txt: este bloque puede ser el archivo completo.';
  return { texto: L.join('\n'), aviso };
}

/** JSON-LD de la entidad con lo que ya se sabe de la web y huecos marcados. */
async function generarSchema(url, tipo = 'organizacion') {
  const { origen, doc, entidad, nombre } = await portada(url);
  const perfiles = [...new Set([
    ...[].concat((entidad && entidad.sameAs) || []),
    ...doc.anclas.map(a => a.abs).filter(u => u && PLATAFORMAS.some(p => p.re.test(u)))
  ])].filter(u => /^https?:\/\//.test(u) && !u.replace(/\/$/, '').startsWith(origen));
  const tel = (doc.anclas.find(a => /^tel:/i.test(a.href)) || {}).href;
  const mail = (doc.anclas.find(a => /^mailto:/i.test(a.href)) || {}).href;
  const C = '[COMPLETAR]';
  const base = {
    '@context': 'https://schema.org',
    '@id': `${origen}/#${tipo === 'persona' ? 'persona' : 'organizacion'}`,
    name: nombre,
    url: origen + '/',
    description: doc.meta('description') || C,
    sameAs: perfiles.length ? perfiles : [`${C}: https://www.linkedin.com/in/…`]
  };
  let ld;
  if (tipo === 'persona') {
    const per = entidad && J.esTipo(entidad, ['Person']) ? entidad : {};
    ld = { ...base, '@type': 'Person', jobTitle: per.jobTitle || C, image: doc.meta('og:image') || C, knowsAbout: per.knowsAbout || [C], worksFor: { '@type': 'Organization', name: C }, ...(mail ? { email: mail.slice(7) } : {}) };
  } else {
    const local = tipo === 'negocio';
    ld = {
      ...base, '@type': local ? 'ProfessionalService' : 'Organization',
      logo: (entidad && entidad.logo) || C,
      ...(tel ? { telephone: tel.slice(4) } : { telephone: C }),
      ...(mail ? { email: mail.slice(7) } : {}),
      ...(local ? { address: { '@type': 'PostalAddress', streetAddress: C, addressLocality: C, postalCode: C, addressCountry: 'ES' }, areaServed: C, priceRange: C } : {}),
      founder: { '@type': 'Person', name: C }
    };
  }
  return { texto: `<script type="application/ld+json">\n${JSON.stringify(ld, null, 2)}\n</script>`, huecos: JSON.stringify(ld).split(C).length - 1 };
}

module.exports = { generarLlms, generarRobots, generarSchema };
