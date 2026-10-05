import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { StoreSummary, TrendPoint } from '../../../shared/types';
import { money, num, timeShort } from '../../lib/format';
import { EmptyState, Panel } from '../ui';

const STORE_COLOR: Record<string, string> = {
  anglo: 'var(--color-down)',
  mercado: 'var(--color-warn)',
  omie: 'var(--color-brand)',
};

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | string;
  color?: string;
  name?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  stores,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  stores: StoreSummary[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md bg-raised/95 px-3 py-2">
      <p className="mb-1.5 text-[11px] font-medium text-muted">
        {label ? timeShort(label) : ''}
      </p>
      {payload.map((entry) => {
        const store = stores.find((s) => s.id === entry.dataKey);
        if (!store) return null;
        return (
          <p key={String(entry.dataKey)} className="flex items-center gap-2 text-[12px]">
            <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
            <span className="text-muted">{store.name}</span>
            <span className="ml-auto font-mono text-ink">
              {money(Number(entry.value), store.currency)}
            </span>
          </p>
        );
      })}
    </div>
  );
}

/**
 * Tendencia del precio promedio por tienda.
 * La fuente cripto queda fuera del eje porque esta en pesos: mezclarla con
 * dolares aplastaria la escala y el grafico no diria nada.
 */
export function TrendChart({
  trend,
  stores,
}: {
  trend: TrendPoint[];
  stores: StoreSummary[];
}) {
  const plottable = stores.filter((s) => s.currency === 'GBP' || s.currency === 'EUR');

  return (
    <Panel
      title="Tendencia"
      subtitle="Evolución entre corridas"
      action={
        <span className="flex flex-wrap gap-3">
          {plottable.map((store) => (
            <span key={store.id} className="flex items-center gap-1.5 text-[11px] text-muted">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: STORE_COLOR[store.id] }}
              />
              {store.name}
            </span>
          ))}
        </span>
      }
    >
      {trend.length < 2 || plottable.length === 0 ? (
        <EmptyState
          message="Todavía no hay suficientes corridas para graficar."
          hint="El agente está monitoreando. En un par de minutos vas a ver la curva formarse."
        />
      ) : (
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
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
                tickFormatter={(v: number) => num(Math.round(v))}
                width={54}
              />
              <Tooltip
                content={<ChartTooltip stores={plottable} />}
                cursor={{ stroke: 'var(--color-line)', strokeDasharray: '4 4' }}
              />
              {plottable.map((store) => (
                <Line
                  key={store.id}
                  type="monotone"
                  dataKey={store.id}
                  name={store.name}
                  stroke={STORE_COLOR[store.id] ?? 'var(--color-brand)'}
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
