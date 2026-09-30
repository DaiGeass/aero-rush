# 🫧 Aero Rush

Carreras 3D en estilo **Frutiger Aero**: cristal, burbujas, océano infinito y un ciclo completo de **día → atardecer → noche → amanecer**.

Hecho con **React + TypeScript + Three.js + Vite** y empaquetado para escritorio con **Tauri 2**.

[![Pages](https://github.com/DaiGeass/aero-rush/actions/workflows/deploy.yml/badge.svg)](https://daigeass.github.io/aero-rush/)
[![Instaladores](https://github.com/DaiGeass/aero-rush/actions/workflows/installers.yml/badge.svg)](https://github.com/DaiGeass/aero-rush/actions/workflows/installers.yml)
[![Licencia](https://img.shields.io/badge/licencia-MIT-blue.svg)](./LICENSE)

> por **Daigeass** & **GLP** · Licencia [MIT](./LICENSE)

## 📲 Jugar

| | |
| --- | --- |
| 🌐 Web / PWA | **<https://daigeass.github.io/aero-rush/>** (instalable y jugable sin conexión) |
| 🖥️ Escritorio | [Releases](https://github.com/DaiGeass/aero-rush/releases) → `.exe`, `.msi`, `.deb` o `.AppImage` |

## ✨ Características

- **8 coches** con geometría propia y estadísticas distintas (giro, punta, turbo, imán) y **11 colores**.
- **3 modos de juego**
  - ♾️ **Supervivencia** — aguanta sin fin con 3 vidas.
  - ⏱️ **Contrarreloj** — 90 s; las burbujas suman tiempo y los golpes lo restan.
  - 🎯 **Cuota** — alcanza la puntuación objetivo antes de quedarte sin vidas.
- **3 dificultades** (Suave / Normal / Intenso) que ajustan velocidad, tráfico, tiempo y objetivo.
- Trazado curvo con fuerza centrífuga, cámara que se inclina, rasantes y cámara con sacudida.
- Ciclo día/noche con faros, pilotos, luna, estrellas y atenuación de materiales por keyframes.
- **Ajustes**: volumen, sensibilidad e inversión de giro, calidad gráfica y reducir movimiento.
- **Calidad automática**: ajusta la resolución según los FPS reales del equipo.
- **PWA**: instalable y jugable **offline** (manifest + service worker).
- **Escritorio** con Tauri: instaladores nativos, arranque nativo y sin Chromium incrustado.

## 🎮 Controles

| Acción | Teclado | Táctil |
| --- | --- | --- |
| Girar | `←` `→` o `A` `D` | toca izquierda / derecha |
| Turbo | `Espacio` / `↑` / `W` | botón TURBO o deslizar ↑ |
| Pausa | `Esc` / `P` | ❚❚ |

## 🛠️ Desarrollo web

```bash
npm install
npm run dev        # servidor de desarrollo
npm run typecheck  # comprobación de tipos
npm run build      # genera dist/ (index.html autocontenido)
npm run preview    # sirve la build
```

## 🖥️ Desarrollo de escritorio

Requiere [Rust](https://www.rust-lang.org/tools/install) y las dependencias del sistema:

```bash
# Debian / Ubuntu
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

```bash
npm install
npm run desktop:dev     # ventana de escritorio con recarga en caliente
npm run desktop:build   # instaladores en src-tauri/target/release/bundle/
```

Los objetivos se toman de `src-tauri/tauri.windows.conf.json` (`.exe` + `.msi`) y
`src-tauri/tauri.linux.conf.json` (`.deb` + `.AppImage`). Para forzar otros:

```bash
npm run desktop:build -- --bundles deb
```

Notas: el `.AppImage` necesita `libfuse2` (`sudo apt install libfuse2`); el `.deb` está pensado
para Debian 12+ / Ubuntu 24.04+; y los instaladores de Windows **no van firmados**, así que
SmartScreen avisará la primera vez.

## 🚀 Publicación automática

| Workflow | Qué hace |
| --- | --- |
| [`deploy.yml`](./.github/workflows/deploy.yml) | Compila y publica la **web** en GitHub Pages en cada push a `main`. |
| [`installers.yml`](./.github/workflows/installers.yml) | Compila los **cuatro instaladores** en paralelo (Windows en `windows-latest`, Linux en `ubuntu-latest`) y los deja como artefactos. Al hacer tag, además se adjuntan a un **release**. |

```bash
git tag v1.0.0 && git push origin v1.0.0   # publica una release con los 4 instaladores
```

## 📁 Estructura

```
src/
  App.tsx            interfaz y flujo de pantallas
  game/
    Engine.ts        motor 3D, física, tráfico y modos
    environment.ts   keyframes de día/noche
    cars.ts          8 modelos + paleta + garaje
    settings.ts      modos, dificultad, calidad y ajustes
    audio.ts         efectos y música procedural
    scores.ts        récords (por modo)
  ui/                Garaje, tabla de récords, ajustes, selector de modo
src-tauri/
  src/main.rs        proceso nativo (ventana Tauri)
  tauri.conf.json    configuración de la app y del empaquetado
  tauri.*.conf.json  objetivos por plataforma (Windows / Linux)
  capabilities/      permisos mínimos de Tauri
  icons/             iconos de la app (.png + .ico)
public/              manifest, service worker, iconos, favicon
```
