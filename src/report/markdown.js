'use strict';
const { NOMBRE_SEV } = require('../informe');
const { alcance, titulo } = require('./terminal');

function markdown(inf) {
  const m = inf.meta;
  const ruta = (u) => { try { const x = new URL(u); return x.origin === m.origen ? (decodeURI(x.pathname) + x.search) : u; } catch { return u; } };
  const s = inf.resumen.porSev;
  const L = [];
  L.push(`# ${titulo(m)} · ${m.titulo || m.url}`, '');
  L.push(`${new Date(m.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })} · ${alcance(m)}`, '');
  L.push('## Resumen', '');
  L.push(`| Críticos | Altos | Medios | Bajos | Correctos |`, `|---|---|---|---|---|`, `| ${s.critico} | ${s.alto} | ${s.medio} | ${s.bajo} | ${s.ok} |`, '');
  const est = { mal: 'Requiere atención', mejorable: 'Mejorable', bien: 'Correcto' };
  L.push('| Área | Estado | A revisar |', '|---|---|---|');
  inf.resumen.areas.forEach(a => L.push(`| ${a.nombre} | ${est[a.estado]} | ${a.problemas} |`));
  L.push('');
  if (inf.linkedin && inf.linkedin.ssi) {
    const x = inf.linkedin.ssi;
    L.push('## LinkedIn · Social Selling Index', '', `**${x.total}/100**${x.sector != null ? ` · top ${x.sector} % de tu sector` : ''}${x.red != null ? ` · top ${x.red} % de tu red` : ''}`, '', '| Pilar | Puntuación | Estado |', '|---|---|---|');
    x.pilares.forEach(p => L.push(`| ${p.nombre} | ${p.valor}/25 | ${p.banda} |`));
    L.push('', '### Plan de acción', '');
    x.plan.forEach(pl => { L.push(`**${pl.pilar}** (${pl.valor}/25)`, ''); pl.acciones.forEach(a => L.push(`- ${a}`)); L.push(''); });
  }
  if (inf.ia && inf.ia.proveedores && inf.ia.proveedores.length) {
    L.push('## Visibilidad en asistentes de IA', '', '| Asistente | Respuestas | Menciones | Con enlace |', '|---|---|---|---|');
    inf.ia.proveedores.forEach(p => L.push(`| ${p.proveedor} | ${p.respuestas} | ${p.menciones} | ${p.enlaces} |`));
    L.push('');
  }
  const problemas = inf.grupos.filter(g => !['ok', 'info'].includes(g.severidad));
  L.push('## Hallazgos por prioridad', '');
  for (const g of problemas) {
    L.push(`### ${NOMBRE_SEV[g.severidad]} · ${g.titulo}`, '');
    L.push(`*${g.areaNombre}${g.casos.length > 1 ? ` · ${g.casos.length} casos` : ''}*`, '');
    if (g.porque) L.push(`**Por qué importa.** ${g.porque}`, '');
    if (g.arreglo) L.push(`**Cómo se arregla.** ${g.arreglo}`, '');
    g.variantes.slice(0, 25).forEach(v => {
      const urls = m.modo === 'sitio' ? (v.urls.length > 1 ? `${v.urls.length} páginas: ` : '') + v.urls.slice(0, 10).map(u => `\`${ruta(u)}\``).join(', ') + (v.urls.length > 10 ? '…' : '') : '';
      L.push(`- ${[(v.detalle || '').replace(/\|/g, '\\|'), urls].filter(Boolean).join(' — ')}`);
    });
    if (g.variantes.length > 25) L.push(`- … y ${g.variantes.length - 25} más`);
    L.push('');
  }
  const info = inf.grupos.filter(g => g.severidad === 'info');
  if (info.length) { L.push('## Para tener en cuenta', ''); info.forEach(g => L.push(`- **${g.titulo}**${g.casos[0].detalle ? ` — ${g.casos[0].detalle}` : ''}`)); L.push(''); }
  const oks = inf.grupos.filter(g => g.severidad === 'ok');
  if (oks.length) { L.push('## Lo que está bien', ''); oks.forEach(g => L.push(`- ${g.titulo}${g.casos.length > 1 ? ` (${g.casos.length} páginas)` : g.casos[0].detalle ? ` — ${g.casos[0].detalle}` : ''}`)); L.push(''); }
  L.push('---', '', `Generado con auditor-geo ${m.version}. No consulta a los asistentes de IA ni sustituye a Search Console; las comprobaciones de contenido son heurísticas.`);
  return L.join('\n');
}

module.exports = { markdown };
