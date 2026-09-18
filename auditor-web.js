#!/usr/bin/env node
/**
 * auditor-web.js — Auditoría completa de un sitio propio.
 *
 * No comprueba solo el contenido: comprueba también los campos que NO son contenido
 * (H1, meta description, alt, nombres de archivo) y la COHERENCIA entre páginas,
 * que es donde se esconden los fallos que no se ven leyendo un artículo.
 *
 *   node auditor-web.js https://tudominio.com
 *   node auditor-web.js https://tudominio.com --json
 *
 * Node 18+. Sin dependencias.
 */

const BASE = (process.argv[2] || '').replace(/\/$/, '');
const JSON_OUT = process.argv.includes('--json');
if (!BASE) { console.error('Uso: node auditor-web.js https://tudominio.com'); process.exit(1); }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36';
const C = JSON_OUT
  ? { r: '', v: '', a: '', gris: '', neg: '', off: '' }
  : { r: '[31m', v: '[32m', a: '[33m', gris: '[2m', neg: '[1m', off: '[0m' };

// ─────────────────────────────────────────────────────────────
// CONFIGURACIÓN: lo que define "correcto" para ESTE sitio.
// Es lo único que hay que tocar al cambiar de proyecto.
// ─────────────────────────────────────────────────────────────
const CFG = {
  // Términos del posicionamiento ABANDONADO. Si aparecen describiéndole a él,
  // es un resto que se quedó atrás. Se ignoran en las URLs de la lista blanca.
  terminosViejos: [
    'consultor de automatizaci',
    'consultor de implantación de IA',
    'especialista en automatizaci',
    'Especialista en IA aplicada'
  ],
  // Páginas donde hablar de automatización SÍ es correcto.
  blancaViejos: [
    '/automatizacion-procesos-', '/agentes-ia-', '/implantacion-hubspot-crm',
    '/guia-n8n-pymes', '/ia-', '/tareas-', '/preguntas-frecuentes-ia-empresas',
    '/glosario-automatizacion'
  ],

  // Datos que deben decirse IGUAL en todas partes. Dos versiones = fallo.
  coherencia: {
    // Capturar solo la enumeración, no lo que viene detrás: si arrastras la
    // frase entera, cuatro páginas que dicen la misma lista salen como cuatro
    // variantes distintas y el aviso deja de significar nada.
    'lista de rastreadores de IA': /GPTBot((?:,\s*[A-Z][\w-]+)+(?:\s+[oy]\s+[A-Z][\w-]+)?)/g
  },

  minPalabras: 250,
  maxTitlePropio: 62,   // sin contar el sufijo de marca
  sufijoMarca: 16,      // longitud de " – Alex Vendrell"
  maxMeta: 160,
  minMeta: 50,
  maxKBInmediato: 300,  // peso de imágenes sin lazy-load en la portada

  // WordPress deja las primeras imágenes SIN lazy a propósito: son las que
  // están sobre el pliegue, y aplazarlas empeora el LCP en vez de mejorarlo.
  // Solo tiene sentido avisar a partir de la que ya no se ve al entrar.
  imagenesEager: 3,

  // Páginas que son cortas a propósito: avisar de su longitud es ruido.
  exentasDeLongitud: [
    '/politica-de-privacidad/', '/politica-de-cookies/', '/aviso-legal/', '/muchas-gracias/'
  ],

  // Páginas a las que no se enlaza queriendo (destino de un formulario, etc.).
  // Sin esta lista el informe da una huérfana fija que nunca hay que arreglar.
  huerfanasAdrede: ['/muchas-gracias/'],

  // Recursos que no controlamos (píxeles de la plataforma, etc.).
  // Avisar de ellos en 80 páginas oculta los avisos que sí importan.
  imagenesIgnoradas: [/\bb\.gif/i, /pixel\.wp\.com/i, /\/i\/scripts\//i]
};

const get = async (u) => {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    const ct = r.headers.get('content-type') || '';
    const esImagen = ct.includes('image');
    return {
      s: r.status, ct,
      b: esImagen ? '' : await r.text(),
      bytes: esImagen ? (await r.arrayBuffer()).byteLength : 0
    };
  } catch (e) { return { s: 0, b: '', bytes: 0, err: e.message }; }
};

const sinEtiquetas = h => h
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

// Solo el contenido: fuera cabecera y pie, que si no el menú cuenta como texto y como enlaces.
const cuerpo = h => {
  let i = h.search(/<main[\s>]/i);
  if (i < 0) i = h.search(/<h1[\s>]/i);
  if (i < 0) i = 0;
  let j = h.lastIndexOf('<footer');
  if (j < 0) j = h.length;
  return h.slice(i, j);
};

const norm = u => {
  if (!u || u.startsWith('//')) return null;
  if (u.startsWith('/')) u = BASE + u;
  if (!u.startsWith(BASE)) return null;
  u = u.split('#')[0].split('?')[0];
  return u.endsWith('/') ? u : u + '/';
};

(async () => {
  // ── Descubrir URLs ──────────────────────────────────────────
  const sm = await get(BASE + '/sitemap.xml');
  let urls = [...sm.b.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  for (const s of urls.filter(u => /\.xml$/i.test(u))) {
    const r = await get(s);
    urls.push(...[...r.b.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]));
  }
  urls = [...new Set(urls.filter(u => !/\.xml$/i.test(u)).map(norm))].filter(Boolean);
  if (!urls.length) { console.error('No se han encontrado URLs en el sitemap.'); process.exit(1); }

  const fallos = [], avisos = [];
  const paginas = {};
  const entrantes = {}; urls.forEach(u => entrantes[u] = new Set());
  const fueraDelSitemap = new Set();
  const cargos = {}, valoresCoherencia = {};

  const anota = (lista, url, msg) => lista.push({ url: (url.replace(BASE, '') || '/'), msg });

  // ── Rastreo ─────────────────────────────────────────────────
  for (let i = 0; i < urls.length; i += 6) {
    const lote = urls.slice(i, i + 6);
    const rs = await Promise.all(lote.map(get));

    rs.forEach((r, k) => {
      const u = lote[k];
      paginas[u] = r;

      // ── A. Salud técnica ──
      if (r.s !== 200) { anota(fallos, u, 'HTTP ' + r.s); return; }

      const h1s = (r.b.match(/<h1[\s>]/gi) || []).length;
      if (h1s !== 1) anota(fallos, u, h1s + ' etiquetas H1 (debe haber exactamente 1)');

      const can = (r.b.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1];
      if (!can) anota(fallos, u, 'sin canonical');
      else if (can.replace(/\/$/, '') !== u.replace(/\/$/, '')) anota(fallos, u, 'canonical apunta a ' + can.replace(BASE, ''));

      const metaRobots = (r.b.match(/<meta[^>]+name=["']robots["'][^>]*>/i) || [''])[0];
      if (/noindex/i.test(metaRobots)) anota(fallos, u, 'meta robots noindex');

      const restos = (r.b.match(/&lt;!--\s*\/?wp:|\/div&gt;/g) || []).length;
      if (restos) anota(fallos, u, restos + ' restos de bloque visibles en la página');

      if (/PENDIENTE/.test(r.b)) anota(fallos, u, 'marcador [PENDIENTE] publicado');

      // ── Title y meta description (vienen del TÍTULO y el EXTRACTO, no del cuerpo) ──
      const title = (r.b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
      const largoPropio = title.replace(/&#?\w+;/g, 'x').trim().length - CFG.sufijoMarca;
      if (largoPropio > CFG.maxTitlePropio) anota(avisos, u, 'title propio de ' + largoPropio + ' car.');

      const meta = (r.b.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || [])[1];
      if (!meta) anota(fallos, u, 'sin meta description');
      else if (meta.length > CFG.maxMeta) anota(avisos, u, 'meta description de ' + meta.length + ' car. (se corta en ' + CFG.maxMeta + ')');
      else if (meta.length < CFG.minMeta) anota(avisos, u, 'meta description de solo ' + meta.length + ' car.');

      if (!/property=["']og:title["']/.test(r.b)) anota(avisos, u, 'sin og:title');

      const exenta = CFG.exentasDeLongitud.some(p => u.endsWith(p));
      const palabras = sinEtiquetas(cuerpo(r.b)).split(' ').length;
      if (palabras < CFG.minPalabras && !exenta) anota(avisos, u, 'solo ~' + palabras + ' palabras');

      // ── B. Restos del posicionamiento viejo, mirando TAMBIÉN title, meta, H1 y alt ──
      const enBlanca = CFG.blancaViejos.some(p => u.includes(p));
      if (!enBlanca) {
        const h1 = (r.b.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
        const alts = [...r.b.matchAll(/alt=["']([^"']*)["']/g)].map(m => m[1]);
        CFG.terminosViejos.forEach(term => {
          const re = new RegExp(term, 'i');
          if (!re.test(r.b)) return;
          const donde = [];
          if (re.test(title)) donde.push('el title');
          if (meta && re.test(meta)) donde.push('la meta description');
          if (re.test(h1)) donde.push('el H1');
          if (alts.some(a => re.test(a))) donde.push('un alt de imagen');
          if (!donde.length) donde.push('el cuerpo');
          anota(fallos, u, 'posicionamiento viejo en ' + donde.join(' y ') + ': "' + term.replace(/\\u00f3/g, 'ó') + '"');
        });
      }

      // ── C. Coherencia del cargo en las firmas ──
      // Solo interesa la firma que declara el cargo (empieza por coma: "Por X, cargo…"),
      // no otros formatos de firma como "· Actualizado en…".
      const firma = r.b.match(/rel=["']author["'][^>]*>[^<]*<\/a>\s*(,[^<]{5,120})/);
      if (firma) {
        // Quedarse solo con la primera frase: el cargo es una sola cláusula, y si el
        // nodo de texto continúa, la captura arrastra lo de detrás y finge dos variantes.
        const v = sinEtiquetas(firma[1]).trim().replace(/\s+/g, ' ').replace(/\.\s+.*$/, '.');
        if (v) cargos[v] = (cargos[v] || 0) + 1;
      }

      // ── F. Datos repetidos que deben coincidir entre páginas ──
      const texto = sinEtiquetas(r.b);
      Object.entries(CFG.coherencia).forEach(([nombre, re]) => {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(texto)) !== null) {
          const v = m[1].trim().slice(0, 95);
          valoresCoherencia[nombre] = valoresCoherencia[nombre] || {};
          valoresCoherencia[nombre][v] = (valoresCoherencia[nombre][v] || 0) + 1;
        }
      });

      // ── D. Enlaces internos ──
      const salientes = [...new Set(
        [...cuerpo(r.b).matchAll(/href=["']([^"']+)["']/g)].map(m => norm(m[1])).filter(Boolean)
      )];
      salientes.forEach(d => {
        if (d === u) return;
        if (entrantes[d]) entrantes[d].add(u);
        else fueraDelSitemap.add(d.replace(BASE, ''));
      });

      // ── E. Imágenes: alt, nombre de archivo y carga diferida ──
      const imgs = [...r.b.matchAll(/<img[^>]*>/g)].map(m => m[0]);
      imgs.forEach((tag, idx) => {
        const src = (tag.match(/src=["']([^"']+)["']/) || [])[1] || '';
        if (!src.startsWith('http')) return;
        if (CFG.imagenesIgnoradas.some(re => re.test(src))) return;
        const alt = (tag.match(/alt=["']([^"']*)["']/) || [])[1];
        const fichero = decodeURIComponent(src.split('/').pop().split('?')[0]);

        if (alt === undefined) anota(avisos, u, 'imagen sin atributo alt: ' + fichero.slice(0, 42));
        if (/^(image|img|foto|dsc|captura|screenshot)[-_]?\d*\.(png|jpe?g|webp|gif)$/i.test(fichero))
          anota(avisos, u, 'nombre de archivo sin significado: ' + fichero);
        if (idx > CFG.imagenesEager && !/loading=["']lazy/.test(tag))
          anota(avisos, u, 'imagen bajo el pliegue sin lazy-load: ' + fichero.slice(0, 42));
      });
    });
  }

  // ── Análisis global del enlazado ────────────────────────────
  const huerfanas = Object.entries(entrantes).filter(([, s]) => s.size === 0)
    .map(([u]) => u.replace(BASE, '') || '/')
    .filter(u => !CFG.huerfanasAdrede.includes(u));
  const pocoEnlazadas = Object.entries(entrantes).filter(([, s]) => s.size === 1).map(([u]) => u.replace(BASE, '') || '/');

  // ── Peso de las imágenes de la portada ──────────────────────
  let kbInmediato = 0, kbTotal = 0;
  const home = paginas[BASE + '/'];
  if (home && home.b) {
    for (const tag of [...home.b.matchAll(/<img[^>]*>/g)].map(m => m[0])) {
      const src = ((tag.match(/src=["']([^"']+)["']/) || [])[1] || '').replace(/&amp;/g, '&');
      if (!src.startsWith('http')) continue;
      const r = await get(src);
      kbTotal += r.bytes;
      if (!/loading=["']lazy/.test(tag)) kbInmediato += r.bytes;
    }
    kbInmediato = Math.round(kbInmediato / 1024);
    kbTotal = Math.round(kbTotal / 1024);
    if (kbInmediato > CFG.maxKBInmediato)
      anota(avisos, BASE + '/', 'la portada carga ' + kbInmediato + ' KB de imágenes de golpe');
  }

  // ── robots.txt ──────────────────────────────────────────────
  const rb = await get(BASE + '/robots.txt');
  if (/^Disallow:\s*\/\s*$/m.test(rb.b)) fallos.push({ url: '/robots.txt', msg: 'BLOQUEO GLOBAL de rastreo' });

  // ── Salida ──────────────────────────────────────────────────
  if (JSON_OUT) {
    console.log(JSON.stringify({
      urls: urls.length, fallos, avisos, huerfanas, pocoEnlazadas,
      fueraDelSitemap: [...fueraDelSitemap], cargos, coherencia: valoresCoherencia,
      portada: { kbTotal, kbInmediato }
    }, null, 2));
    process.exitCode = fallos.length ? 1 : 0;
    return;
  }

  const bloque = (titulo, items, color) => {
    console.log('\n' + C.neg + titulo + C.off + ' ' + C.gris + '(' + items.length + ')' + C.off);
    if (!items.length) { console.log('  ' + C.v + 'nada' + C.off); return; }
    items.forEach(x => console.log('  ' + color + x.url.padEnd(44).slice(0, 44) + C.off + '  ' + x.msg));
  };

  console.log('\n' + C.neg + 'Auditoría completa' + C.off + '  ' + C.gris + BASE + ' · ' + urls.length + ' URLs' + C.off);

  bloque('FALLOS', fallos, C.r);
  bloque('AVISOS', avisos, C.a);

  console.log('\n' + C.neg + 'ENLAZADO INTERNO' + C.off);
  console.log('  Huérfanas: ' + (huerfanas.length ? C.r + huerfanas.join(', ') + C.off : C.v + 'ninguna' + C.off));
  console.log('  Con un solo enlace entrante: ' + (pocoEnlazadas.length
    ? C.a + pocoEnlazadas.length + C.off + ' ' + C.gris + pocoEnlazadas.slice(0, 4).join(', ') + (pocoEnlazadas.length > 4 ? '…' : '') + C.off
    : C.v + 'ninguna' + C.off));
  if (fueraDelSitemap.size)
    console.log('  ' + C.gris + 'Enlaces a URLs fuera del sitemap: ' + fueraDelSitemap.size + ' (archivos de autor y categoría son normales)' + C.off);

  console.log('\n' + C.neg + 'COHERENCIA' + C.off);
  const vCargos = Object.keys(cargos);
  if (vCargos.length > 1) {
    console.log('  ' + C.r + 'El cargo se escribe de ' + vCargos.length + ' formas distintas:' + C.off);
    vCargos.forEach(v => console.log('     ' + C.gris + cargos[v] + '×' + C.off + ' "' + v.slice(0, 72) + '"'));
  } else if (vCargos.length === 1) {
    console.log('  ' + C.v + 'Cargo idéntico en las ' + cargos[vCargos[0]] + ' firmas' + C.off);
  } else {
    console.log('  ' + C.gris + 'No se han encontrado firmas con rel="author"' + C.off);
  }
  Object.entries(valoresCoherencia).forEach(([nombre, vals]) => {
    const ks = Object.keys(vals);
    if (ks.length > 1) {
      console.log('  ' + C.r + '"' + nombre + '" se dice de ' + ks.length + ' formas distintas:' + C.off);
      ks.forEach(v => console.log('     ' + C.gris + vals[v] + '×' + C.off + ' ' + v.slice(0, 72)));
    } else if (ks.length === 1) {
      console.log('  ' + C.v + '"' + nombre + '" idéntico en todas partes' + C.off);
    }
  });

  if (kbTotal) {
    console.log('\n' + C.neg + 'PORTADA' + C.off);
    console.log('  Imágenes: ' + kbTotal + ' KB en total · '
      + (kbInmediato > CFG.maxKBInmediato ? C.a : C.v) + kbInmediato + ' KB de carga inmediata' + C.off);
  }

  console.log('\n' + C.neg + 'Resumen:' + C.off + ' '
    + (fallos.length ? C.r + fallos.length + ' fallos' : C.v + '0 fallos') + C.off
    + ' · ' + C.a + avisos.length + ' avisos' + C.off + '\n');

  process.exitCode = fallos.length ? 1 : 0;
})();
