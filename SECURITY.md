# Seguridad

Si encuentras una vulnerabilidad (por ejemplo, que el auditor ejecute código de una página
auditada o que el informe HTML permita inyectar contenido), no abras una incidencia pública.
Usa el aviso privado de vulnerabilidades de GitHub: pestaña **Security → Report a vulnerability**
de este repositorio.

El auditor nunca ejecuta el JavaScript de las páginas que analiza, salvo con `--render`, que usa un
navegador aislado de Playwright. Las claves de API se leen de variables de entorno y no se
escriben en informes ni historiales.
