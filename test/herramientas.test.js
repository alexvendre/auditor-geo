'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { comparar } = require('../src/comparar');
const G = require('../src/generar');
const { limpiarCache } = require('../src/http');

test('comparar: resuelto, nuevo, mejora y empeora', () => {
  const g = (id, n, severidad = 'medio') => ({ id, titulo: id, severidad, casos: Array.from({ length: n }, () => ({})) });
  const antes = { meta: { fecha: '2026-10-01T00:00:00Z' }, grupos: [g('a', 3), g('b', 5), g('c', 1), g('ok-x', 9, 'ok')] };
  const ahora = { grupos: [g('b', 2), g('c', 4), g('d', 1)] };
  const r = comparar(ahora, antes);
  assert.deepEqual(r.resueltos.map(x => x.id), ['a']);
  assert.deepEqual(r.mejoran.map(x => x.id), ['b']);
  assert.deepEqual(r.empeoran.map(x => x.id), ['c']);
  assert.deepEqual(r.nuevos.map(x => x.id), ['d']);
  assert.equal(r.casosAntes, 9);
  assert.equal(r.casosAhora, 7);
});

function servidor() {
  return new Promise(ok => {
    const s = http.createServer((req, res) => {
      const base = 'http://127.0.0.1:' + s.address().port;
      const html = (titulo, desc, extra = '') => `<!doctype html><html lang="es"><head><title>${titulo} | Mi Marca</title><meta name="description" content="${desc}"><meta property="og:site_name" content="Mi Marca"></head><body><h1>${titulo}</h1>${extra}</body></html>`;
      const rutas = {
        '/robots.txt': ['text/plain', `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`],
        '/sitemap.xml': ['application/xml', `<urlset><url><loc>${base}/</loc></url><url><loc>${base}/servicios/</loc></url><url><loc>${base}/2026/10/01/articulo/</loc></url><url><loc>${base}/aviso-legal/</loc></url></urlset>`],
        '/': ['text/html', html('Inicio', 'Consultoría para despachos en Sabadell.', '<a href="https://www.linkedin.com/in/mi-perfil/">LinkedIn</a><a href="tel:+34600000000">Tel</a>')],
        '/servicios/': ['text/html', html('Servicios', 'Qué hacemos.')],
        '/2026/10/01/articulo/': ['text/html', html('Un artículo', 'Resumen del artículo.')],
        '/aviso-legal/': ['text/html', html('Aviso legal', 'Datos legales.')]
      };
      const r = rutas[req.url];
      if (!r) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': r[0] }); res.end(r[1]);
    });
    s.listen(0, '127.0.0.1', () => ok({ url: 'http://127.0.0.1:' + s.address().port, cerrar: () => s.close() }));
  });
}

test('generar: llms.txt agrupa páginas, artículos y opcional', async () => {
  limpiarCache();
  const s = await servidor();
  try {
    const r = await G.generarLlms(s.url);
    assert.match(r.texto, /^# Mi Marca/);
    assert.match(r.texto, /> Consultoría para despachos en Sabadell\./);
    assert.match(r.texto, /## Páginas\n\n- \[Servicios\]\(.*\/servicios\/\): Qué hacemos\./);
    assert.match(r.texto, /## Artículos\n\n- \[Un artículo\]/);
    assert.match(r.texto, /## Opcional\n\n- \[Aviso legal\]/);
  } finally { s.cerrar(); }
});

test('generar: JSON-LD con datos reales y huecos marcados, robots con la decisión explícita', async () => {
  limpiarCache();
  const s = await servidor();
  try {
    const sc = await G.generarSchema(s.url, 'negocio');
    const ld = JSON.parse(sc.texto.replace(/<\/?script[^>]*>/g, ''));
    assert.equal(ld['@type'], 'ProfessionalService');
    assert.equal(ld.telephone, '+34600000000');
    assert.deepEqual(ld.sameAs, ['https://www.linkedin.com/in/mi-perfil/']);
    assert.ok(sc.huecos > 0);
    const rb = await G.generarRobots(s.url);
    assert.match(rb.texto, /User-agent: OAI-SearchBot[\s\S]*Allow: \//);
    assert.match(rb.texto, /Sitemap: http:\/\/127\.0\.0\.1/);
  } finally { s.cerrar(); }
});

test('mcp: inicializa, lista herramientas y ejecuta una', async () => {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'mcp.js')], { stdio: ['pipe', 'pipe', 'ignore'] });
  const respuestas = [];
  let buf = '';
  const listo = new Promise((ok) => p.stdout.on('data', (d) => {
    buf += d;
    buf.split('\n').slice(0, -1).forEach(l => respuestas.push(JSON.parse(l)));
    buf = buf.split('\n').pop();
    if (respuestas.length >= 4) ok();
  }));
  const msg = (m) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  msg({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  msg({ method: 'notifications/initialized' });
  msg({ id: 2, method: 'tools/list' });
  msg({ id: 3, method: 'tools/call', params: { name: 'estudio_linkedin_ssi', arguments: { marca: 20, personas: 8, interaccion: 12, relaciones: 22 } } });
  msg({ id: 4, method: 'metodo/inexistente' });
  await listo;
  p.kill();
  const por = Object.fromEntries(respuestas.map(r => [r.id, r]));
  assert.equal(por[1].result.serverInfo.name, 'auditor-geo');
  assert.ok(por[2].result.tools.some(t => t.name === 'auditar_web'));
  assert.match(por[3].result.content[0].text, /Social Selling Index/);
  assert.equal(por[4].error.code, -32601);
});
