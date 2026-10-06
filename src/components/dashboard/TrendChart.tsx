import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TrendPoint } from '../../../shared/types';
import type { CoinMeta } from '../../../shared/coins';
import { api } from '../../lib/api';
import { timeShort } from '../../lib/format';
import { EmptyState, Panel, Spinner } from '../ui';

/** Un color por moneda, en el orden del Top 10. */
const COIN_COLORS = [
  '#f7931a', // BTC
  '#627eea', // ETH
  '#9945ff', // SOL
  '#f0b90b', // BNB
  '#25a4e8', // XRP
  '#c2a633', // DOGE
  '#3468d1', // ADA
  '#2a5ada', // LINK
  '#e84142', // AVAX
  '#ff0013', // TRX
];

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | string;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  coins,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  coins: CoinMeta[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="max-h-[240px] overflow-y-auto rounded-md bg-raised/95 px-3 py-2">
      <p className="mb-1.5 text-[11px] font-medium text-muted">
        {label ? timeShort(label) : ''}
      </p>
      {payload.map((entry) => {
        const coin = coins.find((c) => c.id === entry.dataKey);
        if (!coin || typeof entry.value !== 'number') return null;
        const pct = entry.value - 100;
        return (
          <p key={String(entry.dataKey)} className="flex items-center gap-2 text-[12px]">
            <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
            <span className="text-muted">{coin.symbol}</span>
            <span className="ml-auto font-mono text-ink">
              {entry.value.toFixed(2)} ({pct > 0 ? '+' : ''}{pct.toFixed(2)}%)
            </span>
          </p>
        );
      })}
    </div>
  );
}

/**
 * Tendencia indexada base 100: cada moneda parte de 100 en la primera corrida
 * visible. 101 = +1% desde el inicio; 98 = −2%. Así el precio gigante de BTC
 * no aplasta a las demás y se ve quién se mueve.
 */
export function TrendChart() {
  const [coins, setCoins] = useState<CoinMeta[]>([]);
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api.trendIndexed();
        if (!alive) return;
        setCoins(data.coins);
        setPoints(data.points);
      } catch {
        /* se reintenta en el siguiente ciclo */
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const id = setInterval(() => void load(), 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const colorOf = (index: number) => COIN_COLORS[index % COIN_COLORS.length];

  return (
    <Panel
      title="Tendencia base 100"
      subtitle="100 = primera corrida visible · arriba/abajo = % ganado/perdido"
      action={
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {coins.map((coin, i) => (
            <span key={coin.id} className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: colorOf(i) }} />
              {coin.symbol}
            </span>
          ))}
        </span>
      }
    >
      {loading && points.length === 0 ? (
        <Spinner />
      ) : points.length < 2 ? (
        <EmptyState
          message="Todavía no hay suficientes corridas para graficar."
          hint="El agente está monitoreando. En un par de minutos vas a ver las curvas formarse."
        />
      ) : (
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="var(--color-line-soft)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="ts"
                tickFormatter={(ts: string) => timeShort(ts)}
                stroke="var(--color-dim)"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-line)' }}
                minTickGap={40}
              />
              <YAxis
                stroke="var(--color-dim)"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                domain={['auto', 'auto']}
                tickFormatter={(v: number) => v.toFixed(1)}
                width={48}
              />
              <Tooltip
                content={<ChartTooltip coins={coins} />}
                cursor={{ stroke: 'var(--color-line)', strokeDasharray: '4 4' }}
              />
              <ReferenceLine
                y={100}
                stroke="var(--color-dim)"
                strokeDasharray="4 4"
                strokeOpacity={0.6}
              />
              {coins.map((coin, i) => (
                <Line
                  key={coin.id}
                  type="monotone"
                  dataKey={coin.id}
                  name={coin.symbol}
                  stroke={colorOf(i)}
                  strokeWidth={1.8}
                  dot={false}
                  activeDot={{ r: 3 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}
