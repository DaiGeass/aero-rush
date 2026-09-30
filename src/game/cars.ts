/**
 * Catálogo unificado de coches y colores.
 *
 * Fusión de las dos versiones del juego: los 4 modelos de la build "Aero GT"
 * (Aero GT, Pod Burbuja, Hoja Racer, Escarabajo Aqua) y los 4 de la build
 * "Aero/Bala/Titán/Hover", más un modelo nuevo para cerrar la parrilla de 8.
 *
 * `stats` es multiplicativo y es lo que lee la física del motor:
 *   steer  → velocidad lateral máxima (giro)
 *   top    → velocidad punta
 *   boost  → duración del turbo (mayor = aguanta más)
 *   magnet → radio de atracción de burbujas
 *   hover  → altura de flotación (0 = ruedas en el suelo)
 */

export interface CarStats {
  steer: number;
  top: number;
  boost: number;
  magnet: number;
}

export interface CarModel {
  id: number;
  name: string;
  /** descripción corta que se ve bajo el nombre en el garaje */
  tag: string;
  icon: string;
  /** altura de flotación en unidades de mundo */
  hover: number;
  stats: CarStats;
  /** barras 0..1 para la interfaz */
  bars: { manejo: number; velocidad: number; turbo: number; iman: number };
}

export const CAR_MODELS: CarModel[] = [
  {
    id: 0,
    name: 'Aero GT',
    tag: 'El clásico equilibrado de cristal y cromo.',
    icon: '🏎️',
    hover: 0,
    stats: { steer: 1.0, top: 1.0, boost: 1.0, magnet: 1.0 },
    bars: { manejo: 0.62, velocidad: 0.62, turbo: 0.5, iman: 0.55 },
  },
  {
    id: 1,
    name: 'Pod Burbuja',
    tag: 'Una pompa que gira sobre su propio anillo.',
    icon: '🫧',
    hover: 0,
    stats: { steer: 1.16, top: 0.94, boost: 1.0, magnet: 1.08 },
    bars: { manejo: 0.95, velocidad: 0.44, turbo: 0.5, iman: 0.7 },
  },
  {
    id: 2,
    name: 'Hoja Racer',
    tag: 'Velocidad pura. Frenar no está en el manual.',
    icon: '🍃',
    hover: 0,
    stats: { steer: 0.86, top: 1.12, boost: 0.94, magnet: 1.0 },
    bars: { manejo: 0.3, velocidad: 0.97, turbo: 0.38, iman: 0.52 },
  },
  {
    id: 3,
    name: 'Escarabajo Aqua',
    tag: 'Tanque redondo con imán de burbujas.',
    icon: '🪲',
    hover: 0,
    stats: { steer: 0.96, top: 0.96, boost: 1.38, magnet: 1.2 },
    bars: { manejo: 0.5, velocidad: 0.5, turbo: 0.97, iman: 0.92 },
  },
  {
    id: 4,
    name: 'Bala',
    tag: 'Cuchilla con turbo instantáneo y corto.',
    icon: '⚡',
    hover: 0,
    stats: { steer: 1.12, top: 1.09, boost: 0.8, magnet: 1.0 },
    bars: { manejo: 0.8, velocidad: 0.85, turbo: 0.24, iman: 0.55 },
  },
  {
    id: 5,
    name: 'Titán',
    tag: 'Tanque de acero: gira tarde, pero el turbo no se acaba.',
    icon: '🛡️',
    hover: 0,
    stats: { steer: 0.84, top: 0.95, boost: 1.42, magnet: 1.05 },
    bars: { manejo: 0.18, velocidad: 0.45, turbo: 1.0, iman: 0.62 },
  },
  {
    id: 6,
    name: 'Hover',
    tag: 'Flota sobre la pista y atrae burbujas desde lejos.',
    icon: '🛸',
    hover: 0.35,
    stats: { steer: 1.04, top: 1.03, boost: 1.0, magnet: 1.55 },
    bars: { manejo: 0.68, velocidad: 0.68, turbo: 0.5, iman: 1.0 },
  },
  {
    id: 7,
    name: 'Aurora',
    tag: 'Alas de cristal: punta brutal y turbo de relámpago.',
    icon: '🌅',
    hover: 0.12,
    stats: { steer: 0.95, top: 1.18, boost: 0.88, magnet: 1.25 },
    bars: { manejo: 0.56, velocidad: 1.0, turbo: 0.32, iman: 0.86 },
  },
];

export const DEFAULT_MODEL = CAR_MODELS[0].id;
export const MAX_MODEL_ID = CAR_MODELS[CAR_MODELS.length - 1].id;

export interface CarColor {
  hex: string;
  name: string;
}

/** Unión de las dos paletas originales, sin repetir tonos. */
export const CAR_COLORS: CarColor[] = [
  { hex: '#1f9bff', name: 'Azul Aero' },
  { hex: '#3fe0d0', name: 'Turquesa' },
  { hex: '#7ed957', name: 'Verde Lima' },
  { hex: '#ffe14d', name: 'Amarillo Sol' },
  { hex: '#ffa630', name: 'Naranja' },
  { hex: '#ff5fa2', name: 'Rosa Chicle' },
  { hex: '#ff5f7a', name: 'Coral' },
  { hex: '#ff6fd8', name: 'Rosa Neón' },
  { hex: '#a77bff', name: 'Lila' },
  { hex: '#f6fbff', name: 'Blanco Perla' },
  { hex: '#30415e', name: 'Azul Noche' },
];

export const DEFAULT_COLOR = CAR_COLORS[0].hex;

/** Devuelve el color de la carrocería oscurecido, para degradados de la UI. */
export function darker(hex: string, k = 0.55): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

export interface Garage {
  model: number;
  color: string;
}

/** Claves antiguas: se leen para no perder la elección de quien ya jugó. */
const KEYS = ['aero-garage-v2', 'aero-garage-v1', 'aero-car'];
const KEY = KEYS[0];

export function normalizeGarage(g: Partial<Garage> | null | undefined): Garage {
  const model = Number(g?.model);
  return {
    model: Number.isFinite(model) && CAR_MODELS.some((m) => m.id === model) ? model : DEFAULT_MODEL,
    color: CAR_COLORS.some((c) => c.hex === g?.color) ? (g!.color as string) : DEFAULT_COLOR,
  };
}

export function loadGarage(): Garage {
  for (const key of KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return normalizeGarage(JSON.parse(raw) as Garage);
    } catch {
      /* siguiente clave */
    }
  }
  return { model: DEFAULT_MODEL, color: DEFAULT_COLOR };
}

export function saveGarage(g: Garage) {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* ignore */
  }
}

/** Coche por id, con fallback al primero. */
export function getModel(id: number): CarModel {
  return CAR_MODELS.find((m) => m.id === id) ?? CAR_MODELS[0];
}

export function getColorName(hex: string): string {
  return CAR_COLORS.find((c) => c.hex === hex)?.name ?? '';
}
