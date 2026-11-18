'use strict';
/**
 * Agrupa los hallazgos en problemas (uno por comprobación, con todas las URLs
 * afectadas), los ordena por prioridad y resume el estado de cada área.
 */

const { AREAS, entrada } = require('./catalogo');

const ORDEN = { critico: 0, alto: 1, medio: 2, bajo: 3, info: 4, ok: 5 };
const NOMBRE_SEV = { critico: 'Crítico', alto: 'Alto', medio: 'Medio', bajo: 'Bajo', info: 'Info', ok: 'Correcto' };

function agrupar(hallazgos) {
  const grupos = new Map();
  const vistos = new Set();
  for (const x of hallazgos) {
    const k = `${x.id}|${x.url}|${x.detalle}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    // Un mismo id puede tener casos «ok» y casos con problema: se separan
    const clave = x.severidad === 'ok' ? x.id + '|ok' : x.id;
    if (!grupos.has(clave)) {
      const e = entrada(x.id);
      grupos.set(clave, { id: x.id, area: e.area, areaNombre: AREAS[e.area] || e.area, titulo: e.titulo, porque: e.porque, arreglo: e.arreglo, severidad: x.severidad, casos: [] });
    }
    const g = grupos.get(clave);
    g.casos.push({ url: x.url, detalle: x.detalle, evidencia: x.evidencia, severidad: x.severidad });
    if (ORDEN[x.severidad] < ORDEN[g.severidad]) g.severidad = x.severidad;
  }
  const lista = [...grupos.values()];
  lista.forEach(g => {
    g.casos.sort((a, b) => ORDEN[a.severidad] - ORDEN[b.severidad]);
    // Variantes: casos con el mismo detalle en varias URLs se muestran una sola vez
    const v = new Map();
    for (const k of g.casos) {
      const clave = k.severidad + '|' + k.detalle;
      if (!v.has(clave)) v.set(clave, { detalle: k.detalle, evidencia: k.evidencia, severidad: k.severidad, urls: [] });
      v.get(clave).urls.push(k.url);
    }
    g.variantes = [...v.values()];
  });
  lista.sort((a, b) => ORDEN[a.severidad] - ORDEN[b.severidad] || b.casos.length - a.casos.length);
  return lista;
}

function resumen(grupos) {
  const porSev = { critico: 0, alto: 0, medio: 0, bajo: 0, info: 0, ok: 0 };
  grupos.forEach(g => { porSev[g.severidad]++; });
  const areas = Object.entries(AREAS).map(([k, nombre]) => {
    const gs = grupos.filter(g => g.area === k);
    const peor = gs.filter(g => g.severidad !== 'ok' && g.severidad !== 'info').sort((a, b) => ORDEN[a.severidad] - ORDEN[b.severidad])[0];
    const estado = !gs.length ? 'sin-datos' : !peor ? 'bien' : ['critico', 'alto'].includes(peor.severidad) ? 'mal' : peor.severidad === 'medio' ? 'mejorable' : 'bien';
    return {
      clave: k, nombre, estado,
      problemas: gs.filter(g => !['ok', 'info'].includes(g.severidad)).length,
      correctos: gs.filter(g => g.severidad === 'ok').length
    };
  }).filter(a => a.estado !== 'sin-datos');
  return { porSev, areas };
}

function construir(resultado) {
  const grupos = agrupar(resultado.hallazgos);
  return { ...resultado, grupos, resumen: resumen(grupos) };
}

module.exports = { construir, agrupar, ORDEN, NOMBRE_SEV };
