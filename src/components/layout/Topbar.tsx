import { useEffect, useState } from 'react';
import { Radar } from 'lucide-react';
import type { CrawlerState } from '../../../shared/types';
import { countdown } from '../../lib/format';

/** Cuenta regresiva local: la del servidor llega cada 5s, esto la hace fluida. */
function useTicker(crawler: CrawlerState | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!crawler?.nextRunAt) return null;
  return Math.max(0, Math.round((Date.parse(crawler.nextRunAt) - now) / 1000));
}

export function Topbar({
  title,
  subtitle,
  crawler,
  onRunNow,
  pending,
}: {
  title: string;
  subtitle: string;
  crawler: CrawlerState | undefined;
  onRunNow: () => void;
  pending: boolean;
}) {
  const seconds = useTicker(crawler);

  return (
    <header className="border-b border-line-soft bg-surface">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-medium tracking-tight">{title}</h1>
          <p className="truncate text-[11px] text-dim">{subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          {crawler?.autoScrape && (
            <span className="hidden items-center gap-1.5 rounded bg-raised px-2.5 py-1.5 text-[11px] text-muted md:inline-flex">
              Próxima corrida
              <span className="font-mono text-brand">{countdown(seconds)}</span>
            </span>
          )}

          <button className="btn btn-primary btn-xs" onClick={onRunNow} disabled={pending}>
            <Radar size={13} />
            {pending ? 'Ejecutando…' : 'Ejecutar ahora'}
          </button>
        </div>
      </div>
    </header>
  );
}
