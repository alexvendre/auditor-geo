'use strict';
/**
 * Pruebas de extremo a extremo contra servidores locales que reproducen casos reales.
 * Cada caso que debería pasar limpio se prueba también: una regla que da falsos
 * positivos es peor que no tenerla.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { auditar } = require('../src/auditoria');
const { limpiarCache } = require('../src/http');

function servidor(manejar) {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const r = manejar(req) || { status: 404, body: 'no' };
      res.writeHead(r.status || 200, { 'content-type': r.tipo || 'text/html; charset=utf-8', ...(r.headers || {}) });
      res.end(r.body || '');
    });
    s.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${s.address().port}`, cerrar: () => s.close() }));
  });
}

const pagina = ({ title = 'Servicio de auditoría SEO para despachos | Marca', h1 = 'Auditoría SEO para despachos', cuerpo = '', head = '', enlaces = '' } = {}) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="description" content="Auditoría SEO, GEO y AEO para despachos profesionales con informe priorizado, explicación de cada problema y cómo resolverlo.">
<meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="https://x/i.webp"><meta property="og:url" content="u">
<link rel="icon" href="/favicon.ico">${head}</head>
<body><nav><a href="/">Inicio</a><a href="/contacto/">Contacto</a><a href="/sobre-mi/">Sobre mí</a><a href="/aviso-legal/">Aviso legal</a></nav>
<main><h1>${h1}</h1>${cuerpo}${enlaces}</main><footer><a href="tel:+34600000000">600 000 000</a><a href="mailto:a@b.c">a@b.c</a></footer></body></html>`;

const texto = (n) => Array.from({ length: Math.ceil(n / 80) }, (_, k) => Array.from({ length: 80 }, (_, i) => `palabra${(i + k) % 50}`).join(' ')).join('</p><p>');
const ids = (r) => r.hallazgos.map(h => h.id);
const de = (r, id) => r.hallazgos.filter(h => h.id === id);

test.beforeEach(() => limpiarCache());

test('falso positivo: el servidor rechaza a cualquier bot, también a Googlebot', async () => {
  const s = await servidor((req) => {
    if (/bot|crawl|spider|agent/i.test(req.headers['user-agent'])) return { status: 403, body: 'Forbidden' };
    if (req.url === '/robots.txt') return { tipo: 'text/plain', body: 'User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n' };
    if (req.url === '/') return { body: pagina({ cuerpo: `<p>${texto(400)}</p>` }) };
  });
  try {
    const r = await auditar(s.url + '/');
    assert.ok(ids(r).includes('ia-acceso-falso-positivo'));
    assert.ok(!ids(r).includes('ia-acceso-bloqueado'));
  } finally { s.cerrar(); }
});

test('bloqueo real: el servidor rechaza a los bots de IA pero no a Googlebot', async () => {
  const s = await servidor((req) => {
    if (/GPTBot|OAI-SearchBot|ClaudeBot|Claude-SearchBot|PerplexityBot/i.test(req.headers['user-agent'])) return { status: 403, body: 'no' };
    if (req.url === '/') return { body: pagina({ cuerpo: `<p>${texto(400)}</p>` }) };
  });
  try {
    const r = await auditar(s.url + '/');
    const b = de(r, 'ia-acceso-bloqueado');
    assert.equal(b.length, 1);
    assert.equal(b[0].severidad, 'alto');
  } finally { s.cerrar(); }
});

test('robots.txt: bloquear el entrenamiento no es bloquear la búsqueda', async () => {
  const s = await servidor((req) => {
    if (req.url === '/robots.txt') return { tipo: 'text/plain', body: 'User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n' };
    if (req.url === '/') return { body: pagina({ cuerpo: `<p>${texto(400)}</p>` }) };
  });
  try {
    const r = await auditar(s.url + '/', { bots: false });
    assert.ok(!ids(r).includes('ia-robots-busqueda-bloqueado'));
    assert.equal(de(r, 'ia-robots-entrenamiento-bloqueado')[0].severidad, 'info');
  } finally { s.cerrar(); }
});

test('robots.txt: bloquear OAI-SearchBot es un problema alto', async () => {
  const s = await servidor((req) => {
    if (req.url === '/robots.txt') return { tipo: 'text/plain', body: 'User-agent: OAI-SearchBot\nDisallow: /\n' };
    if (req.url === '/') return { body: pagina({ cuerpo: `<p>${texto(400)}</p>` }) };
  });
  try {
    const r = await auditar(s.url + '/', { bots: false });
    assert.equal(de(r, 'ia-robots-busqueda-bloqueado')[0].severidad, 'alto');
  } finally { s.cerrar(); }
});

test('robots.txt con error 5xx es crítico', async () => {
  const s = await servidor((req) => {
    if (req.url === '/robots.txt') return { status: 503, body: 'caído' };
    if (req.url === '/') return { body: pagina() };
  });
  try {
    const r = await auditar(s.url + '/', { bots: false });
    assert.equal(de(r, 'robots-error-servidor')[0].severidad, 'critico');
  } finally { s.cerrar(); }
});

test('aplicación que pinta el contenido con JavaScript', async () => {
  const s = await servidor((req) => {
    if (req.url === '/') return { body: '<!doctype html><html lang="es"><head><title>App</title><script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script></head><body><div id="root"></div></body></html>' };
  });
  try {
    const r = await auditar(s.url + '/', { bots: false });
    assert.equal(de(r, 'ia-depende-js')[0].severidad, 'critico');
  } finally { s.cerrar(); }
});

test('una página bien hecha no da falsos positivos de contenido', async () => {
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'ProfessionalService', '@id': '#n', name: 'Marca', url: 'https://x', logo: 'l', image: 'i', address: { '@type': 'PostalAddress', addressLocality: 'Sabadell' }, telephone: '+34600000000', geo: { '@type': 'GeoCoordinates' }, openingHoursSpecification: [{}], sameAs: ['https://linkedin.com/x'] },
    { '@type': 'WebSite', name: 'Marca', url: 'https://x' }
  ] });
  const s = await servidor((req) => {
    if (req.url === '/') return { body: pagina({ head: `<link rel="canonical" href="${'http://127.0.0.1:' + req.socket.localPort}/"><script type="application/ld+json">${ld}</script>`, cuerpo: `<p>${texto(400)}</p>`, enlaces: '<a href="/contacto/">Pide presupuesto de auditoría</a>' }) };
  });
  try {
    const r = await auditar(s.url + '/', { bots: false });
    const problemas = r.hallazgos.filter(h => !['ok', 'info'].includes(h.severidad)).map(h => h.id);
    // En http local solo se esperan avisos que dependen del entorno de prueba
    const esperados = ['robots-falta', 'sitemap-falta', 'soft-404', 'sin-https'];
    assert.deepEqual(problemas.filter(p => !esperados.includes(p)), [], 'Problemas inesperados: ' + problemas.join(', '));
    assert.ok(ids(r).includes('entidad-ok'));
  } finally { s.cerrar(); }
});

test('FAQPage con preguntas que no se ven en la página', async () => {
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [
    { '@type': 'Question', name: '¿Cuánto cuesta una auditoría SEO completa?', acceptedAnswer: { '@type': 'Answer', text: 'Depende' } },
    { '@type': 'Question', name: '¿Cuánto tarda en verse el resultado del trabajo?', acceptedAnswer: { '@type': 'Answer', text: 'Meses' } }
  ] });
  const s = await servidor((req) => { if (req.url === '/faq/') return { body: pagina({ head: `<script type="application/ld+json">${ld}</script>`, cuerpo: `<p>${texto(400)}</p>` }) }; });
  try {
    const r = await auditar(s.url + '/faq/', { bots: false });
    assert.equal(de(r, 'faq-no-visible')[0].severidad, 'alto');
  } finally { s.cerrar(); }
});

test('JSON-LD fugado como texto y nosnippet', async () => {
  const s = await servidor((req) => {
    if (req.url === '/') return { body: pagina({ head: '<meta name="robots" content="index, nosnippet">', cuerpo: `<p>{«@context»: «https://schema.org», «@type»: «Organization»}</p><p>${texto(300)}</p>` }) };
  });
  try {
    const r = await auditar(s.url + '/', { bots: false });
    assert.ok(ids(r).includes('jsonld-fugado'));
    assert.equal(de(r, 'snippet-restringido')[0].severidad, 'alto');
  } finally { s.cerrar(); }
});

test('modo sitio: huérfanas, enlaces rotos, duplicados y sitemap incoherente', async () => {
  const s = await servidor((req) => {
    const base = 'http://127.0.0.1:' + req.socket.localPort;
    const rutas = {
      '/robots.txt': { tipo: 'text/plain', body: `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n` },
      '/sitemap.xml': { tipo: 'application/xml', body: `<?xml version="1.0"?><urlset>${['/', '/a/', '/b/', '/huerfana/', '/oculta/', '/vieja/'].map(u => `<url><loc>${base}${u}</loc></url>`).join('')}</urlset>` },
      '/': { body: pagina({ title: 'Portada | Marca', cuerpo: `<p>${texto(350)}</p>`, enlaces: '<a href="/a/">Página A sobre auditorías</a><a href="/b/">Página B sobre auditorías</a><a href="/rota/">Enlace roto a una página</a>' }) },
      '/a/': { body: pagina({ title: 'Mismo título repetido | Marca', cuerpo: `<p>${texto(350)}</p>` }) },
      '/b/': { body: pagina({ title: 'Mismo título repetido | Marca', cuerpo: `<p>${texto(350)}</p>` }) },
      '/huerfana/': { body: pagina({ title: 'Página huérfana sin enlaces | Marca', cuerpo: `<p>${'texto distinto '.repeat(200)}</p>` }) },
      '/oculta/': { body: pagina({ title: 'Página con noindex en el sitemap | Marca', head: '<meta name="robots" content="noindex">' }) },
      '/vieja/': { status: 301, headers: { location: '/a/' } }
    };
    return rutas[req.url];
  });
  try {
    const r = await auditar(s.url + '/', { sitio: true, bots: false, max: 20 });
    assert.ok(de(r, 'huerfanas').some(h => h.url.endsWith('/huerfana/')), 'huérfana');
    assert.ok(de(r, 'enlace-roto-interno').length, 'enlace roto');
    assert.equal(de(r, 'duplicado-title').length, 2, 'title duplicado');
    assert.ok(de(r, 'duplicado-contenido').length, 'contenido duplicado');
    assert.ok(de(r, 'sitemap-url-noindex').some(h => h.url.endsWith('/oculta/')), 'noindex en sitemap');
    assert.ok(de(r, 'sitemap-url-redirige').some(h => h.url.endsWith('/vieja/')), 'redirección en sitemap');
    assert.ok(!de(r, 'huerfanas').some(h => h.url.endsWith('/a/')), '/a/ no es huérfana');
  } finally { s.cerrar(); }
});

test('soft 404 y llms.txt mal formado', async () => {
  const s = await servidor((req) => {
    if (req.url === '/llms.txt') return { tipo: 'text/plain', body: 'Esto es un llms.txt sin título ni enlaces, solo texto plano.' };
    return { body: pagina({ cuerpo: `<p>${texto(350)}</p>` }) };
  });
  try {
    const r = await auditar(s.url + '/', { bots: false });
    assert.ok(ids(r).includes('soft-404'));
    assert.ok(ids(r).includes('llms-formato'));
  } finally { s.cerrar(); }
});

test('modo sitio: el marcado global (https://dominio/#…) solo se valida en la portada', async () => {
  const s = await servidor((req) => {
    const base = 'http://127.0.0.1:' + req.socket.localPort;
    const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': [
      { '@type': 'ProfessionalService', '@id': base + '/#negocio', name: 'Marca', hasOfferCatalog: { '@type': 'OfferCatalog', itemListElement: [{ '@type': 'Service', name: 'SEO' }] } },
      { '@type': 'WebPage', '@id': base + req.url }
    ] });
    const head = `<script type="application/ld+json">${ld}</script>`;
    if (req.url === '/') return { body: pagina({ title: 'Portada | Marca', head, cuerpo: `<p>${texto(350)}</p>`, enlaces: '<a href="/a/">Página A sobre auditorías</a>' }) };
    if (req.url === '/a/') return { body: pagina({ title: 'Página A con su propio título | Marca', head, cuerpo: `<p>${'texto distinto '.repeat(200)}</p>` }) };
  });
  try {
    const r = await auditar(s.url + '/', { sitio: true, bots: false, max: 5 });
    const urls = de(r, 'jsonld-rec').concat(de(r, 'jsonld-req')).map(h => new URL(h.url).pathname);
    assert.ok(urls.includes('/'), 'la portada sí avisa');
    assert.ok(!urls.includes('/a/'), 'las páginas interiores no repiten el aviso del marcado global');
  } finally { s.cerrar(); }
});

test('límite de peticiones: reintenta tras un 429 y no lo confunde con un error de la página', async () => {
  let vistas = 0;
  const s = await servidor((req) => {
    if (req.url === '/') {
      vistas++;
      if (vistas === 1) return { status: 429, headers: { 'retry-after': '1' }, body: 'Too Many Requests' };
      return { body: pagina({ cuerpo: `<p>${texto(350)}</p>` }) };
    }
  });
  try {
    const r = await auditar(s.url + '/', { bots: false });
    assert.ok(!ids(r).includes('http-error'));
    assert.equal(de(r, 'servidor-limita')[0].severidad, 'info');
  } finally { s.cerrar(); }
});
