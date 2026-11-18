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
  L.push(`${c.neg}${titulo(m)}${c.off}  ${m.url || (m.titulo !== 'LinkedIn' ? m.titulo : '')}`);
  L.push(`${c.dim}${alcance(m)} · ${new Date(m.fecha).toLocaleString('es-ES')} · ${m.duracionS} s · auditor-geo ${m.version}${c.off}`);

  const s = inf.resumen.porSev;
  L.push('');
  L.push(`${c.neg}Resumen${c.off}  ${c.critico} ${s.critico} críticos ${c.off}  ${c.alto}${s.alto} altos${c.off} · ${c.medio}${s.medio} medios${c.off} · ${c.bajo}${s.bajo} bajos${c.off} · ${c.ok}${s.ok} correctos${c.off}`);
  for (const a of inf.resumen.areas) {
    const icono = a.estado === 'mal' ? `${c.alto}●${c.off}` : a.estado === 'mejorable' ? `${c.medio}●${c.off}` : `${c.ok}●${c.off}`;
    L.push(`  ${icono} ${a.nombre.padEnd(34)} ${c.dim}${a.problemas} a revisar · ${a.correctos} correctos${c.off}`);
  }

  modulos(inf, L, c);

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
      if (linea) L.push(`           ${c.dim}${linea.slice(0, detalle ? 100000 : 400)}${c.off}`);
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

function titulo(m) {
  const mod = m.modulos || {};
  if (mod.web) return 'Auditoría SEO · GEO · AEO';
  if (mod.linkedin && !mod.ia) return 'Estudio de LinkedIn';
  if (mod.ia && !mod.linkedin) return 'Visibilidad en asistentes de IA';
  return 'Auditoría de marca';
}

function alcance(m) {
  const partes = [];
  if (m.modo === 'sitio') partes.push(`${m.paginasHtml} páginas analizadas`);
  else if (m.modo === 'pagina') partes.push('Una página');
  const mod = m.modulos || {};
  if (mod.marca) partes.push('marca');
  if (mod.ia) partes.push('visibilidad en IA');
  if (mod.linkedin) partes.push('LinkedIn');
  return partes.join(' + ') || 'Auditoría';
}

const barra = (v, max, ancho = 20) => '█'.repeat(Math.round(v / max * ancho)).padEnd(ancho, '·');

function modulos(inf, L, c) {
  const li = inf.linkedin;
  if (li && li.ssi) {
    const s = li.ssi;
    L.push('');
    L.push(`${c.neg}LinkedIn · Social Selling Index${c.off}  ${c.neg}${s.total}${c.off}/100${s.sector != null ? `  ${c.dim}top ${s.sector} % sector${s.red != null ? ` · top ${s.red} % red` : ''}${c.off}` : ''}${s.tendencia ? `  ${s.tendencia.delta >= 0 ? c.ok + '+' : c.alto}${s.tendencia.delta}${c.off} ${c.dim}desde ${s.tendencia.fechaPrevia.slice(0, 10)}${c.off}` : ''}`);
    s.pilares.forEach(p => {
      const col = p.banda === 'débil' ? c.alto : p.banda === 'mejorable' ? c.medio : c.ok;
      L.push(`  ${p.nombre.padEnd(36)} ${col}${barra(p.valor, 25)}${c.off} ${String(p.valor).padStart(5)}/25  ${c.dim}${p.banda}${c.off}`);
    });
    if (s.plan.length) {
      L.push(`  ${c.neg}Plan para las próximas semanas${c.off}`);
      s.plan.forEach(pl => { L.push(`  ${pl.pilar} (${pl.valor}/25)`); pl.acciones.forEach(a => L.push(`    ${c.dim}·${c.off} ${a}`)); });
    }
  }
  if (li && li.exportacion) {
    const e = li.exportacion;
    const act = e.actividad || {};
    L.push('');
    L.push(`${c.neg}LinkedIn · actividad (últimos 90 días)${c.off}`);
    L.push(`  ${[e.red ? `${e.red.contactos} contactos (+${e.red.nuevos90})` : null, `${act.publicaciones90 ?? '—'} publicaciones (~${act.porSemana ?? 0}/sem.)`, act.comentarios90 != null ? `${act.comentarios90} comentarios` : null, `${e.recomendaciones ?? 0} recomendaciones`, e.aptitudes != null ? `${e.aptitudes} aptitudes` : null].filter(Boolean).join(' · ')}`);
  }
  const ia = inf.ia;
  if (ia && ia.proveedores && ia.proveedores.length) {
    L.push('');
    L.push(`${c.neg}Visibilidad en asistentes de IA${c.off}  ${c.dim}${ia.consultas.length} consultas${c.off}`);
    ia.proveedores.forEach(p => L.push(`  ${p.proveedor.padEnd(26)} ${p.menciones}/${p.respuestas} menciones · ${p.enlaces} con enlace a la web`));
  }
  const mc = inf.marca;
  if (mc && mc.perfiles && mc.perfiles.length) {
    L.push('');
    L.push(`${c.neg}Marca · perfiles externos${c.off}  ${c.dim}${mc.nombre || ''}${c.off}`);
    mc.perfiles.forEach(p => L.push(`  ${p.plataforma.padEnd(24)} ${p.estado === 'no existe' ? c.alto : p.estado === 'enlaza a la web' ? c.ok : c.dim}${p.estado}${c.off}  ${c.dim}${p.url}${c.off}`));
  }
}

module.exports = { terminal, alcance, titulo };
