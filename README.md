# 🫧 Aero Rush

Carreras 3D en estilo **Frutiger Aero**: cristal, burbujas, océano infinito y un ciclo completo de **día → atardecer → noche → amanecer**.

Hecho con **React + TypeScript + Three.js + Vite**, todo en un único `index.html` al compilar.

> por **Daigeass** & **GLP** · Licencia [MIT](./LICENSE)

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
- **PWA**: instalable y jugable **offline** (manifest + service worker).

## 🎮 Controles

| Acción | Teclado | Táctil |
| --- | --- | --- |
| Girar | `←` `→` o `A` `D` | toca izquierda / derecha |
| Turbo | `Espacio` / `↑` / `W` | botón TURBO o deslizar ↑ |
| Pausa | `Esc` / `P` | ❚❚ |

## 🛠️ Desarrollo

```bash
npm install
npm run dev        # servidor de desarrollo
npm run typecheck  # comprobación de tipos
npm run build      # genera dist/ (index.html autocontenido)
npm run preview    # sirve la build
```

## 🚀 Publicación

El workflow [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) compila y publica en **GitHub Pages** en cada push a `main`. En el repositorio, activa `Settings → Pages → Build and deployment → Source: GitHub Actions`.

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
public/              manifest, service worker, iconos, favicon
```
