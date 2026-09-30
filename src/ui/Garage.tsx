import { CAR_COLORS, CAR_MODELS, darker, type Garage } from '../game/cars';

const BARS: { key: keyof GarageStats; label: string }[] = [
  { key: 'manejo', label: 'Manejo' },
  { key: 'velocidad', label: 'Veloc.' },
  { key: 'turbo', label: 'Turbo' },
  { key: 'iman', label: 'Imán' },
];

type GarageStats = (typeof CAR_MODELS)[number]['bars'];

interface Props {
  garage: Garage;
  onChange: (g: Garage) => void;
  /** versión apretada para pausa y fin de partida: sin barras ni descripciones */
  compact?: boolean;
}

export default function Garage({ garage, onChange, compact = false }: Props) {
  const model = CAR_MODELS.find((m) => m.id === garage.model) ?? CAR_MODELS[0];

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg leading-none">🔧</span>
        <h3 className="font-extrabold aero-text tracking-wide text-sm uppercase">Garaje</h3>
        <span className="text-[10px] aero-text opacity-60 font-semibold ml-auto hidden sm:block">
          {compact ? '' : 'se ve al instante en la pista'}
        </span>
      </div>

      <div className={`grid ${compact ? 'grid-cols-4 gap-1.5' : 'grid-cols-2 sm:grid-cols-4 gap-2'}`}>
        {CAR_MODELS.map((m) => {
          const sel = garage.model === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onChange({ ...garage, model: m.id })}
              className={`garage-card ${sel ? 'sel' : ''} ${compact ? 'compact' : ''}`}
              title={`${m.name} — ${m.tag}`}
            >
              <div className="flex items-center gap-1.5">
                <span className={compact ? 'text-base leading-none' : 'text-xl leading-none'}>{m.icon}</span>
                <span className={`font-extrabold leading-none aero-text ${compact ? 'text-[10px]' : 'text-sm'}`}>{m.name}</span>
              </div>
              {compact ? (
                <div className="mt-1 flex justify-center gap-0.5">
                  {BARS.map((b) => (
                    <i key={b.key} className={`dot ${m.bars[b.key] >= 0.6 ? 'on' : ''}`} title={`${b.label} ${Math.round(m.bars[b.key] * 100)}%`} />
                  ))}
                </div>
              ) : (
                <>
                  <p className="text-[10px] aero-text opacity-70 mt-1 leading-tight">{m.tag}</p>
                  <div className="mt-1.5 space-y-[3px]">
                    {BARS.map((b) => (
                      <div key={b.key} className="flex items-center gap-1.5">
                        <span className="text-[8px] uppercase font-bold aero-text opacity-60 w-9 shrink-0">{b.label}</span>
                        <span className="bar flex-1">
                          <i style={{ width: `${m.bars[b.key] * 100}%` }} />
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3">
        <div className="text-[10px] font-bold uppercase tracking-widest aero-text opacity-70 mb-1.5">
          Color de la carrocería
        </div>
        <div className="flex flex-wrap gap-2">
          {CAR_COLORS.map((c) => (
            <button
              key={c.hex}
              title={c.name}
              aria-label={c.name}
              onClick={() => onChange({ ...garage, color: c.hex })}
              className={`swatch ${garage.color === c.hex ? 'sel' : ''}`}
              style={{ background: `radial-gradient(circle at 32% 26%, rgba(255,255,255,0.98) 0 10%, ${c.hex} 46%, ${darker(c.hex)} 100%)` }}
            />
          ))}
        </div>
      </div>

      {!compact && (
        <div className="mt-3 flex items-center justify-between text-[11px] font-semibold aero-text opacity-80">
          <span>
            {model.icon} {model.name}
          </span>
          <span>{CAR_COLORS.find((c) => c.hex === garage.color)?.name}</span>
        </div>
      )}
    </div>
  );
}
