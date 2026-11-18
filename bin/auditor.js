#!/usr/bin/env node
'use strict';
/**
 * auditor-geo — Auditoría SEO, GEO y AEO.
 *
 *   node bin/auditor.js https://dominio.com                 una página
 *   node bin/auditor.js https://dominio.com --sitio         el sitio entero
 *   node bin/auditor.js https://dominio.com --sitio --html  + informe HTML para el cliente
 *
 * Node 18 o superior. Sin dependencias (Playwright solo si usas --render).
 */

const fs = require('fs');
const path = require('path');
const { auditar } = require('../src/auditoria');
const { construir, ORDEN } = require('../src/informe');
const { terminal } = require('../src/report/terminal');
const { html } = require('../src/report/html');
const { markdown } = require('../src/report/markdown');

const AYUDA = `
Auditoría SEO, GEO y AEO

Uso: auditor-geo <url> [opciones]

Alcance
  --sitio              Audita el sitio entero: sitemap + enlaces internos
  --max <n>            Máximo de páginas en modo sitio (por defecto 100)
  --concurrencia <n>   Peticiones simultáneas (por defecto 4)

Comprobaciones opcionales
  --render             Compara el HTML del servidor con la página renderizada (requiere Playwright)
  --psi                Core Web Vitals reales y Lighthouse vía PageSpeed Insights (PSI_API_KEY opcional)
  --sin-bots           No simula rastreadores de IA contra el servidor
  --config <archivo>   Reglas propias del sitio (ver ejemplos/config.ejemplo.json)

Salida
  --html [archivo]     Informe HTML para entregar (por defecto informe-<dominio>-<fecha>.html)
  --md [archivo]       Informe en Markdown
  --json [archivo]     JSON completo (a la salida estándar si no se indica archivo)
  --detalle            En la terminal, muestra todos los casos de cada hallazgo
  --autor "<nombre>"   Firma del informe HTML
  --marca "<texto>"    Antetítulo del informe HTML
  --sin-color          Terminal sin colores
  --falla-en <nivel>   Código de salida 1 si hay hallazgos de ese nivel o más graves:
                       critico | alto | medio | bajo | nunca  (por defecto: alto)

Ejemplos
  auditor-geo alexvendrell.com
  auditor-geo https://cliente.es --sitio --max 300 --html --autor "Alex Vendrell"
  auditor-geo https://cliente.es --sitio --json informe.json --falla-en critico
`;

function leerArgs(argv) {
  const op = { _: [] };
  const conValor = new Set(['max', 'concurrencia', 'config', 'autor', 'marca', 'falla-en']);
  const valorOpcional = { html: /\.html?$/i, md: /\.(md|markdown)$/i, json: /\.json$/i };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { op._.push(a); continue; }
    const [nombre, igual] = a.slice(2).split(/=(.*)/s);
    if (igual !== undefined) { op[nombre] = igual; continue; }
    if (conValor.has(nombre)) { op[nombre] = argv[++i]; continue; }
    if (valorOpcional[nombre]) {
      const sig = argv[i + 1];
      if (sig && !sig.startsWith('--') && valorOpcional[nombre].test(sig)) { op[nombre] = sig; i++; } else op[nombre] = true;
      continue;
    }
    op[nombre] = true;
  }
  return op;
}

function cargarConfig(ruta) {
  if (!ruta) return {};
  const cfg = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  if (cfg.imagenesIgnoradas) cfg.imagenesIgnoradas = cfg.imagenesIgnoradas.map(s => new RegExp(s, 'i'));
  return cfg;
}

(async () => {
  const op = leerArgs(process.argv.slice(2));
  if (op.help || op.ayuda || !op._.length) { console.log(AYUDA); process.exit(op._.length ? 0 : 1); }

  let cfg;
  try { cfg = cargarConfig(op.config); } catch (e) { console.error(`No se pudo leer la configuración: ${e.message}`); process.exit(2); }

  const jsonStdout = op.json === true;
  const color = !op['sin-color'] && process.stdout.isTTY && !jsonStdout;
  const verProgreso = process.stderr.isTTY && !jsonStdout;
  const progreso = (msg) => { if (verProgreso) process.stderr.write(`\r\x1b[2K\x1b[2m${String(msg).slice(0, (process.stderr.columns || 100) - 2)}\x1b[0m`); };

  let resultado;
  try {
    resultado = await auditar(op._[0], {
      sitio: !!op.sitio, max: op.max ? Number(op.max) : undefined, concurrencia: op.concurrencia ? Number(op.concurrencia) : 4,
      render: !!op.render, psi: !!op.psi, bots: !op['sin-bots'], cfg, progreso
    });
  } catch (e) {
    if (verProgreso) process.stderr.write('\r\x1b[2K');
    console.error(e.codigo === 'SIN_ACCESO' ? e.message : `Error inesperado: ${e.stack || e.message}`);
    process.exit(2);
  }
  if (verProgreso) process.stderr.write('\r\x1b[2K');

  const inf = construir(resultado);
  const host = new URL(inf.meta.url).host.replace(/^www\./, '');
  const dia = inf.meta.fecha.slice(0, 10);
  const guardar = (valor, ext, contenido) => {
    const archivo = valor === true ? `informe-${host}-${dia}.${ext}` : valor;
    fs.mkdirSync(path.dirname(path.resolve(archivo)), { recursive: true });
    fs.writeFileSync(archivo, contenido);
    return archivo;
  };

  const salida = { meta: inf.meta, resumen: inf.resumen, grupos: inf.grupos, paginas: inf.paginas, sitio: inf.sitio, avisos: inf.avisos };
  if (jsonStdout) console.log(JSON.stringify(salida, null, 2));
  else {
    console.log(terminal(inf, { color, detalle: !!op.detalle }));
    const generados = [];
    if (op.json) generados.push(guardar(op.json, 'json', JSON.stringify(salida, null, 2)));
    if (op.html) generados.push(guardar(op.html, 'html', html(inf, { autor: op.autor, marca: op.marca })));
    if (op.md) generados.push(guardar(op.md, 'md', markdown(inf)));
    generados.forEach(g => console.log(`Informe guardado: ${path.resolve(g)}`));
  }

  const umbral = op['falla-en'] || 'alto';
  if (umbral !== 'nunca' && ORDEN[umbral] !== undefined) {
    process.exitCode = inf.grupos.some(g => ORDEN[g.severidad] <= ORDEN[umbral]) ? 1 : 0;
  }
})();
