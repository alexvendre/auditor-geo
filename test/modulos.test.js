'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const http = require('node:http');
const { parsearCSV, aObjetos, leerZip } = require('../src/util/csv');
const L = require('../src/linkedin');
const IA = require('../src/ia');
const { auditarMarca } = require('../src/marca');
const { analizar } = require('../src/html');
const J = require('../src/jsonld');
const { limpiarCache } = require('../src/http');

const ids = (hs) => hs.map(h => h.id);

/* ── CSV y ZIP ── */
test('csv: comillas, comas y saltos de línea dentro de campos', () => {
  const f = parsearCSV('a,b\n"x, y","línea 1\nlínea 2"\n"con ""comillas""",z\n');
  assert.deepEqual(f, [['a', 'b'], ['x, y', 'línea 1\nlínea 2'], ['con "comillas"', 'z']]);
});

test('csv: salta las notas previas a la cabecera (Connections.csv)', () => {
  const t = 'Notes:\n"When exporting your connection data, some emails are missing."\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nAna,P,u,,Acme,CEO,15 Nov 2026\n';
  const o = aObjetos(t, ['First Name', 'Last Name', 'Connected On']);
  assert.equal(o.length, 1);
  assert.equal(o[0]['Connected On'], '15 Nov 2026');
});

function crearZip(archivos) {
  const locales = [], centrales = [];
  let off = 0;
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const datos = zlib.deflateRawSync(Buffer.from(contenido));
    const n = Buffer.from(nombre);
    const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(8, 8); loc.writeUInt32LE(datos.length, 18); loc.writeUInt32LE(contenido.length, 22); loc.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(datos.length, 20); cen.writeUInt32LE(contenido.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(off, 42);
    locales.push(loc, n, datos); centrales.push(cen, n);
    off += 30 + n.length + datos.length;
  }
  const central = Buffer.concat(centrales);
  const fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(Object.keys(archivos).length, 8); fin.writeUInt16LE(Object.keys(archivos).length, 10); fin.writeUInt32LE(central.length, 12); fin.writeUInt32LE(off, 16);
  return Buffer.concat([...locales, central, fin]);
}

test('zip: lee archivos comprimidos con deflate', () => {
  const z = leerZip(crearZip({ 'Profile.csv': 'Headline\nHola\n', 'carpeta/Skills.csv': 'Name\nSEO\n' }));
  assert.equal(z['Profile.csv'].toString(), 'Headline\nHola\n');
  assert.equal(z['carpeta/Skills.csv'].toString(), 'Name\nSEO\n');
});

/* ── SSI ── */
test('ssi: total, bandas, plan con los dos pilares más bajos', () => {
  const r = L.analizarSSI({ marca: 20, personas: 8, interaccion: 12, relaciones: 22 });
  assert.equal(r.datos.total, 62);
  assert.deepEqual(r.datos.plan.map(p => p.pilar), ['Encontrar a las personas adecuadas', 'Interactuar ofreciendo información']);
  assert.ok(ids(r.hallazgos).includes('ssi-pilar-debil'));
  assert.ok(ids(r.hallazgos).includes('ssi-desequilibrio'));
});

test('ssi: rechaza valores fuera de 0–25 y lee el formato de texto', () => {
  assert.throws(() => L.analizarSSI({ marca: 30, personas: 1, interaccion: 1, relaciones: 1 }));
  assert.deepEqual(L.parsearSSI('18.5, 12, 15, 20, 8, 12'), { marca: 18.5, personas: 12, interaccion: 15, relaciones: 20, sector: 8, red: 12 });
  assert.throws(() => L.parsearSSI('18,12'));
});

test('ssi: tendencia respecto a la medición anterior', () => {
  const r = L.analizarSSI({ marca: 20, personas: 15, interaccion: 15, relaciones: 20 }, [{ fecha: '2026-10-01T00:00:00Z', total: 60 }]);
  assert.equal(r.datos.tendencia.delta, 10);
});

/* ── Exportación de LinkedIn ── */
const AHORA = Date.parse('2026-11-18T12:00:00Z');
const dia = (n) => new Date(AHORA - n * 864e5);
const fechaLI = (d) => `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const exportacion = {
  'Profile.csv': 'First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers\nAna,Pérez,,,,Consultora SEO en Acme,Corto,Marketing,,Barcelona,,,\n',
  'Positions.csv': 'Company Name,Title,Description,Location,Started On,Finished On\nAcme,Consultora,,Barcelona,Jan 2024,\nOtra,Junior,"Hice cosas",Madrid,Jan 2020,Dec 2023\n',
  'Skills.csv': 'Name\nSEO\nGEO\n',
  'Recommendations_Received.csv': 'First Name,Last Name,Company,Job Title,Text,Creation Date,Status\nLuis,G,X,CEO,"Muy buena",01/01/26,VISIBLE\n',
  'Connections.csv': 'Notes:\n"nota"\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\n' + Array.from({ length: 30 }, (_, i) => `N${i},A,u,,C,P,${fechaLI(dia(i * 10))}`).join('\n') + '\n',
  'Shares.csv': 'Date,ShareLink,ShareCommentary,SharedUrl,MediaUrl,Visibility\n' + [5, 20, 40].map(n => `${dia(n).toISOString().slice(0, 19).replace('T', ' ')},l,"texto",,,MEMBER_NETWORK`).join('\n') + '\n',
  'Comments.csv': 'Date,Link,Message\n' + `${dia(3).toISOString().slice(0, 19).replace('T', ' ')},l,"comentario"\n`,
  'Invitations.csv': 'From,To,Sent At,Message,Direction,inviterProfileUrl,inviteeProfileUrl\n' + Array.from({ length: 12 }, (_, i) => `Ana,X${i},${dia(i).toISOString()},${i < 2 ? 'Hola' : ''},OUTGOING,a,b`).join('\n') + '\n'
};

test('linkedin: analiza la exportación sin exponer datos personales', () => {
  const r = L.analizarExportacion(exportacion, AHORA);
  const i = ids(r.hallazgos);
  for (const esperado of ['li-titular-cargo', 'li-extracto-corto', 'li-sin-web', 'li-puestos-sin-descripcion', 'li-aptitudes-pocas', 'li-recomendaciones', 'li-red-pequena', 'li-publica-poco', 'li-comenta-poco', 'li-invitaciones-genericas']) {
    assert.ok(i.includes(esperado), 'falta ' + esperado);
  }
  assert.equal(r.datos.red.contactos, 30);
  assert.equal(r.datos.red.nuevos90, 9);
  assert.equal(r.datos.actividad.publicaciones90, 3);
  const texto = JSON.stringify(r);
  assert.ok(!/Luis|N12|Muy buena|Hola/.test(texto), 'el resultado no debe contener nombres ni textos');
});

test('linkedin: lee la exportación desde un ZIP y desde una carpeta', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'li-'));
  const zip = path.join(dir, 'export.zip');
  fs.writeFileSync(zip, crearZip(Object.fromEntries(Object.entries(exportacion).map(([k, v]) => ['Basic_LinkedInDataExport/' + k, v]))));
  assert.equal(Object.keys(L.leerExportacion(zip)).length, Object.keys(exportacion).length);
  const carpeta = path.join(dir, 'carpeta');
  fs.mkdirSync(carpeta);
  Object.entries(exportacion).forEach(([k, v]) => fs.writeFileSync(path.join(carpeta, k), v));
  assert.equal(Object.keys(L.leerExportacion(carpeta)).length, Object.keys(exportacion).length);
});

test('linkedin: checklist distingue pendiente, hecho y sin comprobar', () => {
  const r = L.analizarChecklist({ fotoProfesional: true, banner: false, destacados: null });
  assert.deepEqual(ids(r.hallazgos).sort(), ['li-checklist-ok', 'li-checklist-pendiente', 'li-checklist-sin-dato']);
});

test('linkedin: guarda el historial y calcula la evolución en la siguiente medición', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ssi-')), 'ssi.jsonl');
  fs.writeFileSync(f, JSON.stringify({ fecha: '2026-10-01T09:00:00Z', total: 40 }) + '\n');
  L.estudioLinkedIn({ ssi: { marca: 10, personas: 10, interaccion: 10, relaciones: 10 }, historial: f });
  // Una segunda medición el mismo día se compara con la de otro día, no con la de hace un minuto
  const r = L.estudioLinkedIn({ ssi: { marca: 12, personas: 10, interaccion: 10, relaciones: 10 }, historial: f });
  assert.equal(r.datos.ssi.tendencia.delta, 2);
  assert.equal(fs.readFileSync(f, 'utf8').trim().split('\n').length, 3);
});

/* ── Visibilidad en IA ── */
test('ia: detecta mención, enlace, posición y competidores', () => {
  const a = IA.analizarRespuesta({ texto: 'Te recomiendo a Alex Vendrell o a SEO Bros.', citas: [{ url: 'https://otra.com/x' }, { url: 'https://www.alexvendrell.com/seo/' }] },
    { marcas: ['Alex Vendrell'], dominio: 'alexvendrell.com', competidores: ['SEO Bros', 'Nadie'] });
  assert.equal(a.mencionada, true);
  assert.equal(a.enlazada, true);
  assert.equal(a.posicionCita, 2);
  assert.deepEqual(a.competidores, ['SEO Bros']);
});

test('ia: no confunde una palabra contenida en otra', () => {
  const a = IA.analizarRespuesta({ texto: 'Las auditorías de Alexandra son buenas', citas: [] }, { marcas: ['Alex'], dominio: 'alex.com' });
  assert.equal(a.mencionada, false);
});

test('ia: interpreta las respuestas de cada proveedor', async () => {
  const falso = (cuerpo) => async () => ({ ok: true, status: 200, text: async () => JSON.stringify(cuerpo) });
  process.env.OPENAI_API_KEY = process.env.PERPLEXITY_API_KEY = process.env.GEMINI_API_KEY = 'x';
  const o = await IA.proveedores.openai('q', { fetch: falso({ model: 'm', output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'Hola', annotations: [{ type: 'url_citation', url: 'https://a.com', title: 'A' }] }] }] }) });
  assert.deepEqual([o.texto, o.citas[0].url], ['Hola', 'https://a.com']);
  const p = await IA.proveedores.perplexity('q', { fetch: falso({ choices: [{ message: { content: 'Hola' } }], citations: ['https://b.com'], search_results: [{ url: 'https://b.com', title: 'B' }] }) });
  assert.deepEqual(p.citas.map(c => c.url), ['https://b.com']);
  const g = await IA.proveedores.gemini('q', { fetch: falso({ candidates: [{ content: { parts: [{ text: 'Ho' }, { text: 'la' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://redir', title: 'c.com' } }] } }] }) });
  assert.deepEqual([g.texto, g.citas[0].titulo], ['Hola', 'c.com']);
  // Claude: cliente simulado con una pausa de turno y citas en los bloques de texto
  let llamadas = 0;
  const cliente = { beta: { messages: { create: async (req) => {
    llamadas++;
    assert.equal(req.tools[0].type, 'web_search_20260209');
    if (llamadas === 1) return { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use' }] };
    return { stop_reason: 'end_turn', model: req.model, content: [
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://d.com', title: 'D' }] },
      { type: 'text', text: 'Respuesta', citations: [{ type: 'web_search_result_location', url: 'https://d.com', title: 'D' }] }
    ] };
  } } } };
  const c = await IA.proveedores.claude('q', { cliente });
  assert.equal(llamadas, 2);
  assert.equal(c.texto, 'Respuesta');
  assert.ok(c.citas.some(x => x.url === 'https://d.com'));
});

test('ia: sin claves no consulta nada y explica qué configurar', async () => {
  const guardadas = {};
  for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'PERPLEXITY_API_KEY', 'GEMINI_API_KEY']) { guardadas[k] = process.env[k]; delete process.env[k]; }
  try {
    const r = await IA.visibilidadIA({ marca: 'X', categoria: 'consultor SEO' });
    assert.deepEqual(ids(r.hallazgos), ['ia-sin-proveedores']);
  } finally { Object.entries(guardadas).forEach(([k, v]) => { if (v !== undefined) process.env[k] = v; }); }
});

test('ia: resume menciones, enlaces y competidores por delante', async () => {
  process.env.PERPLEXITY_API_KEY = 'x';
  const respuestas = ['Te recomiendo SEO Bros y también SEO Bros Plus.', 'La mejor opción es SEO Bros.'];
  let k = 0;
  const fetchFalso = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: respuestas[k++ % 2] } }], citations: ['https://seobros.com'] }) });
  const r = await IA.visibilidadIA({ marca: 'Alex Vendrell', dominio: 'alexvendrell.com', consultas: ['a', 'b'], competidores: ['SEO Bros'], proveedores: ['perplexity'], fetch: fetchFalso });
  assert.ok(ids(r.hallazgos).includes('ia-sin-menciones'));
  assert.ok(ids(r.hallazgos).includes('ia-competidores-delante'));
  assert.equal(r.datos.registros.length, 2);
});

/* ── Marca ── */
test('marca: nombre incoherente, perfil roto y perfil que enlaza de vuelta', async () => {
  limpiarCache();
  const s = await new Promise(ok => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/perfil-ok') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<a href="https://midominio.com">web</a>'); return; }
      res.writeHead(404); res.end('no');
    });
    srv.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${srv.address().port}`, cerrar: () => srv.close() }));
  });
  try {
    const ld = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Mi Marca', url: 'https://midominio.com', sameAs: [s.base + '/perfil-ok', s.base + '/borrado'] };
    const html = `<html><head><title>Inicio | Otra Empresa SL</title><meta property="og:site_name" content="Mi Marca"><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><p>Bienvenido a Mi Marca</p></body></html>`;
    const doc = analizar(html, 'https://midominio.com/');
    const r = await auditarMarca({ doc, nodosLD: doc.jsonld.flatMap(b => J.nodos(b.datos)), origen: 'https://midominio.com' });
    const i = ids(r.hallazgos);
    assert.ok(i.includes('marca-nombre-incoherente'));
    assert.ok(i.includes('marca-perfil-roto'));
    assert.ok(i.includes('marca-perfiles-ok'));
    assert.ok(i.includes('marca-sin-linkedin'));
    assert.ok(i.includes('marca-org-incompleta'));
  } finally { s.cerrar(); }
});
