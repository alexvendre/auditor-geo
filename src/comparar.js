'use strict';
/**
 * Comparación con una auditoría anterior (su exportación JSON): qué se ha
 * resuelto, qué es nuevo y qué ha mejorado o empeorado. Es la prueba de
 * «antes y después» que se enseña a un cliente o en un caso de portfolio.
 */

const fs = require('fs');

const problema = (g) => !['ok', 'info'].includes(g.severidad);

function comparar(actual, anterior) {
  const previos = new Map((anterior.grupos || []).filter(problema).map(g => [g.id, g]));
  const ahora = new Map((actual.grupos || []).filter(problema).map(g => [g.id, g]));
  const resueltos = [], nuevos = [], mejoran = [], empeoran = [];
  for (const [id, g] of previos) {
    if (!ahora.has(id)) resueltos.push({ id, titulo: g.titulo, antes: g.casos.length });
  }
  for (const [id, g] of ahora) {
    const p = previos.get(id);
    if (!p) { nuevos.push({ id, titulo: g.titulo, severidad: g.severidad, ahora: g.casos.length }); continue; }
    const d = g.casos.length - p.casos.length;
    if (d < 0) mejoran.push({ id, titulo: g.titulo, antes: p.casos.length, ahora: g.casos.length });
    if (d > 0) empeoran.push({ id, titulo: g.titulo, antes: p.casos.length, ahora: g.casos.length });
  }
  const cuenta = (inf) => (inf.grupos || []).filter(problema).reduce((a, g) => a + g.casos.length, 0);
  const sev = (inf) => (inf.resumen && inf.resumen.porSev) || {};
  const avisos = [];
  const ma = anterior.meta || {}, mb = actual.meta || {};
  if (ma.huella && mb.huella && ma.huella !== mb.huella) avisos.push('Las dos auditorías usan reglas o alcance distintos (--config, --sitio): parte de las diferencias puede deberse a eso y no a cambios en la web.');
  if (ma.paginasHtml && mb.paginasHtml && Math.abs(ma.paginasHtml - mb.paginasHtml) / ma.paginasHtml > 0.2) avisos.push(`El número de páginas analizadas cambia de ${ma.paginasHtml} a ${mb.paginasHtml}: compara los totales con cautela.`);
  return {
    avisos,
    fechaAnterior: anterior.meta && anterior.meta.fecha,
    casosAntes: cuenta(anterior), casosAhora: cuenta(actual),
    severidadAntes: sev(anterior), severidadAhora: sev(actual),
    resueltos, nuevos, mejoran, empeoran
  };
}

function cargarAnterior(ruta) {
  const d = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  if (!d.grupos) throw new Error(`${ruta} no es una exportación JSON de auditor-geo (falta «grupos»)`);
  return d;
}

module.exports = { comparar, cargarAnterior };
