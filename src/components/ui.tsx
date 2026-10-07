import type { ReactNode } from 'react';
import clsx from 'clsx';
import type { EventKind, PriceEvent, Severity, UserHorizon } from '../../shared/types';
import { money, pct, timeAgo } from '../lib/format';

/* --------------------------- Color por cliente --------------------------- */

export const HORIZON_HUE: Record<UserHorizon, string> = {
  scalper: 'var(--color-h-scalper)',
  daily: 'var(--color-h-daily)',
  swing: 'var(--color-h-swing)',
  holder: 'var(--color-h-holder)',
};

/** Micro-etiqueta editorial: la única "cabecera" permitida en la ruta demo. */
export function Eyebrow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <p className="eyebrow">{children}</p>
      {right}
    </div>
  );
}

/* --------------------------------- Panel --------------------------------- */

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClass,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={clsx('panel flex flex-col', className)}>
      {(title || action) && (
        <header className="panel-head">
          <div>
            <h2 className="panel-title">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11px] text-dim">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={clsx('min-h-0 flex-1', bodyClass ?? 'p-4')}>{children}</div>
    </section>
  );
}

/* --------------------------------- Chips --------------------------------- */

type ChipTone = 'neutral' | 'live' | 'up' | 'down' | 'warn' | 'brand';

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: 'bg-raised text-muted',
  live: 'bg-down/15 text-down',
  up: 'bg-up/15 text-up',
  down: 'bg-down/15 text-down',
  warn: 'bg-warn/15 text-warn',
  brand: 'bg-brand/15 text-brand',
};

export function Chip({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={clsx('chip', CHIP_TONE[tone], className)}>{children}</span>;
}

/* ------------------------------ Delta (+/-%) ----------------------------- */

export function DeltaPill({ value, suffix }: { value: number | null; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-dim">—</span>;
  }
  if (Math.abs(value) < 0.05) {
    return <span className="text-dim">sin cambio</span>;
  }
  const up = value > 0;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium',
        up ? 'bg-up/12 text-up' : 'bg-down/12 text-down',
      )}
    >
      {up ? '▲' : '▼'} {pct(Math.abs(value) * (up ? 1 : -1))}
      {suffix}
    </span>
  );
}

/* -------------------------------- Sparkline ------------------------------- */

/** SVG a mano: una libreria de charts por fila de tabla seria pesada de mas. */
export function Sparkline({
  values,
  width = 88,
  height = 26,
  tone = 'brand',
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: 'brand' | 'up' | 'down';
}) {
  if (values.length < 2) {
    return <div style={{ width, height }} className="flex items-center text-[10px] text-dim">—</div>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => [i * step, height - ((v - min) / span) * (height - 4) - 2]);
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;
  const rising = values[values.length - 1] >= values[0];
  const color =
    tone === 'brand' ? 'var(--color-brand)' : rising ? 'var(--color-up)' : 'var(--color-down)';
  const gradientId = `spark-${tone}-${Math.round(min * 1000)}-${values.length}`;

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.16" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <circle
        cx={points[points.length - 1][0]}
        cy={points[points.length - 1][1]}
        r="2"
        fill={color}
      />
    </svg>
  );
}

/* -------------------------------- Eventos --------------------------------- */

export const EVENT_LABEL: Record<EventKind, string> = {
  price_up: 'Subió',
  price_down: 'Bajó',
  stockout: 'Sin stock',
  back_in_stock: 'Stock repuesto',
  new_product: 'Nuevo',
  removed_product: 'Desaparecido',
};

export const EVENT_COLOR: Record<EventKind, string> = {
  price_up: 'text-up',
  price_down: 'text-down',
  stockout: 'text-warn',
  back_in_stock: 'text-down',
  new_product: 'text-brand',
  removed_product: 'text-muted',
};

export const SEVERITY_TONE: Record<Severity, ChipTone> = {
  high: 'down',
  medium: 'warn',
  low: 'neutral',
};

export function EventRow({ event, showTime = true }: { event: PriceEvent; showTime?: boolean }) {
  const isPrice = event.kind === 'price_up' || event.kind === 'price_down';
  return (
    <div className="flex items-start gap-3 border-b border-line-soft px-4 py-2.5 last:border-0">
      <span
        className={clsx(
          'mt-0.5 w-px shrink-0 self-stretch',
          event.severity === 'high'
            ? 'bg-down/60'
            : event.severity === 'medium'
              ? 'bg-warn/60'
              : 'bg-line',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={clsx('text-[12px] font-semibold', EVENT_COLOR[event.kind])}>
            {EVENT_LABEL[event.kind]}
          </span>
          <span className="truncate text-[13px] text-ink">{event.title}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
          {isPrice && (
            <span className="font-mono">
              {money(event.oldPrice, event.currency)} → {money(event.newPrice, event.currency)}
            </span>
          )}
          {isPrice && <span className="font-mono">{pct(event.deltaPct)}</span>}
          {event.kind === 'stockout' && <span>quedó sin unidades</span>}
          {event.kind === 'back_in_stock' && <span>volvió al catálogo</span>}
          {showTime && <span className="text-dim">{timeAgo(event.ts)}</span>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Estados vacios ---------------------------- */

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <p className="text-[13px] text-muted">{message}</p>
      {hint && <p className="max-w-sm text-[11px] text-dim">{hint}</p>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-muted" />
      {label ?? 'Cargando…'}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-up/10 px-3 py-2 text-[12px] text-up">{message}</div>
  );
}

/* ------------------------------ Toggle switch ----------------------------- */

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-brand' : 'bg-line',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-canvas transition-all',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </button>
      <span>
        <span className="block text-[13px] text-ink">{label}</span>
        {description && <span className="block text-[11px] text-dim">{description}</span>}
      </span>
    </label>
  );
}
