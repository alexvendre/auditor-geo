'use strict';
const { NOMBRE_SEV } = require('../informe');

function markdown(inf) {
  const m = inf.meta;
  const ruta = (u) => { try { const x = new URL(u); return x.origin === m.origen ? (decodeURI(x.pathname) + x.search) : u; } catch { return u; } };
  const s = inf.resumen.porSev;
  const L = [];
  L.push(`# Auditoría SEO, GEO y AEO · ${new URL(m.url).host}`, '');
  L.push(`${new Date(m.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })} · ${m.modo === 'sitio' ? `${m.paginasHtml} páginas` : m.url}`, '');
  L.push('## Resumen', '');
  L.push(`| Críticos | Altos | Medios | Bajos | Correctos |`, `|---|---|---|---|---|`, `| ${s.critico} | ${s.alto} | ${s.medio} | ${s.bajo} | ${s.ok} |`, '');
  const est = { mal: 'Requiere atención', mejorable: 'Mejorable', bien: 'Correcto' };
  L.push('| Área | Estado | A revisar |', '|---|---|---|');
  inf.resumen.areas.forEach(a => L.push(`| ${a.nombre} | ${est[a.estado]} | ${a.problemas} |`));
  L.push('');
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
