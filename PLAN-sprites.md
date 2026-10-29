# Plan — arte de la gata real (16 sprites de referencia)

**Fecha:** 28 de octubre de 2026
**Objetivo:** sustituir el arte procedural por la hoja de referencia de la gata del usuario
(16 poses), generar las poses que faltan a partir de ese arte y dejar la extensión construida,
probada y verificada en el harness.

---

## 1. Punto de partida (verificado)

| Hecho | Dato |
|---|---|
| Referencia | `1402×1122`, **RGB sin alfa**; el damero está pintado en los píxeles |
| Recorte | relleno por inundación desde los bordes sobre píxeles neutros claros; el contorno oscuro cierra a cada gato |
| Ruido | motas aisladas fuera de los gatos → se descartan por tamaño de componente |
| Rejilla nativa | ~4,45 px de origen por píxel de arte (autocorrelación en las 4 filas) |
| Tamaño nativo | gato más ancho ≈ 71 px de arte, más alto ≈ 68 px |
| Poses | fila 1 echada (ojos abiertos, cerrados, abiertos, entornados) · fila 2 caminata hacia la izquierda (4) · fila 3 sentada (frente, ojos cerrados, mira a la derecha, cola en movimiento) · fila 4 dormida enroscada (4) |

## 2. Decisiones

| Decisión | Motivo |
|---|---|
| Celda **80×80** | Cabe el gato a resolución nativa sin reescalar hacia arriba ni perder detalle |
| Reducción por área + alfa binario | El arte no está en una rejilla exacta; el alfa binario mantiene bordes nítidos |
| Alineación por fila, apoyada en el suelo | Cada fila conserva la colocación horizontal del artista; todas las poses pisan la misma línea base, así no saltan al cambiar de animación |
| Caminata a la derecha = espejo horneado en la hoja | El runtime sigue eligiendo frames por `background-position`; sin `scaleX(-1)` |
| N/S conservan la última orientación | Solo hay vista lateral: subir o bajar no debe girar al gato de golpe |
| Se mantienen los 25 nombres de animación | No rompe API, persistencia, harness ni menús |
| Frames compartidos entre animaciones | Con 16 poses reales ya no hay un frame único por animación; la prueba pasa a exigir rango y cobertura |
| Poses que faltan = derivadas del arte real | Espejos, desplazamientos, rotaciones leves y adornos (corazones, notas, `z`) reutilizando `heart`, `note`, `z` y `spark` de `generate_sprites.py` |
| Fuente versionada en `assets/source/reference.png` | El build de arte es reproducible sin depender de `%TEMP%` |

## 3. Mapa de animaciones

| Animación | Frames | Origen |
|---|---|---|
| `idle` | sentada frente ×5 + parpadeo | real |
| `blink` | sentada frente → ojos cerrados | real |
| `alert` | mira a la derecha ↔ cola en movimiento | real |
| `sit` (echarse) | echada: abiertos, entornados, cerrados, abiertos | real |
| `walkW/NW/SW` | caminata ×4 | real |
| `walkE/NE/SE` | caminata espejada ×4 | derivada (espejo) |
| `walkN/S` | caminata ×4 (el runtime usa la orientación previa) | real |
| `sleep` | dormida enroscada con `z` que suben | real + adorno |
| `tired` | echada entornada ↔ ojos cerrados | real |
| `yawn` | sentada ojos cerrados + boca abierta (pequeña → grande) | derivada |
| `happy` | sentada ojos cerrados + corazones que suben | derivada |
| `dance` | sentada con rebote y espejo alterno + notas | derivada |
| `drag` | sentada asustada con balanceo (rotación ±) | derivada |
| `stretch` | caminata inclinada hacia delante (patas delanteras abajo) | derivada |
| `groom` | sentada ojos cerrados con inclinación de cabeza + brillo | derivada |
| `scratchSelf` | cola en movimiento con sacudida | derivada |
| `scratchWallN/E/S/W` | no los usa el runtime; reutilizan poses existentes | relleno |

## 4. Pasos

1. **Fuente:** copiar la referencia a `assets/source/reference.png`.
2. **`tools/import_sprites.py`:** recorte, limpieza de motas, reducción nativa, alineación,
   espejos, poses derivadas, `spritesheet.png`, `animations.json`, lámina de revisión, preview PNG y GIF.
   `npm run sprites` pasa a apuntar aquí; `numpy` entra en `tools/requirements.txt`.
3. **Runtime (`src/vfdPet.js`)**, solo lo imprescindible:
   - función pura `walkAnimation(direction, facing)` y estado `facing`;
   - `background-size` de las muestras de variante calculado desde el meta (hoy es `1000% 900%` fijo);
   - texto de “Tamaño” calculado desde `frameWidth` (hoy dice “64 px”).
4. **Pruebas:** `assets.test.js` pasa de “90 frames únicos en 10×9” a “rango, cobertura y celda 80×80”;
   nueva prueba de `walkAnimation` en `logic.test.js`.
5. **Smoke:** `scripts/smoke-expr.js` deja de exigir 64×64 y 90 frames; compara con el meta.
6. **Verificación:** `npm.cmd test`, build y presupuesto; harness en Chrome con caminata a ambos lados,
   sueño en la barra, menú y variantes.
7. **Documentación:** actualizar `ESTADO.md` y `README.md` (métricas y origen del arte).

## 5. Fuera de alcance (se reporta, no se toca)

- Variantes de color: “Miel” describía al gato naranja procedural; con tu gata quizá quieras otro nombre.
- `tools/generate_sprites.py` queda como biblioteca de adornos y como generador antiguo.
- Instalar en Spotify real (sigue pendiente del plan anterior).

## 6. Arte que conviene pedir después

Las poses derivadas son aproximaciones. Para acicalarse, estirarse y rascarse de verdad hace falta
una segunda hoja con el mismo formato (4×4, mismo estilo, mismo damero o fondo transparente):

1. sentada lamiéndose la pata delantera (2 frames);
2. estiramiento con las patas delanteras extendidas y la grupa alta (2 frames);
3. sentada rascándose la oreja con la pata trasera (2 frames);
4. bostezo de frente con boca abierta (2 frames);
5. arañando una superficie vertical (2 frames);
6. colgando al ser levantada (2 frames).

Cuando exista esa hoja: guardarla en `assets/source/`, recortarla con las mismas funciones
(`cut_reference` + `place_row`) y sustituir las poses derivadas en `build_frames()`. Hoy
`import_sprites.py` solo lee `reference.png`.

## 7. Resultado (28-oct-2026)

Ejecutado completo. `npm.cmd test` → 31/31; hoja 640×480 (47.050 B), 42 frames, 25 animaciones;
extensión 118.490 B (38,6 % de 300 KiB). Verificado en el harness (Chrome): caminata este/oeste,
subir tras ir al este usa `walkNE`, sueño sobre la barra con `z`, muestras de variante, todas las
acciones sin errores de consola. **No instalado en Spotify.**

## 8. Vistas nuevas con PixelLab (29-oct-2026)

Generadas con el MCP de PixelLab (plan de prueba, **$0 de crédito**: no hay cargos posibles).
Gasto: 15 de 40 generaciones. Frames guardados en `assets/source/pixellab/`.

| Resultado | Origen | Uso |
|---|---|---|
| Gata sentada en 8 direcciones | `create_character` v3 con la pose sentada de frente | base para acicalarse |
| Se levanta y camina (sur) | animación libre v3 | frames 0–4 → `getUp` / `sitDown`; frame 7 → referencia de pie |
| Gata de pie en 8 direcciones | `create_character` v3 con el frame 7 | base para caminar |
| Caminata sur (8 frames) | plantilla `walk-8-frames` | `walkS` |
| Caminata norte (8 frames) | `skeleton-v3` (la plantilla deformaba la cabeza) | `walkN` |
| Acicalarse (12 frames) | plantilla `licking` | `groom` (sin 8, 10, 11: lengua magenta) |
| Saltar (8 frames) | plantilla `jump` | `danceJump` (frames 1, 2, 4, 5, 6) |
| Bostezo | plantilla `yawning` | **descartado**: cabeza deformada |

Lecciones: la referencia debe estar de pie para caminar (las plantillas no cambian la postura);
`skeleton-v3` conserva mejor la identidad; el plan de prueba solo admite 1 dirección por llamada.
Pendiente: caminatas diagonales y laterales de PixelLab si se quiere unificar el estilo.
