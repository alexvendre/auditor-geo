# Cambios

## 3.1.0 — 2026-11-18

- **Comparar con una auditoría anterior** (`--comparar informe.json`): resuelto, nuevo, mejora y
  empeora, con aviso si las reglas o el alcance no son los mismos.
- **Generadores** (`generar llms|robots|schema`): borradores de llms.txt desde el sitemap, bloque
  de robots.txt para rastreadores de IA y JSON-LD de la entidad con huecos marcados.
- **Servidor MCP** (`bin/mcp.js`) sin dependencias, para usar el auditor desde Claude u otros
  asistentes.
- Nuevas comprobaciones informativas: `llms-full.txt` y versión Markdown por negociación de
  contenido (`Accept: text/markdown`).
- Calibración: el marcado global (`https://dominio/#…`) y lo que cuelga de él se valida solo en la
  portada.

## 3.0.0 — 2026-11-18

- **Auditoría completa** (`auditor-geo completa --proyecto proyecto.json`): web, marca, visibilidad
  en IA y LinkedIn en un único informe.
- **Marca y entidad**: coherencia del nombre entre marcado, title, pie y llms.txt; ficha de Person u
  Organization; verificación de perfiles externos (existe, enlaza de vuelta, no verificable);
  Wikidata y Google Knowledge Graph opcionales; lista de verificación manual.
- **Visibilidad en asistentes de IA**: ChatGPT, Claude, Perplexity y Gemini con búsqueda web;
  menciones, enlaces, posición, competidores y fuentes citadas; historial JSONL.
- **LinkedIn**: estudio del Social Selling Index (pilares, posición, evolución y plan de acción) y
  análisis de la exportación oficial de datos (perfil, red, actividad, recomendaciones), procesada
  en local y sin exponer datos de terceros.
- Proyecto preparado como código abierto: licencia MIT, guía de contribución, integración continua
  y plantillas de incidencias.
- **Cambio incompatible**: el antetítulo del informe HTML pasa de `--marca` a `--empresa`;
  `--marca` es ahora el nombre de la marca auditada.

## 2.0.0 — 2026-11-18

- Reescritura modular: más de 100 comprobaciones SEO, GEO y AEO, modo sitio, informes HTML,
  Markdown y JSON, reglas por sitio con `--config` y pruebas automáticas.

## 1.0.0 — 2026-09

- Primera versión: `auditor-geo.js` (GEO y AEO de una URL) y `auditor-web.js` (sitio desde el sitemap).
