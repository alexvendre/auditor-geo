#!/usr/bin/env node
'use strict';
/**
 * Servidor MCP (Model Context Protocol) de auditor-geo, por stdio y sin dependencias.
 * Permite usar el auditor desde Claude Desktop, Claude Code u otro cliente MCP:
 *
 *   { "mcpServers": { "auditor-geo": { "command": "node", "args": ["/ruta/auditor-geo/bin/mcp.js"] } } }
 *
 * Por stdout solo viajan mensajes JSON-RPC; el progreso y los errores van a stderr.
 */

const { auditoriaCompleta } = require('../src/completa');
const { construir } = require('../src/informe');
const { markdown } = require('../src/report/markdown');
const G = require('../src/generar');
const VERSION = require('../package.json').version;

const HERRAMIENTAS = [
  {
    name: 'auditar_web',
    description: 'Auditoría SEO, GEO y AEO de una web (una página o el sitio entero) más marca y entidad. Devuelve un informe en Markdown con hallazgos priorizados, por qué importan y cómo se arreglan.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL o dominio a auditar' },
        sitio: { type: 'boolean', description: 'true para rastrear el sitio entero desde el sitemap', default: false },
        max: { type: 'integer', description: 'Máximo de páginas en modo sitio', default: 50 },
        marca: { type: 'string', description: 'Nombre canónico de la marca o la persona (opcional)' }
      },
      required: ['url']
    }
  },
  {
    name: 'estudio_linkedin_ssi',
    description: 'Analiza el Social Selling Index de LinkedIn (cuatro pilares de 0 a 25) y devuelve estado por pilar y plan de acción. Las puntuaciones se copian de linkedin.com/sales/ssi.',
    inputSchema: {
      type: 'object',
      properties: {
        marca: { type: 'number', description: 'Establecer tu marca profesional (0-25)' },
        personas: { type: 'number', description: 'Encontrar a las personas adecuadas (0-25)' },
        interaccion: { type: 'number', description: 'Interactuar ofreciendo información (0-25)' },
        relaciones: { type: 'number', description: 'Establecer relaciones (0-25)' },
        sector: { type: 'number', description: 'Top % en tu sector (opcional)' },
        red: { type: 'number', description: 'Top % en tu red (opcional)' }
      },
      required: ['marca', 'personas', 'interaccion', 'relaciones']
    }
  },
  {
    name: 'visibilidad_ia',
    description: 'Pregunta a ChatGPT, Claude, Perplexity y Gemini (por API, con las claves configuradas en el entorno del servidor) y mide si mencionan y enlazan la marca. Tiene coste en la cuenta del usuario.',
    inputSchema: {
      type: 'object',
      properties: {
        marca: { type: 'string' },
        dominio: { type: 'string' },
        consultas: { type: 'array', items: { type: 'string' } },
        categoria: { type: 'string', description: 'Para generar consultas si no se indican, p. ej. «consultor SEO»' },
        zona: { type: 'string' },
        competidores: { type: 'array', items: { type: 'string' } }
      },
      required: ['marca']
    }
  },
  {
    name: 'generar_borrador',
    description: 'Genera un borrador de arreglo: llms.txt desde el sitemap, bloque de robots.txt para rastreadores de IA o JSON-LD de la entidad. Los huecos se marcan con [COMPLETAR].',
    inputSchema: {
      type: 'object',
      properties: {
        que: { type: 'string', enum: ['llms', 'robots', 'schema'] },
        url: { type: 'string' },
        tipo: { type: 'string', enum: ['persona', 'organizacion', 'negocio'], description: 'Solo para schema' }
      },
      required: ['que', 'url']
    }
  }
];

async function ejecutar(nombre, a) {
  const progreso = (m) => process.stderr.write(`[auditor-geo] ${m}\n`);
  if (nombre === 'auditar_web') {
    const r = await auditoriaCompleta({ web: { url: a.url, sitio: !!a.sitio, max: a.max || 50, bots: true, concurrencia: 4 }, marca: { nombre: a.marca } }, progreso);
    return markdown(construir(r));
  }
  if (nombre === 'estudio_linkedin_ssi') {
    const r = await auditoriaCompleta({ marca: false, linkedin: { ssi: { marca: a.marca, personas: a.personas, interaccion: a.interaccion, relaciones: a.relaciones, sector: a.sector ?? null, red: a.red ?? null } } }, progreso);
    return markdown(construir(r));
  }
  if (nombre === 'visibilidad_ia') {
    const r = await auditoriaCompleta({ marca: false, ia: { activar: true, ...a } }, progreso);
    return markdown(construir(r));
  }
  if (nombre === 'generar_borrador') {
    const r = a.que === 'llms' ? await G.generarLlms(a.url) : a.que === 'robots' ? await G.generarRobots(a.url) : await G.generarSchema(a.url, a.tipo);
    return r.texto + '\n\n(Borrador: revísalo antes de publicarlo.)';
  }
  throw new Error(`Herramienta desconocida: ${nombre}`);
}

const enviar = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');

async function atender(msg) {
  const { id, method, params = {} } = msg;
  if (id === undefined) return; // notificaciones (p. ej. notifications/initialized)
  try {
    if (method === 'initialize') {
      return enviar({ id, result: { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'auditor-geo', version: VERSION } } });
    }
    if (method === 'ping') return enviar({ id, result: {} });
    if (method === 'tools/list') return enviar({ id, result: { tools: HERRAMIENTAS } });
    if (method === 'tools/call') {
      try {
        const texto = await ejecutar(params.name, params.arguments || {});
        return enviar({ id, result: { content: [{ type: 'text', text: texto }] } });
      } catch (e) {
        return enviar({ id, result: { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true } });
      }
    }
    enviar({ id, error: { code: -32601, message: `Método no soportado: ${method}` } });
  } catch (e) {
    enviar({ id, error: { code: -32603, message: e.message } });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (trozo) => {
  buffer += trozo;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const linea = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!linea) continue;
    let msg;
    try { msg = JSON.parse(linea); } catch { enviar({ id: null, error: { code: -32700, message: 'JSON no válido' } }); continue; }
    atender(msg);
  }
});
