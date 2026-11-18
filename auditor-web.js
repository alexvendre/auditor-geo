#!/usr/bin/env node
// Compatibilidad con la versión 1: `node auditor-web.js https://dominio.com` audita el sitio entero.
// Equivale a `node bin/auditor.js https://dominio.com --sitio`. Las reglas propias de cada sitio
// (antes en el objeto CFG) se pasan ahora con --config: ver ejemplos/.
if (!process.argv.includes('--sitio')) process.argv.push('--sitio');
require('./bin/auditor.js');
