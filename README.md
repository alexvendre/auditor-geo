# auditor-geo

Auditoría de **GEO y AEO** para cualquier URL pública. Comprueba si una web está preparada para que
ChatGPT, Perplexity, Gemini o las respuestas generadas de Google puedan encontrarla, entenderla y
citarla.

Sin instalación y sin dependencias: solo Node 18 o superior.

```bash
node auditor-geo.js https://tudominio.com
node auditor-geo.js https://tudominio.com --json
```

---

## Por qué existe

Las auditorías automáticas dan falsos positivos en la comprobación más importante de todas.

Varias herramientas comprueban si permites el acceso a los rastreadores de IA lanzando una petición
con el *user-agent* de GPTBot o ClaudeBot. Si reciben un `403`, concluyen que hay bloqueo deliberado.

**Casi siempre es falso.** Muchos alojamientos verifican también la IP de origen y rechazan a quien
dice ser un bot desde una IP que no le corresponde. Es antisuplantación estándar. La herramienta no
puede lanzar la petición desde la IP real del bot, así que siempre va a recibir un 403.

Este script lo distingue haciendo la comprobación que ninguna otra hace: **prueba lo mismo con
Googlebot**. Si Googlebot también recibe 403 y tus páginas están indexadas en Google, no hay bloqueo,
hay una protección funcionando correctamente.

```
Acceso
    OK    robots.txt permite a los rastreadores de IA
          Ninguna regla Disallow global para agentes de IA.
    OK    FALSO POSITIVO descartado: no hay bloqueo de IA
          Los bots de IA reciben 403, pero Googlebot también (403).
          Es verificación de IP antisuplantación, no un bloqueo.
```

---

## Qué comprueba

**Acceso**
- `robots.txt`: si hay reglas que bloqueen a GPTBot, ClaudeBot, PerplexityBot, CCBot,
  Google-Extended, Bytespider o Meta-ExternalAgent.
- Respuesta real a seis rastreadores de IA, **contrastada con Googlebot** para descartar el falso
  positivo de la verificación de IP.

**Datos estructurados**
- Presencia y validez de bloques JSON-LD, con los tipos que declara.
- **Detección de JSON-LD fugado como texto visible**: si tu alojamiento filtra las etiquetas
  `<script>` puede quitar la etiqueta y dejar el JSON en la página, a la vista de cualquiera y con
  las comillas convertidas en angulares por el filtro tipográfico. Es peor que no tener marcado y
  casi nadie lo comprueba.

**Citabilidad**
- Un único `<h1>`, y que exista.
- Longitud del `<title>` y qué se pierde si Google lo corta.
- Longitud de la `meta description`.
- Si el primer párrafo **responde directamente**, mirando solo a partir del `<h1>` para no confundir
  el menú de navegación con el contenido.
- Volumen de texto.

**Entidad**
- Señal de autoría (`rel="author"`, `itemprop`, `author` en datos estructurados).
- Etiquetas Open Graph.
- Datos de contacto verificables en la página: `tel:` y `mailto:`.
- Atributo `lang`.

**Auxiliares**
- `sitemap.xml`
- `llms.txt` — marcado como informativo, no como fallo: es una convención emergente, no un estándar.

---

## Salida

Informe legible en la terminal, con tres estados: correcto, aviso y fallo. Cada línea incluye el
motivo, no solo el veredicto.

Con `--json` devuelve la misma información estructurada, para encadenarlo con otras herramientas o
guardar histórico y comparar entre meses.

---

## Lo que NO hace

- **No consulta a los modelos.** No te dice si ChatGPT te cita hoy: eso requiere preguntárselo, y el
  método fiable sigue siendo hacerlo tú cada mes y anotarlo.
- **No puntúa del 0 al 100.** Una nota agregada mezcla lo que puedes arreglar con lo que depende de
  tu alojamiento, y eso lleva a perder el tiempo en lo segundo.
- **No sustituye el criterio.** Señala dónde mirar; qué hacer con eso depende de tu contexto.

---

## Contexto

Escrito mientras reposicionaba mi propia web. Las tres comprobaciones menos habituales —el falso
positivo de bots, el JSON-LD fugado y el primer párrafo medido desde el `<h1>`— salieron de problemas
reales que me encontré, no de una lista de buenas prácticas.

Lo cuento entero en la [guía de GEO y AEO](https://alexvendrell.wordpress.com/guia-geo-aeo/).

---

## Autor

**Alex Vendrell Torres** — Marketing y comunicación · SEO, GEO y AEO · Sabadell (Barcelona)

- Web: [alexvendrell.wordpress.com](https://alexvendrell.wordpress.com)
- LinkedIn: [alex-vendrell-torres](https://www.linkedin.com/in/alex-vendrell-torres/)

## Licencia

MIT
