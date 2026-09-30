// Ajustes del jugador, modos de juego y presets de calidad.

export type Quality = 'low' | 'medium' | 'high';
export type GameMode = 'survival' | 'time' | 'quota';
export type DifficultyId = 'easy' | 'normal' | 'hard';

export interface Settings {
  /** 0..1 */
  volume: number;
  /** multiplicador de giro 0.6..1.6 */
  steerSensitivity: number;
  invertSteer: boolean;
  quality: Quality;
  /** adapta el pixel ratio a los FPS reales */
  autoQuality: boolean;
  /** menos sacudidas de cámara y animaciones */
  reduceMotion: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.8,
  steerSensitivity: 1,
  invertSteer: false,
  quality: 'high',
  autoQuality: true,
  reduceMotion: false,
};

const KEY = 'aero-settings-v1';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  if (s.quality !== 'low' && s.quality !== 'medium' && s.quality !== 'high') s.quality = DEFAULT_SETTINGS.quality;
  return {
    volume: clamp(Number.isFinite(s.volume) ? s.volume : DEFAULT_SETTINGS.volume, 0, 1),
    steerSensitivity: clamp(Number.isFinite(s.steerSensitivity) ? s.steerSensitivity : 1, 0.6, 1.6),
    invertSteer: !!s.invertSteer,
    quality: s.quality,
    autoQuality: s.autoQuality !== false,
    reduceMotion: !!s.reduceMotion,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return normalizeSettings(raw ? (JSON.parse(raw) as Partial<Settings>) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------ modos de juego
export interface ModeInfo {
  id: GameMode;
  name: string;
  icon: string;
  blurb: string;
  /** etiqueta corta para la tabla */
  tag: string;
}

export const GAME_MODES: ModeInfo[] = [
  { id: 'survival', name: 'Supervivencia', icon: '♾️', tag: 'SURV', blurb: 'Aguanta sin fin con 3 vidas y suma todo lo posible.' },
  { id: 'time', name: 'Contrarreloj', icon: '⏱️', tag: 'TIME', blurb: '90 s en el reloj. Las burbujas suman tiempo y los golpes lo restan.' },
  { id: 'quota', name: 'Cuota', icon: '🎯', tag: 'META', blurb: 'Alcanza la puntuación objetivo antes de quedarte sin vidas.' },
];

export function getMode(id: GameMode): ModeInfo {
  return GAME_MODES.find((m) => m.id === id) ?? GAME_MODES[0];
}

// ------------------------------------------------ dificultad
export interface DifficultyInfo {
  id: DifficultyId;
  name: string;
  icon: string;
  /** multiplicador de velocidad base */
  speed: number;
  /** multiplicador de separación entre patrones (mayor = menos tráfico) */
  gap: number;
  /** segundos iniciales en contrarreloj */
  time: number;
  /** segundos perdidos por choque en contrarreloj */
  timeCost: number;
  /** segundos ganados por burbuja en contrarreloj */
  timeOrb: number;
  /** objetivo de puntos en el modo cuota */
  goal: number;
}

export const DIFFICULTIES: DifficultyInfo[] = [
  { id: 'easy', name: 'Suave', icon: '🫧', speed: 0.9, gap: 1.25, time: 105, timeCost: 2, timeOrb: 0.8, goal: 8000 },
  { id: 'normal', name: 'Normal', icon: '🌊', speed: 1, gap: 1, time: 90, timeCost: 3.5, timeOrb: 0.6, goal: 15000 },
  { id: 'hard', name: 'Intenso', icon: '⚡', speed: 1.12, gap: 0.82, time: 75, timeCost: 5, timeOrb: 0.45, goal: 25000 },
];

export function getDifficulty(id: DifficultyId): DifficultyInfo {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];
}

// ------------------------------------------------ calidad
export interface QualityTier {
  /** tope de pixel ratio */
  cap: number;
  /** multiplicador de partículas */
  fx: number;
}

export function qualityTier(q: Quality): QualityTier {
  if (q === 'low') return { cap: 1, fx: 0.5 };
  if (q === 'medium') return { cap: 1.5, fx: 0.8 };
  return { cap: 2, fx: 1 };
}

export const QUALITY_INFO: { id: Quality; name: string; desc: string }[] = [
  { id: 'low', name: 'Baja', desc: 'Más FPS, menos partículas' },
  { id: 'medium', name: 'Media', desc: 'Equilibrada' },
  { id: 'high', name: 'Alta', desc: 'Nitidez máxima' },
];

// ------------------------------------------------ elección de partida
const MODE_KEY = 'aero-mode-v1';
const DIFF_KEY = 'aero-difficulty-v1';

export function loadMode(): GameMode {
  try {
    const m = localStorage.getItem(MODE_KEY) as GameMode | null;
    return GAME_MODES.some((x) => x.id === m) ? (m as GameMode) : 'survival';
  } catch {
    return 'survival';
  }
}

export function saveMode(m: GameMode) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* ignore */
  }
}

export function loadDifficulty(): DifficultyId {
  try {
    const d = localStorage.getItem(DIFF_KEY) as DifficultyId | null;
    return DIFFICULTIES.some((x) => x.id === d) ? (d as DifficultyId) : 'normal';
  } catch {
    return 'normal';
  }
}

export function saveDifficulty(d: DifficultyId) {
  try {
    localStorage.setItem(DIFF_KEY, d);
  } catch {
    /* ignore */
  }
}
