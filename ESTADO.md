# VFD Pet — estado del proyecto

**Fecha:** 28 de octubre de 2026
**Versión:** 0.1.0
**Ubicación:** `C:\Users\Mario\Downloads\VFD\pet`
**Estado:** funcional y verificado en harness local; **aún no instalado en Spotify**.

---

## Resumen

VFD Pet es una extensión de Spicetify que añade un michi de 64×64 px sobre la interfaz de
Spotify. Sigue al cursor, camina en ocho direcciones, duerme sobre la barra de progreso,
reacciona a la reproducción y tiene menú contextual y ajustes propios.

Es una implementación independiente inspirada en **oneko.js** y **spicetify-oneko**, sin código
ni arte copiados. **Desde el 28-oct-2026 el arte sale de 16 poses de referencia de la gata del
usuario** (`assets/source/reference.png`) mediante `tools/import_sprites.py`; ver
`PLAN-sprites.md`. El runtime es un único archivo JavaScript sin dependencias.

| Métrica | Valor |
|---|---|
| Extensión construida | `Extensions/vfdPet.js` — **184.103 B** |
| Presupuesto | 307.200 B (300 KiB) — usa **59,9 %** |
| Frames | **82** distintos: las 16 poses reales y derivadas + vistas generadas con PixelLab; cuadrícula 8×11, celdas de 80×80 |
| Animaciones | **30** (25 de siempre + `danceJump` + transiciones `lieDown` / `wakeUp` / `getUp` / `sitDown`; comparten frames) |
| Hoja de sprites | 640×880, PNG indexado con transparencia — 91.037 B |
| Variantes | 4 (Miel, Noche, Menta, Fresa) por filtro CSS |
| Pruebas | **37/37** (`npm.cmd test`) |

> Las secciones 3–8 siguientes describen el arte procedural anterior (64×64, 90 frames) salvo
> donde se indica. Lo vigente del arte está en `PLAN-sprites.md` y `README.md`.
| Dependencias en runtime | ninguna |
| Assets remotos | ninguno; el PNG va incrustado en base64 |

---

## 1. Qué hace

- **Seguir al cursor** con animación de caminata según la dirección (8 octantes).
- **Dormir en la barra de progreso**: camina hasta ella, se tumba y muestra `z`. Si no hay barra,
  usa la esquina inferior derecha como respaldo.
- **Reaccionar a Spotify**: se alerta al cambiar de pista; si pausas 20 s, bosteza.
- **Acciones**: acariciar (clic), dormir/despertar (doble clic), arrastrar, menú contextual,
  acicalarse, bailar, estirarse y centrar.
- **Ajustes**: tamaño 1×–3×, velocidad, seguir cursor, dormir en la barra, acciones automáticas,
  reacción al reproductor y reducir movimiento.
- **Persistencia** de posición, variante, escala, preferencias, mimos y sueño.
- **Accesibilidad**: foco visible, teclado, `aria-label`, `prefers-reduced-motion`.

---

## 2. Estado actual

### 2.1 Verificado en navegador (harness + CDP)

| Área | Resultado |
|---|---|
| Montaje | `dataset.vfdPet = "mounted"`, `#vfd-pet` presente, sin errores de consola |
| Sprite | PNG inline como `data:image/png;base64`, 90 frames / 25 animaciones, 64×64 |
| Animaciones | idle, blink, alert, dance, drag y caminatas reproducen y cambian de frame |
| Sueño | camina a la barra, se centra en ella y queda en modo `sleep` |
| Clic vs arrastre | clic suma mimos y dispara `happy`; arrastre mueve sin contar como clic |
| Menú | 6 acciones y se cierra al elegir |
| Ajustes | abre/cierra, cambia variante y escala, persiste en `localStorage` |
| Visibilidad | se oculta con modales y reaparece al cerrarlos (incluido el modal propio) |
| Atajos | `michi` y `vfdpet` abren ajustes |
| Reproductor | pausa, reanudación y cambio de pista actualizan el estado sin errores; la alerta por pista nueva se ve al reanudar |
| Escala | 3× deja al gato dentro del viewport; el sueño se recalcula |
| Limpieza | `destroy()` elimina elemento, estilos, dataset y API global |

### 2.2 Implementado, pendiente de ver en Spotify real

- Instalación con `spicetify apply` y ciclo completo dentro del cliente.
- Acciones automáticas cada 10–26 s (no se esperó el intervalo en QA).
- Bostezo tras 20 s en pausa (el temporizador no se esperó en QA).
- `S` para dormir y `Esc` para cerrar: el mock de Mousetrap del harness solo emite letras, así que
  no se pudieron pulsar allí.
- Modo “reducir movimiento” (código y preferencia del sistema, sin captura visual).
- Aspecto en temas claros y oscuros.
- Consumo de CPU con la ventana visible.

### 2.3 No probado

- macOS y Linux.
- Pantallas táctiles (doble toque).
- Versiones de Spotify distintas de la 1.2.89.539.

> No se instaló en Spotify para no reiniciar el cliente del usuario. Todo lo anterior se validó
> con el simulador `dev/harness.html` y un Chrome headless vía CDP.

---

## 3. Arquitectura

```text
tools/generate_sprites.py
        │
        ├── assets/pet/spritesheet.png      (640×576, 90 celdas de 64×64)
        ├── assets/pet/animations.json      (nombre → frames [col,row], fps, loop)
        ├── assets/pet/contact-sheet.png    (revisión visual, 20 animaciones)
        └── assets/preview/preview.png/.gif (Marketplace y README)

assets/pet/*
        │
        ▼
tools/build.js  ── valida rejilla, frames y presupuesto
        │            sustituye __SPRITE_META__ y __SPRITE_URI__
        ▼
Extensions/vfdPet.js  ── único archivo que se instala
        │
        ├── Spicetify (Spotify de escritorio)
        └── dev/harness.html (simulador local)
```

**Runtime (28-oct-2026):** `requestAnimationFrame` en cada fotograma (antes 20 Hz con `TICK_MS`), aceleración
y frenada (`nextSpeed`), caminata que avanza por distancia (`stride`), duración por frame
(`durations`) y posición ajustada a píxeles del dispositivo. El gato se mueve con
`transform: translate3d` y el frame se elige con `background-position` sobre la hoja. No hay
`setInterval` ni Canvas.

**Separación:** las funciones puras (`clamp`, `direction8`, `stepToward`, `pickSleepSpot`,
`advanceFrame`, `sanitizeSettings`, `framePosition`…) se exportan con `module.exports` y se prueban
en Node sin DOM. El resto es runtime de Spicetify.

**Marcadores:** `src/vfdPet.js` conserva `/*__SPRITE_META__*/ null` y `/*__SPRITE_URI__*/ ""`;
`build.js` los reemplaza y falla si quedan sin sustituir.

---

## 4. Contenido funcional

### 4.1 Animaciones (90 frames)

| Grupo | Animaciones | Frames | fps | Loop |
|---|---|---|---|---|
| Reposo | `idle` (4), `blink` (2), `alert` (2), `sit` (2) | 10 | 4–8 | mixto |
| Caminata | `walkN`, `walkNE`, `walkE`, `walkSE`, `walkS`, `walkSW`, `walkW`, `walkNW` | 8 × 4 = 32 | 12 | sí |
| Sueño | `sleep` (6), `tired` (2) | 8 | 3 | sí |
| Rascado | `scratchSelf` (4), `scratchWallN/E/S/W` (3 c/u) | 16 | 8–10 | no |
| Interacción | `drag` (2), `happy` (4) | 6 | 8–10 | mixto |
| Aseo | `groom` (4), `yawn` (4), `stretch` (4) | 12 | 6–8 | no |
| Baile | `dance` (6) | 6 | 10 | sí |
| **Total** | **25 animaciones** | **90** | | |

El detalle exacto de cada frame está en `assets/pet/animations.json`; la lámina de revisión está en
`assets/pet/contact-sheet.png`.

### 4.2 Variantes

| Variante | Filtro CSS | Uso |
|---|---|---|
| Miel | `none` (arte original) | por defecto |
| Noche | `grayscale + brightness + contrast` | gato oscuro |
| Menta | `hue-rotate(120deg)` | verde menta |
| Fresa | `hue-rotate(-38deg)` | rosado |

No duplican la hoja: se aplican sobre el mismo PNG.

### 4.3 Controles

| Acción | Gesto |
|---|---|
| Acariciar | clic |
| Dormir / despertar | doble clic o `S` con foco |
| Arrastrar | pointer down + move |
| Menú | clic derecho |
| Ajustes | menú → Ajustes…, `michi` o `vfdpet` |
| Cerrar menú/ajustes | `Esc` o clic fuera |
| Acariciar con teclado | `Enter` / `Espacio` |

### 4.4 Ajustes y persistencia

Valores por defecto: `variant=miel`, `scale=1.5`, `speed=130`, `follow=true`, `sleepOnBar=true`,
`autoActions=true`, `reactToPlayer=true`, `reducedMotion=false`.

- `vfdpet:settings:v1` — preferencias.
- `vfdpet:state:v1` — `x`, `y`, `affection`, `sleeping`.
- `reducedMotion` baja las animaciones a 4 fps, reduce la velocidad al 70 % y desactiva las
  acciones automáticas. También se activa si el sistema pide `prefers-reduced-motion: reduce` y no
  hay ajustes guardados.

### 4.5 API de inspección

```js
window.__vfdPet.getState()   // estado completo
window.__vfdPet.meta         // frameWidth, columns, rows, animations
window.__vfdPet.actions      // pet, toggleSleep, startSleep, wake, runAction,
                             // openSettings, centerPet, resetPet, destroy
```

Marcadores en `<html>`: `data-vfd-pet="loaded" | "mounted" | "error"`.

---

## 5. Archivos

| Archivo | Bytes | Papel |
|---|---:|---|
| `Extensions/vfdPet.js` | 100.717 | Artefacto instalable; PNG y mapa incrustados |
| `src/vfdPet.js` | 52.994 | Fuente única con lógica pura + runtime |
| `assets/pet/spritesheet.png` | 34.508 | Hoja 640×576, 90 frames |
| `assets/pet/animations.json` | 6.930 | Mapa de animaciones |
| `assets/pet/contact-sheet.png` | 23.176 | Revisión visual de 20 animaciones |
| `assets/preview/preview.png` | 20.034 | Preview estática |
| `assets/preview/preview.gif` | 276.673 | Demo animada (no la carga la extensión) |
| `tools/generate_sprites.py` | 33.038 | Generador procedural del arte |
| `tools/build.js` | 4.354 | Valida y construye la extensión |
| `tests/logic.test.js` | 8.007 | 18 pruebas de lógica pura |
| `tests/assets.test.js` | 4.850 | 9 pruebas de assets, manifest y licencias |
| `dev/harness.html` | 22.029 | Simulador de Spicetify + escenarios QA |
| `scripts/install.ps1` | 2.478 | Instala y activa; `-DebugPort` opcional |
| `scripts/uninstall.ps1` | 1.868 | Retira y restaura flags |
| `scripts/dev.ps1` | 1.004 | Build + copia sin aplicar |
| `scripts/measure.ps1` | 867 | Tamaños y presupuesto |
| `scripts/smoke.ps1` + `smoke-expr.js` | 3.813 | Salud de la extensión vía CDP |
| `scripts/cdp.js` | 5.158 | Cliente CDP mínimo |
| `manifest.json`, `package.json` | 1.160 | Metadatos de Marketplace y scripts npm |
| `README.md`, `LICENSE`, `LICENSE-NOTICE.md` | 12.264 | Documentación y licencias |

---

## 6. Comandos

```powershell
cd C:\Users\Mario\Downloads\VFD\pet

# Arte (requiere Pillow)
python -m pip install -r tools\requirements.txt
python tools\generate_sprites.py

# Build y pruebas
node tools\build.js
npm.cmd test

# Medición
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\measure.ps1

# Desarrollo: build + copia, sin reiniciar Spotify
.\scripts\dev.ps1

# Instalación / desinstalación
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1

# Smoke con CDP (requiere instalar con -DebugPort)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -DebugPort
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke.ps1
```

Notas del entorno:

- PowerShell bloquea `npm.ps1` y los `.ps1`; por eso se usa `npm.cmd` y `-ExecutionPolicy Bypass`.
- Node **v24.15.0**. `node --test tests` falla en esta versión, así que `package.json` lista los dos
  archivos explícitamente.
- `smoke.ps1` espera exactamente una pestaña de Spotify; `CDP_PORT` permite otro puerto.

---

## 7. Verificación de hoy

```text
npm.cmd test
ℹ tests 27
ℹ pass 27
ℹ fail 0

build
sheet: 640x576 (34508 B)
frames: 90 in 25 animations
extension: Extensions\vfdPet.js (100717 B, budget 307200 B)

measure
extension uses 32.8% of the 300 KiB budget
```

También se validó:

- `node --check Extensions/vfdPet.js`.
- Sintaxis de los cinco `.ps1` y de `scripts/cdp.js` / `smoke-expr.js`.
- Smoke CDP: `ok: yes`, `marker: mounted`, 90 frames / 25 animaciones, PNG inline, tamaño 96×96
  con escala 1,5.
- Revisión visual en Chrome real y capturas headless con `?qa=1`.

---

## 8. Decisiones de diseño

| Decisión | Motivo |
|---|---|
| Implementación propia, no fork | Control del arte y del runtime; solo se toman ideas |
| 64×64 por frame | El doble de resolución que oneko, sin disparar el peso |
| Sprite sheet + JSON | Un solo PNG, animación por `background-position`, fácil de validar |
| JavaScript puro + DOM/CSS | No hace falta Angular, Canvas ni Phaser para un overlay |
| PNG en base64 dentro del JS | Spicetify copia un solo archivo; no hay `fetch` ni rutas que se rompan |
| Arte procedural con Pillow | 90 frames coherentes, editable y sin riesgo de licencias |
| 4 variantes por filtro CSS | Más personalidad sin duplicar la hoja |
| `requestAnimationFrame` en cada fotograma | Movimiento suave sin `setInterval`; se pausa con `document.hidden`. A 20 Hz se veían saltos de ~6,5 px |
| Selectores defensivos + fallback | La barra de progreso cambia entre versiones de Spotify |
| UI y docs en español | Preferencia del proyecto |

Descartado por ahora: PNG por fotograma (90 archivos), capas separadas (más complejidad en runtime),
Angular (peso innecesario) y Phaser (no es un juego).

---

## 9. Limitaciones conocidas

- Los selectores de la barra de progreso pueden cambiar entre versiones; el respaldo es la esquina.
- Las variantes son filtros: no cambian el dibujo, solo el color.
- La cuadrícula es fija de 90 celdas; añadir animaciones obliga a ampliarla y actualizar el meta.
- Probado solo en Windows 11; el objetivo es Spotify 1.2.89.539 + Spicetify 2.45.1.
- El doble toque táctil no está garantizado.
- El GIF de preview pesa ~270 KB, pero la extensión no lo carga.
- El proyecto **no es un repositorio git**: no hay historial ni commits; vive en disco.

---

## 10. Próximos pasos

### Prioridad alta

1. Instalar en Spotify y recorrer el ciclo completo: seguir, arrastrar, dormir en la barra, menú,
   ajustes, `michi`, cambio de pista y pausa.
2. Revisar el modal y el menú en un tema claro y en uno oscuro.
3. Medir CPU con la ventana visible (`node scripts/cdp.js perf 20`).

### Prioridad media

4. Verificar en vivo las acciones automáticas (10–26 s) y “reducir movimiento”.
5. Añadir una prueba de humo al harness para el ciclo de ajustes y variantes.
6. Probar en macOS/Linux si se publica en Marketplace.

### Mejoras opcionales

7. Versión 128×128 del arte (cabría en el presupuesto, hay que medirla).
8. Pipeline Aseprite/Pixelorama → `animations.json` para arte dibujado a mano.
9. Más reacciones (corazón al acariciar, siesta tras inactividad prolongada).
10. Publicar: topic `spicetify-extensions`, `Extensions/vfdPet.js` commiteado, manifest revisado.

---

## 11. Publicación

`manifest.json` ya declara `name`, `description`, `preview`, `main`, `readme` y tags
(`pet`, `cat`, `companion`, `pixel-art`, `fun`). Para Marketplace:

1. Subir el proyecto a GitHub con el topic `spicetify-extensions`.
2. Mantener `Extensions/vfdPet.js` en el repo (Marketplace descarga ese archivo, no ejecuta el build).
3. No hace falta GitHub Pages: el arte viaja dentro del JS.

---

## 12. Licencia y atribución

- Código y arte de este proyecto: **MIT**, © 2026 VFD Pet contributors.
- Inspiración: **oneko.js** (adryd, MIT) y **spicetify-oneko** (kyrie25, MIT); concepto original del
  Neko de 1989.
- No se copió código ni arte de esos proyectos; la hoja se genera con `tools/generate_sprites.py`.
- Sin afiliación con Spotify, Spicetify, adryd ni kyrie25.

Ver `LICENSE` y `LICENSE-NOTICE.md`.

---

## 13. Cómo retomar

```powershell
cd C:\Users\Mario\Downloads\VFD\pet
npm.cmd test                    # 27/27 y build actualizado
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\measure.ps1
# abrir dev/harness.html o instalar con .\scripts\install.ps1
```

Si algo falla en Spotify, revisar primero `document.documentElement.dataset.vfdPet`
(`loaded` → `mounted` → `error`) y la consola con `node scripts/cdp.js console 10`.
