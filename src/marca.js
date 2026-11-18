'use strict';
/**
 * Auditoría de marca y entidad.
 *
 * Buscadores y modelos de IA no posicionan «páginas»: identifican entidades
 * (una empresa, una persona) y las reconocen cuando muchas fuentes dicen lo mismo
 * de ellas. Este módulo comprueba lo que se puede comprobar desde fuera:
 * cómo se declara la entidad, si el nombre es coherente, si los perfiles externos
 * existen y enlazan de vuelta, y si la marca está en bases de conocimiento abiertas.
 */

const { pedir, enParalelo, UA_NAVEGADOR } = require('./http');
const J = require('./jsonld');
const { normalizarTexto } = require('./checks/pagina');

const PLATAFORMAS = [
  { id: 'linkedin', nombre: 'LinkedIn', re: /linkedin\.com\/(in|company|school)\//i, cerrada: true },
  { id: 'gbp', nombre: 'Google Business Profile', re: /(g\.page\/|maps\.app\.goo\.gl|google\.[a-z.]+\/maps|business\.google\.com|\bcid=\d+)/i, cerrada: true },
  { id: 'youtube', nombre: 'YouTube', re: /youtube\.com\/(@|c\/|channel\/|user\/)/i },
  { id: 'x', nombre: 'X / Twitter', re: /(twitter|x)\.com\/[A-Za-z0-9_]+/i, cerrada: true },
  { id: 'instagram', nombre: 'Instagram', re: /instagram\.com\//i, cerrada: true },
  { id: 'facebook', nombre: 'Facebook', re: /facebook\.com\//i, cerrada: true },
  { id: 'tiktok', nombre: 'TikTok', re: /tiktok\.com\/@/i, cerrada: true },
  { id: 'github', nombre: 'GitHub', re: /github\.com\/[A-Za-z0-9-]+/i },
  { id: 'wikidata', nombre: 'Wikidata', re: /wikidata\.org\/(wiki|entity)\/Q\d+/i },
  { id: 'wikipedia', nombre: 'Wikipedia', re: /wikipedia\.org\/wiki\//i },
  { id: 'crunchbase', nombre: 'Crunchbase', re: /crunchbase\.com\//i },
  { id: 'medium', nombre: 'Medium', re: /medium\.com\/@/i },
  { id: 'bluesky', nombre: 'Bluesky', re: /bsky\.app\/profile\//i }
];

const plataforma = (u) => PLATAFORMAS.find(p => p.re.test(u)) || { id: 'otra', nombre: (() => { try { return new URL(u).host; } catch { return u; } })() };

/** Comprobaciones que no se pueden automatizar sin incumplir condiciones de uso o sin APIs de pago. */
const VERIFICACION_MANUAL = [
  { que: 'Busca el nombre exacto de la marca en Google (sesión privada)', mirar: '¿La web es el primer resultado? ¿Aparece panel de conocimiento o ficha de empresa? ¿Hay resultados de terceros que hablen de ti?' },
  { que: 'Google Business Profile', mirar: 'Categoría principal correcta, horario, fotos recientes, reseñas respondidas y mismo nombre, dirección y teléfono que en la web.' },
  { que: 'Pregunta a ChatGPT, Claude, Gemini y Perplexity «¿Quién es [marca]?» y «Recomiéndame [servicio] en [zona]»', mirar: 'Anota herramienta, fecha, consulta, si te menciona, si enlaza tu web y qué fuentes cita. Repite cada mes con las mismas consultas (o usa el módulo de visibilidad en IA).' },
  { que: 'Perfil de LinkedIn (personal y de empresa)', mirar: 'Mismo cargo, misma propuesta y enlace a la web. Ver el estudio de SSI.' },
  { que: 'Menciones en medios, directorios y asociaciones del sector', mirar: 'Fuentes que un modelo considere fiables y que nombren la marca con el mismo nombre y la misma descripción.' },
  { que: 'Reseñas en plataformas independientes', mirar: 'Volumen, recencia y respuestas. Las reseñas propias marcadas en la web no cuentan como prueba externa.' }
];

function nombresDeclarados(doc, nodosLD) {
  const nombres = [];
  const ent = nodosLD.filter(n => J.esTipo(n, [...J.TIPOS_ENTIDAD, 'WebSite']) && n.name);
  ent.forEach(n => nombres.push({ origen: `JSON-LD ${J.tiposDe(n).join('/')}`, valor: String(n.name) }));
  if (doc.meta('og:site_name')) nombres.push({ origen: 'og:site_name', valor: doc.meta('og:site_name') });
  const sufijo = (doc.title || '').split(/\s[|–—·•\-]\s/).slice(1).pop();
  if (sufijo && sufijo.length <= 40) nombres.push({ origen: 'sufijo del title', valor: sufijo.trim() });
  const copy = doc.textoCompleto.match(/©\s*(?:\d{4}\s*[-–]?\s*\d{0,4})?\s*([A-ZÀ-Ý][\wÀ-ÿ&.\- ]{2,40}?)(?=\.|\s[-–|·]|\s{2}|$|\s(?:Todos|All|Tots))/);
  if (copy) nombres.push({ origen: 'copyright del pie', valor: copy[1].trim() });
  return nombres;
}

/**
 * @param {object} p { doc, nodosLD, origen, nombre (opcional), perfiles: [], linkedinUrl, wikidata: bool, llmsH1 }
 */
async function auditarMarca(p) {
  const hallazgos = [];
  const h = (id, severidad, detalle = '') => hallazgos.push({ id, severidad, detalle, url: p.origen + '/' });
  const { doc, nodosLD } = p;
  const idx = J.indicePorId(nodosLD);
  const completa = (n) => (n['@id'] && idx.has(n['@id'])) ? idx.get(n['@id']) : n;
  const entidades = nodosLD.filter(n => J.esTipo(n, J.TIPOS_ENTIDAD)).map(completa).filter(n => n.name);
  const personas = entidades.filter(n => J.esTipo(n, ['Person']));
  const orgs = entidades.filter(n => !J.esTipo(n, ['Person']));
  const tipo = personas.length && !orgs.length ? 'persona' : orgs.length && !personas.length ? 'organizacion' : personas.length ? 'mixta' : 'desconocida';

  // 1. Coherencia del nombre
  const nombres = nombresDeclarados(doc, nodosLD);
  if (p.llmsH1) nombres.push({ origen: 'llms.txt', valor: p.llmsH1 });
  const nombre = p.nombre || (orgs[0] && orgs[0].name) || (personas[0] && personas[0].name) || doc.meta('og:site_name') || null;
  const n0 = normalizarTexto(nombre || '');
  if (nombre) {
    const distintos = nombres.filter(x => { const v = normalizarTexto(x.valor); return v && !v.includes(n0) && !n0.includes(v); });
    if (distintos.length) h('marca-nombre-incoherente', 'medio', `Referencia: «${nombre}». Distinto en: ${distintos.map(d => `${d.origen} «${d.valor}»`).join(' · ')}`);
    else if (nombres.length > 1) h('marca-nombre-ok', 'ok', `«${nombre}» en ${nombres.length} lugares`);
    if (p.nombre && !normalizarTexto(doc.textoCompleto).includes(n0)) h('marca-nombre-ausente', 'alto', `«${p.nombre}» no aparece en el texto de la portada`);
  }

  // 2. Ficha de la entidad
  if (personas.length) {
    const per = personas[0];
    const faltan = ['jobTitle', 'image', 'sameAs', 'url', 'knowsAbout'].filter(k => !per[k] || (Array.isArray(per[k]) && !per[k].length));
    if (!per.worksFor && !per.affiliation) faltan.push('worksFor');
    if (faltan.length) h('marca-persona-incompleta', faltan.length > 2 ? 'medio' : 'bajo', `${per.name}: falta ${faltan.join(', ')}`);
    else h('marca-persona-ok', 'ok', String(per.name));
  }
  if (orgs.length) {
    const o = orgs[0];
    const faltan = ['logo', 'url', 'sameAs'].filter(k => !o[k]);
    if (!o.contactPoint && !o.telephone && !o.email) faltan.push('contactPoint o telephone');
    if (J.esTipo(o, J.SUBTIPOS_NEGOCIO) && !o.address) faltan.push('address');
    if (!o.description) faltan.push('description');
    if (faltan.length) h('marca-org-incompleta', faltan.length > 2 ? 'medio' : 'bajo', `${o.name}: falta ${faltan.join(', ')}`);
    else h('marca-org-ok', 'ok', String(o.name));
  }

  // 3. Perfiles externos declarados (sameAs) y enlaces a redes en la portada
  const sameAs = [...new Set(entidades.flatMap(n => [].concat(n.sameAs || [])).filter(u => /^https?:\/\//.test(u)))];
  const enlacesRedes = [...new Set(doc.anclas.map(a => a.abs).filter(u => u && PLATAFORMAS.some(pl => pl.re.test(u))))];
  const host = new URL(p.origen).host.replace(/^www\./, '');
  const propio = (u) => { try { return new URL(u).host.replace(/^www\./, '') === host; } catch { return false; } };
  const todos = [...new Set([...sameAs, ...(p.perfiles || []), ...(p.linkedinUrl ? [p.linkedinUrl] : [])])].filter(u => !propio(u));
  const perfiles = await enParalelo(todos.slice(0, 20), 3, async (u) => {
    const pl = plataforma(u);
    const r = await pedir(u, { ua: UA_NAVEGADOR, timeoutMs: 12000 });
    const bloqueado = [999, 401, 403, 429].includes(r.status) || r.status === 0 && pl.cerrada;
    const enlazaVuelta = r.status === 200 && r.body.toLowerCase().includes(host);
    const estado = r.status === 200 ? (enlazaVuelta ? 'enlaza a la web' : 'existe') : bloqueado ? 'no verificable' : [404, 410].includes(r.status) ? 'no existe' : `HTTP ${r.status}`;
    return { url: u, plataforma: pl.nombre, id: pl.id, status: r.status, estado, enSameAs: sameAs.includes(u), enlazaVuelta };
  });
  const rotos = perfiles.filter(x => x.estado === 'no existe');
  if (rotos.length) h('marca-perfil-roto', 'alto', rotos.map(x => `${x.plataforma}: ${x.url}`).join(' · '));
  const noVerif = perfiles.filter(x => x.estado === 'no verificable');
  if (noVerif.length) h('marca-perfil-no-verificable', 'info', noVerif.map(x => x.plataforma).join(', '));
  const redesSinDeclarar = enlacesRedes.filter(u => !sameAs.some(s => s.replace(/\/$/, '').toLowerCase() === u.replace(/\/$/, '').toLowerCase()));
  if (redesSinDeclarar.length && entidades.length) h('marca-redes-sin-sameas', 'bajo', redesSinDeclarar.slice(0, 5).join(' · '));
  const ids = new Set(perfiles.map(x => x.id));
  if (!ids.has('linkedin') && !enlacesRedes.some(u => /linkedin/i.test(u))) h('marca-sin-linkedin', 'medio');
  if (p.linkedinUrl && !sameAs.some(s => s.toLowerCase().includes(p.linkedinUrl.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')))) h('marca-linkedin-no-declarado', 'bajo', p.linkedinUrl);
  if (orgs.some(o => J.esTipo(o, J.SUBTIPOS_NEGOCIO)) && !ids.has('gbp')) h('marca-sin-gbp', 'info');
  const conVuelta = perfiles.filter(x => x.enlazaVuelta).length;
  if (perfiles.length && conVuelta) h('marca-perfiles-ok', 'ok', `${conVuelta} de ${perfiles.length} perfiles enlazan de vuelta a ${host}`);

  // 4. Bases de conocimiento abiertas (opcional: hace peticiones a terceros)
  let wikidata = null;
  if (p.wikidata && nombre) {
    const r = await pedir(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(nombre)}&language=es&uselang=es&format=json&limit=5`, { ua: 'auditor-geo/3 (https://github.com/alexvendre/auditor-geo)', timeoutMs: 12000 });
    if (r.status === 200) {
      try {
        const d = JSON.parse(r.body);
        wikidata = (d.search || []).map(x => ({ id: x.id, etiqueta: x.label, descripcion: x.description || '' }));
        const exacta = wikidata.find(x => normalizarTexto(x.etiqueta) === n0);
        h('marca-wikidata', 'info', exacta ? `Entrada encontrada: ${exacta.id} «${exacta.etiqueta}» — ${exacta.descripcion}${ids.has('wikidata') ? '' : '. No está en sameAs: añádela.'}` : 'Sin entrada con ese nombre. Solo procede crearla si la marca cumple los criterios de notabilidad de Wikidata.');
      } catch { /* respuesta no válida */ }
    } else h('marca-wikidata', 'info', `No se pudo consultar Wikidata (${r.status ? 'HTTP ' + r.status : r.error}).`);
  }
  let kg = null;
  if (process.env.KG_API_KEY && nombre) {
    const r = await pedir(`https://kgsearch.googleapis.com/v1/entities:search?query=${encodeURIComponent(nombre)}&limit=3&languages=es&key=${encodeURIComponent(process.env.KG_API_KEY)}`, { timeoutMs: 12000 });
    if (r.status === 200) {
      try {
        kg = (JSON.parse(r.body).itemListElement || []).map(x => ({ nombre: x.result.name, tipos: x.result['@type'], descripcion: x.result.description || '', puntuacion: x.resultScore }));
        const exacta = kg.find(x => normalizarTexto(x.nombre) === n0);
        h('marca-knowledge-graph', exacta ? 'ok' : 'info', exacta ? `Google reconoce la entidad: «${exacta.nombre}» (${[].concat(exacta.tipos).join(', ')})` : 'Google Knowledge Graph no devuelve una entidad con ese nombre exacto.');
      } catch { /* nada */ }
    }
  }

  return { hallazgos, datos: { nombre, tipo, nombres, perfiles, wikidata, kg, verificacionManual: VERIFICACION_MANUAL } };
}

module.exports = { auditarMarca, PLATAFORMAS, VERIFICACION_MANUAL };
