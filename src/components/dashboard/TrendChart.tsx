import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TrendMarker, TrendPoint } from '../../../shared/types';
import type { CoinMeta } from '../../../shared/coins';
import { api } from '../../lib/api';
import { timeShort } from '../../lib/format';
import { EmptyState, Panel, Spinner } from '../ui';

/** Rangos de la gráfica (a 30 s por corrida): 15 min, 1 h, 3 h o todo el historial. */
const RANGES = [
  { id: '30', label: '15 min', points: 30 },
  { id: '120', label: '1 h', points: 120 },
  { id: '360', label: '3 h', points: 360 },
  { id: '600', label: 'Todo', points: 600 },
] as const;

const RANGE_KEY = 'trend-range';

function initialRange(): number {
  try {
    const saved = localStorage.getItem(RANGE_KEY);
    const found = RANGES.find((r) => r.id === saved);
    if (found) return found.points;
  } catch {
    /* sin localStorage: 1 h por defecto */
  }
  return 120;
}
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
export function TrendChart({ bare = false, fill = false }: { bare?: boolean; fill?: boolean }) {
  const [coins, setCoins] = useState<CoinMeta[]>([]);
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [markers, setMarkers] = useState<TrendMarker[]>([]);
  const [range, setRange] = useState<number>(() => initialRange());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api.trendIndexed(range);
        if (!alive) return;
        setCoins(data.coins);
        setPoints(data.points);
        setMarkers(data.markers ?? []);
      } catch {
        /* se reintenta en el siguiente ciclo */
      } finally {
        if (alive) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const id = setInterval(() => void load(), 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [range]);

  const pickRange = (points: number) => {
    setRange(points);
    try {
      localStorage.setItem(RANGE_KEY, String(points));
    } catch {
      /* solo memoria */
    }
  };

  const colorOf = (index: number) => COIN_COLORS[index % COIN_COLORS.length];

  // Cada operación se ancla al punto más cercano en el tiempo.
  const dots = markers.slice(-12).flatMap((m, i) => {
    if (points.length === 0) return [];
    let best = points[0];
    const target = Date.parse(m.at);
    for (const p of points) {
      if (Math.abs(Date.parse(p.ts) - target) < Math.abs(Date.parse(best.ts) - target)) best = p;
    }
    const y = best[m.coinId];
    if (typeof y !== 'number') return [];
    const buy = m.side === 'compra';
    return [
      <ReferenceDot
        key={`${m.at}-${m.coinId}-${i}`}
        x={best.ts}
        y={y}
        r={6}
        fill={buy ? '#6d917c' : '#ab7070'}
        stroke="var(--color-canvas)"
        strokeWidth={2}
        label={{ value: `${buy ? 'C' : 'V'} ${m.symbol}`, fontSize: 9, fill: buy ? '#6d917c' : '#ab7070', position: buy ? 'bottom' : 'top' }}
      />,
    ];
  });

  const legend = (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="flex items-center gap-1 rounded bg-raised p-0.5">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => pickRange(r.points)}
            className={`rounded px-2 py-0.5 font-mono text-[10px] tabular-nums transition-colors ${
              range === r.points ? 'bg-line text-ink' : 'text-dim hover:text-ink'
            }`}
          >
            {r.label}
          </button>
        ))}
      </span>
      {coins.map((coin, i) => (
        <span key={coin.id} className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: colorOf(i) }} />
          {coin.symbol}
        </span>
      ))}
      {markers.length > 0 && (
        <span className="font-mono text-[10px] text-dim">C compra · V venta</span>
      )}
    </span>
  );

  return (
    <Panel
      className={fill ? 'h-full' : undefined}
      title={bare ? undefined : 'Tendencia base 100'}
      action={bare ? undefined : legend}
      bodyClass={bare ? 'flex min-h-0 flex-1 flex-col px-2 pb-2 pt-1' : undefined}
    >
      {bare && <div className="flex justify-end px-3 pb-1">{legend}</div>}
      {loading && points.length === 0 ? (
        <Spinner />
      ) : points.length < 2 ? (
        <EmptyState
          message="Todavía no hay suficientes corridas para graficar."
          hint="El agente está monitoreando. En un par de minutos vas a ver las curvas formarse."
        />
      ) : (
        <div className={fill ? 'min-h-[320px] min-w-0 flex-1' : 'h-[260px]'}>
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
              {dots}
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
