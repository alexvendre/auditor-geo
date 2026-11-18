'use strict';
/**
 * Visibilidad en asistentes de IA.
 *
 * Hace las mismas preguntas que haría un cliente a varios asistentes con búsqueda
 * web y registra, para cada respuesta: herramienta, modelo, fecha, consulta, si
 * menciona la marca, si enlaza la web, en qué posición, qué competidores salen y
 * qué fuentes cita. El registro se acumula en un archivo JSONL para comparar
 * entre meses con las mismas consultas.
 *
 * Límites que el informe deja claros:
 *  - Se consulta la API, no la aplicación de consumo: las respuestas se parecen
 *    pero no son idénticas (personalización, historial, modelo por defecto).
 *  - Las respuestas no son deterministas: una aparición puntual no es una tendencia.
 *  - Cada consulta cuesta dinero en la cuenta del usuario. Nada se ejecuta sin
 *    claves configuradas y sin pedirlo expresamente con --ia.
 */

const fs = require('fs');
const path = require('path');
const { normalizarTexto } = require('./checks/pagina');

/* ───────────────────────── Proveedores ───────────────────────── */

/** Claude (Anthropic) con búsqueda web. Usa el SDK oficial, que se instala aparte. */
async function claude(consulta, op = {}) {
  let cliente = op.cliente;
  if (!cliente) {
    let Anthropic;
    try { Anthropic = require('@anthropic-ai/sdk'); } catch { throw new Error('Instala el SDK de Anthropic para usar Claude: npm install @anthropic-ai/sdk'); }
    cliente = new (Anthropic.default || Anthropic)();
  }
  const modelo = op.modelo || process.env.CLAUDE_MODEL || 'claude-opus-5-5';
  const herramienta = { type: 'web_search_20260209', name: 'web_search', max_uses: 5 };
  if (op.pais) herramienta.user_location = { type: 'approximate', country: op.pais, ...(op.ciudad ? { city: op.ciudad } : {}) };
  const messages = [{ role: 'user', content: consulta }];
  let r;
  for (let i = 0; i < 4; i++) {
    r = await cliente.beta.messages.create({
      model: modelo,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      tools: [herramienta],
      messages
    });
    // Con herramientas de servidor el turno puede pausarse: se reenvía para que continúe
    if (r.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: r.content });
  }
  if (r.stop_reason === 'refusal') throw new Error('El modelo declinó responder' + (r.stop_details && r.stop_details.category ? ` (${r.stop_details.category})` : ''));
  const texto = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const citas = [];
  for (const b of r.content) {
    if (b.type === 'text' && Array.isArray(b.citations)) b.citations.forEach(c => c.url && citas.push({ url: c.url, titulo: c.title || '' }));
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(x => x.url && citas.push({ url: x.url, titulo: x.title || '', consultada: true }));
  }
  return { texto, citas, modelo: r.model || modelo };
}

async function postJSON(url, cuerpo, cabeceras, fetchFn = fetch) {
  const r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', ...cabeceras }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(120000) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
  return JSON.parse(txt);
}

/** OpenAI (ChatGPT) mediante la API Responses con la herramienta web_search. */
async function openai(consulta, op = {}) {
  const modelo = op.modelo || process.env.OPENAI_MODEL || 'gpt-5';
  const d = await postJSON((process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1') + '/responses',
    { model: modelo, input: consulta, tools: [{ type: 'web_search' }] },
    { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, op.fetch);
  const citas = [];
  let texto = '';
  for (const item of d.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) {
      if (c.type === 'output_text') {
        texto += c.text || '';
        (c.annotations || []).filter(a => a.type === 'url_citation' && a.url).forEach(a => citas.push({ url: a.url, titulo: a.title || '' }));
      }
    }
  }
  return { texto: texto || d.output_text || '', citas, modelo: d.model || modelo };
}

/** Perplexity (modelos Sonar, con búsqueda incorporada). */
async function perplexity(consulta, op = {}) {
  const modelo = op.modelo || process.env.PERPLEXITY_MODEL || 'sonar';
  const d = await postJSON((process.env.PERPLEXITY_BASE_URL || 'https://api.perplexity.ai') + '/chat/completions',
    { model: modelo, messages: [{ role: 'user', content: consulta }] },
    { authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` }, op.fetch);
  const texto = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
  const urls = [...(d.search_results || []).map(s => ({ url: s.url, titulo: s.title || '' })), ...(d.citations || []).map(u => ({ url: u, titulo: '' }))];
  const vistos = new Set();
  return { texto, citas: urls.filter(c => c.url && !vistos.has(c.url) && vistos.add(c.url)), modelo: d.model || modelo };
}

/** Gemini con Grounding con la Búsqueda de Google. */
async function gemini(consulta, op = {}) {
  const modelo = op.modelo || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
  const d = await postJSON(`${base}/models/${encodeURIComponent(modelo)}:generateContent`,
    { contents: [{ role: 'user', parts: [{ text: consulta }] }], tools: [{ google_search: {} }] },
    { 'x-goog-api-key': process.env.GEMINI_API_KEY }, op.fetch);
  const cand = (d.candidates || [])[0] || {};
  const texto = ((cand.content && cand.content.parts) || []).map(p => p.text || '').join('');
  // Las URLs de grounding son redirecciones; el título lleva el dominio de la fuente
  const citas = ((cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || []).filter(c => c.web).map(c => ({ url: c.web.uri, titulo: c.web.title || '' }));
  return { texto, citas, modelo };
}

const PROVEEDORES = {
  chatgpt: { nombre: 'ChatGPT (OpenAI API)', fn: openai, disponible: () => !!process.env.OPENAI_API_KEY, requisito: 'OPENAI_API_KEY' },
  claude: { nombre: 'Claude (Anthropic API)', fn: claude, disponible: () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN), requisito: 'ANTHROPIC_API_KEY y npm install @anthropic-ai/sdk' },
  perplexity: { nombre: 'Perplexity (Sonar API)', fn: perplexity, disponible: () => !!process.env.PERPLEXITY_API_KEY, requisito: 'PERPLEXITY_API_KEY' },
  gemini: { nombre: 'Gemini (Google AI API)', fn: gemini, disponible: () => !!process.env.GEMINI_API_KEY, requisito: 'GEMINI_API_KEY' }
};

/* ───────────────────────── Análisis ───────────────────────── */

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function analizarRespuesta(resp, { marcas, dominio, competidores = [] }) {
  const textoN = normalizarTexto(resp.texto);
  const menciona = (nombres) => nombres.some(n => { const x = normalizarTexto(n); return x && new RegExp(`(^| )${escapar(x)}( |$)`).test(textoN); });
  const dominioN = (dominio || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
  const enCita = (c) => { try { return new URL(c.url).host.replace(/^www\./, '').toLowerCase().endsWith(dominioN); } catch { return false; } } ;
  const citaPropia = dominioN ? resp.citas.findIndex(c => enCita(c) || (c.titulo || '').toLowerCase().replace(/^www\./, '') === dominioN) : -1;
  const mencionada = menciona(marcas) || (dominioN && resp.texto.toLowerCase().includes(dominioN));
  return {
    mencionada: !!mencionada,
    enlazada: citaPropia >= 0 || (!!dominioN && resp.texto.toLowerCase().includes(dominioN)),
    posicionCita: citaPropia >= 0 ? citaPropia + 1 : null,
    competidores: competidores.filter(c => menciona([].concat(c.nombres || c.nombre || c))).map(c => c.nombre || [].concat(c)[0]),
    fuentes: [...new Set(resp.citas.map(c => { try { return new URL(c.url).host.replace(/^www\./, ''); } catch { return c.titulo; } }))].slice(0, 10)
  };
}

function plantillaConsultas({ marca, categoria, zona }) {
  const c = [];
  if (marca) c.push(`¿Quién es ${marca}?`, `¿Qué opiniones hay sobre ${marca}?`);
  if (categoria) {
    const donde = zona ? ` en ${zona}` : '';
    c.push(`Recomiéndame ${categoria}${donde}`, `¿Cuáles son los mejores ${categoria}${donde}?`, `¿Qué ${categoria}${donde} me recomiendas para una empresa?`);
  }
  return c;
}

/**
 * @param {object} op { marca, alias:[], dominio, categoria, zona, consultas:[], competidores:[], proveedores:[], repeticiones, historial, pais }
 */
async function visibilidadIA(op, progreso = () => {}) {
  const hallazgos = [];
  const h = (id, severidad, detalle = '') => hallazgos.push({ id, severidad, detalle, url: 'Asistentes de IA' });
  const marcas = [op.marca, ...(op.alias || [])].filter(Boolean);
  const consultas = (op.consultas && op.consultas.length) ? op.consultas : plantillaConsultas(op);
  const elegidos = (op.proveedores && op.proveedores.length ? op.proveedores : Object.keys(PROVEEDORES)).filter(p => PROVEEDORES[p]);
  const activos = elegidos.filter(p => op.forzar || PROVEEDORES[p].disponible());

  if (!marcas.length) throw new Error('La visibilidad en IA necesita el nombre de la marca (--marca)');
  if (!consultas.length) throw new Error('Indica las consultas (--consultas archivo.txt) o una categoría (--categoria "consultor SEO") para generarlas');
  if (!activos.length) {
    h('ia-sin-proveedores', 'info', 'Configura al menos una clave: ' + elegidos.map(p => `${PROVEEDORES[p].nombre} → ${PROVEEDORES[p].requisito}`).join(' · '));
    return { hallazgos, datos: { registros: [], consultas, proveedores: [] } };
  }

  const registros = [];
  const fecha = new Date().toISOString();
  const rep = Math.max(1, op.repeticiones || 1);
  let n = 0;
  const total = activos.length * consultas.length * rep;
  for (const p of activos) {
    for (const consulta of consultas) {
      for (let k = 0; k < rep; k++) {
        progreso(`IA ${++n}/${total}: ${PROVEEDORES[p].nombre} · ${consulta}`);
        try {
          const resp = await PROVEEDORES[p].fn(consulta, { pais: op.pais, ciudad: op.ciudad, modelo: op.modelos && op.modelos[p], fetch: op.fetch, cliente: op.clientes && op.clientes[p] });
          const a = analizarRespuesta(resp, { marcas, dominio: op.dominio, competidores: op.competidores });
          registros.push({ fecha, herramienta: PROVEEDORES[p].nombre, proveedor: p, modelo: resp.modelo, consulta, ...a, fragmento: resp.texto.slice(0, 600) });
        } catch (e) {
          registros.push({ fecha, herramienta: PROVEEDORES[p].nombre, proveedor: p, consulta, error: String(e.message || e).slice(0, 300) });
        }
      }
    }
  }

  if (op.historial) {
    fs.mkdirSync(path.dirname(path.resolve(op.historial)), { recursive: true });
    fs.appendFileSync(op.historial, registros.map(r => JSON.stringify(r)).join('\n') + '\n');
  }

  const validos = registros.filter(r => !r.error);
  const errores = registros.filter(r => r.error);
  if (errores.length) h('ia-error', 'info', [...new Set(errores.map(e => `${e.herramienta}: ${e.error}`))].slice(0, 4).join(' · '));

  const porProveedor = activos.map(p => {
    const rs = validos.filter(r => r.proveedor === p);
    return { proveedor: PROVEEDORES[p].nombre, respuestas: rs.length, menciones: rs.filter(r => r.mencionada).length, enlaces: rs.filter(r => r.enlazada).length };
  }).filter(x => x.respuestas);

  if (validos.length) {
    const menciones = validos.filter(r => r.mencionada).length;
    const enlaces = validos.filter(r => r.enlazada).length;
    const resumen = porProveedor.map(x => `${x.proveedor}: ${x.menciones}/${x.respuestas} menciones, ${x.enlaces} con enlace`).join(' · ');
    if (!menciones) h('ia-sin-menciones', 'alto', `0 de ${validos.length} respuestas mencionan la marca. ${resumen}`);
    else {
      h('ia-visibilidad', 'info', `${menciones} de ${validos.length} respuestas (${Math.round(menciones / validos.length * 100)} %) mencionan la marca. ${resumen}`);
      if (!enlaces) h('ia-mencion-sin-enlace', 'medio', `Te mencionan ${menciones} veces pero ninguna respuesta cita tu web como fuente.`);
    }
    // Competidores que aparecen más que la marca
    const cuenta = {};
    validos.forEach(r => r.competidores.forEach(c => { cuenta[c] = (cuenta[c] || 0) + 1; }));
    const delante = Object.entries(cuenta).filter(([, v]) => v > menciones).sort((a, b) => b[1] - a[1]);
    if (delante.length) h('ia-competidores-delante', 'medio', delante.map(([c, v]) => `${c}: ${v} menciones`).join(' · ') + ` (tu marca: ${menciones})`);
    // Fuentes más citadas: dónde conviene estar presente
    const fuentes = {};
    validos.forEach(r => r.fuentes.forEach(f => { fuentes[f] = (fuentes[f] || 0) + 1; }));
    const top = Object.entries(fuentes).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (top.length) h('ia-fuentes-citadas', 'info', top.map(([f, v]) => `${f} (${v})`).join(' · '));
  }

  return { hallazgos, datos: { registros, consultas, proveedores: porProveedor, competidores: (op.competidores || []).map(c => c.nombre || c) } };
}

module.exports = { visibilidadIA, analizarRespuesta, plantillaConsultas, PROVEEDORES, proveedores: { claude, openai, perplexity, gemini } };
