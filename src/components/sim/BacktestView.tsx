import { useEffect, useState } from 'react';
import { FlaskConical, Play } from 'lucide-react';
import { api } from '../../lib/api';
import { money, pct } from '../../lib/format';
import { Chip, EmptyState, ErrorNote, Panel, Spinner } from '../ui';

interface CoinMeta {
  id: string;
  symbol: string;
  name: string;
}

/** Rango real simulado (el histórico crece solo hasta el año completo). */
function spanLabel(r: HorizonResult): string {
  if (r.from && r.to) {
    const days = Math.max(1, Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000));
    if (days < 2) return 'Últimas 24 horas';
    return `Últimos ${days} días`;
  }
  return `Últimas ${r.windowLabel}`;
}

interface HorizonResult {
  horizon: string;
  label: string;
  windowLabel: string;
  from: string | null;
  to: string | null;
  valueNow: number;
  pnl: number;
  pnlPct: number;
  buys: number;
  sells: number;
  moves: number;
  headline: string;
  explanation: string;
}

export function BacktestView() {
  const [coins, setCoins] = useState<CoinMeta[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [amount, setAmount] = useState('10000');
  const [results, setResults] = useState<HorizonResult[]>([]);
  const [invested, setInvested] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .coins()
      .then((d) => setCoins(d.coins))
      .catch(() => setCoins([]));
  }, []);

  const toggle = (id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const data = await api.simBacktest(picked, amount);
      setResults(data.horizons);
      setInvested(data.amount);
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : 'No se pudo simular.');
    } finally {
      setRunning(false);
    }
  };

  /** "Con $10,000 invertidos hace 32 días, hoy tendrías $11,857." */
  const plainSentence = (r: HorizonResult): string => {
    let ago = r.windowLabel;
    if (r.from && r.to) {
      const days = Math.max(1, Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000));
      ago = days < 2 ? '24 horas' : `${days} días`;
    }
    return `Con ${money(invested, 'MXN')} invertidos hace ${ago}, hoy tendrías ${money(r.valueNow, 'MXN')}.`;
  };

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}

      <Panel
        title="Simulador por horizonte"
        subtitle="Elige monedas y monto: el programa invierte lo mismo con las 4 reglas y compara"
      >
        <div className="flex flex-wrap gap-2">
          {coins.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              title={c.name}
              className={`chip ${picked.includes(c.id) ? 'bg-brand/15 text-brand' : 'bg-raised text-muted'}`}
            >
              {c.symbol}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-dim">Vacío = las 10. El monto se reparte en partes iguales.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="bt-amount">Monto total (MXN)</label>
            <input
              id="bt-amount"
              type="number"
              min={1}
              className="input w-44"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={() => void run()} disabled={running}>
            <Play size={13} /> {running ? 'Simulando 30 días…' : 'Simular los 4'}
          </button>
        </div>
      </Panel>

      {results.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {results.map((r) => {
            const won = r.pnl >= 0;
            return (
              <Panel
                key={r.horizon}
                title={r.label}
                subtitle={`${spanLabel(r)}${
                  r.from && r.to
                    ? ` (${r.from.slice(0, 10)} → ${r.to.slice(0, 10)})`
                    : ''
                } · ${r.moves === 0 ? 'sin operar tras asignar' : `${r.moves} movimiento(s)`}`}
                action={<Chip tone={won ? 'up' : 'down'}>{pct(r.pnlPct)}</Chip>}
              >
                <p className="flex items-center gap-2">
                  <FlaskConical size={14} className="text-brand" />
                  <span className="text-[13px] font-semibold">{plainSentence(r)}</span>
                  <span className="ml-auto font-mono text-[13px]">{money(r.valueNow, 'MXN')}</span>
                </p>
                <p className="mt-1 text-[12px] text-muted">{r.explanation}</p>
              </Panel>
            );
          })}
        </div>
      )}

      {results.length === 0 && !running && (
        <div className="panel">
          <EmptyState
            message="Sin simulación aún."
            hint="Elige monedas y monto, pulsa Simular y compara qué hubiera pasado siendo scalper, day trader, swing u holder."
          />
        </div>
      )}
      {running && <Spinner label="Recorriendo el histórico hora por hora…" />}
    </div>
  );
}
