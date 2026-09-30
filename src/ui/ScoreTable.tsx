import type { ScoreEntry } from '../game/scores';
import { getMode } from '../game/settings';

const medals = ['🥇', '🥈', '🥉'];

export default function ScoreTable({ scores, highlight = -1, compact = false }: { scores: ScoreEntry[]; highlight?: number; compact?: boolean }) {
  return (
    <div className="w-full">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">🏆</span>
        <h3 className="font-extrabold aero-text tracking-wide text-sm uppercase">Mejores puntuaciones</h3>
      </div>
      {scores.length === 0 ? (
        <div className="text-sm text-sky-700/70 py-4 text-center rounded-2xl bg-white/40 border border-white/80">
          ¡Aún no hay récords! Sé el primero 🫧
        </div>
      ) : (
        <ol className="space-y-1">
          {scores.slice(0, compact ? 5 : 8).map((s, i) => (
            <li
              key={s.date + '-' + i}
              className={`flex items-center gap-2 rounded-xl px-3 ${compact ? 'py-1' : 'py-1.5'} text-sm ${
                i === highlight ? 'record-shine text-white font-extrabold shadow-lg' : 'bg-white/45 border border-white/80 aero-text'
              }`}
            >
              <span className="w-6 text-center font-bold">{medals[i] ?? i + 1}</span>
              <span className="shrink-0 text-[13px]" title={getMode(s.mode ?? 'survival').name}>
                {getMode(s.mode ?? 'survival').icon}
              </span>
              <span className="flex-1 truncate font-semibold">{s.name}</span>
              <span className="text-xs opacity-70 tabular-nums">{Math.round(s.dist / 10) / 100} km</span>
              <span className="w-20 text-right font-extrabold tabular-nums">{s.score.toLocaleString('es')}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
