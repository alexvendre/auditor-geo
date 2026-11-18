'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/robots');
const J = require('../src/jsonld');
const { analizar } = require('../src/html');

test('robots: la regla más larga gana y Allow gana en empate', () => {
  const p = R.parsear('User-agent: *\nDisallow: /privado/\nAllow: /privado/publico\n');
  assert.equal(R.permitido(p, 'GPTBot', '/privado/x').permitido, false);
  assert.equal(R.permitido(p, 'GPTBot', '/privado/publico').permitido, true);
  assert.equal(R.permitido(p, 'GPTBot', '/').permitido, true);
});

test('robots: un grupo específico sustituye al de *', () => {
  const p = R.parsear('User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n');
  assert.equal(R.permitido(p, 'OAI-SearchBot', '/').permitido, true);
  assert.equal(R.permitido(p, 'GPTBot', '/').permitido, false);
});

test('robots: varios User-agent seguidos forman un solo grupo', () => {
  const p = R.parsear('User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n');
  assert.equal(R.permitido(p, 'ClaudeBot', '/').permitido, false);
  assert.equal(R.permitido(p, 'GPTBot', '/').permitido, false);
  assert.equal(R.permitido(p, 'PerplexityBot', '/').permitido, true);
});

test('robots: comodines, $ y Disallow vacío', () => {
  const p = R.parsear('User-agent: *\nDisallow: /*.pdf$\nDisallow:\n');
  assert.equal(R.permitido(p, 'x', '/doc.pdf').permitido, false);
  assert.equal(R.permitido(p, 'x', '/doc.pdf?v=1').permitido, true);
  assert.equal(R.permitido(p, 'x', '/').permitido, true);
});

test('robots: lee Sitemap y Content-Signal y detecta líneas no válidas', () => {
  const p = R.parsear('User-agent: *\nContent-Signal: search=yes, ai-train=no\nAllow: /\nSitemap: https://a.com/s.xml\nesto no vale\n');
  assert.deepEqual(p.sitemaps, ['https://a.com/s.xml']);
  assert.deepEqual(p.senales, ['search=yes, ai-train=no']);
  assert.equal(p.errores.length, 1);
});

test('jsonld: resuelve @id y no marca como incompleta una referencia', () => {
  const datos = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'Organization', '@id': '#org', name: 'X', url: 'https://x.com', logo: 'l.png', sameAs: ['https://linkedin.com/x'] },
    { '@type': 'WebPage', publisher: { '@id': '#org' } },
    { '@type': 'Article', headline: 'H', author: { '@id': '#p' }, datePublished: '2026-01-01', dateModified: '2026-01-02', image: 'i.png' },
    { '@type': 'Person', '@id': '#p', name: 'Ana', url: 'https://x.com/ana', sameAs: ['https://linkedin.com/ana'], jobTitle: 'SEO' }
  ] };
  assert.deepEqual(J.validar(J.nodos(datos)), []);
});

test('jsonld: detecta obligatorias que faltan y author como texto', () => {
  const datos = [{ '@type': 'LocalBusiness', name: 'Bar' }, { '@type': 'BlogPosting', headline: 'H', author: 'Ana' }, { '@type': 'Product', name: 'P' }];
  const pr = J.validar(J.nodos(datos));
  assert.ok(pr.some(p => p.nivel === 'req' && p.prop === 'address'));
  assert.ok(pr.some(p => p.prop === 'author.name'));
  assert.ok(pr.some(p => p.tipo === 'Product' && p.nivel === 'req'));
});

test('html: el contenido principal excluye menú y pie', () => {
  const d = analizar('<html><body><nav><a href="/a">Inicio</a> uno dos tres</nav><main><h1>T</h1><p>Hola mundo cruel</p></main><footer>pie pie pie pie</footer></body></html>', 'https://x.com/');
  assert.equal(d.principal.origen, 'main');
  assert.equal(d.principal.palabras, 4);
  assert.equal(d.anclas.length, 1);
  assert.equal(d.anclasPrincipal.length, 0);
});

test('html: alt vacío es alt (imagen decorativa), sin atributo no', () => {
  const d = analizar('<img src="a.png" alt=""><img src="b.png">', 'https://x.com/');
  assert.equal(d.imagenes[0].tieneAlt, true);
  assert.equal(d.imagenes[1].tieneAlt, false);
});

test('html: decodifica entidades en title y metas', () => {
  const d = analizar('<title>SEO &amp; GEO &#8211; Ana</title><meta name="description" content="Qu&eacute; tal">', 'https://x.com/');
  assert.equal(d.title, 'SEO & GEO – Ana');
});
