import clsx from 'clsx';
import {
  BellRing,
  Boxes,
  LayoutDashboard,
  Radio,
  Send,
  Settings2,
  Users,
} from 'lucide-react';
import type { TabId } from '../../hooks/useHashTab';
import { TABS } from '../../hooks/useHashTab';

const ICONS: Record<TabId, typeof LayoutDashboard> = {
  resumen: LayoutDashboard,
  productos: Boxes,
  perfiles: Users,
  alertas: BellRing,
  reporte: Send,
  config: Settings2,
};

const SUBTITLE: Record<TabId, string> = {
  resumen: 'Estado general del mercado y actividad del agente',
  productos: 'Precios actuales y variación contra la corrida anterior',
  perfiles: 'perfiles de trading con simulaci�n (presupuesto ficticio) basada en scraping y recomendaciones en lenguaje sencillo',
  alertas: 'Historial completo de cambios detectados',
  reporte: 'Generación y entrega del reporte diario',
  config: 'Intervalos, umbrales y canal de notificación',
};

export function Sidebar({
  tab,
  onChange,
  alertCount,
}: {
  tab: TabId;
  onChange: (tab: TabId) => void;
  alertCount: number;
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-surface md:flex">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <Radio size={16} className="shrink-0 text-brand/70" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium leading-tight text-ink">Agente de Precios</p>
          <p className="text-[10px] text-dim">Scraping &amp; monitoreo</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 p-2.5">
        {TABS.map((item) => {
          const Icon = ICONS[item.id];
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={clsx(
                'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] transition-colors',
                active
                  ? 'bg-raised font-medium text-ink'
                  : 'text-muted hover:bg-raised/50 hover:text-ink',
              )}
            >
              <Icon size={14} className={clsx('shrink-0', active ? 'text-brand' : 'text-dim')} />
              <span className="flex-1">{item.label}</span>
              {item.id === 'alertas' && alertCount > 0 && (
                <span className="rounded bg-up/15 px-1.5 py-0.5 text-[10px] font-medium text-up">
                  {alertCount > 99 ? '99+' : alertCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="space-y-2 px-4 py-3">
        <p className="text-[10px] leading-relaxed text-dim">
          Miniproyecto escolar. Vite + React + Tailwind con un agente de scraping en Node.
        </p>
      </div>
    </aside>
  );
}

export function MobileNav({ tab, onChange }: { tab: TabId; onChange: (tab: TabId) => void }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line-soft bg-surface px-2 py-1.5 md:hidden">
      {TABS.map((item) => {
        const Icon = ICONS[item.id];
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={clsx(
              'flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1.5 text-[12px] transition-colors',
              tab === item.id ? 'bg-raised text-ink' : 'text-muted hover:text-ink',
            )}
          >
            <Icon size={13} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

export { SUBTITLE };
