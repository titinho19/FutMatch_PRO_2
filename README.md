# ⚽ Jogo Bonito Walking F.C. — Vestuario v2

Web estática para gestionar la plantilla, las convocatorias, las actas de cada partido y el ranking de leyendas. Sigue usando **Google Sheets + SheetDB**, así que no hay que migrar ningún dato: se leen y escriben los mismos campos de siempre.

## Qué hay nuevo

- **Historial de actas editable.** Puedes corregir un gol olvidado de la jornada 4 (o de la 1) sin tocar la hoja a mano. Al guardar, las estadísticas se recalculan con la **diferencia**: goles, MVPs y partidos jugados quedan siempre cuadrados.
- **Historial en la nube sin segunda API.** Las actas se guardan en una pestaña **Partidos** del mismo Google Sheets, usando la misma URL de SheetDB con `?sheet=Partidos`. Se sincronizan entre móvil y ordenador automáticamente.
- **Rediseño completo:** tarjetas tipo Ultimate Team con niveles oro/plata/bronce, marcador con barra de equilibrio, ranking con podio, buscador y ordenación por columnas, forma reciente (V/E/D) y ficha con trayectoria.
- **Generador de equipos mejorado:** reparte porteros y equilibra la media con cientos de combinaciones, no solo un reparto codicioso.
- **Borrador persistente:** si recargas sin querer, los equipos, goles, MVP, fecha y notas siguen ahí.
- **Extras:** convocatoria para WhatsApp, copia de seguridad JSON, ajustes de API desde la propia web, toasts, confirmaciones bonitas y avatares locales (sin depender de servicios externos).

## Archivos

| Archivo | Uso |
| --- | --- |
| `index.html` | Estructura y pantallas |
| `styles.css` | Diseño responsive |
| `app.js` | Lógica, API y estadísticas |

Sigue siendo 100 % estático: puedes abrir `index.html` directamente o subir los tres archivos a GitHub Pages, Netlify o similar. No hace falta compilar nada.

## Hoja de jugadores (ya existente)

La API de SheetDB se configura en ⚙ **Ajustes**. Por defecto usa la actual. Columnas esperadas:

```
id | nombre | posicion | pac | sho | pas | dri | def | phy | foto | goles | mvp | partidos
```

`posicion` admite `POR`, `DEF`, `MED` o `DEL`. Los campos que falten se rellenan con valores por defecto para no romper la app.

## Pestaña de actas (misma API, sin crear otra)

El historial reutiliza **la misma API** de SheetDB, apuntando a otra pestaña del mismo documento:

1. Crea una pestaña nueva en el mismo Google Sheets llamada **Partidos** (si aún no existe).
2. En la fila 1 escribe exactamente: `id`, `jornada`, `fecha`, `data`.
3. Abre ⚙ **Ajustes** y comprueba que **Pestaña de actas** dice `Partidos`. Guarda.
4. No hay que publicar una API nueva ni tocar la URL de la plantilla: la app construye `…?sheet=Partidos` automáticamente.

Cada acta se guarda como JSON en la columna `data`. **No edites esa columna a mano**; si quieres corregir algo, usa el botón ✏️ del historial.

> Si dejas la pestaña vacía, el historial funciona solo en ese dispositivo. También puedes usar una API independiente desde **Ajustes → Avanzado**.

## Cómo se recalculan las estadísticas

Cada acta guarda sus propios goles, MVP y jugadores. Al editarla:

1. Se calculan las estadísticas “antiguas” y las “nuevas” del acta.
2. Solo se envían a SheetDB las **diferencias** de cada jugador.
3. Si falla la conexión con algún jugador, el acta queda marcada con un aviso y un botón **Reintentar**; no se pierde nada.

Eliminar un acta también resta sus goles, MVPs y partidos. Si un jugador se borra de la plantilla, sus actas se conservan y dejan de afectar a los totales.

## Consejos

- El historial local vive en `localStorage`. Si limpias los datos del navegador, descarga antes una **copia de seguridad** desde ⚙ Ajustes.
- Con el plan gratuito de SheetDB, guardar un acta implica una petición por jugador. La app usa caché para no gastar lecturas en cada visita.
- Los cambios de nombre de un jugador se propagan también a las actas guardadas.
- En el editor de acta puedes **añadir o quitar jugadores** de un partido pasado; los partidos jugados se ajustan solos.
