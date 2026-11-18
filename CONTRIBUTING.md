# Cómo contribuir

Gracias por querer mejorar auditor-geo. Antes de empezar, conviene conocer las tres reglas del proyecto:

1. **Una regla mal calibrada es peor que no tenerla.** Un informe con ruido se deja de leer. Toda
   comprobación nueva necesita una prueba con un caso que la dispare y otro que debería pasarla
   limpio. Si encuentras un falso positivo, [abre una incidencia](../../issues/new?template=falso-positivo.yml):
   es la contribución más valiosa.
2. **Sin dependencias obligatorias.** El auditor tiene que funcionar con `node` y nada más. Lo
   opcional (Playwright para `--render`, el SDK de Anthropic para Claude) se carga solo si se usa.
3. **Honestidad antes que espectacularidad.** Nada de puntuaciones inventadas ni garantías de
   aparecer en ChatGPT. Si algo es una heurística, el texto lo dice. Si algo no se puede comprobar
   desde fuera, se marca como «no verificable», no como error.

## Añadir una comprobación

1. **Catálogo** (`src/catalogo.js`): añade una entrada con `area`, `titulo`, `porque` (por qué
   importa, con fuente si existe) y `arreglo` (cómo se arregla, en concreto).
2. **Emisión**: en el módulo que corresponda (`src/checks/pagina.js`, `src/checks/sitio.js`,
   `src/marca.js`, `src/ia.js`, `src/linkedin.js`), emite el hallazgo con su severidad:

   | Severidad | Cuándo |
   |---|---|
   | `critico` | La web no se puede indexar o leer |
   | `alto` | Pérdida directa de visibilidad o confianza |
   | `medio` | Problema real con impacto moderado |
   | `bajo` | Mejora recomendable |
   | `info` | Contexto: no requiere acción |
   | `ok` | Comprobación superada (aparece en «Lo que está bien») |

3. **Pruebas** (`test/`): un caso que lo dispare y otro que pase limpio. Las pruebas de extremo a
   extremo levantan un servidor local; no dependen de internet.
4. `npm test`.

## Estilo

- Código y textos en español, con nombres descriptivos.
- Comentarios para explicar el *porqué*, sobre todo cuando una regla evita un falso positivo.
- Los textos del informe se dirigen a quien tiene que arreglar el problema: claros, concretos y
  sin jerga innecesaria.

## Privacidad

El módulo de LinkedIn procesa datos personales de la exportación del usuario. Ningún cambio puede
hacer que el informe muestre nombres, correos o textos de terceros: solo recuentos. Hay una prueba
que lo verifica.
