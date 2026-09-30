import { DIFFICULTIES, GAME_MODES, getMode, type DifficultyId, type GameMode } from '../game/settings';

interface Props {
  mode: GameMode;
  difficulty: DifficultyId;
  onMode: (m: GameMode) => void;
  onDifficulty: (d: DifficultyId) => void;
}

export default function ModePicker({ mode, difficulty, onMode, onDifficulty }: Props) {
  const info = getMode(mode);
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {GAME_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onMode(m.id)}
            title={m.blurb}
            className={`chip flex-col py-2 ${mode === m.id ? 'sel' : ''}`}
          >
            <span className="text-lg leading-none">{m.icon}</span>
            <span className="font-extrabold text-[11px]">{m.name}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] aero-text mt-1.5 min-h-[2.4em] leading-tight">
        {info.icon} {info.blurb}
      </p>
      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700">Dificultad</span>
        <div className="flex gap-1.5 ml-auto">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onDifficulty(d.id)}
              className={`chip px-2.5 py-1 text-[11px] ${difficulty === d.id ? 'sel' : ''}`}
            >
              {d.icon} {d.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
