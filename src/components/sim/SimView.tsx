import { useEffect, useState } from 'react';
import { FlaskConical, History, Play, Trash2, Trophy } from 'lucide-react';
import { api } from '../../lib/api';
import { money, pct } from '../../lib/format';
import { Chip, EmptyState, ErrorNote, Panel, Spinner } from '../ui';

interface CoinMeta {
  id: string;
  symbol: string;
  name: string;
}

interface SimResult {
  coinId: string;
  symbol: string;
  name: string;
  date: string;
  side: 'buy' | 'sell';
  amount: number;
  priceThen: number;
  priceNow: number;
  qty: number;
  valueNow: number;
  pnl: number;
  pnlPct: number;
  headline: string;
  explanation: string;
}

interface SavedSim {
  key: string;
  at: string;
  inputs: { coin: string; date: string; side: string; amount: string };
  result: SimResult;
}

const HISTORY_KEY = 'sim-history';

function todayIso(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

function loadHistory(): SavedSim[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedSim[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Barra entonces-vs-hoy: anchos relativos al mayor de los dos valores. */
function VsBar({ thenValue, nowValue }: { thenValue: number; nowValue: number }) {
  const max = Math.max(thenValue, nowValue, 1);
  return (
    <div className="space-y-1.5">
      {(
        [
          ['Entonces', thenValue, 'bg-dim'],
          ['Hoy', nowValue, 'bg-brand'],
        ] as const
      ).map(([label, value, bar]) => (
        <div key={label} className="flex items-center gap-2 text-[11px]">
          <span className="w-14 shrink-0 text-muted">{label}</span>
          <div className="h-2.5 flex-1 rounded bg-raised">
            <div className={`h-2.5 rounded ${bar}`} style={{ width: `${Math.max(2, (value / max) * 100)}%` }} />
          </div>
          <span className="w-24 shrink-0 text-right font-mono tabular-nums">{money(value, 'MXN')}</span>
        </div>
      ))}
    </div>
  );
}

export function SimView() {
  const [coins, setCoins] = useState<CoinMeta[]>([]);
  const [coin, setCoin] = useState('bitcoin');
  const [date, setDate] = useState('2024-01-15');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('5000');
  const [result, setResult] = useState<SimResult | null>(null);
  const [disclaimer, setDisclaimer] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ranking, setRanking] = useState<SimResult[]>([]);
  const [rankingFailed, setRankingFailed] = useState<Array<{ coinId: string; error: string }>>([]);
  const [rankingRunning, setRankingRunning] = useState(false);
  const [history, setHistory] = useState<SavedSim[]>(() => loadHistory());

  useEffect(() => {
    void api
      .coins()
      .then((d) => setCoins(d.coins))
      .catch(() => setCoins([]));
  }, []);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const data = await api.simEvaluate({ coin, date, side, amount });
      setResult(data.result);
      setDisclaimer(data.disclaimer);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'No se pudo simular.');
    } finally {
      setRunning(false);
    }
  };

  const runRanking = async () => {
    setRankingRunning(true);
    setError(null);
    try {
      const data = await api.simRanking(date, amount);
      setRanking(data.results);
      setRankingFailed(data.failed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo rankear.');
    } finally {
      setRankingRunning(false);
    }
  };

  const save = () => {
    if (!result) return;
    const entry: SavedSim = {
      key: `${Date.now()}`,
      at: new Date().toISOString(),
      inputs: { coin, date, side, amount },
      result,
    };
    setHistory((prev) => [entry, ...prev].slice(0, 20));
  };

  const won = result !== null && result.pnl >= 0;
  const today = todayIso();

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}

      <Panel
        title="Simulador: ¿y si hubiera…?"
        subtitle="Precios aproximados del día (CoinGecko, resolución diaria) · Contenido educativo"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <label className="label" htmlFor="sim-coin">Moneda</label>
            <select id="sim-coin" className="input" value={coin} onChange={(e) => setCoin(e.target.value)}>
              {coins.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.symbol})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="sim-date">Fecha del movimiento</label>
            <input
              id="sim-date"
              type="date"
              className="input"
              min="2013-01-01"
              max={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="sim-side">Movimiento</label>
            <select id="sim-side" className="input" value={side} onChange={(e) => setSide(e.target.value as 'buy' | 'sell')}>
              <option value="buy">Compré</option>
              <option value="sell">Vendí</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="sim-amount">Monto (MXN)</label>
            <input
              id="sim-amount"
              type="number"
              min={1}
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button className="btn btn-primary w-full" onClick={() => void run()} disabled={running}>
              <Play size={13} /> {running ? 'Calculando…' : 'Simular'}
            </button>
          </div>
        </div>

        {result && (
          <div className="mt-4 rounded-lg border border-line-soft p-3">
            <div className="flex flex-wrap items-center gap-2">
              <FlaskConical size={14} className="text-brand" />
              <span className="text-[13px] font-semibold">{result.headline}</span>
              <Chip tone={won ? 'down' : 'up'}>{pct(result.pnlPct)}</Chip>
              <span className="ml-auto font-mono text-[13px]">{money(result.valueNow, 'MXN')}</span>
            </div>
            <p className="mt-1 text-[12px] text-muted">{result.explanation}</p>
            <div className="mt-3">
              <VsBar thenValue={result.amount} nowValue={result.valueNow} />
            </div>
            <p className="mt-2 font-mono text-[10px] text-dim">
              {result.symbol}: {money(result.priceThen, 'MXN')} el {result.date} → {money(result.priceNow, 'MXN')} hoy
            </p>
            <div className="mt-2">
              <button className="btn btn-xs" onClick={save}>
                Guardar escenario
              </button>
            </div>
          </div>
        )}
        {disclaimer && <p className="mt-2 text-[10px] text-dim">{disclaimer}</p>}
      </Panel>

      <Panel
        title="Ranking del día"
        subtitle={`¿Qué habría rendido ${money(Number(amount) || 0, 'MXN')} en cada moneda comprada el ${date}?`}
        action={
          <button className="btn btn-xs" onClick={() => void runRanking()} disabled={rankingRunning}>
            <Trophy size={12} /> {rankingRunning ? 'Comparando…' : 'Comparar las 10'}
          </button>
        }
      >
        {rankingRunning && ranking.length === 0 ? (
          <Spinner />
        ) : ranking.length === 0 ? (
          <EmptyState message="Aún sin comparación." hint="Elige fecha y monto arriba y pulsa Comparar." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead className="border-b border-line-soft">
                <tr>
                  <th className="th">#</th>
                  <th className="th">Moneda</th>
                  <th className="th text-right">Hoy valdría</th>
                  <th className="th text-right">Rendimiento</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r, i) => (
                  <tr key={r.coinId} className="border-b border-line-soft last:border-0">
                    <td className="td font-mono text-dim">{i + 1}</td>
                    <td className="td font-medium">
                      {r.name} <span className="text-dim">({r.symbol})</span>
                    </td>
                    <td className="td text-right font-mono tabular-nums">{money(r.valueNow, 'MXN')}</td>
                    <td className="td text-right">
                      <Chip tone={r.pnl >= 0 ? 'down' : 'up'}>{pct(r.pnlPct)}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rankingFailed.length > 0 && (
              <p className="px-1 py-2 text-[10px] text-dim">
                {rankingFailed.length} moneda(s) sin resultado: {rankingFailed[0].error}
              </p>
            )}
          </div>
        )}
      </Panel>

      {history.length > 0 && (
        <Panel
          title="Mis escenarios"
          subtitle="Guardados en este navegador"
          action={
            <button className="btn btn-xs" onClick={() => setHistory([])}>
              <Trash2 size={12} /> Borrar todos
            </button>
          }
          bodyClass=""
        >
          <div className="max-h-[260px] overflow-y-auto">
            {history.map((h) => (
              <div
                key={h.key}
                className="flex items-center gap-2 border-b border-line-soft px-4 py-2 text-[12px] last:border-0"
              >
                <History size={13} className="shrink-0 text-dim" />
                <span className="min-w-0 flex-1 truncate">
                  {h.inputs.side === 'buy' ? 'Compré' : 'Vendí'} {h.result.symbol} el {h.inputs.date} con{' '}
                  {money(h.result.amount, 'MXN')} → <span className="font-medium">{h.result.headline}</span>
                </span>
                <button
                  className="rounded p-1 text-dim hover:text-up"
                  title="Eliminar"
                  onClick={() => setHistory((prev) => prev.filter((x) => x.key !== h.key))}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
