import { useState } from 'react';
import clsx from 'clsx';
import { Code2, ExternalLink, Loader2, Plug } from 'lucide-react';
import type { StoreId, StoreSummary } from '../../../shared/types';
import { api } from '../../lib/api';
import { money, timeAgo } from '../../lib/format';
import { Chip, DeltaPill, Panel } from '../ui';

type TestResult = {
  ok: boolean;
  durationMs: number;
  itemCount: number;
  error: string | null;
  sample: Array<{ title: string; price: number; currency: string; availability: string }>;
};

function SourceCard({ store }: { store: StoreSummary }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.testStore(store.id as StoreId));
    } catch (err) {
      setResult({
        ok: false,
        durationMs: 0,
        itemCount: 0,
        error: err instanceof Error ? err.message : 'Error desconocido',
        sample: [],
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="panel flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-line-soft px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold">{store.name}</h3>
            <Chip tone={store.kind === 'html' ? 'warn' : 'brand'}>
              {store.kind === 'html' ? (
                <>
                  <Code2 size={10} /> HTML + Cheerio
                </>
              ) : (
                'API JSON'
              )}
            </Chip>
          </div>
          <p className="mt-0.5 text-[11px] text-muted">{store.description}</p>
        </div>
        {store.lastRun && (
          <span
            className={clsx(
              'mt-1 h-2 w-2 shrink-0 rounded-full',
              store.lastRun.ok ? 'bg-down' : 'bg-up',
            )}
            title={store.lastRun.ok ? 'Operativa' : store.lastRun.error ?? 'Con error'}
          />
        )}
      </div>

      <div className="grid grid-cols-3 gap-px border-b border-line-soft bg-line-soft">
        {[
          ['Productos', String(store.products)],
          ['Precio medio', store.avgPrice !== null ? money(store.avgPrice, store.currency) : '—'],
          ['Sin stock', String(store.outOfStock)],
        ].map(([label, value]) => (
          <div key={label} className="bg-surface px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wider text-dim">{label}</p>
            <p className="mt-0.5 truncate font-mono text-[13px] tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[11px] text-muted">
        <span>
          Variación media: <DeltaPill value={store.avgPriceDeltaPct} />
        </span>
        <span>Última pasada: {timeAgo(store.lastRun?.at ?? null)}</span>
        {store.lastRun && <span>{store.lastRun.durationMs} ms</span>}
      </div>

      <div className="mt-auto space-y-2 border-t border-line-soft px-4 py-3">
        {store.lastRun?.error && (
          <p className="rounded bg-up/12 px-2 py-1.5 text-[11px] text-up">
            {store.lastRun.error}
          </p>
        )}

        {result && (
          <div
            className={clsx(
              'rounded px-2.5 py-2 text-[11px]',
              result.ok ? 'bg-down/12' : 'bg-up/12',
              result.ok ? 'text-down' : 'text-up',
            )}
          >
            {result.ok ? (
              <>
                <p>
                  Conexión OK · {result.itemCount} ítems en {result.durationMs} ms
                </p>
                <ul className="mt-1 space-y-0.5 text-muted">
                  {result.sample.map((item, i) => (
                    <li key={i} className="truncate">
                      • {item.title} — {money(item.price, item.currency)}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>Falló: {result.error}</p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button className="btn btn-xs" onClick={() => void test()} disabled={testing}>
            {testing ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
            {testing ? 'Probando…' : 'Probar conexión'}
          </button>
          <a
            className="btn btn-xs"
            href={store.homepage}
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLink size={12} /> Ver sitio
          </a>
        </div>
      </div>
    </div>
  );
}

export function SourcesView({ stores }: { stores: StoreSummary[] }) {
  return (
    <div className="space-y-4">
      <Panel
        title="Fuentes de datos"
        subtitle="Agregar una tienda nueva es sumar un módulo en server/sources y una entrada en el registro"
      >
        <p className="text-[12px] leading-relaxed text-muted">
          El agente extrae precios de {stores.length} fuentes usando requests HTTP desde Node, no
          desde el navegador: así no dependemos de CORS ni de las protecciones anti-bot del cliente.
          La librería Anglo se raspa del HTML con Cheerio. Mercado cripto y Mercado eléctrico
          consultan APIs públicas (CoinGecko y ESIOS/Red Eléctrica).
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {stores.map((store) => (
          <SourceCard key={store.id} store={store} />
        ))}
      </div>
    </div>
  );
}
