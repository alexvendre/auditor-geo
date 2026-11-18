'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const L = require('../src/logs');

const UA = {
  oai: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.3; +https://openai.com/searchbot',
  claudeSearch: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Claude-SearchBot/1.0; +https://www.anthropic.com',
  claudeBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +claudebot@anthropic.com',
  google: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  persona: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 Safari/537.36'
};
const linea = (ip, dia, ruta, status, ua) => `${ip} - - [${String(dia).padStart(2, '0')}/Nov/2026:10:00:00 +0100] "GET ${ruta} HTTP/1.1" ${status} 1234 "-" "${ua}"`;

test('logs: interpreta Combined Log Format con zona horaria', () => {
  const r = L.parsearLinea(linea('1.2.3.4', 5, '/blog/?a=1', 200, UA.google));
  assert.equal(r.ip, '1.2.3.4');
  assert.equal(r.ruta, '/blog/?a=1');
  assert.equal(r.status, 200);
  assert.equal(r.fecha.toISOString(), '2026-11-05T09:00:00.000Z');
});

test('logs: interpreta JSON por línea con nombres de campo variados', () => {
  const r = L.parsearLinea(JSON.stringify({ date: '2026-11-10T08:00:00Z', request_url: 'https://dominio.com/servicios/', status: '301', user_agent: UA.oai, user_ip: '9.9.9.9' }));
  assert.deepEqual([r.ruta, r.status, r.ip], ['/servicios/', 301, '9.9.9.9']);
});

test('logs: distingue Claude-SearchBot de ClaudeBot y no confunde personas con bots', () => {
  assert.equal(L.agenteDe(UA.claudeSearch).token, 'Claude-SearchBot');
  assert.equal(L.agenteDe(UA.claudeBot).token, 'ClaudeBot');
  assert.equal(L.agenteDe(UA.persona), null);
});

test('logs: rangos CIDR', () => {
  assert.equal(L.enRango('20.171.207.5', '20.171.206.0/23'), true);
  assert.equal(L.enRango('20.171.208.5', '20.171.206.0/23'), false);
  assert.equal(L.enRango('::1', '20.171.206.0/23'), false);
});

test('logs: errores de un bot, páginas sin visitar y archivo comprimido', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-'));
  const lineas = [
    ...Array.from({ length: 10 }, (_, i) => linea('20.171.207.5', 1 + i, '/', 200, UA.oai)),
    ...Array.from({ length: 8 }, (_, i) => linea('3.3.3.3', 2 + i, '/servicios/', 403, UA.claudeSearch)),
    ...Array.from({ length: 2 }, (_, i) => linea('3.3.3.3', 3 + i, '/', 200, UA.claudeSearch)),
    linea('66.249.66.1', 20, '/blog/', 200, UA.google),
    ...Array.from({ length: 50 }, (_, i) => linea('5.5.5.5', 1 + (i % 25), '/', 200, UA.persona)),
    'línea que no es un registro'
  ];
  const f = path.join(dir, 'access.log.gz');
  fs.writeFileSync(f, zlib.gzipSync(lineas.join('\n')));
  const r = await L.analizarLogs([f], { sitemap: ['https://d.com/', 'https://d.com/servicios/', 'https://d.com/blog/', 'https://d.com/contacto/'] });
  const ids = r.hallazgos.map(h => h.id);
  assert.equal(r.datos.validas, 71);
  assert.equal(r.datos.bots.find(b => b.token === 'OAI-SearchBot').visitas, 10);
  const err = r.hallazgos.find(h => h.id === 'logs-bot-errores');
  assert.equal(err.severidad, 'alto');
  assert.match(err.detalle, /Claude-SearchBot: 80 %.*403×8/);
  assert.ok(ids.includes('logs-bots-ia'));
  const sin = r.hallazgos.find(h => h.id === 'logs-paginas-sin-visitar');
  assert.match(sin.detalle, /^1 de 4 .*\/contacto/);
  assert.ok(!JSON.stringify(r).includes('20.171.207.5'), 'las IP no deben aparecer en el resultado');
});

test('logs: sin bots de IA durante una semana es un aviso', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'logs-')), 'a.log');
  fs.writeFileSync(f, [linea('1.1.1.1', 1, '/', 200, UA.persona), linea('1.1.1.1', 15, '/', 200, UA.google)].join('\n'));
  const r = await L.analizarLogs([f]);
  assert.equal(r.hallazgos.find(h => h.id === 'logs-sin-bots-ia').severidad, 'medio');
});
