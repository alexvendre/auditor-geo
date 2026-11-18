'use strict';
/**
 * Estudio de LinkedIn: Social Selling Index (SSI) y perfil.
 *
 * LinkedIn no ofrece una API pública para leer el SSI ni permite automatizar la
 * lectura de perfiles (sus condiciones prohíben el scraping). Por eso este módulo
 * trabaja con datos que el propio usuario obtiene de forma legítima:
 *
 *  1. Las cuatro puntuaciones del SSI, copiadas de https://www.linkedin.com/sales/ssi
 *  2. La exportación de datos de su cuenta (Ajustes → Privacidad de datos →
 *     Obtener una copia de tus datos), en ZIP o carpeta. Se procesa en local y en
 *     el informe solo aparecen recuentos: nunca nombres, correos ni mensajes.
 *  3. Una lista de comprobación de lo que no está en la exportación (foto, banner…).
 */

const fs = require('fs');
const path = require('path');
const { aObjetos, leerZip } = require('./util/csv');

const PILARES = [
  { clave: 'marca', nombre: 'Establecer tu marca profesional', corto: 'Marca profesional' },
  { clave: 'personas', nombre: 'Encontrar a las personas adecuadas', corto: 'Encontrar personas' },
  { clave: 'interaccion', nombre: 'Interactuar ofreciendo información', corto: 'Interactuar' },
  { clave: 'relaciones', nombre: 'Establecer relaciones', corto: 'Relaciones' }
];

/**
 * Bandas de referencia de ESTA herramienta (cuartos de la escala de 0 a 25).
 * No son referencias publicadas por LinkedIn: LinkedIn solo publica tu posición
 * relativa en tu sector y en tu red, que es la comparación que cuenta.
 */
const banda = (v) => v < 10 ? 'débil' : v < 17.5 ? 'mejorable' : 'fuerte';

const PLAN = {
  marca: [
    'Titular que diga a quién ayudas y con qué resultado, no solo tu cargo (máx. 220 caracteres).',
    'Extracto («Acerca de») de 1.000–2.000 caracteres que empiece por el problema de tu cliente.',
    'Sección «Destacado» con tu mejor caso, tu web y una pieza de contenido propia.',
    'Publicar 2–3 veces por semana sobre problemas reales de tus clientes; constancia antes que volumen.',
    'Pedir recomendaciones a personas que conozcan tu trabajo de primera mano (objetivo: 3–5).'
  ],
  personas: [
    'Definir por escrito tu cliente ideal: sector, tamaño, cargo que decide, zona.',
    'Usar la búsqueda con filtros (cargo, sector, ubicación) y guardar las búsquedas que funcionen.',
    'Revisar cada semana quién ha visto tu perfil y quién interactúa con tus publicaciones.',
    'Seguir a las empresas objetivo para ver sus novedades y cambios de equipo.'
  ],
  interaccion: [
    'Comentar con criterio (no «¡Gran post!») en publicaciones de tu cliente ideal: 3–5 al día, 15 minutos.',
    'Compartir contenido de otros añadiendo tu opinión, no solo el botón de compartir.',
    'Responder a todos los comentarios de tus publicaciones durante las primeras horas.',
    'Participar en conversaciones del sector donde tu experiencia aporte algo concreto.'
  ],
  relaciones: [
    'Enviar invitaciones personalizadas que digan por qué conectas; nada de envíos masivos ni automatizaciones.',
    'Conectar con personas de nivel decisor del sector, no solo con colegas de profesión.',
    'Mantener el contacto: felicitar cambios de puesto con un mensaje propio, no el automático.',
    'Pasar de la conversación pública al mensaje privado solo cuando haya un motivo real.'
  ]
};

function analizarSSI(ssi, historial = []) {
  const hallazgos = [];
  const h = (id, severidad, detalle = '') => hallazgos.push({ id, severidad, detalle, url: 'LinkedIn · SSI' });
  const valores = PILARES.map(p => ({ ...p, valor: Number(ssi[p.clave]) }));
  for (const v of valores) {
    if (!Number.isFinite(v.valor) || v.valor < 0 || v.valor > 25) throw new Error(`Valor de SSI no válido para «${v.nombre}»: ${ssi[v.clave]} (debe estar entre 0 y 25)`);
  }
  const total = Math.round(valores.reduce((a, v) => a + v.valor, 0) * 100) / 100;
  const ordenados = [...valores].sort((a, b) => a.valor - b.valor);

  for (const v of valores) {
    const b = banda(v.valor);
    if (b === 'débil') h('ssi-pilar-debil', 'medio', `${v.nombre}: ${v.valor}/25`);
    else if (b === 'mejorable') h('ssi-pilar-mejorable', 'bajo', `${v.nombre}: ${v.valor}/25`);
    else h('ssi-pilar-fuerte', 'ok', `${v.nombre}: ${v.valor}/25`);
  }
  const dif = ordenados[3].valor - ordenados[0].valor;
  if (dif >= 10) h('ssi-desequilibrio', 'info', `${ordenados[3].corto} (${ordenados[3].valor}) frente a ${ordenados[0].corto} (${ordenados[0].valor}): ${Math.round(dif * 10) / 10} puntos de diferencia.`);

  if (ssi.sector != null || ssi.red != null) {
    const partes = [];
    if (ssi.sector != null) partes.push(`top ${ssi.sector} % de tu sector`);
    if (ssi.red != null) partes.push(`top ${ssi.red} % de tu red`);
    h('ssi-posicion', Number(ssi.sector) > 50 ? 'bajo' : 'info', partes.join(' · '));
  }

  let tendencia = null;
  // Se compara con la última medición de otro día: el SSI se actualiza a diario
  const previo = historial.filter(x => x.total != null && Date.now() - new Date(x.fecha) > 12 * 36e5).slice(-1)[0];
  if (previo) {
    const delta = Math.round((total - previo.total) * 100) / 100;
    const dias = Math.round((Date.now() - new Date(previo.fecha)) / 864e5);
    tendencia = { previo: previo.total, fechaPrevia: previo.fecha, delta, dias };
    h('ssi-tendencia', delta < -2 ? 'bajo' : 'info', `${delta >= 0 ? '+' : ''}${delta} puntos desde el ${previo.fecha.slice(0, 10)} (hace ${dias} días): de ${previo.total} a ${total}.`);
  }

  // El plan empieza por los dos pilares más bajos
  const plan = ordenados.slice(0, 2).map(p => ({ pilar: p.nombre, valor: p.valor, acciones: PLAN[p.clave] }));
  return {
    hallazgos,
    datos: { total, pilares: valores.map(v => ({ clave: v.clave, nombre: v.nombre, valor: v.valor, banda: banda(v.valor) })), sector: ssi.sector ?? null, red: ssi.red ?? null, tendencia, plan }
  };
}

/** Lee la exportación de LinkedIn desde un ZIP o una carpeta. Devuelve { nombreArchivo: texto } */
function leerExportacion(ruta) {
  const st = fs.statSync(ruta);
  const archivos = {};
  if (st.isDirectory()) {
    const recorrer = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (/\.csv$/i.test(e.name)) archivos[e.name] = fs.readFileSync(p, 'utf8');
    });
    recorrer(ruta);
  } else {
    const zip = leerZip(fs.readFileSync(ruta));
    for (const [n, b] of Object.entries(zip)) if (/\.csv$/i.test(n)) archivos[path.basename(n)] = b.toString('utf8');
  }
  return archivos;
}

const buscar = (archivos, nombre) => {
  const k = Object.keys(archivos).find(x => x.toLowerCase() === nombre.toLowerCase());
  return k ? archivos[k] : null;
};
const fecha = (s) => { if (!s) return null; const d = new Date(s.replace(/ UTC$/, 'Z')); return isNaN(d) ? null : d; };
const enUltimos = (lista, campo, dias, ahora) => lista.filter(x => { const d = fecha(x[campo]); return d && ahora - d <= dias * 864e5; }).length;

function analizarExportacion(archivos, ahora = Date.now()) {
  const hallazgos = [];
  const h = (id, severidad, detalle = '') => hallazgos.push({ id, severidad, detalle, url: 'LinkedIn · perfil' });
  const datos = { archivos: Object.keys(archivos).length };

  // Perfil
  const perfil = buscar(archivos, 'Profile.csv');
  if (perfil) {
    const p = aObjetos(perfil, ['First Name', 'Headline', 'Summary'])[0] || {};
    const titular = p.Headline || '';
    const extracto = p.Summary || '';
    datos.perfil = { titular: titular.length, extracto: extracto.length, web: !!p.Websites, sector: !!p.Industry, ubicacion: !!(p['Geo Location'] || p.Location) };
    if (!titular) h('li-titular-falta', 'alto');
    else if (/^[^|·,]{0,60}\b(en|at|@)\b[^|·,]{0,40}$/i.test(titular) && !/ayud|help|para |for /i.test(titular)) h('li-titular-cargo', 'bajo', `«${titular}» (${titular.length} car.)`);
    else h('li-titular-ok', 'ok', `${titular.length} caracteres`);
    if (!extracto) h('li-extracto-falta', 'alto');
    else if (extracto.length < 600) h('li-extracto-corto', 'medio', `${extracto.length} caracteres`);
    else h('li-extracto-ok', 'ok', `${extracto.length} caracteres`);
    if (!p.Websites) h('li-sin-web', 'bajo');
  } else h('li-export-incompleta', 'info', 'Falta Profile.csv');

  // Experiencia
  const pos = buscar(archivos, 'Positions.csv');
  if (pos) {
    const lista = aObjetos(pos, ['Company Name', 'Title', 'Started On']);
    const actual = lista.filter(x => !x['Finished On']);
    const sinDesc = lista.filter(x => !x.Description).length;
    datos.experiencia = { puestos: lista.length, actuales: actual.length, sinDescripcion: sinDesc };
    if (!actual.length) h('li-sin-puesto-actual', 'medio');
    if (sinDesc) h('li-puestos-sin-descripcion', sinDesc === lista.length ? 'medio' : 'bajo', `${sinDesc} de ${lista.length} sin descripción`);
  }

  // Aptitudes
  const skills = buscar(archivos, 'Skills.csv');
  if (skills) {
    const n = aObjetos(skills, ['Name']).length;
    datos.aptitudes = n;
    if (n < 5) h('li-aptitudes-pocas', 'medio', `${n} aptitudes`);
  }

  // Recomendaciones
  const rec = buscar(archivos, 'Recommendations_Received.csv');
  const recs = rec ? aObjetos(rec, ['First Name', 'Text', 'Status']).filter(x => !x.Status || /visible/i.test(x.Status)) : [];
  datos.recomendaciones = recs.length;
  if (recs.length === 0) h('li-recomendaciones', 'medio', 'Ninguna recomendación visible');
  else if (recs.length < 3) h('li-recomendaciones', 'bajo', `${recs.length} recomendación(es) visible(s)`);
  else h('li-recomendaciones-ok', 'ok', `${recs.length} recomendaciones visibles`);

  // Red
  const con = buscar(archivos, 'Connections.csv');
  if (con) {
    const lista = aObjetos(con, ['First Name', 'Last Name', 'Connected On']);
    const nuevas90 = enUltimos(lista, 'Connected On', 90, ahora);
    datos.red = { contactos: lista.length, nuevos90: nuevas90 };
    if (lista.length < 500) h('li-red-pequena', 'info', `${lista.length} contactos (LinkedIn muestra «500+» a partir de 500)`);
    if (nuevas90 < 15) h('li-red-estancada', 'bajo', `${nuevas90} contactos nuevos en 90 días`);
  }

  // Actividad: publicaciones, comentarios y reacciones en los últimos 90 días
  const sh = buscar(archivos, 'Shares.csv');
  const posts = sh ? aObjetos(sh, ['Date', 'ShareLink', 'ShareCommentary']) : [];
  const posts90 = enUltimos(posts, 'Date', 90, ahora);
  const com = buscar(archivos, 'Comments.csv');
  const coms90 = com ? enUltimos(aObjetos(com, ['Date', 'Link', 'Message']), 'Date', 90, ahora) : null;
  const rea = buscar(archivos, 'Reactions.csv');
  const reas90 = rea ? enUltimos(aObjetos(rea, ['Date', 'Type', 'Link']), 'Date', 90, ahora) : null;
  const ultimo = posts.map(x => fecha(x.Date)).filter(Boolean).sort((a, b) => b - a)[0];
  datos.actividad = { publicaciones90: posts90, porSemana: Math.round(posts90 / 12.86 * 10) / 10, comentarios90: coms90, reacciones90: reas90, ultimaPublicacion: ultimo ? ultimo.toISOString().slice(0, 10) : null };
  if (sh) {
    if (posts90 === 0) h('li-sin-publicar', 'medio', ultimo ? `Última publicación: ${datos.actividad.ultimaPublicacion}` : 'Ninguna publicación en la exportación');
    else if (posts90 < 13) h('li-publica-poco', 'bajo', `${posts90} publicaciones en 90 días (~${datos.actividad.porSemana} por semana)`);
    else h('li-publica-ok', 'ok', `${posts90} publicaciones en 90 días (~${datos.actividad.porSemana} por semana)`);
  }
  if (coms90 !== null && coms90 < 20) h('li-comenta-poco', 'bajo', `${coms90} comentarios en 90 días`);

  // Invitaciones enviadas: ¿personalizadas?
  const inv = buscar(archivos, 'Invitations.csv');
  if (inv) {
    const salientes = aObjetos(inv, ['From', 'To', 'Direction']).filter(x => /outgoing|enviad/i.test(x.Direction || ''));
    const conMensaje = salientes.filter(x => (x.Message || '').trim()).length;
    datos.invitaciones = { enviadas: salientes.length, personalizadas: conMensaje };
    if (salientes.length >= 10 && conMensaje / salientes.length < 0.5) h('li-invitaciones-genericas', 'bajo', `${conMensaje} de ${salientes.length} invitaciones enviadas llevan mensaje`);
  }
  return { hallazgos, datos };
}

/** Lo que no está en la exportación: lo marca el propio usuario en un JSON. */
const CHECKLIST = {
  fotoProfesional: 'Foto profesional, de cara y reciente',
  banner: 'Banner propio que explique qué haces',
  urlPersonalizada: 'URL personalizada (linkedin.com/in/tu-nombre)',
  destacados: 'Sección «Destacado» con caso, web o contenido',
  paginaServicios: 'Página de servicios activada',
  botonPersonalizado: 'Botón personalizado o enlace a la web en la cabecera',
  modoCreadorTemas: 'Temas de los que hablas definidos',
  idiomaSecundario: 'Perfil en un segundo idioma (si trabajas con clientes en otro idioma)',
  enlaceWebEnContacto: 'Web en la información de contacto',
  coherenciaConWeb: 'Titular y extracto coherentes con la web (mismo cargo y propuesta)'
};

function analizarChecklist(valores) {
  const hallazgos = [];
  const pendientes = Object.entries(CHECKLIST).filter(([k]) => valores[k] === false).map(([, v]) => v);
  const sinDato = Object.entries(CHECKLIST).filter(([k]) => valores[k] === undefined || valores[k] === null).map(([, v]) => v);
  const hechos = Object.entries(CHECKLIST).filter(([k]) => valores[k] === true).length;
  if (pendientes.length) hallazgos.push({ id: 'li-checklist-pendiente', severidad: pendientes.length > 3 ? 'medio' : 'bajo', detalle: pendientes.join(' · '), url: 'LinkedIn · perfil' });
  if (sinDato.length) hallazgos.push({ id: 'li-checklist-sin-dato', severidad: 'info', detalle: sinDato.join(' · '), url: 'LinkedIn · perfil' });
  if (hechos) hallazgos.push({ id: 'li-checklist-ok', severidad: 'ok', detalle: `${hechos} de ${Object.keys(CHECKLIST).length} elementos confirmados`, url: 'LinkedIn · perfil' });
  return { hallazgos, datos: { hechos, pendientes: pendientes.length, sinDato: sinDato.length } };
}

function leerHistorial(ruta) {
  if (!ruta || !fs.existsSync(ruta)) return [];
  return fs.readFileSync(ruta, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * @param {object} op { ssi:{marca,personas,interaccion,relaciones,sector,red}, exportacion:ruta, checklist:obj|ruta, historial:ruta, guardarHistorial:bool }
 */
function estudioLinkedIn(op) {
  const hallazgos = [];
  const datos = {};
  if (op.ssi) {
    const historial = leerHistorial(op.historial);
    const r = analizarSSI(op.ssi, historial);
    hallazgos.push(...r.hallazgos);
    datos.ssi = r.datos;
    if (op.historial && op.guardarHistorial !== false) {
      fs.mkdirSync(path.dirname(path.resolve(op.historial)), { recursive: true });
      fs.appendFileSync(op.historial, JSON.stringify({ fecha: new Date().toISOString(), total: r.datos.total, ...Object.fromEntries(r.datos.pilares.map(p => [p.clave, p.valor])), sector: op.ssi.sector ?? null, red: op.ssi.red ?? null }) + '\n');
    }
  }
  if (op.exportacion) {
    const r = analizarExportacion(leerExportacion(op.exportacion));
    hallazgos.push(...r.hallazgos);
    datos.exportacion = r.datos;
  }
  if (op.checklist) {
    const valores = typeof op.checklist === 'string' ? JSON.parse(fs.readFileSync(op.checklist, 'utf8')) : op.checklist;
    const r = analizarChecklist(valores);
    hallazgos.push(...r.hallazgos);
    datos.checklist = r.datos;
  }
  if (op.perfilUrl) datos.perfilUrl = op.perfilUrl;
  return { hallazgos, datos };
}

/** "18,12.5,15,20" o "18 12 15 20" → objeto; opcionalmente sector y red como 5.º y 6.º valor */
function parsearSSI(texto) {
  const n = String(texto).split(/[,;\s/]+/).filter(Boolean).map(x => Number(x.replace(',', '.')));
  if (n.length < 4) throw new Error('El SSI necesita las cuatro puntuaciones: marca, personas, interacción, relaciones (p. ej. 18,12,15,20)');
  return { marca: n[0], personas: n[1], interaccion: n[2], relaciones: n[3], sector: n[4] ?? null, red: n[5] ?? null };
}

module.exports = { estudioLinkedIn, analizarSSI, analizarExportacion, analizarChecklist, leerExportacion, parsearSSI, PILARES, CHECKLIST, PLAN };
