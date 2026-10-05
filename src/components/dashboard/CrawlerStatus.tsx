import { Activity, Radio, Timer, Zap } from 'lucide-react';
import type { CrawlerState } from '../../../shared/types';
import { countdown, dateTime, timeAgo } from '../../lib/format';
import { Chip } from '../ui';

/** Estado del crawler: si esta corriendo, cuando fue la ultima pasada y cuando viene la siguiente. */
export function CrawlerStatus({ crawler }: { crawler: CrawlerState }) {
  const active = crawler.autoScrape && !crawler.running;

  return (
    <div className="panel px-4 py-3">
      <div className="flex items-center gap-2">
        <span
          className={
            crawler.running
              ? 'h-2 w-2 rounded-full bg-warn pulse-dot'
              : active
                ? 'h-2 w-2 rounded-full bg-down pulse-dot'
                : 'h-2 w-2 rounded-full bg-dim'
          }
        />
        <span className="text-[13px] font-semibold text-ink">
          {crawler.running
            ? 'Raspar ahora…'
            : crawler.autoScrape
              ? 'Agente activo'
              : 'Agente en pausa'}
        </span>
        {crawler.running ? (
          <Chip tone="warn">ejecutando</Chip>
        ) : active ? (
          <Chip tone="live">monitoreando</Chip>
        ) : (
          <Chip>detenido</Chip>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
        <div className="flex items-center gap-1.5 text-dim">
          <Timer size={12} />
          <span>Última pasada</span>
          <span className="ml-auto text-muted">{timeAgo(crawler.lastRunAt)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-dim">
          <Activity size={12} />
          <span>Próxima</span>
          <span className="ml-auto text-muted">
            {crawler.autoScrape ? countdown(crawler.secondsToNextRun) : '—'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-dim">
          <Radio size={12} />
          <span>Intervalo</span>
          <span className="ml-auto text-muted">{crawler.intervalSeconds}s</span>
        </div>
        <div className="flex items-center gap-1.5 text-dim">
          <Zap size={12} />
          <span>Total corridas</span>
          <span className="ml-auto text-muted">{crawler.totalRuns}</span>
        </div>
      </div>

      {crawler.lastRunAt && (
        <p className="mt-2.5 truncate border-t border-line-soft pt-2 text-[10px] text-dim">
          Última corrida completa: {dateTime(crawler.lastRunAt)}
        </p>
      )}
    </div>
  );
}
