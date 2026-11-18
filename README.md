# auditor-geo

**Auditoría SEO, GEO y AEO de código abierto para webs, marcas y marcas personales.**

Comprueba si una web puede ser **rastreada, indexada, entendida y citada** por Google, Bing y los
asistentes de IA (ChatGPT, Claude, Perplexity, Gemini, Copilot); si la **marca** está bien definida
como entidad y conectada con sus perfiles; si los asistentes **la mencionan** cuando un cliente
pregunta; y cómo está su **LinkedIn** (Social Selling Index, perfil y actividad). Todo en un único
informe priorizado que se puede entregar tal cual.

```bash
git clone https://github.com/alexvendre/auditor-geo.git && cd auditor-geo
node bin/auditor.js https://tudominio.com --sitio --html
```

Node 18 o superior. **Sin dependencias obligatorias.** Licencia MIT.

> *English summary at the end.*

---

## Qué audita

| Módulo | Qué responde | Cómo |
|---|---|---|
| **Web: SEO, GEO y AEO** | ¿Pueden buscadores y asistentes leer, entender y citar la web? | Más de 100 comprobaciones sobre el HTML que entrega el servidor, una página o el sitio entero |
| **Marca y entidad** | ¿Está claro quién es la marca y lo confirman otras fuentes? | Nombre, ficha de la entidad, perfiles externos, Wikidata y Knowledge Graph |
| **Visibilidad en IA** | ¿Te mencionan los asistentes cuando un cliente pregunta? | Consultas reales a sus API con búsqueda web, con historial para comparar entre meses |
| **LinkedIn** | ¿Qué falla en tu SSI y en tu perfil, y qué hacer? | SSI, exportación oficial de datos de la cuenta y lista de comprobación |

### 1. Web: SEO, GEO y AEO

- **GEO.** robots.txt según el RFC 9309 para 18 agentes de IA, separados por uso: **búsqueda**
  (OAI-SearchBot, Claude-SearchBot, PerplexityBot, Bingbot…), **petición de usuario** (ChatGPT-User,
  Claude-User…) y **entrenamiento** (GPTBot, ClaudeBot, CCBot, Google-Extended…). Bloquear el
  entrenamiento es una decisión legítima; bloquear la búsqueda es renunciar a que te citen.
  - **Acceso real** de cada bot contrastado con Googlebot, para no confundir la verificación de IP
    del alojamiento con un bloqueo. Detecta **Cloudflare AI Crawl Control** y `Content-Signal`.
  - **Contenido que depende de JavaScript**, invisible para la mayoría de rastreadores de IA. Con
    `--render`, compara el HTML del servidor con la página renderizada.
  - llms.txt, fuentes externas, datos concretos, fechas, autoría y secciones demasiado largas.
- **AEO.** `nosnippet` y `max-snippet`, respuesta directa en el primer párrafo, preguntas como
  subtítulo con respuestas breves y preguntas de `FAQPage` que no se ven en la página.
- **SEO técnico y on-page.** Indexación, canonical, redirecciones, soft 404, http/https y www,
  sitemaps, title y meta (medidos sin el sufijo de marca), encabezados, Open Graph, `alt`, enlaces,
  hreflang, HTTPS y contenido mixto.
- **Datos estructurados.** Validación por tipo con resolución de `@id` y detección de JSON-LD
  «fugado» como texto visible.
- **Sitio entero** (`--sitio`). Duplicados de title, meta, H1 y contenido, páginas huérfanas,
  enlaces rotos, profundidad de clic, sitemap incoherente y datos que cada página dice de una forma.
- **Rendimiento.** Tiempo de servidor, compresión, scripts que bloquean, imágenes sin dimensiones,
  LCP con carga diferida y formatos (comprobando antes si el CDN ya sirve WebP o AVIF). Con
  `--psi`, Core Web Vitals de usuarios reales.

### 2. Marca y entidad

Buscadores y modelos no posicionan páginas, reconocen **entidades**. Se comprueba:

- **Coherencia del nombre** entre el JSON-LD, `og:site_name`, el sufijo del title, el pie y llms.txt.
- **Ficha de la entidad**:
  - Person: cargo, foto, temas, empresa y perfiles.
  - Organization o LocalBusiness: logo, contacto, dirección y descripción.
- **Perfiles externos** (`sameAs` y los que indiques): si existen, si **enlazan de vuelta** a la web
  y cuáles no se pueden verificar desde fuera (LinkedIn, Instagram, X y Facebook bloquean las
  comprobaciones automáticas). Esos se marcan como «no verificables», no como errores.
- **Wikidata** (`--wikidata`) y **Google Knowledge Graph** (con `KG_API_KEY`).
- **Verificación manual** de lo que no se puede automatizar: resultados de Google, ficha de empresa,
  reseñas y menciones.

### 3. Visibilidad en asistentes de IA

Hace a ChatGPT, Claude, Perplexity y Gemini (por API y con búsqueda web) las preguntas que haría un
cliente. Para cada respuesta registra herramienta, modelo, fecha y consulta, y además:

- si **menciona** la marca y si **enlaza** la web, y en qué posición;
- qué **competidores** aparecen;
- qué **fuentes** cita.

Los resultados se acumulan en un historial JSONL para comparar mes a mes con las mismas consultas.

- Usa **tus claves** y **tiene coste**. Solo se ejecuta con `--ia` o con `"activar": true` en el proyecto.
- La API no es la aplicación de consumo y las respuestas varían entre ejecuciones. Es una muestra
  con fecha, no una garantía de lo que verá cada usuario.

| Asistente | Variable | Notas |
|---|---|---|
| ChatGPT | `OPENAI_API_KEY` | API Responses con `web_search`; modelo en `OPENAI_MODEL` |
| Claude | `ANTHROPIC_API_KEY` | Requiere `npm install @anthropic-ai/sdk`; modelo en `CLAUDE_MODEL` |
| Perplexity | `PERPLEXITY_API_KEY` | Sonar; modelo en `PERPLEXITY_MODEL` |
| Gemini | `GEMINI_API_KEY` | Grounding con Google Search; modelo en `GEMINI_MODEL` |

### 4. LinkedIn: SSI, perfil y actividad

LinkedIn no permite leer el SSI ni los perfiles de forma automatizada (sus condiciones prohíben el
scraping). Por eso el estudio usa datos que obtienes tú legítimamente:

1. **SSI**: las cuatro puntuaciones de [linkedin.com/sales/ssi](https://www.linkedin.com/sales/ssi)
   (0–25 cada una) y, si quieres, tu posición en tu sector y en tu red. El informe incluye:
   - el estado de cada pilar;
   - el **plan de acción** para los dos más bajos;
   - la **evolución** si guardas el historial.
2. **Exportación de datos** (Ajustes → Privacidad de datos → Obtener una copia de tus datos), en ZIP
   o carpeta. Analiza:
   - el titular, el extracto y la experiencia;
   - las aptitudes y las recomendaciones;
   - el crecimiento de la red;
   - las publicaciones, los comentarios y las invitaciones personalizadas.

   **Se procesa en local** y el informe solo muestra recuentos, nunca nombres, correos ni mensajes.
3. **Lista de comprobación** ([`ejemplos/linkedin-checklist.json`](ejemplos/linkedin-checklist.json))
   para lo que no está en la exportación: foto, banner, URL personalizada, destacados, servicios…

> Las bandas «débil / mejorable / fuerte» son de esta herramienta: dividen la escala de 0 a 25 en
> tramos. LinkedIn no publica referencias absolutas, solo tu posición relativa en tu sector y tu red.

---

## Uso

```bash
# Web + marca de una página
node bin/auditor.js https://tudominio.com

# Sitio entero con informe para entregar
node bin/auditor.js https://tudominio.com --sitio --max 300 --html --autor "Tu nombre"

# Estudio de LinkedIn
node bin/auditor.js linkedin --ssi 18.5,12,15,20,8,12 \
  --linkedin-export Basic_LinkedInDataExport.zip \
  --linkedin-checklist mi-checklist.json --historial-ssi historial/ssi.jsonl --html

# Visibilidad en IA
node bin/auditor.js ia --marca "Tu Marca" --dominio tudominio.com \
  --categoria "consultor SEO para despachos" --zona Barcelona \
  --competidores "Competidor A,Competidor B" --historial-ia historial/ia.jsonl

# Todo junto, definido en un archivo de proyecto
node bin/auditor.js completa --proyecto ejemplos/proyecto.ejemplo.json
```

<details>
<summary><strong>Todas las opciones</strong></summary>

```
Web
  --sitio                Audita el sitio entero (sitemap + enlaces internos)
  --max <n>              Máximo de páginas (100)       --concurrencia <n>  Peticiones simultáneas (4)
  --render               Compara con la página renderizada (requiere Playwright)
  --psi                  Core Web Vitals reales vía PageSpeed Insights (PSI_API_KEY)
  --sin-bots             No simula rastreadores de IA     --config <archivo>  Reglas propias del sitio

Marca y entidad
  --marca "<nombre>"     Nombre canónico de la marca o la persona
  --alias "A,B"          Otras formas de escribirla
  --perfiles "url,url"   Perfiles externos a verificar además de los del marcado
  --linkedin-url <url>   Tu perfil o página de empresa de LinkedIn
  --wikidata             Busca la marca en Wikidata      --sin-marca  Omite este módulo

Visibilidad en IA
  --ia                   Activa el módulo (consulta las API con tus claves; tiene coste)
  --consultas <archivo>  Una consulta por línea  ·  o --categoria "…" [--zona "…"]
  --competidores "A,B"   --proveedores "chatgpt,claude,perplexity,gemini"
  --repeticiones <n>     --historial-ia <archivo>        --pais ES

LinkedIn
  --ssi "m,p,i,r[,sector,red]"   --linkedin-export <zip|carpeta>
  --linkedin-checklist <json>    --historial-ssi <archivo>

Informe
  --html [archivo]  --md [archivo]  --json [archivo]
  --autor "<nombre>"  --empresa "<texto>"  --detalle  --sin-color
  --falla-en critico|alto|medio|bajo|nunca   (código de salida 1; por defecto alto)
```
</details>

### El proyecto de auditoría

Para auditorías que se repiten (un cliente cada trimestre, tu propia marca cada mes), define todo en
un JSON y versiona el historial. Ver [`ejemplos/proyecto.ejemplo.json`](ejemplos/proyecto.ejemplo.json):

```json
{
  "web":      { "url": "https://cliente.es", "sitio": true, "max": 200 },
  "marca":    { "nombre": "Cliente SL", "perfiles": ["https://www.linkedin.com/company/cliente/"], "wikidata": true },
  "ia":       { "activar": true, "consultas": "consultas.txt", "competidores": ["Competidor A"], "historial": "historial/ia.jsonl" },
  "linkedin": { "ssi": "18.5,12,15,20", "exportacion": "LinkedInDataExport.zip", "historial": "historial/ssi.jsonl" },
  "informe":  { "html": "informes/cliente.html", "autor": "Tu nombre" }
}
```

### El informe

- **Terminal**: ordenado por gravedad y número de páginas afectadas; los casos idénticos se agrupan.
- **HTML**: un único archivo autocontenido con resumen, estado por área, prioridades y todos los
  hallazgos con su explicación y solución. Incluye además:
  - el SSI con su plan de acción y la tabla de visibilidad en IA;
  - los perfiles de la marca y la lista de verificación manual;
  - la metodología y los límites.

  Modo claro y oscuro, adaptado a móvil e imprimible como PDF.
- **JSON** para guardar histórico o integrarlo en otras herramientas, y **Markdown** para documentos.

Severidades: **crítico** (no se indexa o no se puede leer), **alto** (pérdida directa de
visibilidad), **medio**, **bajo** e **info** (contexto, sin acción).

### Reglas propias de cada sitio

[`ejemplos/config.ejemplo.json`](ejemplos/config.ejemplo.json) (con `--config` o `web.reglas`):

- términos de un posicionamiento anterior que no deberían quedar;
- datos que deben decirse igual en todas las páginas;
- páginas exentas de longitud y huérfanas intencionadas;
- imágenes que se ignoran y umbrales propios.

---

## Principios

- **Una regla mal calibrada es peor que no tenerla.** Cada comprobación tiene una prueba con un caso
  que debería pasar limpio, y se ha calibrado con webs reales. Algunos falsos positivos que se
  corrigieron:

  | Falso positivo | Causa | Solución |
  |---|---|---|
  | «Artículo sin autor» en páginas de servicio | Yoast pone `og:type=article` en todas las páginas | El tipo se deduce del JSON-LD y de la URL |
  | Titles duplicados en categorías | La paginación (`/page/2/`) los repite por diseño | Se excluye la paginación |
  | Enlaces internos con nofollow | Botones de compartir (`?share=`) | Se ignoran los enlaces con parámetros |
  | «Imágenes en JPEG/PNG» | El CDN sirve WebP a la misma URL | Se comprueba la negociación antes de avisar |
  | Bloqueo de bots de IA por un 403 | Verificación de IP del alojamiento | Control con Googlebot |
  | Perfil de LinkedIn «roto» | LinkedIn responde 999 a cualquier petición automática | Se marca como no verificable |

- **Sin puntuación de 0 a 100.** Una nota agregada mezcla lo que depende de ti con lo que depende
  del alojamiento o de terceros. Cada área tiene un estado y cada hallazgo una prioridad.
- **Sin promesas.** Ninguna auditoría garantiza aparecer en ChatGPT. Lo que se puede hacer es quitar
  obstáculos técnicos, definir bien la entidad, responder mejor que otros y medir con método.
- **Privacidad.** Los datos de LinkedIn se procesan en local; las claves de API se leen del entorno
  y no se guardan en informes ni historiales.

## Lo que no hace

- No sustituye a Google Search Console ni a Bing Webmaster Tools, que dicen qué está indexado.
- No mide enlaces entrantes ni tráfico (para eso hacen falta Search Console o herramientas de pago).
- No automatiza LinkedIn ni lee perfiles de terceros.

---

## Contribuir

Las contribuciones son bienvenidas, sobre todo los **avisos de falsos positivos**. Lee
[CONTRIBUTING.md](CONTRIBUTING.md): cómo añadir una comprobación, la política de cero dependencias y
las pruebas.

```bash
npm test     # pruebas unitarias y de extremo a extremo, sin internet
```

```
bin/auditor.js          CLI y subcomandos (web, completa, linkedin, ia)
src/completa.js         orquesta los cuatro módulos en un único resultado
src/auditoria.js        auditoría web: selección de páginas, rastreo y análisis entre páginas
src/checks/             comprobaciones de sitio y de página
src/marca.js            marca y entidad
src/ia.js               visibilidad en asistentes de IA
src/linkedin.js         SSI, exportación de datos y lista de comprobación
src/catalogo.js         texto de cada comprobación: área, por qué importa, cómo se arregla
src/robots.js · src/jsonld.js · src/html.js · src/util/csv.js   intérpretes sin dependencias
src/report/             terminal, HTML y Markdown
```

`auditor-geo.js` y `auditor-web.js` se mantienen por compatibilidad con la versión 1.

## Autor y licencia

Creado por **Alex Vendrell Torres** ([alexvendrell.com](https://alexvendrell.com) ·
[LinkedIn](https://www.linkedin.com/in/alex-vendrell-torres/)). Licencia [MIT](LICENSE).

---

## English summary

**auditor-geo** is an open-source, zero-dependency Node.js CLI that audits websites and brands for
SEO, GEO (Generative Engine Optimization) and AEO (Answer Engine Optimization). It runs four modules:

- **Web**: 100+ checks, with robots.txt parsed per RFC 9309 for 18 AI crawlers and real access
  tested against a Googlebot control to avoid false positives.
- **Brand and entity**: naming consistency, entity markup, and external profiles.
- **AI visibility**: brand mentions and citations in ChatGPT, Claude, Perplexity and Gemini via
  their APIs.
- **LinkedIn**: Social Selling Index study and analysis of the official data export, processed
  locally.

The output is a prioritized terminal, HTML, Markdown or JSON report. The interface and reports are
in Spanish; contributions to translate them are welcome.

```bash
node bin/auditor.js https://example.com --sitio --html
```
