'use strict';
/**
 * Informe HTML autocontenido: un único archivo, sin dependencias externas,
 * legible en pantalla y preparado para imprimir o guardar como PDF.
 */
const { NOMBRE_SEV } = require('../informe');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function html(inf, { autor = '', marca = '' } = {}) {
  const m = inf.meta;
  const host = new URL(m.url).host;
  const fecha = new Date(m.fecha);
  const fechaTxt = fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  const ruta = (u) => { try { const x = new URL(u); return x.origin === m.origen ? (decodeURI(x.pathname) + x.search) : u; } catch { return u; } };
  const s = inf.resumen.porSev;
  const problemas = inf.grupos.filter(g => !['ok', 'info'].includes(g.severidad));
  const prioridades = problemas.filter(g => ['critico', 'alto'].includes(g.severidad));
  const info = inf.grupos.filter(g => g.severidad === 'info');
  const oks = inf.grupos.filter(g => g.severidad === 'ok');

  const estadoTxt = { mal: 'Requiere atención', mejorable: 'Mejorable', bien: 'Sin problemas relevantes' };
  const estadoArea = (a) => a.problemas ? `${estadoTxt[a.estado]} · ${a.problemas} a revisar` : 'Correcto';

  const tarjeta = (g, abierto) => `
    <details class="hallazgo sev-${g.severidad}"${abierto ? ' open' : ''}>
      <summary>
        <span class="chip ${g.severidad}">${NOMBRE_SEV[g.severidad]}</span>
        <span class="tit">${esc(g.titulo)}</span>
        <span class="meta">${g.casos.length > 1 || m.modo === 'sitio' ? `${g.casos.length} ${g.casos.length === 1 ? 'caso' : 'casos'}` : ''}</span>
      </summary>
      <div class="cuerpo">
        ${g.porque ? `<p><strong>Por qué importa.</strong> ${esc(g.porque)}</p>` : ''}
        ${g.arreglo ? `<p><strong>Cómo se arregla.</strong> ${esc(g.arreglo)}</p>` : ''}
        <ul class="casos">
          ${g.variantes.slice(0, 60).map(v => `<li>${v.detalle ? `<span>${esc(v.detalle)}</span>` : ''}${m.modo === 'sitio' ? `<span class="urls">${v.urls.length > 1 ? `${v.urls.length} páginas: ` : ''}${v.urls.slice(0, 40).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(ruta(u))}</a>`).join(', ')}${v.urls.length > 40 ? '…' : ''}</span>` : ''}${v.evidencia ? `<code>${esc(String(v.evidencia).slice(0, 300))}</code>` : ''}</li>`).join('')}
          ${g.variantes.length > 60 ? `<li class="mas">… y ${g.variantes.length - 60} más (ver la exportación JSON)</li>` : ''}
        </ul>
      </div>
    </details>`;

  const porArea = inf.resumen.areas.map(a => {
    const gs = problemas.filter(g => g.area === a.clave);
    if (!gs.length) return '';
    return `<section class="area" id="area-${a.clave}"><h3>${esc(a.nombre)}</h3>${gs.map(g => tarjeta(g, false)).join('')}</section>`;
  }).join('');

  const tipoBot = { busqueda: 'Búsqueda / citas', usuario: 'Petición de usuario', entrenamiento: 'Entrenamiento', token: 'Señal de uso' };
  const bots = (inf.sitio.bots || []).map(b => {
    const prueba = inf.sitio.acceso && inf.sitio.acceso.pruebas.find(p => p.token === b.token);
    const accesoTxt = !prueba ? '—' : prueba.bloqueado ? `Rechazado (${prueba.status})` : `OK (${prueba.status})`;
    return `<tr><td><strong>${esc(b.token)}</strong><br><span class="dim">${esc(b.empresa)}</span></td><td>${esc(tipoBot[b.tipo])}<br><span class="dim">${esc(b.producto)}</span></td>
      <td class="${b.permitido && !b.bloqueadoEn.length ? 'si' : 'no'}">${b.permitido ? (b.bloqueadoEn.length ? 'Parcial' : 'Permitido') : 'Bloqueado'}</td><td>${esc(accesoTxt)}</td></tr>`;
  }).join('');

  const paginas = m.modo === 'sitio' ? `
    <section id="paginas"><h2>Páginas analizadas</h2>
    <div class="tabla"><table><thead><tr><th>URL</th><th>Estado</th><th>Palabras</th><th>Profundidad</th><th>Marcado</th></tr></thead><tbody>
    ${inf.paginas.map(p => `<tr><td><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(ruta(p.url))}</a>${p.title ? `<br><span class="dim">${esc(p.title.slice(0, 90))}</span>` : ''}</td>
      <td>${p.status === 200 ? (p.indexable === false ? '<span class="no">noindex</span>' : '200') : `<span class="no">${p.status}</span>`}</td>
      <td>${p.palabras ?? '—'}</td><td>${p.profundidad ?? '—'}</td><td class="dim">${esc((p.tiposLD || []).slice(0, 4).join(', '))}</td></tr>`).join('')}
    </tbody></table></div></section>` : '';

  const psi = inf.sitio.psi;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auditoría SEO, GEO y AEO · ${esc(host)}</title>
<meta name="robots" content="noindex">
<style>
:root{--bg:#f7f7f5;--panel:#fff;--txt:#1d2125;--dim:#5f6870;--borde:#e3e5e8;--acento:#0f6e6e;--crit:#b42318;--alto:#d92d20;--medio:#b54708;--bajo:#1f6f8b;--info:#667085;--ok:#13795b;--fondo-crit:#fef3f2;--fondo-medio:#fffaeb;--fondo-ok:#ecfdf3}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#111416;--panel:#191d20;--txt:#e7e9ea;--dim:#9aa4ad;--borde:#2b3137;--acento:#4fb3b3;--crit:#f97066;--alto:#f97066;--medio:#fdb022;--bajo:#7cc4dd;--info:#98a2b3;--ok:#47cd89;--fondo-crit:#2a1514;--fondo-medio:#2a2112;--fondo-ok:#10251c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--acento)}
.contenedor{max-width:1040px;margin:0 auto;padding:40px 20px 80px}
header.portada{border-bottom:1px solid var(--borde);padding-bottom:28px;margin-bottom:32px}
.marca{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
h1{font-size:clamp(28px,4vw,40px);line-height:1.15;margin:8px 0 6px;letter-spacing:-.02em}
h2{font-size:24px;margin:48px 0 16px;letter-spacing:-.01em}
h3{font-size:18px;margin:28px 0 12px;color:var(--dim);font-weight:600}
.dim{color:var(--dim);font-size:14px}
.datos{display:flex;flex-wrap:wrap;gap:8px 24px;color:var(--dim);font-size:14px}
.cifras{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:20px 0}
.cifra{background:var(--panel);border:1px solid var(--borde);border-radius:10px;padding:14px 16px}
.cifra b{display:block;font-size:30px;line-height:1.1}
.cifra.critico b{color:var(--crit)}.cifra.alto b{color:var(--alto)}.cifra.medio b{color:var(--medio)}.cifra.bajo b{color:var(--bajo)}.cifra.ok b{color:var(--ok)}
.areas{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
.areaest{display:flex;gap:10px;align-items:flex-start;background:var(--panel);border:1px solid var(--borde);border-radius:10px;padding:12px 14px;text-decoration:none;color:inherit}
.punto{width:10px;height:10px;border-radius:50%;margin-top:7px;flex:none}
.punto.mal{background:var(--alto)}.punto.mejorable{background:var(--medio)}.punto.bien{background:var(--ok)}
.hallazgo{background:var(--panel);border:1px solid var(--borde);border-left:4px solid var(--info);border-radius:10px;margin:10px 0;overflow:hidden}
.hallazgo.sev-critico{border-left-color:var(--crit)}.hallazgo.sev-alto{border-left-color:var(--alto)}.hallazgo.sev-medio{border-left-color:var(--medio)}.hallazgo.sev-bajo{border-left-color:var(--bajo)}.hallazgo.sev-ok{border-left-color:var(--ok)}
summary{cursor:pointer;list-style:none;display:flex;gap:12px;align-items:center;padding:14px 16px;flex-wrap:wrap}
summary::-webkit-details-marker{display:none}
.tit{font-weight:600;flex:1;min-width:200px}
.meta{color:var(--dim);font-size:14px}
.chip{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:999px;border:1px solid currentColor}
.chip.critico{color:var(--crit)}.chip.alto{color:var(--alto)}.chip.medio{color:var(--medio)}.chip.bajo{color:var(--bajo)}.chip.info{color:var(--info)}.chip.ok{color:var(--ok)}
.cuerpo{padding:0 16px 14px;border-top:1px solid var(--borde)}
.cuerpo p{margin:12px 0}
.casos{margin:8px 0 0;padding:0;list-style:none}
.casos li{padding:8px 0;border-top:1px dashed var(--borde);font-size:14px;overflow-wrap:anywhere}
.casos li>span{display:block}.casos .urls{color:var(--dim);margin-top:2px}.casos .urls a{font-weight:600}
.casos code{display:block;margin-top:4px;color:var(--dim);font-size:12px;white-space:pre-wrap}
.tabla{overflow-x:auto;background:var(--panel);border:1px solid var(--borde);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--borde);vertical-align:top;overflow-wrap:anywhere}
th{color:var(--dim);font-weight:600;font-size:13px}
td.si{color:var(--ok);font-weight:600}td.no,.no{color:var(--alto);font-weight:600}
ul.lista{padding-left:20px}
.nota{background:var(--panel);border:1px solid var(--borde);border-radius:10px;padding:16px 18px;font-size:15px}
footer{margin-top:60px;color:var(--dim);font-size:13px;border-top:1px solid var(--borde);padding-top:20px}
@media print{body{background:#fff}.hallazgo{break-inside:avoid}details{display:block}details>summary{pointer-events:none}details:not([open])>.cuerpo{display:block}a{color:inherit;text-decoration:none}}
</style>
</head>
<body>
<div class="contenedor">
<header class="portada">
  <div class="marca">${esc(marca || 'Auditoría técnica')}</div>
  <h1>Auditoría SEO, GEO y AEO<br><span style="color:var(--acento)">${esc(host)}</span></h1>
  <div class="datos">
    <span>${esc(fechaTxt)}</span>
    <span>${m.modo === 'sitio' ? `${m.paginasHtml} páginas analizadas` : `Página: ${esc(ruta(m.url) || '/')}`}</span>
    ${autor ? `<span>Preparado por ${esc(autor)}</span>` : ''}
  </div>
</header>

<section id="resumen">
  <h2>Resumen</h2>
  <p>${prioridades.length
    ? `Se han detectado <strong>${prioridades.length} ${prioridades.length === 1 ? 'problema prioritario' : 'problemas prioritarios'}</strong> que conviene resolver antes que nada, y ${problemas.length - prioridades.length} mejoras de menor impacto.`
    : problemas.length ? `No hay problemas críticos ni altos. Hay ${problemas.length} mejoras de impacto medio o bajo.` : 'No se han detectado problemas en las comprobaciones realizadas.'}</p>
  <div class="cifras">
    <div class="cifra critico"><b>${s.critico}</b>Críticos</div>
    <div class="cifra alto"><b>${s.alto}</b>Altos</div>
    <div class="cifra medio"><b>${s.medio}</b>Medios</div>
    <div class="cifra bajo"><b>${s.bajo}</b>Bajos</div>
    <div class="cifra ok"><b>${s.ok}</b>Correctos</div>
  </div>
  <div class="areas">
    ${inf.resumen.areas.map(a => `<a class="areaest" href="#area-${a.clave}"><span class="punto ${a.estado}"></span><span><strong>${esc(a.nombre)}</strong><br><span class="dim">${estadoArea(a)}</span></span></a>`).join('')}
  </div>
</section>

${prioridades.length ? `<section id="prioridades"><h2>Prioridades</h2><p class="dim">Ordenadas por gravedad y número de páginas afectadas.</p>${prioridades.map(g => tarjeta(g, true)).join('')}</section>` : ''}

<section id="hallazgos"><h2>Todos los hallazgos por área</h2>${porArea || '<p>Sin hallazgos.</p>'}</section>

${bots ? `<section id="ia"><h2>Rastreadores de IA</h2>
<p class="dim">Política de robots.txt y respuesta real del servidor a cada agente. Los de búsqueda y los que actúan a petición del usuario son los que permiten que te citen; bloquear los de entrenamiento es una decisión aparte${inf.sitio.acceso ? `. Googlebot simulado recibió ${inf.sitio.acceso.googlebot}` : ''}.</p>
<div class="tabla"><table><thead><tr><th>Agente</th><th>Uso</th><th>robots.txt</th><th>Acceso simulado</th></tr></thead><tbody>${bots}</tbody></table></div></section>` : ''}

${psi && (psi.campo || psi.lab) ? `<section id="cwv"><h2>Core Web Vitals</h2><div class="cifras">
${psi.campo ? `<div class="cifra ${psi.campo.lcp > 2500 ? 'alto' : 'ok'}"><b>${psi.campo.lcp != null ? (psi.campo.lcp / 1000).toFixed(1) + ' s' : '—'}</b>LCP (≤ 2,5 s)</div>
<div class="cifra ${psi.campo.inp > 200 ? 'alto' : 'ok'}"><b>${psi.campo.inp != null ? psi.campo.inp + ' ms' : '—'}</b>INP (≤ 200 ms)</div>
<div class="cifra ${psi.campo.cls > 0.1 ? 'alto' : 'ok'}"><b>${psi.campo.cls != null ? psi.campo.cls.toFixed(2) : '—'}</b>CLS (≤ 0,1)</div>` : ''}
${psi.lab ? `<div class="cifra"><b>${psi.lab.puntuacion}</b>Lighthouse móvil</div>` : ''}
</div>${psi.campo ? `<p class="dim">Datos de usuarios reales de Chrome (percentil 75), ámbito: ${esc(psi.campo.ambito)}.</p>` : '<p class="dim">Sin datos de usuarios reales: solo laboratorio.</p>'}</section>` : ''}

${info.length ? `<section id="info"><h2>Para tener en cuenta</h2>${info.map(g => tarjeta(g, false)).join('')}</section>` : ''}

${oks.length ? `<section id="correcto"><h2>Lo que está bien</h2><ul class="lista">${oks.map(g => `<li><strong>${esc(g.titulo)}</strong>${g.casos.length > 1 ? ` <span class="dim">(${g.casos.length} páginas)</span>` : g.casos[0].detalle ? ` <span class="dim">— ${esc(g.casos[0].detalle.slice(0, 160))}</span>` : ''}</li>`).join('')}</ul></section>` : ''}

${paginas}

<section id="metodo"><h2>Metodología y límites</h2>
<div class="nota">
<p>La auditoría lee el HTML tal como lo entrega el servidor, que es lo que procesan la mayoría de rastreadores de IA${m.opciones.render ? ', y lo compara con la página renderizada en un navegador' : ''}. Se revisan robots.txt (RFC 9309), sitemaps, directivas de indexación, metadatos, encabezados, datos estructurados, enlaces, imágenes, señales de entidad y la respuesta del servidor a ${(inf.sitio.bots || []).length} rastreadores de IA, contrastada con Googlebot para descartar falsos positivos.</p>
<p><strong>Qué no hace:</strong> no consulta a ChatGPT, Gemini o Perplexity para saber si hoy te citan (eso se mide con un registro de consultas repetido en el tiempo); no sustituye a Google Search Console ni a Bing Webmaster Tools, que dicen qué está indexado; no puntúa del 0 al 100, porque una nota agregada mezcla lo que depende de ti con lo que depende del alojamiento. Las comprobaciones de contenido (respuesta directa, fuentes, datos) son heurísticas: señalan dónde mirar, no sustituyen el criterio.</p>
<p class="dim">Duración: ${m.duracionS} s · ${m.paginas} URL solicitadas · auditor-geo ${esc(m.version)}</p>
</div></section>

<footer>Generado el ${esc(fecha.toLocaleString('es-ES'))} con auditor-geo ${esc(m.version)}${autor ? ` · ${esc(autor)}` : ''}.</footer>
</div>
</body>
</html>`;
}

module.exports = { html };
