'use strict';
/**
 * Capa HTTP: peticiones con tiempo límite, seguimiento manual de redirecciones
 * (para poder informar de cadenas), medición de tiempo hasta cabeceras y caché
 * en memoria para no pedir dos veces lo mismo durante una auditoría.
 */

const UA_NAVEGADOR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const UA_AUDITOR = UA_NAVEGADOR + ' AuditorGEO/2.0 (+https://github.com/alexvendre/auditor-geo)';

const cache = new Map();

/**
 * Pide una URL siguiendo redirecciones a mano.
 * Devuelve { url, finalUrl, status, headers, body, cadena:[{url,status}], ms, bytes, error }
 */
async function pedir(url, opciones = {}) {
  const {
    ua = UA_AUDITOR,
    timeoutMs = 20000,
    maxRedirecciones = 10,
    metodo = 'GET',
    leerCuerpo = true,
    usarCache = true,
    maxBytes = 8 * 1024 * 1024,
    cabeceras = {}
  } = opciones;

  const clave = `${metodo} ${ua} ${url} ${leerCuerpo} ${JSON.stringify(cabeceras)}`;
  if (usarCache && cache.has(clave)) return cache.get(clave);

  const promesa = (async () => {
    const cadena = [];
    let actual = url;
    const inicio = Date.now();
    for (let salto = 0; salto <= maxRedirecciones; salto++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const t0 = Date.now();
      let r;
      try {
        r = await fetch(actual, {
          method: metodo,
          headers: {
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9,ca;q=0.8,en;q=0.7',
            ...cabeceras
          },
          redirect: 'manual',
          signal: ctrl.signal
        });
      } catch (e) {
        clearTimeout(t);
        const motivo = e.name === 'AbortError' ? `tiempo agotado (${timeoutMs / 1000}s)` : (e.cause && e.cause.code) || e.message;
        return { url, finalUrl: actual, status: 0, headers: new Headers(), body: '', cadena, ms: Date.now() - inicio, bytes: 0, error: String(motivo) };
      }
      const ttfb = Date.now() - t0;
      cadena.push({ url: actual, status: r.status });

      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        clearTimeout(t);
        try { await r.body?.cancel(); } catch { /* nada */ }
        actual = new URL(r.headers.get('location'), actual).href;
        if (cadena.some(c => c.url === actual)) {
          return { url, finalUrl: actual, status: r.status, headers: r.headers, body: '', cadena, ms: Date.now() - inicio, bytes: 0, error: 'bucle de redirecciones' };
        }
        continue;
      }

      let body = '';
      let bytes = 0;
      const ct = r.headers.get('content-type') || '';
      try {
        if (leerCuerpo && metodo !== 'HEAD') {
          const buf = Buffer.from(await r.arrayBuffer());
          bytes = buf.byteLength;
          if (!/^(image|video|audio|font)\//i.test(ct) && !/pdf|zip|octet-stream/i.test(ct)) {
            body = buf.subarray(0, maxBytes).toString('utf8');
          }
        } else {
          try { await r.body?.cancel(); } catch { /* nada */ }
          bytes = Number(r.headers.get('content-length') || 0);
        }
      } catch (e) {
        clearTimeout(t);
        return { url, finalUrl: actual, status: r.status, headers: r.headers, body: '', cadena, ms: Date.now() - inicio, ttfb, bytes, error: 'cuerpo interrumpido: ' + e.message };
      }
      clearTimeout(t);
      return { url, finalUrl: actual, status: r.status, headers: r.headers, body, cadena, ms: Date.now() - inicio, ttfb, bytes, contentType: ct };
    }
    return { url, finalUrl: actual, status: 0, headers: new Headers(), body: '', cadena, ms: Date.now() - inicio, bytes: 0, error: 'demasiadas redirecciones' };
  })();

  if (usarCache) cache.set(clave, promesa);
  return promesa;
}

/** Ejecuta tareas con un máximo de N en paralelo. */
async function enParalelo(items, n, fn) {
  const resultados = new Array(items.length);
  let i = 0;
  const trabajadores = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      resultados[k] = await fn(items[k], k);
    }
  });
  await Promise.all(trabajadores);
  return resultados;
}

function limpiarCache() { cache.clear(); }

module.exports = { pedir, enParalelo, limpiarCache, UA_NAVEGADOR, UA_AUDITOR };
