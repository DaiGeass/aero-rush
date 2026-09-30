import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine, type GameOverInfo, type Hud, type Phase } from './game/Engine';
import { audio } from './game/audio';
import { CAR_COLORS, CAR_MODELS, loadGarage, saveGarage, type Garage } from './game/cars';
import {
  getDifficulty,
  getMode,
  loadDifficulty,
  loadMode,
  loadSettings,
  saveDifficulty,
  saveMode,
  saveSettings,
  type DifficultyId,
  type GameMode,
  type Settings,
} from './game/settings';
import { addScore, bestScoreFor, loadName, loadScores, saveName, type ScoreEntry } from './game/scores';
import { phaseName } from './game/environment';
import GaragePanel from './ui/Garage';
import ModePicker from './ui/ModePicker';
import ScoreTable from './ui/ScoreTable';
import SettingsPanel from './ui/Settings';

const freshHud = (mode: GameMode): Hud => ({
  score: 0,
  speed: 0,
  mult: 1,
  combo: 0,
  comboT: 0,
  boost: 0.35,
  lives: 3,
  distance: 0,
  boosting: false,
  night: 0,
  cycle: 0.06,
  mode,
  timeLeft: 0,
  target: 0,
});

interface Result {
  info: GameOverInfo;
  rank: number;
  isRecord: boolean;
  prevBest: number;
}

const isTouch = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);

const PHASE_ICON: Record<string, string> = {
  'Día': '☀️',
  'Atardecer': '🌇',
  'Noche': '🌙',
  'Amanecer': '🌅',
};

/** Rótulo del ciclo con su icono y el dial que marca la posición dentro del día. */
function DayNight({ cycle }: { cycle: number }) {
  const name = phaseName(cycle);
  return (
    <div className="glass-lite rounded-full px-2.5 py-1 flex items-center gap-2">
      <span className="text-sm leading-none">{PHASE_ICON[name] ?? '☀️'}</span>
      <span className="text-[10px] font-extrabold uppercase tracking-wider aero-text leading-none">{name}</span>
      <span className="dn-dial" style={{ '--p': cycle } as React.CSSProperties}>
        <i />
      </span>
    </div>
  );
}

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [phase, setPhase] = useState<Phase>('menu');
  const [hud, setHud] = useState<Hud>(() => freshHud(loadMode()));
  const [scores, setScores] = useState<ScoreEntry[]>(() => loadScores());
  const [name, setName] = useState(() => loadName());
  const nameRef = useRef(name);
  const [muted, setMuted] = useState(audio.muted);
  const [result, setResult] = useState<Result | null>(null);
  const [boostDown, setBoostDown] = useState(false);
  const overAt = useRef(0);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [garage, setGarage] = useState<Garage>(() => loadGarage());
  const garageRef = useRef(garage);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const settingsRef = useRef(settings);
  const [mode, setMode] = useState<GameMode>(() => loadMode());
  const modeRef = useRef(mode);
  const [difficulty, setDifficulty] = useState<DifficultyId>(() => loadDifficulty());
  const diffRef = useRef(difficulty);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  // cambios de garaje → coche 3D en caliente
  useEffect(() => {
    garageRef.current = garage;
    saveGarage(garage);
    engineRef.current?.setCar(garage.model, garage.color);
  }, [garage]);

  // ajustes → persistencia + motor (volumen, calidad, accesibilidad)
  useEffect(() => {
    settingsRef.current = settings;
    saveSettings(settings);
    audio.setVolume(settings.volume);
    engineRef.current?.applySettings(settings);
  }, [settings]);

  useEffect(() => {
    modeRef.current = mode;
    saveMode(mode);
    engineRef.current?.setMode(mode, diffRef.current);
  }, [mode]);

  useEffect(() => {
    diffRef.current = difficulty;
    saveDifficulty(difficulty);
    engineRef.current?.setMode(modeRef.current, difficulty);
  }, [difficulty]);

  const changeCar = useCallback((g: Garage) => {
    audio.click();
    setGarage(g);
  }, []);

  useEffect(() => {
    const engine = new Engine(
      hostRef.current!,
      fxRef.current!,
      {
        onHud: setHud,
        onPhase: setPhase,
        onGameOver: (info) => {
          const m = info.mode;
          const prevBest = bestScoreFor(m);
          const [list, rank] = addScore({ name: nameRef.current.trim() || 'Piloto', score: info.score, dist: info.distance, date: Date.now(), mode: m });
          setScores(list);
          const isRecord = info.score > prevBest && info.score > 0;
          if (isRecord && !info.won) setTimeout(() => audio.record(), 350);
          setResult({ info, rank, isRecord, prevBest });
          overAt.current = performance.now();
        },
      },
      garageRef.current
    );
    engine.applySettings(settingsRef.current);
    engine.setMode(modeRef.current, diffRef.current);
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    audio.click();
    saveName(nameRef.current.trim() || 'Piloto');
    setResult(null);
    engineRef.current?.setMode(modeRef.current, diffRef.current);
    setHud(freshHud(modeRef.current));
    engineRef.current?.start();
  }, []);

  const pause = useCallback(() => {
    audio.click();
    engineRef.current?.pause();
  }, []);
  const resume = useCallback(() => {
    audio.click();
    engineRef.current?.resume();
  }, []);
  const toMenu = useCallback(() => {
    audio.click();
    setResult(null);
    engineRef.current?.toMenu();
  }, []);

  const toggleMute = () => {
    const m = !muted;
    audio.setMuted(m);
    setMuted(m);
    audio.click();
  };

  const pickMode = (m: GameMode) => {
    audio.click();
    setMode(m);
  };
  const pickDifficulty = (d: DifficultyId) => {
    audio.click();
    setDifficulty(d);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showSettings) {
        if (e.code === 'Escape') setShowSettings(false);
        return;
      }
      const inInput = (e.target as HTMLElement)?.tagName === 'INPUT';
      const e2 = engineRef.current;
      if (!e2) return;
      const p = e2.phase;
      if (p === 'menu') {
        if (e.code === 'Enter' || (!inInput && e.code === 'Space')) {
          e.preventDefault();
          (e.target as HTMLElement)?.blur?.();
          start();
        }
      } else if (p === 'playing') {
        if (e.code === 'Escape' || e.code === 'KeyP') pause();
      } else if (p === 'paused') {
        if (e.code === 'Escape' || e.code === 'KeyP' || e.code === 'Enter') resume();
        else if (e.code === 'KeyR') start();
      } else if (p === 'over') {
        if (performance.now() - overAt.current < 600) return;
        if (e.code === 'Enter' || e.code === 'KeyR' || e.code === 'Space') {
          e.preventDefault();
          start();
        } else if (e.code === 'Escape') toMenu();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start, pause, resume, toMenu, showSettings]);

  const setBoost = (on: boolean) => {
    setBoostDown(on);
    engineRef.current?.setBoostButton(on);
  };

  const modeScores = scores.filter((s) => (s.mode ?? 'survival') === mode);
  const best = modeScores.length ? modeScores[0].score : 0;
  const model = CAR_MODELS.find((m) => m.id === garage.model) ?? CAR_MODELS[0];
  const colorName = CAR_COLORS.find((c) => c.hex === garage.color)?.name ?? '';
  const hudMode = getMode(hud.mode);
  const activeMode = getMode(mode);
  const quotaPct = hud.target > 0 ? Math.min(100, (hud.score / hud.target) * 100) : 0;

  return (
    <div className={`fixed inset-0 overflow-hidden select-none ${settings.reduceMotion ? 'reduce-motion' : ''}`} style={{ fontFamily: 'var(--aero-font)' }}>
      {/* 3D */}
      <div ref={hostRef} className="absolute inset-0" />
      <div ref={fxRef} className="absolute inset-0 pointer-events-none overflow-hidden" />

      {/* ---------- HUD ---------- */}
      {(phase === 'playing' || phase === 'paused') && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 right-0 flex items-start justify-between p-3 sm:p-4 gap-2">
            <div className="glass-lite rounded-2xl px-4 py-2 min-w-[130px]">
              <div className="text-[10px] font-bold tracking-widest text-sky-600 uppercase">Puntos</div>
              <div className="flex items-baseline gap-2">
                <div className="text-2xl sm:text-3xl font-black aero-text tabular-nums leading-none">{hud.score.toLocaleString('es')}</div>
                {hud.mult > 1 && (
                  <div key={hud.mult} className="bump text-sm font-black text-white px-2 py-0.5 rounded-full bg-gradient-to-b from-fuchsia-400 to-pink-500 shadow">
                    x{hud.mult}
                  </div>
                )}
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-sky-900/10 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-pink-400 to-fuchsia-500" style={{ width: `${hud.comboT * 100}%` }} />
              </div>
              <div className="text-[10px] text-sky-700/70 mt-0.5 font-semibold">Récord: {Math.max(best, hud.score).toLocaleString('es')}</div>
            </div>

            <div className="flex flex-col items-center gap-1.5 mt-1">
              <div className="glass-lite rounded-full px-2.5 py-1 flex items-center gap-1.5">
                <span className="text-sm leading-none">{hudMode.icon}</span>
                <span className="text-[10px] font-extrabold uppercase tracking-wider aero-text leading-none">{hudMode.name}</span>
              </div>
              {hud.mode === 'time' ? (
                <div className={`glass-lite rounded-2xl px-3 py-1 text-2xl sm:text-3xl font-black tabular-nums leading-none ${hud.timeLeft <= 10 ? 'text-rose-500' : 'aero-text'}`}>
                  ⏱ {Math.ceil(hud.timeLeft)}s
                </div>
              ) : (
                <div className="flex gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className={`life-bubble w-7 h-7 sm:w-8 sm:h-8 rounded-full ${i >= hud.lives ? 'lost' : ''}`} />
                  ))}
                </div>
              )}
              {hud.mode === 'quota' && (
                <div className="w-32 max-w-[40vw]">
                  <div className="bar" style={{ height: 7 }}>
                    <i style={{ width: `${quotaPct}%` }} />
                  </div>
                  <div className="text-[9px] font-bold text-sky-700/70 text-center mt-0.5 tabular-nums">
                    {hud.score.toLocaleString('es')} / {hud.target.toLocaleString('es')}
                  </div>
                </div>
              )}
              <DayNight cycle={hud.cycle} />
            </div>

            <div className="flex items-start gap-2">
              <div className="glass-lite rounded-2xl px-4 py-2 text-right">
                <div className="text-[10px] font-bold tracking-widest text-sky-600 uppercase">km/h</div>
                <div className={`text-2xl sm:text-3xl font-black tabular-nums leading-none ${hud.boosting ? 'text-emerald-500' : 'aero-text'}`}>{hud.speed}</div>
                <div className="text-[10px] text-sky-700/70 mt-1 font-semibold tabular-nums">
                  {(hud.distance / 1000).toFixed(2)} km · {model.icon} {model.name}
                </div>
              </div>
              <button onClick={pause} className="pointer-events-auto aero-btn blue w-11 h-11 flex items-center justify-center text-lg" aria-label="Pausa">
                ❚❚
              </button>
            </div>
          </div>

          <div className="absolute left-1/2 -translate-x-1/2 bottom-4 sm:bottom-6 flex flex-col items-center gap-2 w-[min(78vw,420px)]">
            {isTouch && (
              <button
                className={`boost-btn pointer-events-auto w-20 h-20 rounded-full font-black text-emerald-900 text-sm transition-transform ${boostDown ? 'on' : ''} ${hud.boost < 0.02 ? 'opacity-50' : ''}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  setBoost(true);
                }}
                onPointerUp={() => setBoost(false)}
                onPointerCancel={() => setBoost(false)}
                onContextMenu={(e) => e.preventDefault()}
              >
                TURBO
              </button>
            )}
            <div className="w-full flex items-center gap-2">
              <span className="text-xs font-black text-white drop-shadow-[0_1px_2px_rgba(0,60,120,0.6)]">TURBO</span>
              <div className="meter flex-1 h-4 rounded-full overflow-hidden">
                <div className={`meter-fill h-full rounded-full ${hud.boosting ? 'active' : ''}`} style={{ width: `${Math.max(3, hud.boost * 100)}%` }} />
              </div>
              {!isTouch && <span className="text-[10px] font-bold text-white/90 drop-shadow">[ESPACIO]</span>}
            </div>
          </div>

          {isTouch && phase === 'playing' && hud.distance < 600 && (
            <>
              <div className="absolute left-4 bottom-28 text-5xl text-white/70 drop-shadow-lg animate-pulse">◀</div>
              <div className="absolute right-4 bottom-28 text-5xl text-white/70 drop-shadow-lg animate-pulse">▶</div>
              <div className="absolute left-1/2 -translate-x-1/2 top-32 text-center text-white font-bold text-sm drop-shadow-[0_2px_4px_rgba(0,60,120,0.7)]">
                Toca izquierda / derecha para girar
              </div>
            </>
          )}
        </div>
      )}

      {phase !== 'playing' && !showSettings && (
        <div className="absolute top-4 right-4 z-30 flex gap-2">
          <button onClick={() => { audio.click(); setShowSettings(true); }} className="aero-btn white w-12 h-12 flex items-center justify-center text-xl" aria-label="Ajustes">
            ⚙️
          </button>
          <button onClick={toggleMute} className="aero-btn white w-12 h-12 flex items-center justify-center text-xl" aria-label="Sonido">
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      )}

      {/* ---------- MENÚ ---------- */}
      {phase === 'menu' && (
        <div className="absolute inset-0 z-20 flex items-start justify-center p-3 sm:p-4 overflow-y-auto bg-gradient-to-b from-sky-300/10 via-transparent to-sky-900/25">
          <div className="w-full max-w-5xl grid md:grid-cols-[1.1fr_1fr] gap-3 sm:gap-4 items-stretch fade-in my-auto">
            <div className="glass rounded-[28px] p-5 sm:p-7 relative overflow-hidden">
              <div className="float-bubble w-16 h-16 -top-4 -right-2" />
              <div className="float-bubble w-8 h-8 top-20 right-14" style={{ animationDelay: '1s' }} />
              <div className="float-bubble w-10 h-10 bottom-6 -left-3" style={{ animationDelay: '2s' }} />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold tracking-[0.28em] text-sky-600 uppercase">Carreras 3D · Frutiger Aero</span>
                <span className="ml-auto">
                  <DayNight cycle={hud.cycle} />
                </span>
              </div>
              <h1 className="aero-title text-[15vw] sm:text-7xl leading-[0.92] mt-1">
                AERO
                <br />
                RUSH
              </h1>
              <p className="mt-2 aero-text text-sm max-w-sm">
                Surca la autopista de cristal sobre el océano, de <b>día y de noche</b>. Elige entre <b>{CAR_MODELS.length} coches</b>, recoge burbujas, esquiva el tráfico y enciende el <b>TURBO</b> para arrasar con todo. 🫧
              </p>

              <label className="flex items-center gap-2 mt-4">
                <span className="text-xs font-bold text-sky-700 uppercase tracking-wider">Piloto</span>
                <input
                  className="aero-input rounded-full px-4 py-2 text-sm font-semibold w-full"
                  value={name}
                  maxLength={14}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  onKeyUp={(e) => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur();
                      start();
                    }
                  }}
                />
              </label>

              <div className="mt-4 rounded-2xl bg-white/40 border border-white/80 p-3">
                <ModePicker mode={mode} difficulty={difficulty} onMode={pickMode} onDifficulty={pickDifficulty} />
              </div>

              <button onClick={start} className="aero-btn mt-4 w-full py-4 text-2xl">
                ▶ ¡JUGAR!
              </button>
              <div className="text-center text-[11px] text-sky-700/70 mt-2 font-semibold">{isTouch ? 'Toca para empezar' : 'Pulsa ENTER para empezar'}</div>

              <button onClick={() => setShowHelp((v) => !v)} className="mt-3 text-xs font-bold text-sky-600 underline underline-offset-2">
                {showHelp ? 'Ocultar controles' : '¿Cómo se juega?'}
              </button>
              {showHelp && (
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs aero-text fade-in">
                  <Help k={isTouch ? 'Toca ◀ / ▶' : '← → / A D'} t="Girar" />
                  <Help k={isTouch ? 'Botón TURBO / desliza ↑' : 'ESPACIO / ↑ / W'} t="Turbo" />
                  <Help k="🫧 Burbujas" t="Puntos + turbo + combo" />
                  <Help k="🚗 Pasar cerca" t="¡CASI! bonus" />
                  <Help k="⚡ Con turbo" t="¡Destruye obstáculos!" />
                  <Help k={isTouch ? '❚❚' : 'P / ESC'} t="Pausa" />
                </div>
              )}

              <div className="mt-4 pt-3 border-t border-white/70 text-center text-[10px] font-semibold text-sky-700/70">
                por <b>Daigeass</b> &amp; <b>GLP</b> · Licencia MIT
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:gap-4">
              <div className="glass rounded-[28px] p-4 sm:p-5">
                <GaragePanel garage={garage} onChange={changeCar} />
              </div>
              <div className="glass rounded-[28px] p-4 sm:p-5 flex-1 flex flex-col">
                <ScoreTable scores={modeScores} compact />
                <div className="mt-3 pt-3 grid grid-cols-3 gap-2 text-center">
                  <Tip icon={activeMode.icon} text={activeMode.name} />
                  <Tip icon="⚡" text="Turbo = invencible" />
                  <Tip icon="🌙" text="El mundo cambia de día a noche" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- PAUSA ---------- */}
      {phase === 'paused' && (
        <div className="absolute inset-0 z-20 flex items-start justify-center p-4 bg-sky-900/25 overflow-y-auto">
          <div className="glass rounded-[28px] p-6 w-full max-w-md text-center pop-in my-auto">
            <h2 className="aero-title text-5xl">PAUSA</h2>
            <p className="aero-text text-sm mt-1">
              {hudMode.icon} {hudMode.name} · {getDifficulty(difficulty).icon} {getDifficulty(difficulty).name}
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <button onClick={resume} className="aero-btn py-3 text-lg">
                ▶ Continuar
              </button>
              <button onClick={start} className="aero-btn blue py-3 text-lg">
                ↻ Reiniciar
              </button>
              <button onClick={toMenu} className="aero-btn white py-2.5">
                Menú principal
              </button>
            </div>
            <div className="mt-5 text-left">
              <GaragePanel garage={garage} onChange={changeCar} compact />
            </div>
            <div className="mt-4 flex items-center justify-center gap-4">
              <button onClick={toggleMute} className="text-xs font-bold text-sky-600">
                {muted ? '🔇 Sonido desactivado' : '🔊 Sonido activado'}
              </button>
              <button onClick={() => { audio.click(); setShowSettings(true); }} className="text-xs font-bold text-sky-600">
                ⚙️ Ajustes
              </button>
            </div>
            {!isTouch && <div className="text-[11px] text-sky-700/60 mt-2">ESC continuar · R reiniciar</div>}
          </div>
        </div>
      )}

      {/* ---------- GAME OVER ---------- */}
      {phase === 'over' && result && (
        <div className="absolute inset-0 z-20 flex items-start justify-center p-3 sm:p-4 overflow-y-auto bg-gradient-to-b from-sky-900/10 to-sky-900/45">
          <div className="w-full max-w-4xl grid md:grid-cols-2 gap-3 sm:gap-4 my-auto">
            <div className="glass rounded-[28px] p-5 sm:p-6 text-center pop-in relative overflow-hidden">
              <div className="float-bubble w-12 h-12 -top-3 -left-3" />
              <div className="text-xs font-bold tracking-[0.3em] text-sky-600 uppercase">
                {result.info.won ? '¡Objetivo cumplido!' : 'Fin de la carrera'} · {getMode(result.info.mode).name}
              </div>
              {result.info.won ? (
                <div className="record-shine inline-block mt-3 px-4 py-1 rounded-full text-white font-black text-sm shadow-lg">★ ¡VICTORIA! ★</div>
              ) : result.isRecord ? (
                <div className="record-shine inline-block mt-3 px-4 py-1 rounded-full text-white font-black text-sm shadow-lg">★ ¡NUEVO RÉCORD! ★</div>
              ) : (
                <div className="mt-3 text-sm aero-text font-semibold">Récord: {Math.max(result.prevBest, result.info.score).toLocaleString('es')}</div>
              )}
              <div className="aero-title text-6xl sm:text-7xl mt-2 tabular-nums">{result.info.score.toLocaleString('es')}</div>
              <div className="text-xs font-bold text-sky-600 uppercase tracking-widest">
                puntos{result.info.target > 0 ? ` / ${result.info.target.toLocaleString('es')}` : ''}
              </div>
              {result.info.target > 0 && (
                <div className="mt-3 max-w-xs mx-auto">
                  <div className="bar">
                    <i style={{ width: `${Math.min(100, (result.info.score / result.info.target) * 100)}%` }} />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 mt-4 text-left">
                <Stat icon="📏" label="Distancia" value={`${(result.info.distance / 1000).toFixed(2)} km`} />
                <Stat icon="🫧" label="Burbujas" value={result.info.orbs} />
                <Stat icon="😮" label="¡Casi!" value={result.info.nearMisses} />
                <Stat icon="💥" label="Smash" value={result.info.smashes} />
              </div>
              <div className="mt-4 flex gap-3">
                <button onClick={start} className="aero-btn flex-1 py-3.5 text-xl">
                  ↻ Reintentar
                </button>
                <button onClick={toMenu} className="aero-btn white px-5">
                  Menú
                </button>
              </div>
              {!isTouch && <div className="text-[11px] text-sky-700/60 mt-2">ENTER / R reintentar · ESC menú</div>}
            </div>

            <div className="flex flex-col gap-3 sm:gap-4">
              <div className="glass rounded-[28px] p-4 sm:p-5 fade-in">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold uppercase tracking-widest aero-text opacity-70">Tu coche</span>
                  <span className="text-xs font-extrabold aero-text">
                    {model.icon} {model.name} · {colorName}
                  </span>
                </div>
                <GaragePanel garage={garage} onChange={changeCar} compact />
              </div>
              <div className="glass rounded-[28px] p-4 sm:p-5 fade-in flex-1">
                <ScoreTable scores={modeScores} highlight={result.rank} />
                {result.rank < 0 && <div className="text-xs text-sky-700/70 mt-3 text-center">¡Casi entras en la tabla! Inténtalo otra vez.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {showSettings && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => { audio.click(); setShowSettings(false); }} />}
    </div>
  );
}

function Help({ k, t }: { k: string; t: string }) {
  return (
    <div className="rounded-xl bg-white/50 border border-white/80 px-2.5 py-1.5">
      <div className="font-extrabold">{k}</div>
      <div className="opacity-75">{t}</div>
    </div>
  );
}

function Tip({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="rounded-2xl bg-white/45 border border-white/80 p-2">
      <div className="text-2xl">{icon}</div>
      <div className="text-[10px] font-semibold aero-text leading-tight mt-1">{text}</div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: string; label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-white/50 border border-white/80 px-3 py-2">
      <div className="text-[10px] font-bold text-sky-600 uppercase tracking-wider">
        {icon} {label}
      </div>
      <div className="text-lg font-black aero-text tabular-nums">{value}</div>
    </div>
  );
}
