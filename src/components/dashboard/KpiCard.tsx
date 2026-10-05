import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { Panel } from '../ui';

type Tone = 'brand' | 'up' | 'down' | 'warn' | 'muted';

const TONE_TEXT: Record<Tone, string> = {
  brand: 'text-brand',
  up: 'text-up',
  down: 'text-down',
  warn: 'text-warn',
  muted: 'text-ink',
};

export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'muted',
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
  tone?: Tone;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      onClick={onClick}
      className={clsx(
        'panel px-4 py-3.5 text-left transition-colors',
        onClick && 'hover:bg-raised',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-dim">{label}</span>
        {Icon && <Icon size={14} className="shrink-0 text-dim" />}
      </div>
      <p
        className={clsx(
          'mt-2 text-2xl font-medium tabular-nums tracking-tight',
          TONE_TEXT[tone],
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-dim">{sub}</p>}
    </Tag>
  );
}

export { Panel };
