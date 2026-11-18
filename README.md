# auditor-geo

Auditoría **SEO, GEO y AEO** de una página o de un sitio entero, desde la terminal. Comprueba si
una web puede ser **rastreada, indexada, entendida y citada** por Google, Bing y los asistentes de IA
(ChatGPT, Claude, Perplexity, Gemini, Copilot), y entrega un informe priorizado que se puede pasar
tal cual a un cliente.

Sin instalación y sin dependencias: solo Node 18 o superior.

```bash
node bin/auditor.js https://dominio.com                      # una página
node bin/auditor.js https://dominio.com --sitio              # el sitio entero
node bin/auditor.js https://dominio.com --sitio --html       # + informe HTML para el cliente
```

---

## Por qué existe

Las auditorías automáticas tienen dos problemas: **dan falsos positivos** y **miran donde no está el
fallo**.

**Falsos positivos.** Muchas herramientas comprueban si bloqueas a los bots de IA lanzando una
petición con el *user-agent* de GPTBot. Si reciben un `403`, concluyen que hay bloqueo. Casi siempre
es falso: el alojamiento verifica la IP de origen y rechaza a quien dice ser un bot desde una IP que no
le corresponde. Este auditor hace la comprobación de control que las demás no hacen: **prueba lo mismo
con Googlebot**. Si Googlebot también recibe 403, no hay bloqueo de IA, hay una protección funcionando.

**El fallo no vive en el contenido.** El H1 sale del título de la entrada, la meta description del
extracto, el `alt` de la biblioteca de medios y la imagen social de la imagen destacada. Puedes releer
un artículo diez veces y no ver ninguno de esos fallos. Por eso se audita la **página tal como la
entrega el servidor**, que es donde todo confluye y lo que leen los rastreadores de IA, que en su
mayoría no ejecutan JavaScript.

Y una regla de diseño que atraviesa toda la herramienta: **una regla mal calibrada es peor que no
tenerla**. Un informe con ruido se deja de leer. Cada comprobación tiene un caso de prueba que
*debería pasar limpio*, y se ha calibrado contra webs reales (ver [Calibración](#calibración)).

---

## Qué comprueba

Más de 100 comprobaciones en 11 áreas. Cada hallazgo del informe explica **por qué importa** y
**cómo se arregla**.

### GEO · Visibilidad en IA generativa
- **robots.txt para 18 agentes de IA**, interpretado según el RFC 9309 (grupos, regla más larga,
  comodines), y clasificados por uso: **búsqueda** (OAI-SearchBot, Claude-SearchBot, PerplexityBot,
  Bingbot…), **petición de usuario** (ChatGPT-User, Claude-User, Perplexity-User…) y **entrenamiento**
  (GPTBot, ClaudeBot, CCBot, Google-Extended…). Bloquear el entrenamiento es una decisión legítima;
  bloquear la búsqueda es renunciar a que te citen. El informe no los mezcla.
- **Acceso real** de cada bot contrastado con Googlebot y con un navegador: distingue bloqueo real,
  verificación de IP (falso positivo) y **Cloudflare AI Crawl Control**, que bloquea la IA por defecto
  en dominios nuevos desde 2025.
- **`Content-Signal`** de Cloudflare en robots.txt (search, ai-input, ai-train).
- **Contenido que depende de JavaScript**: aplicaciones que llegan vacías al rastreador. Con
  `--render`, compara el HTML del servidor con la página renderizada y dice qué porcentaje del texto
  solo existe tras ejecutar JavaScript.
- **llms.txt**: presencia y formato (marcado como informativo: es una propuesta, no un estándar).
- Fuentes externas, datos concretos, fecha de actualización y autoría en artículos; secciones largas
  sin subtítulos (los modelos recuperan fragmentos, no páginas).

### AEO · Respuestas directas
- `nosnippet`, `max-snippet` y `data-nosnippet`, que excluyen la página de fragmentos destacados y AI
  Overviews.
- Si el primer párrafo **responde** (solo en páginas informativas: exigirlo en una portada daba falsos
  avisos).
- Subtítulos en forma de pregunta y longitud del párrafo que los responde.
- Preguntas del marcado `FAQPage` que **no se ven** en la página (incumple las directrices de Google).

### Rastreo e indexación
robots.txt (incluido el **5xx, que Google trata como bloqueo total**), sitemaps e índices de
sitemaps, `noindex` en meta y en cabecera `X-Robots-Tag`, canonical (ausente, múltiple, a otra URL, a
http), cadenas de redirecciones y redirecciones temporales, **soft 404**, consolidación http→https y
www/sin www. En modo sitio: URLs del sitemap con error, redirección, `noindex` o canonical a otra
página, y páginas indexables fuera del sitemap.

### Datos estructurados
JSON-LD con errores de sintaxis, **JSON-LD fugado como texto visible** (el alojamiento quita la
etiqueta `<script>` y deja el JSON a la vista), propiedades obligatorias y recomendadas por tipo
(Organization, LocalBusiness y 40 subtipos, Person, Article, Product, Service, Event, FAQPage,
BreadcrumbList, VideoObject, JobPosting…) resolviendo referencias `@id` en grafos, y avisos
honestos sobre HowTo y FAQ, cuyos resultados enriquecidos Google retiró o limitó en 2023.

### Entidad y confianza (E-E-A-T)
Ficha de la entidad en la portada (Organization, LocalBusiness o Person) con `sameAs`, coherencia del
teléfono entre el marcado y la página (NAP), contacto visible, páginas de contacto y «sobre
nosotros», aviso legal y privacidad (obligatorios en España por LSSI-CE y RGPD), autoría y
**coherencia de la firma** entre artículos.

### SEO on-page, contenido y arquitectura
Title (medido **sin el sufijo de marca**, que es lo primero que corta Google), meta description, H1,
saltos de jerarquía, Open Graph, viewport, idioma, favicon, `alt` (sin contar `alt=""`, que es
correcto en imágenes decorativas), nombres de archivo sin significado, textos de enlace genéricos,
nofollow interno, texto provisional publicado y restos del editor. En modo sitio: **titles, metas, H1
y contenido duplicados** (similitud por fragmentos, útil para detectar páginas locales clonadas),
**huérfanas**, páginas enlazadas solo desde el menú, **enlaces internos rotos**, enlaces a
redirecciones y profundidad de clic.

### Rendimiento y seguridad
Tiempo de respuesta del servidor, peso del HTML, compresión, scripts que bloquean el renderizado,
imágenes sin dimensiones (CLS), **primera imagen con `loading="lazy"`** (empeora el LCP), imágenes
sin carga diferida bajo el pliegue, formatos antiguos (comprobando antes si el CDN ya negocia WebP o
AVIF, que si no da un falso aviso), HTTPS, contenido mixto y HSTS. Con `--psi`, **Core Web Vitals de
usuarios reales** (LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1) y Lighthouse vía PageSpeed Insights.

### Internacional
Códigos `hreflang` válidos, autorreferencia y `x-default`.

---

## Uso

```
auditor-geo <url> [opciones]

Alcance
  --sitio              Audita el sitio entero: sitemap + enlaces internos
  --max <n>            Máximo de páginas en modo sitio (por defecto 100)
  --concurrencia <n>   Peticiones simultáneas (por defecto 4)

Comprobaciones opcionales
  --render             Compara el HTML del servidor con la página renderizada (requiere Playwright)
  --psi                Core Web Vitals reales y Lighthouse (variable PSI_API_KEY recomendada)
  --sin-bots           No simula rastreadores de IA contra el servidor
  --config <archivo>   Reglas propias del sitio

Salida
  --html [archivo]     Informe HTML para entregar
  --md [archivo]       Informe en Markdown
  --json [archivo]     JSON completo (a la salida estándar si no se indica archivo)
  --detalle            En la terminal, todos los casos de cada hallazgo
  --autor "<nombre>"   Firma del informe HTML
  --marca "<texto>"    Antetítulo del informe HTML
  --falla-en <nivel>   Código de salida 1 si hay hallazgos de ese nivel o más graves
                       (critico | alto | medio | bajo | nunca; por defecto alto)
```

Ejemplos:

```bash
# Auditoría completa con informe para el cliente
node bin/auditor.js https://cliente.es --sitio --max 300 --html --autor "Alex Vendrell Torres"

# En un pipeline: falla solo si hay problemas críticos
node bin/auditor.js https://cliente.es --sitio --json informe.json --falla-en critico

# Con Core Web Vitals y comparación con la página renderizada
PSI_API_KEY=xxxx node bin/auditor.js https://cliente.es --psi --render
```

`--render` necesita Playwright (`npm i -D playwright && npx playwright install chromium`). La clave de
PageSpeed Insights es gratuita en Google Cloud; sin ella la API se queda enseguida sin cuota.

### El informe

- **Terminal**: hallazgos ordenados por gravedad y número de páginas afectadas; los casos idénticos en
  muchas URLs se agrupan en una línea.
- **HTML**: un único archivo autocontenido, con resumen ejecutivo, estado por área, prioridades,
  todos los hallazgos con su explicación y solución, tabla de rastreadores de IA, páginas analizadas y
  metodología. Modo claro y oscuro, adaptado a móvil y preparado para **imprimir o guardar como PDF**.
- **JSON**: todo lo anterior estructurado, para guardar histórico y comparar entre meses.
- **Markdown**: para pegar en un documento o en un ticket.

Severidades: **crítico** (la web no se indexa o no se puede leer), **alto** (pierdes visibilidad de
forma directa), **medio**, **bajo** y **info** (contexto, no requiere acción).

### Reglas propias de un sitio

Lo específico de cada proyecto va en un JSON aparte (`--config`), no en el código. Ver
[`ejemplos/config.ejemplo.json`](ejemplos/config.ejemplo.json):

- `terminosProhibidos` / `listaBlancaTerminos`: restos de un posicionamiento anterior, buscados
  también en title, meta, H1 y `alt`, con las páginas donde siguen siendo correctos.
- `coherencia`: expresiones regulares de datos que deben decirse igual en todas las páginas (precio,
  teléfono, una lista que se repite…). Dos versiones del mismo dato = aviso.
- `exentasDeLongitud`, `huerfanasAdrede`, `imagenesEager`, `imagenesIgnoradas`, `minPalabras`,
  `maxKBInmediato`, `seguirParametros`.

---

## Lo que NO hace

- **No consulta a los modelos.** No dice si ChatGPT te cita hoy. Eso se mide preguntando con un
  registro repetible (herramienta, fecha, consulta, resultado, enlace), no con una auditoría técnica.
- **No sustituye a Search Console ni a Bing Webmaster Tools.** Dice si la web está bien hecha, no si
  está indexada.
- **No puntúa del 0 al 100.** Una nota agregada mezcla lo que puedes arreglar con lo que depende del
  alojamiento. En su lugar, cada área tiene un estado y cada hallazgo una prioridad.
- **No sustituye el criterio.** Las comprobaciones de contenido (respuesta directa, fuentes, datos)
  son heurísticas: señalan dónde mirar.

---

## Calibración

Cada regla se ha contrastado con un caso que debería pasarla limpio. Algunas correcciones que
salieron de auditar webs reales:

| Falso positivo | Causa | Solución |
|---|---|---|
| «Artículo sin autor» en páginas de servicio | Yoast pone `og:type=article` en todas las páginas interiores | El tipo se deduce del JSON-LD y de la URL, no de Open Graph |
| Titles y H1 duplicados en categorías | La paginación (`/page/2/`) los repite por diseño | Se excluye la paginación |
| Enlaces internos con nofollow | Botones de compartir de Jetpack (`?share=linkedin`) | Se ignoran los enlaces con parámetros |
| «Imágenes en JPEG/PNG» | El CDN sirve WebP a la misma URL `.jpg` | Se pide una muestra aceptando WebP/AVIF antes de avisar |
| Propiedades del marcado repetidas en 60 URLs | La ficha de la entidad es global | Se valida una vez, en la portada |
| Bloqueo de IA por 403 | Verificación de IP del alojamiento | Control con Googlebot |
| `--render` con 403 | El alojamiento rechaza un user-agent que no cuadra con el navegador | Se usa el user-agent real del navegador |

---

## Desarrollo

```bash
npm test     # 21 pruebas: unitarias y de extremo a extremo contra servidores locales
```

```
bin/auditor.js          CLI
src/auditoria.js        orquestador: selección de páginas, rastreo y análisis entre páginas
src/checks/sitio.js     robots.txt, bots de IA, llms.txt, sitemaps, dominio, PageSpeed
src/checks/pagina.js    comprobaciones de cada página
src/catalogo.js         texto de cada comprobación: área, por qué importa, cómo se arregla
src/robots.js           intérprete de robots.txt (RFC 9309) y catálogo de agentes de IA
src/jsonld.js           grafo JSON-LD y validación por tipo
src/html.js             analizador HTML sin dependencias
src/informe.js          agrupación y priorización
src/report/             terminal, HTML y Markdown
```

`auditor-geo.js` y `auditor-web.js` se mantienen por compatibilidad con la versión 1: el primero
audita una página y el segundo equivale a `--sitio`.

---

## Autor

**Alex Vendrell Torres**: diseño web, SEO, GEO y AEO. Sabadell (Barcelona).

- Web: [alexvendrell.com](https://alexvendrell.com)
- LinkedIn: [alex-vendrell-torres](https://www.linkedin.com/in/alex-vendrell-torres/)

## Licencia

MIT
