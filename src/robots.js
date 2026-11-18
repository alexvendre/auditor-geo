'use strict';
/**
 * robots.txt según RFC 9309: grupos, coincidencia del agente sin distinguir
 * mayúsculas, regla más larga gana y, en empate, Allow gana. También lee las
 * líneas Sitemap y las señales de contenido (Content-Signal) que añade Cloudflare.
 */

/**
 * Catálogo de rastreadores relacionados con IA (revisado en noviembre de 2026).
 * tipo:
 *   busqueda     → indexa para responder con enlaces y citas. Bloquearlo = no te citan.
 *   usuario      → visita la página cuando un usuario pide algo concreto en el chat.
 *   entrenamiento→ recoge datos para entrenar modelos. Bloquearlo es una decisión legítima.
 *   token        → no es un rastreador real: es una señal en robots.txt (no se le puede "probar").
 */
const BOTS_IA = [
  { token: 'OAI-SearchBot', empresa: 'OpenAI', tipo: 'busqueda', producto: 'Búsqueda de ChatGPT', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.3; +https://openai.com/searchbot' },
  { token: 'ChatGPT-User', empresa: 'OpenAI', tipo: 'usuario', producto: 'ChatGPT al abrir enlaces', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot' },
  { token: 'GPTBot', empresa: 'OpenAI', tipo: 'entrenamiento', producto: 'Entrenamiento de modelos de OpenAI', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot' },
  { token: 'Claude-SearchBot', empresa: 'Anthropic', tipo: 'busqueda', producto: 'Búsqueda de Claude', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Claude-SearchBot/1.0; +https://www.anthropic.com' },
  { token: 'Claude-User', empresa: 'Anthropic', tipo: 'usuario', producto: 'Claude al abrir enlaces', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Claude-User/1.0; +https://www.anthropic.com' },
  { token: 'ClaudeBot', empresa: 'Anthropic', tipo: 'entrenamiento', producto: 'Entrenamiento de modelos de Anthropic', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +claudebot@anthropic.com' },
  { token: 'PerplexityBot', empresa: 'Perplexity', tipo: 'busqueda', producto: 'Índice de Perplexity', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot' },
  { token: 'Perplexity-User', empresa: 'Perplexity', tipo: 'usuario', producto: 'Perplexity al abrir enlaces', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user' },
  { token: 'Bingbot', empresa: 'Microsoft', tipo: 'busqueda', producto: 'Bing y Copilot (y de rebote, buena parte de ChatGPT)', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36' },
  { token: 'DuckAssistBot', empresa: 'DuckDuckGo', tipo: 'busqueda', producto: 'Respuestas de DuckDuckGo', ua: 'DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)' },
  { token: 'Applebot', empresa: 'Apple', tipo: 'busqueda', producto: 'Siri y Spotlight', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)' },
  { token: 'MistralAI-User', empresa: 'Mistral', tipo: 'usuario', producto: 'Le Chat al abrir enlaces', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots' },
  { token: 'Google-Extended', empresa: 'Google', tipo: 'token', producto: 'Uso en Gemini y entrenamiento (no afecta a Google Search ni a AI Overviews)' },
  { token: 'Applebot-Extended', empresa: 'Apple', tipo: 'token', producto: 'Entrenamiento de Apple Intelligence' },
  { token: 'CCBot', empresa: 'Common Crawl', tipo: 'entrenamiento', producto: 'Corpus abierto usado por muchos modelos', ua: 'CCBot/2.0 (https://commoncrawl.org/faq/)' },
  { token: 'Meta-ExternalAgent', empresa: 'Meta', tipo: 'entrenamiento', producto: 'Entrenamiento de Meta AI', ua: 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)' },
  { token: 'Amazonbot', empresa: 'Amazon', tipo: 'busqueda', producto: 'Alexa y servicios de Amazon', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119.0.6045.214 Safari/537.36' },
  { token: 'Bytespider', empresa: 'ByteDance', tipo: 'entrenamiento', producto: 'Entrenamiento de modelos de ByteDance', ua: 'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)' }
];

const GOOGLEBOT = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

function parsear(txt) {
  const grupos = [];
  const sitemaps = [];
  const senales = [];
  const errores = [];
  let actual = null;
  let ultimaFueAgente = false;

  const lineas = (txt || '').replace(/^﻿/, '').split(/\r?\n/);
  lineas.forEach((linea, i) => {
    const limpia = linea.replace(/#.*$/, '').trim();
    if (!limpia) return;
    const m = limpia.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) { errores.push({ linea: i + 1, texto: linea.trim() }); return; }
    const campo = m[1].toLowerCase();
    const valor = m[2].trim();
    if (campo === 'user-agent') {
      if (!actual || !ultimaFueAgente) { actual = { agentes: [], reglas: [] }; grupos.push(actual); }
      actual.agentes.push(valor.toLowerCase());
      ultimaFueAgente = true;
      return;
    }
    ultimaFueAgente = false;
    if (campo === 'sitemap') { sitemaps.push(valor); return; }
    if (campo === 'content-signal') { senales.push(valor); return; }
    if (campo === 'allow' || campo === 'disallow') {
      if (!actual) { errores.push({ linea: i + 1, texto: linea.trim() + ' (regla sin User-agent)' }); return; }
      actual.reglas.push({ tipo: campo, ruta: valor });
      return;
    }
    if (!['crawl-delay', 'host', 'clean-param', 'request-rate', 'visit-time'].includes(campo)) {
      errores.push({ linea: i + 1, texto: linea.trim() });
    }
  });
  return { grupos, sitemaps, senales, errores };
}

function patronARegex(ruta) {
  let r = '';
  for (const ch of ruta) {
    if (ch === '*') r += '.*';
    else if (ch === '$') r += '$';
    else r += ch.replace(/[.+?^{}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + r);
}

/** Reglas que aplican a un agente: grupos con su token o, si no hay, los de "*". */
function reglasPara(robots, token) {
  const t = token.toLowerCase();
  const propios = robots.grupos.filter(g => g.agentes.some(a => a !== '*' && a === t));
  const usados = propios.length ? propios : robots.grupos.filter(g => g.agentes.includes('*'));
  return { reglas: usados.flatMap(g => g.reglas), especifico: propios.length > 0 };
}

/** ¿Puede el agente rastrear esta ruta? Devuelve { permitido, regla, especifico }. */
function permitido(robots, token, ruta = '/') {
  const { reglas, especifico } = reglasPara(robots, token);
  let mejor = null;
  for (const r of reglas) {
    if (r.ruta === '') continue; // "Disallow:" vacío = permitir todo
    let rx;
    try { rx = patronARegex(r.ruta); } catch { continue; }
    if (!rx.test(ruta)) continue;
    const largo = r.ruta.replace(/[*$]/g, '').length;
    if (!mejor || largo > mejor.largo || (largo === mejor.largo && r.tipo === 'allow')) mejor = { ...r, largo };
  }
  return { permitido: !mejor || mejor.tipo === 'allow', regla: mejor, especifico };
}

module.exports = { parsear, permitido, reglasPara, BOTS_IA, GOOGLEBOT };
