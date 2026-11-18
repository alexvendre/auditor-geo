'use strict';
/**
 * Utilidades para JSON-LD: aplanar grafos, resolver @id y validar propiedades
 * mínimas por tipo según la documentación de datos estructurados de Google y
 * schema.org. Solo se marcan como obligatorias las que Google exige para el
 * resultado enriquecido o las imprescindibles para que la entidad tenga sentido.
 */

const SUBTIPOS_NEGOCIO = [
  'LocalBusiness', 'ProfessionalService', 'LegalService', 'Attorney', 'Notary', 'AccountingService', 'FinancialService',
  'InsuranceAgency', 'RealEstateAgent', 'HomeAndConstructionBusiness', 'GeneralContractor', 'Electrician', 'Plumber',
  'HVACBusiness', 'RoofingContractor', 'MedicalBusiness', 'Dentist', 'Physician', 'MedicalClinic', 'Optician', 'Pharmacy',
  'Restaurant', 'FoodEstablishment', 'CafeOrCoffeeShop', 'BarOrPub', 'Bakery', 'Store', 'AutoRepair', 'AutomotiveBusiness',
  'BeautySalon', 'HairSalon', 'HealthAndBeautyBusiness', 'DaySpa', 'SportsActivityLocation', 'ExerciseGym', 'LodgingBusiness',
  'Hotel', 'TravelAgency', 'EmploymentAgency', 'EducationalOrganization', 'ChildCare', 'VeterinaryCare', 'MovingCompany',
  'Locksmith', 'ArchitectureFirm', 'EngineeringFirm'
];
const TIPOS_ARTICULO = ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'Report', 'ScholarlyArticle'];
const TIPOS_ENTIDAD = ['Organization', 'Corporation', 'Person', 'NGO', 'GovernmentOrganization', ...SUBTIPOS_NEGOCIO];

const REGLAS = {
  Organization: { req: ['name'], rec: ['url', 'logo', 'sameAs'] },
  LocalBusiness: { req: ['name', 'address'], rec: ['telephone', 'url', 'image', 'geo', 'openingHoursSpecification', 'sameAs'] },
  Person: { req: ['name'], rec: ['url', 'sameAs', 'jobTitle'] },
  WebSite: { req: ['name', 'url'], rec: [] },
  Article: { req: ['headline'], rec: ['author', 'datePublished', 'dateModified', 'image'] },
  FAQPage: { req: ['mainEntity'], rec: [] },
  Question: { req: ['name', 'acceptedAnswer'], rec: [] },
  BreadcrumbList: { req: ['itemListElement'], rec: [] },
  Product: { req: ['name'], rec: ['image', 'offers', 'brand', 'aggregateRating', 'review'] },
  Service: { req: ['name'], rec: ['provider', 'areaServed', 'description'] },
  Event: { req: ['name', 'startDate', 'location'], rec: ['endDate', 'image', 'offers'] },
  VideoObject: { req: ['name', 'thumbnailUrl', 'uploadDate'], rec: ['description', 'contentUrl', 'duration'] },
  JobPosting: { req: ['title', 'datePosted', 'description', 'hiringOrganization', 'jobLocation'], rec: ['validThrough', 'baseSalary'] },
  Review: { req: ['itemReviewed', 'author', 'reviewRating'], rec: [] },
  Course: { req: ['name', 'description'], rec: ['provider'] }
};

const tiposDe = (n) => [].concat(n['@type'] || []).map(String);

/** Recorre todos los nodos con @type, incluidos los anidados y los de @graph. */
function nodos(datos) {
  const out = [];
  const visitar = (o, profundidad = 0) => {
    if (!o || typeof o !== 'object' || profundidad > 12) return;
    if (Array.isArray(o)) { o.forEach(x => visitar(x, profundidad + 1)); return; }
    if (o['@type']) out.push(o);
    for (const [k, v] of Object.entries(o)) if (k !== '@context') visitar(v, profundidad + 1);
  };
  visitar(datos);
  return out;
}

function indicePorId(lista) {
  const idx = new Map();
  lista.forEach(n => { if (n['@id']) idx.set(n['@id'], Object.assign(idx.get(n['@id']) || {}, n)); });
  return idx;
}

/** Devuelve el valor de una propiedad resolviendo referencias {"@id": ...}. */
function valor(nodo, prop, idx) {
  let v = nodo[prop];
  if (v && typeof v === 'object' && !Array.isArray(v) && v['@id'] && Object.keys(v).length === 1 && idx && idx.has(v['@id'])) v = idx.get(v['@id']);
  return v;
}

const vacio = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function reglaPara(tipos) {
  for (const t of tipos) {
    if (REGLAS[t]) return { nombre: t, ...REGLAS[t] };
    if (SUBTIPOS_NEGOCIO.includes(t)) return { nombre: 'LocalBusiness', ...REGLAS.LocalBusiness };
    if (TIPOS_ARTICULO.includes(t)) return { nombre: 'Article', ...REGLAS.Article };
    if (['Corporation', 'NGO', 'GovernmentOrganization'].includes(t)) return { nombre: 'Organization', ...REGLAS.Organization };
  }
  return null;
}

/** Valida cada nodo y devuelve los problemas encontrados. */
function validar(lista) {
  const idx = indicePorId(lista);
  const problemas = [];
  for (const n of lista) {
    // Un nodo que solo es referencia ({"@type": X, "@id": Y}) se valida en su definición completa.
    if (Object.keys(n).filter(k => !k.startsWith('@')).length === 0) continue;
    const regla = reglaPara(tiposDe(n));
    if (!regla) continue;
    const completo = n['@id'] && idx.has(n['@id']) ? idx.get(n['@id']) : n;
    const faltanReq = regla.req.filter(p => vacio(valor(completo, p, idx)));
    const faltanRec = regla.rec.filter(p => vacio(valor(completo, p, idx)));
    if (regla.nombre === 'Article') {
      const autor = valor(completo, 'author', idx);
      const autores = [].concat(autor || []).map(a => (a && a['@id'] && idx.has(a['@id'])) ? idx.get(a['@id']) : a);
      if (autores.length && autores.some(a => typeof a === 'string' || (a && !a.name && !a['@id']))) {
        problemas.push({ tipo: tiposDe(n).join('/'), nivel: 'rec', prop: 'author.name', nota: 'author debe ser un Person u Organization con name, no un texto' });
      }
    }
    if (regla.nombre === 'Product' && ['offers', 'aggregateRating', 'review'].every(p => vacio(valor(completo, p, idx)))) {
      problemas.push({ tipo: 'Product', nivel: 'req', prop: 'offers | review | aggregateRating', nota: 'Google exige al menos una de las tres para el resultado enriquecido' });
    }
    faltanReq.forEach(p => problemas.push({ tipo: tiposDe(n).join('/'), nivel: 'req', prop: p }));
    faltanRec.forEach(p => problemas.push({ tipo: tiposDe(n).join('/'), nivel: 'rec', prop: p }));
  }
  // Un mismo problema repetido en nodos idénticos solo cuenta una vez
  const vistos = new Set();
  return problemas.filter(p => { const k = `${p.tipo}|${p.nivel}|${p.prop}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
}

const esTipo = (n, lista) => tiposDe(n).some(t => lista.includes(t));

module.exports = { nodos, validar, tiposDe, indicePorId, valor, esTipo, SUBTIPOS_NEGOCIO, TIPOS_ARTICULO, TIPOS_ENTIDAD };
