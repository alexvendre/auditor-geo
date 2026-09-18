# auditor-web

Auditoría completa de un sitio propio, pensada para **no volver a encontrar el mismo fallo dos
semanas después**.

```bash
node auditor-web.js https://tudominio.com
node auditor-web.js https://tudominio.com --json
```

Node 18 o superior. Sin dependencias. Devuelve código de salida 1 si hay fallos, para poder
encadenarlo.

---

## Por qué existe

Durante un reposicionamiento de una web entera fuimos encontrando fallos **después** de darla por
terminada: el H1 de la portada seguía diciendo lo de antes, la meta description también, el `alt`
del logo salía en todas las páginas con el cargo viejo, dos artículos enlazaban a un slug que ya no
existía, y dos piezas publicadas el mismo día listaban rastreadores de IA distintos.

Todos tenían la misma causa, y no era descuido. Era **mirar donde no estaba el problema**.

### Los fallos no viven en el contenido

| Lo que se ve en la página | De dónde sale en realidad |
|---|---|
| El **H1** | Del **título** de la entrada o página |
| La **meta description** | Del **extracto** |
| El **`alt`** de una imagen | De la **biblioteca de medios**, no del artículo |
| El nombre del archivo | De cómo se subió la imagen hace meses |
| La imagen social (`og:image`) | De la **imagen destacada** |

Puedes releer el cuerpo de un artículo diez veces y no ver ninguno de los cinco. Por eso esta
herramienta audita la **página renderizada**, que es donde todos esos campos acaban confluyendo,
y no el contenido tal como lo escribiste.

### Y hay una segunda categoría: la coherencia

Ninguna página está mal por separado, pero **dos dicen cosas distintas**. Eso no lo detecta ninguna
auditoría por URL, porque hace falta comparar entre páginas. Aquí sí:

- ¿Tu cargo está escrito **exactamente igual** en todas las firmas? Dos variantes y dejas de ser una
  entidad para ser dos entidades débiles.
- ¿Los datos que repites en varios artículos coinciden? (En nuestro caso, la lista de rastreadores
  de IA aparecía de cuatro formas.)

---

## Qué comprueba

**Salud técnica**, por URL del sitemap
- HTTP 200, una sola etiqueta `<h1>`, canonical autorreferente, sin `noindex`
- Restos de bloques del editor visibles en la página
- Marcadores `[PENDIENTE]` publicados por accidente

**Campos que no son contenido**
- Longitud del `title` **descontando el sufijo de marca** — lo que Google corta primero es la marca,
  así que medir el título entero da falsos positivos
- Meta description presente y entre 50 y 160 caracteres
- `og:title`
- Volumen de texto, con **lista de exentas** para las páginas que son cortas a propósito

**Restos de un posicionamiento anterior**
- Busca los términos abandonados **en el title, la meta description, el H1 y los `alt`**, no solo en
  el cuerpo, y dice **en cuál de ellos** ha aparecido
- Con lista blanca: hay páginas donde hablar del tema viejo sigue siendo correcto

**Coherencia entre páginas**
- Cuántas formas distintas hay de escribir el cargo en las firmas
- Cuántas versiones hay de cada dato que se repite (configurable)

**Enlazado interno**
- Huérfanas (cero enlaces entrantes) y páginas con un solo enlace entrante
- Enlaces a URLs que no están en el sitemap
- Mide solo el **cuerpo**: si cuentas la cabecera y el pie, el menú hace que ninguna página parezca
  huérfana nunca

**Imágenes**
- Sin `alt`, con nombre de archivo sin significado, sin `loading="lazy"` bajo el pliegue
- Peso total de la portada y **cuánto carga de golpe**, que es lo que afecta al LCP
- Con lista de ignoradas para los recursos de la plataforma que no controlas

---

## Cómo se configura

Todo lo específico del proyecto está en el objeto `CFG`, arriba del todo. Al cambiar de sitio se
toca solo eso:

- `terminosViejos` y `blancaViejos` — el posicionamiento abandonado y dónde sigue siendo válido
- `coherencia` — expresiones regulares de los datos que deben decirse igual en todas partes
- `exentasDeLongitud` — páginas legales, gracias, etc.
- `huerfanasAdrede` — páginas a las que no se enlaza queriendo (el destino de un formulario, por
  ejemplo). Sin esta lista el informe da una huérfana fija que nunca hay que arreglar.
- `imagenesEager` — cuántas imágenes deja WordPress **sin** `lazy` a propósito (3 por defecto). Son
  las que se ven al entrar, y aplazarlas empeora el LCP en vez de mejorarlo.
- `imagenesIgnoradas` — píxeles de la plataforma y recursos ajenos
- Umbrales: `maxMeta`, `maxTitlePropio`, `sufijoMarca`, `minPalabras`, `maxKBInmediato`

### Una regla mal calibrada es peor que no tenerla

Las tres primeras versiones daban avisos que no eran fallos: marcaban como «sin lazy» las imágenes
que WordPress deja así a propósito, daban una huérfana que estaba huérfana queriendo, y contaban
cuatro variantes de un dato donde solo había una porque la expresión regular se llevaba también la
frase que venía detrás. Un informe con ruido se deja de leer, y entonces da igual lo que detecte.
**Antes de dar por buena una regla, comprueba un caso que debería pasarla limpio.**

---

## Cuándo pasarlo

**Siempre después de tocar la web, no antes de publicar.** Tarda un par de minutos y devuelve
código 1 si hay fallos.

En concreto, obligatorio después de:

1. Un **reposicionamiento** o cualquier cambio de mensaje
2. **Renombrar o sustituir imágenes**
3. Cambiar **títulos o extractos**
4. Publicar una pieza que **repita un dato** que ya aparece en otra

---

## Lo que NO hace

- **No sustituye a Search Console ni a Bing Webmaster Tools.** Te dice si tu web está bien hecha,
  no si está indexada. Son preguntas distintas y la segunda no depende de ti.
- **No puntúa del 0 al 100.** Una nota agregada mezcla lo que puedes arreglar con lo que depende de
  tu alojamiento, y eso lleva a perder tardes en lo segundo.
- **No mira estrategia.** Que una página esté técnicamente perfecta no significa que deba existir.
