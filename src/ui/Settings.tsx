import { DEFAULT_SETTINGS, QUALITY_INFO, type Settings } from '../game/settings';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
}

function Toggle({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center justify-between gap-3 w-full text-left">
      <span>
        <span className="block text-sm font-bold aero-text">{label}</span>
        {hint && <span className="block text-[11px] text-sky-700/60 font-semibold">{hint}</span>}
      </span>
      <span className={`toggle ${on ? 'on' : ''}`} aria-hidden>
        <i />
      </span>
    </button>
  );
}

export default function SettingsPanel({ settings, onChange, onClose }: Props) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });

  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center p-3 sm:p-4 overflow-y-auto bg-sky-900/35">
      <div className="glass rounded-[28px] p-5 sm:p-6 w-full max-w-lg my-auto pop-in">
        <div className="flex items-center justify-between">
          <h2 className="aero-title text-3xl">Ajustes</h2>
          <button onClick={onClose} className="aero-btn white w-10 h-10 flex items-center justify-center text-lg" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold aero-text">🔊 Volumen</span>
              <span className="text-xs font-extrabold aero-text tabular-nums">{Math.round(settings.volume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(e) => set('volume', Number(e.target.value))}
              className="aero-range w-full mt-1"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold aero-text">🌀 Sensibilidad de giro</span>
              <span className="text-xs font-extrabold aero-text tabular-nums">{Math.round(settings.steerSensitivity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.6}
              max={1.6}
              step={0.05}
              value={settings.steerSensitivity}
              onChange={(e) => set('steerSensitivity', Number(e.target.value))}
              className="aero-range w-full mt-1"
            />
          </div>

          <Toggle on={settings.invertSteer} onClick={() => set('invertSteer', !settings.invertSteer)} label="↔️ Invertir giro" hint="Izquierda y derecha intercambiados" />
          <Toggle on={settings.reduceMotion} onClick={() => set('reduceMotion', !settings.reduceMotion)} label="🌿 Reducir movimiento" hint="Menos sacudidas de cámara" />

          <div>
            <div className="text-sm font-bold aero-text mb-1">✨ Calidad gráfica</div>
            <div className="grid grid-cols-3 gap-2">
              {QUALITY_INFO.map((q) => (
                <button
                  key={q.id}
                  onClick={() => set('quality', q.id)}
                  className={`chip ${settings.quality === q.id ? 'sel' : ''} flex-col py-2`}
                >
                  <span className="font-extrabold">{q.name}</span>
                  <span className="text-[10px] opacity-70 font-semibold">{q.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <Toggle
            on={settings.autoQuality}
            onClick={() => set('autoQuality', !settings.autoQuality)}
            label="📉 Calidad automática"
            hint="Baja la resolución si los FPS flojean"
          />

          <div className="flex gap-2 pt-1">
            <button onClick={() => onChange({ ...DEFAULT_SETTINGS, volume: settings.volume })} className="aero-btn white flex-1 py-2.5 text-sm">
              ↺ Restablecer
            </button>
            <button onClick={onClose} className="aero-btn flex-1 py-2.5 text-sm">
              ✓ Listo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
