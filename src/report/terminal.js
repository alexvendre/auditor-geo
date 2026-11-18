'use strict';
const { NOMBRE_SEV } = require('../informe');

function terminal(inf, { color = true, detalle = false } = {}) {
  const c = color
    ? { critico: '\x1b[41m\x1b[97m', alto: '\x1b[31m', medio: '\x1b[33m', bajo: '\x1b[36m', info: '\x1b[2m', ok: '\x1b[32m', neg: '\x1b[1m', dim: '\x1b[2m', off: '\x1b[0m' }
    : { critico: '', alto: '', medio: '', bajo: '', info: '', ok: '', neg: '', dim: '', off: '' };
  const L = [];
  const m = inf.meta;
  const ruta = (u) => { try { const x = new URL(u); return x.origin === m.origen ? (x.pathname + x.search) : u; } catch { return u; } };
  const etiqueta = (s) => `${c[s]}${(' ' + NOMBRE_SEV[s].toUpperCase() + ' ').padEnd(10)}${c.off}`;

  L.push('');
  L.push(`${c.neg}Auditoría SEO · GEO · AEO${c.off}  ${m.url}`);
  L.push(`${c.dim}${m.modo === 'sitio' ? `${m.paginasHtml} páginas analizadas` : 'Una página'} · ${new Date(m.fecha).toLocaleString('es-ES')} · ${m.duracionS} s · auditor-geo ${m.version}${c.off}`);

  const s = inf.resumen.porSev;
  L.push('');
  L.push(`${c.neg}Resumen${c.off}  ${c.critico} ${s.critico} críticos ${c.off}  ${c.alto}${s.alto} altos${c.off} · ${c.medio}${s.medio} medios${c.off} · ${c.bajo}${s.bajo} bajos${c.off} · ${c.ok}${s.ok} correctos${c.off}`);
  for (const a of inf.resumen.areas) {
    const icono = a.estado === 'mal' ? `${c.alto}●${c.off}` : a.estado === 'mejorable' ? `${c.medio}●${c.off}` : `${c.ok}●${c.off}`;
    L.push(`  ${icono} ${a.nombre.padEnd(34)} ${c.dim}${a.problemas} a revisar · ${a.correctos} correctos${c.off}`);
  }

  const problemas = inf.grupos.filter(g => !['ok', 'info'].includes(g.severidad));
  const info = inf.grupos.filter(g => g.severidad === 'info');
  const oks = inf.grupos.filter(g => g.severidad === 'ok');

  L.push('');
  L.push(`${c.neg}Hallazgos por prioridad${c.off}`);
  if (!problemas.length) L.push(`  ${c.ok}No se han encontrado problemas.${c.off}`);
  for (const g of problemas) {
    const n = g.casos.length;
    L.push('');
    L.push(`${etiqueta(g.severidad)} ${c.neg}${g.titulo}${c.off}${n > 1 ? `  ${c.dim}${n} casos${c.off}` : ''}  ${c.dim}[${g.areaNombre}]${c.off}`);
    const max = detalle ? Infinity : 4;
    g.variantes.slice(0, max).forEach(v => {
      let linea = v.detalle || '';
      if (m.modo === 'sitio') {
        const rutas = v.urls.map(ruta);
        linea = v.urls.length === 1 ? rutas[0] + (linea ? ' — ' + linea : '')
          : (linea ? linea + ' — ' : '') + `${v.urls.length} páginas: ${rutas.slice(0, detalle ? rutas.length : 3).join(', ')}${!detalle && rutas.length > 3 ? '…' : ''}`;
      }
      L.push(`           ${c.dim}${linea.slice(0, detalle ? 100000 : 400)}${c.off}`);
    });
    if (g.variantes.length > max) L.push(`           ${c.dim}… y ${g.variantes.length - max} más (usa --detalle o el informe HTML)${c.off}`);
    if (g.arreglo) L.push(`           → ${g.arreglo}`);
  }

  if (info.length) {
    L.push('');
    L.push(`${c.neg}Para tener en cuenta${c.off}`);
    info.forEach(g => L.push(`  ${c.dim}·${c.off} ${g.titulo}${g.casos[0].detalle ? ` ${c.dim}— ${g.casos[0].detalle.slice(0, 160)}${c.off}` : ''}`));
  }

  if (oks.length) {
    L.push('');
    L.push(`${c.neg}Correcto${c.off}`);
    oks.forEach(g => L.push(`  ${c.ok}✓${c.off} ${g.titulo}${g.casos.length > 1 ? ` ${c.dim}(${g.casos.length} páginas)${c.off}` : g.casos[0].detalle ? ` ${c.dim}— ${g.casos[0].detalle.slice(0, 140)}${c.off}` : ''}`));
  }

  (inf.avisos || []).forEach(a => L.push(`\n${c.medio}Aviso:${c.off} ${a}`));
  L.push('');
  return L.join('\n');
}

module.exports = { terminal };
