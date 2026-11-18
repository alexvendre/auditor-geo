'use strict';
/**
 * Auditoría completa: web (SEO, GEO, AEO) + marca y entidad + visibilidad en
 * asistentes de IA + LinkedIn (SSI y perfil), en un único resultado e informe.
 * Cada parte es opcional; solo se ejecuta lo que el proyecto define.
 */

const { auditar } = require('./auditoria');
const { pedir, UA_NAVEGADOR } = require('./http');
const { analizar } = require('./html');
const J = require('./jsonld');
const { auditarMarca } = require('./marca');
const { visibilidadIA } = require('./ia');
const { estudioLinkedIn } = require('./linkedin');
const { entrada } = require('./catalogo');
const VERSION = require('../package.json').version;

const completar = (lista) => lista.map(x => ({ ...x, area: entrada(x.id).area }));

/**
 * @param {object} p proyecto: { web, marca, ia, linkedin } (ver ejemplos/proyecto.ejemplo.json)
 */
async function auditoriaCompleta(p, progreso = () => {}) {
  const t0 = Date.now();
  let base = null;
  if (p.web && p.web.url) {
    base = await auditar(p.web.url, { ...p.web, cfg: p.web.reglas || p.web.cfg || {}, progreso });
  }
  const resultado = base || {
    meta: { herramienta: 'auditor-geo', version: VERSION, fecha: new Date().toISOString(), modo: 'sin-web', paginas: 0, paginasHtml: 0, opciones: {} },
    hallazgos: [], paginas: [], sitio: {}, avisos: []
  };
  resultado.meta.modulos = { web: !!base };
  // Huella de la configuración: dos auditorías solo son comparables con las mismas reglas y alcance
  if (p.web) {
    const reglas = JSON.stringify(p.web.reglas || p.web.cfg || {}, (k, v) => v instanceof RegExp ? v.source : v);
    resultado.meta.huella = require('crypto').createHash('sha1').update(reglas + '|' + !!p.web.sitio).digest('hex').slice(0, 10);
  }

  // Marca y entidad: necesita la portada
  if (base && p.marca !== false) {
    progreso('Marca y entidad');
    const origen = base.meta.origen;
    const home = await pedir(origen + '/', { ua: UA_NAVEGADOR });
    if (home.status === 200) {
      const doc = analizar(home.body, home.finalUrl);
      const nodosLD = doc.jsonld.filter(b => b.ok).flatMap(b => J.nodos(b.datos));
      const llms = await pedir(origen + '/llms.txt', { ua: UA_NAVEGADOR });
      const llmsH1 = llms.status === 200 && !/<html/i.test(llms.body.slice(0, 300)) ? ((llms.body.replace(/^﻿/, '').match(/^#\s+([^\n:|–—-]+)/) || [])[1] || '').trim() : '';
      const m = p.marca || {};
      const r = await auditarMarca({ doc, nodosLD, origen, nombre: m.nombre, perfiles: m.perfiles, linkedinUrl: m.linkedin || (p.linkedin && p.linkedin.perfil), wikidata: m.wikidata, llmsH1 });
      resultado.hallazgos.push(...completar(r.hallazgos));
      resultado.marca = r.datos;
      resultado.meta.modulos.marca = true;
    }
  }

  // Visibilidad en IA: solo si se pide expresamente (cuesta dinero en la cuenta del usuario)
  if (p.ia && p.ia.activar) {
    const marca = (p.ia.marca || (p.marca && p.marca.nombre) || (resultado.marca && resultado.marca.nombre));
    const dominio = p.ia.dominio || (base && new URL(base.meta.url).host);
    const r = await visibilidadIA({ ...p.ia, marca, alias: p.ia.alias || (p.marca && p.marca.alias) || [], dominio }, progreso);
    resultado.hallazgos.push(...completar(r.hallazgos));
    resultado.ia = r.datos;
    resultado.meta.modulos.ia = true;
  }

  // LinkedIn
  if (p.linkedin && (p.linkedin.ssi || p.linkedin.exportacion || p.linkedin.checklist)) {
    progreso('LinkedIn');
    const r = estudioLinkedIn(p.linkedin);
    resultado.hallazgos.push(...completar(r.hallazgos));
    resultado.linkedin = r.datos;
    resultado.meta.modulos.linkedin = true;
  }

  resultado.meta.titulo = base ? new URL(base.meta.url).host : (p.marca && p.marca.nombre) || (p.ia && p.ia.marca) || 'LinkedIn';
  resultado.meta.duracionS = Math.round((Date.now() - t0) / 100) / 10;
  return resultado;
}

module.exports = { auditoriaCompleta };
