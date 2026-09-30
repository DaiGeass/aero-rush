import type { GameMode } from './settings';

export interface ScoreEntry {
  name: string;
  score: number;
  dist: number;
  date: number;
  /** modo de juego; ausente en récords antiguos = supervivencia */
  mode?: GameMode;
}

const KEY = 'aero-rush-scores-v1';
const MAX = 8;

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as ScoreEntry[];
    return Array.isArray(arr) ? arr.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Inserts score; returns [newList, rankIndex or -1] */
export function addScore(entry: ScoreEntry): [ScoreEntry[], number] {
  const list = loadScores();
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const trimmed = list.slice(0, MAX);
  const idx = trimmed.indexOf(entry);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
  return [trimmed, idx];
}

export function bestScore(): number {
  const l = loadScores();
  return l.length ? l[0].score : 0;
}

/** Mejor puntuación del modo indicado (los récords antiguos cuentan como supervivencia). */
export function bestScoreFor(mode: GameMode): number {
  const l = loadScores().filter((s) => (s.mode ?? 'survival') === mode);
  return l.length ? l[0].score : 0;
}

export function loadName(): string {
  try {
    return localStorage.getItem('aero-name') || 'Piloto';
  } catch {
    return 'Piloto';
  }
}
export function saveName(n: string) {
  try {
    localStorage.setItem('aero-name', n);
  } catch {
    /* ignore */
  }
}
