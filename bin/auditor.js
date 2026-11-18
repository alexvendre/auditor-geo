#!/usr/bin/env node
'use strict';
/**
 * auditor-geo — Auditoría SEO, GEO y AEO de webs y marcas, con visibilidad en IA
 * y estudio del SSI de LinkedIn. Node 18+, sin dependencias obligatorias.
 */

const fs = require('fs');
const path = require('path');
const { auditoriaCompleta } = require('../src/completa');
const { construir, ORDEN } = require('../src/informe');
const { terminal } = require('../src/report/terminal');
const { html } = require('../src/report/html');
const { markdown } = require('../src/report/markdown');
const { parsearSSI } = require('../src/linkedin');
const { comparar, cargarAnterior } = require('../src/comparar');

const AYUDA = `
auditor-geo — Auditoría SEO, GEO y AEO de webs y marcas

Uso
  auditor-geo <url> [opciones]                    Web + marca (una página o, con --sitio, el sitio entero)
  auditor-geo completa --proyecto proyecto.json   Todo lo que defina el proyecto en un único informe
  auditor-geo linkedin --ssi 18,12,15,20 [...]    Estudio de LinkedIn (SSI, perfil y actividad)
  auditor-geo ia --marca "Nombre" [...]           Visibilidad en ChatGPT, Claude, Perplexity y Gemini
  auditor-geo generar <llms|robots|schema> <url>  Borrador del arreglo (llms.txt, bloque de robots.txt, JSON-LD)
  auditor-geo logs <access.log ...> [--url d]     Qué bots (de IA y buscadores) visitan la web de verdad

Web
  --sitio                Audita el sitio entero (sitemap + enlaces internos)
  --max <n>              Máximo de páginas (100)       --concurrencia <n>  Peticiones simultáneas (4)
  --render               Compara con la página renderizada (requiere Playwright)
  --psi                  Core Web Vitals reales vía PageSpeed Insights (PSI_API_KEY)
  --sin-bots             No simula rastreadores de IA     --config <archivo>  Reglas propias del sitio

Marca y entidad
  --marca "<nombre>"     Nombre canónico de la marca o la persona
  --alias "A,B"          Otras formas de escribirla (para detectar menciones)
  --perfiles "url,url"   Perfiles externos a verificar además de los del marcado
  --linkedin-url <url>   Tu perfil o página de empresa de LinkedIn
  --wikidata             Busca la marca en Wikidata      --sin-marca  Omite este módulo

Visibilidad en IA (consulta las API con tus claves; tiene coste)
  --ia                   Activa el módulo
  --consultas <archivo>  Una consulta por línea  ·  o --categoria "consultor SEO" [--zona "Sabadell"]
  --competidores "A,B"   Nombres a contar en las mismas respuestas
  --proveedores "chatgpt,claude,perplexity,gemini"   (por defecto, los que tengan clave)
  --repeticiones <n>     Veces que se repite cada consulta (1)
  --historial-ia <f>     Acumula los resultados en un JSONL para comparar entre meses

Registros del servidor (subcomando logs, o "logs" en el proyecto)
  --url <dominio>        Cruza las visitas con el sitemap para ver qué páginas no visita ningún bot
  --verificar-ip         Comprueba que las visitas vienen de las IP publicadas por cada empresa (o DNS inverso)

LinkedIn
  --ssi "m,p,i,r[,sector,red]"   Las 4 puntuaciones de linkedin.com/sales/ssi (0–25) y, opcional, tu top % en sector y red
  --linkedin-export <zip|dir>    Exportación de datos de tu cuenta (se procesa en local; solo se muestran recuentos)
  --linkedin-checklist <json>    Lo que no está en la exportación (ver ejemplos/linkedin-checklist.json)
  --historial-ssi <f>            Guarda cada medición para ver la evolución

Informe
  --html [archivo]  --md [archivo]  --json [archivo]   (JSON a la salida estándar si no se indica archivo)
  --autor "<nombre>"  --empresa "<texto>"   Firma y antetítulo del informe HTML
  --comparar <json>  Compara con una auditoría anterior (su --json): resuelto, nuevo, mejor y peor
  --detalle          Todos los casos en la terminal      --sin-color
  --falla-en <nivel> critico | alto | medio | bajo | nunca (por defecto: alto)

Ejemplos
  auditor-geo alexvendrell.com --sitio --html --autor "Alex Vendrell Torres"
  auditor-geo linkedin --ssi 18.5,12,15,20,8,12 --linkedin-export Basic_LinkedInDataExport.zip --html
  auditor-geo ia --marca "Alex Vendrell" --dominio alexvendrell.com --categoria "consultor SEO para asesorías" --zona Barcelona --ia
  auditor-geo completa --proyecto ejemplos/proyecto.ejemplo.json
`;

function leerArgs(argv) {
  const op = { _: [] };
  const conValor = new Set(['max', 'concurrencia', 'config', 'autor', 'empresa', 'falla-en', 'proyecto', 'marca', 'alias', 'perfiles', 'linkedin-url',
    'consultas', 'categoria', 'zona', 'competidores', 'proveedores', 'repeticiones', 'historial-ia', 'dominio', 'pais',
    'ssi', 'linkedin-export', 'linkedin-checklist', 'historial-ssi', 'comparar', 'salida', 'tipo', 'url']);
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

const lista = (s) => s ? String(s).split(',').map(x => x.trim()).filter(Boolean) : [];

function reglas(ruta) {
  if (!ruta) return {};
  const cfg = typeof ruta === 'string' ? JSON.parse(fs.readFileSync(ruta, 'utf8')) : ruta;
  if (cfg.imagenesIgnoradas) cfg.imagenesIgnoradas = cfg.imagenesIgnoradas.map(s => s instanceof RegExp ? s : new RegExp(s, 'i'));
  return cfg;
}

/** Convierte las opciones de la línea de comandos en un proyecto. */
function proyectoDesdeArgs(op, modo) {
  const url = modo === 'web' ? op._[0] : null;
  if (modo === 'logs') return { marca: false, logs: { archivos: op._, url: op.url, verificar: !!op['verificar-ip'] }, informe: { autor: op.autor, empresa: op.empresa } };
  const p = {};
  if (url) p.web = { url, sitio: !!op.sitio, max: op.max ? Number(op.max) : undefined, concurrencia: op.concurrencia ? Number(op.concurrencia) : 4, render: !!op.render, psi: !!op.psi, bots: !op['sin-bots'], reglas: reglas(op.config) };
  p.marca = op['sin-marca'] ? false : { nombre: op.marca, alias: lista(op.alias), perfiles: lista(op.perfiles), linkedin: op['linkedin-url'], wikidata: !!op.wikidata };
  if (op.ia || modo === 'ia') {
    p.ia = {
      activar: !!op.ia || modo === 'ia', marca: op.marca, alias: lista(op.alias), dominio: op.dominio, categoria: op.categoria, zona: op.zona, pais: op.pais,
      consultas: op.consultas ? fs.readFileSync(op.consultas, 'utf8').split('\n').map(x => x.trim()).filter(x => x && !x.startsWith('#')) : [],
      competidores: lista(op.competidores), proveedores: lista(op.proveedores), repeticiones: op.repeticiones ? Number(op.repeticiones) : 1, historial: op['historial-ia']
    };
  }
  if (op.ssi || op['linkedin-export'] || op['linkedin-checklist']) {
    p.linkedin = { ssi: op.ssi ? parsearSSI(op.ssi) : null, exportacion: op['linkedin-export'], checklist: op['linkedin-checklist'], historial: op['historial-ssi'], perfil: op['linkedin-url'] };
  }
  p.informe = { autor: op.autor, empresa: op.empresa };
  return p;
}

function proyectoDesdeArchivo(ruta) {
  const dir = path.dirname(path.resolve(ruta));
  const p = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const rel = (x) => (x && typeof x === 'string' && !path.isAbsolute(x)) ? path.join(dir, x) : x;
  if (p.web) { p.web.reglas = reglas(typeof p.web.reglas === 'string' ? rel(p.web.reglas) : p.web.reglas); p.web.bots = p.web.bots !== false; }
  if (p.linkedin) {
    if (p.linkedin.ssi && typeof p.linkedin.ssi === 'string') p.linkedin.ssi = parsearSSI(p.linkedin.ssi);
    ['exportacion', 'historial'].forEach(k => { p.linkedin[k] = rel(p.linkedin[k]); });
    if (typeof p.linkedin.checklist === 'string') p.linkedin.checklist = rel(p.linkedin.checklist);
  }
  if (p.logs && p.logs.archivos) p.logs.archivos = [].concat(p.logs.archivos).map(rel);
  if (p.ia) { p.ia.historial = rel(p.ia.historial); if (typeof p.ia.consultas === 'string') p.ia.consultas = fs.readFileSync(rel(p.ia.consultas), 'utf8').split('\n').map(x => x.trim()).filter(x => x && !x.startsWith('#')); }
  p.informe = p.informe || {};
  ['html', 'md', 'json'].forEach(k => { if (typeof p.informe[k] === 'string') p.informe[k] = rel(p.informe[k]); });
  return p;
}

async function generar(op) {
  const G = require('../src/generar');
  const [que, url] = op._;
  if (!['llms', 'robots', 'schema'].includes(que) || !url) {
    console.error('Uso: auditor-geo generar <llms|robots|schema> <url> [--tipo persona|organizacion|negocio] [--salida archivo]');
    process.exit(1);
  }
  try {
    const r = que === 'llms' ? await G.generarLlms(url, { max: op.max ? Number(op.max) : 80 })
      : que === 'robots' ? await G.generarRobots(url)
        : await G.generarSchema(url, op.tipo || 'organizacion');
    if (op.salida) { fs.writeFileSync(op.salida, r.texto + '\n'); console.error(`Borrador guardado en ${path.resolve(op.salida)}`); }
    else console.log(r.texto);
    const nota = que === 'llms' ? `${r.paginas} páginas incluidas de ${r.sitemap} en el sitemap.` : que === 'robots' ? r.aviso : `${r.huecos} campos marcados con [COMPLETAR].`;
    console.error(`\nBorrador: revísalo antes de publicarlo. ${nota}`);
  } catch (e) { console.error(`Error: ${e.message}`); process.exit(2); }
}

(async () => {
  const op = leerArgs(process.argv.slice(2));
  const sub = ['completa', 'linkedin', 'ia', 'generar', 'logs'].includes(op._[0]) ? op._.shift() : 'web';
  if (sub === 'generar') return generar(op);
  if (op.help || op.ayuda || (sub === 'web' && !op._.length) || (sub === 'completa' && !op.proyecto)) {
    console.log(AYUDA);
    process.exit(op.help || op.ayuda ? 0 : 1);
  }

  let proyecto;
  try {
    proyecto = sub === 'completa' ? proyectoDesdeArchivo(op.proyecto) : proyectoDesdeArgs(op, sub);
    if (sub === 'linkedin' && !proyecto.linkedin) throw new Error('Indica al menos --ssi, --linkedin-export o --linkedin-checklist');
    if (sub === 'logs' && !(proyecto.logs && proyecto.logs.archivos.length)) throw new Error('Indica uno o más archivos de registro: auditor-geo logs access.log [--url dominio] [--verificar-ip]');
  } catch (e) { console.error(`Configuración no válida: ${e.message}`); process.exit(2); }

  const jsonStdout = op.json === true;
  const color = !op['sin-color'] && process.stdout.isTTY && !jsonStdout;
  const verProgreso = process.stderr.isTTY && !jsonStdout;
  const progreso = (msg) => { if (verProgreso) process.stderr.write(`\r\x1b[2K\x1b[2m${String(msg).slice(0, (process.stderr.columns || 100) - 2)}\x1b[0m`); };

  let resultado;
  try {
    resultado = await auditoriaCompleta(proyecto, progreso);
  } catch (e) {
    if (verProgreso) process.stderr.write('\r\x1b[2K');
    console.error(e.codigo === 'SIN_ACCESO' ? e.message : `Error: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(2);
  }
  if (verProgreso) process.stderr.write('\r\x1b[2K');

  const inf = construir(resultado);
  const anterior = op.comparar || (proyecto.informe && proyecto.informe.comparar);
  if (anterior) {
    try { inf.comparacion = comparar(inf, cargarAnterior(anterior)); }
    catch (e) { console.error(`No se pudo comparar con ${anterior}: ${e.message}`); }
  }
  const nombre = String(inf.meta.titulo || 'auditoria').replace(/^www\./, '').replace(/[^\w.-]+/g, '-').toLowerCase();
  const dia = inf.meta.fecha.slice(0, 10);
  const guardar = (valor, ext, contenido) => {
    const archivo = valor === true ? `informe-${nombre}-${dia}.${ext}` : valor;
    fs.mkdirSync(path.dirname(path.resolve(archivo)), { recursive: true });
    fs.writeFileSync(archivo, contenido);
    return archivo;
  };
  const cfgInforme = { ...(proyecto.informe || {}) };
  ['html', 'md', 'json'].forEach(k => { if (op[k] !== undefined) cfgInforme[k] = op[k]; });
  if (op.autor) cfgInforme.autor = op.autor;
  if (op.empresa) cfgInforme.empresa = op.empresa;

  const salida = { meta: inf.meta, resumen: inf.resumen, grupos: inf.grupos, paginas: inf.paginas, sitio: inf.sitio, marca: inf.marca, ia: inf.ia, linkedin: inf.linkedin, registros: inf.registros, comparacion: inf.comparacion, avisos: inf.avisos };
  if (jsonStdout) console.log(JSON.stringify(salida, null, 2));
  else {
    console.log(terminal(inf, { color, detalle: !!op.detalle }));
    const generados = [];
    if (cfgInforme.json) generados.push(guardar(cfgInforme.json, 'json', JSON.stringify(salida, null, 2)));
    if (cfgInforme.html) generados.push(guardar(cfgInforme.html, 'html', html(inf, { autor: cfgInforme.autor, marca: cfgInforme.empresa })));
    if (cfgInforme.md) generados.push(guardar(cfgInforme.md, 'md', markdown(inf)));
    generados.forEach(g => console.log(`Informe guardado: ${path.resolve(g)}`));
  }

  const umbral = op['falla-en'] || 'alto';
  if (umbral !== 'nunca' && ORDEN[umbral] !== undefined) {
    process.exitCode = inf.grupos.some(g => ORDEN[g.severidad] <= ORDEN[umbral]) ? 1 : 0;
  }
})();
