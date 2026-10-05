import { useEffect, useMemo, useState } from 'react';
import { Download, Search, X } from 'lucide-react';
import type { StoreSummary } from '../../../shared/types';
import { api, type ProductRow } from '../../lib/api';
import { money, num, pct } from '../../lib/format';
import { Chip, DeltaPill, EmptyState, ErrorNote, Spinner, Sparkline } from '../ui';

type SortKey = 'title' | 'price' | 'deltaPct' | 'delta' | 'storeName';

const COLUMNS: Array<{ key: SortKey; label: string; className?: string }> = [
  { key: 'title', label: 'Producto' },
  { key: 'storeName', label: 'Tienda' },
  { key: 'price', label: 'Precio', className: 'text-right' },
  { key: 'deltaPct', label: 'vs. corrida anterior', className: 'text-right' },
];

const AVAILABILITY = {
  in_stock: { label: 'Disponible', className: 'text-down' },
  out_of_stock: { label: 'Sin stock', className: 'text-warn' },
  unknown: { label: 'No publicado', className: 'text-dim' },
} as const;

export function ProductsView({ stores }: { stores: StoreSummary[] }) {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [store, setStore] = useState('all');
  const [sort, setSort] = useState<SortKey>('deltaPct');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api.products({ store, q: term, sort, dir });
        if (!alive) return;
        setRows(data.rows);
        setError(null);
      } catch {
        if (alive) setError('No se pudieron cargar los productos.');
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const id = setInterval(() => void load(), 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [store, term, sort, dir]);

  const grouped = useMemo(() => {
    const byStore = new Map<string, ProductRow[]>();
    for (const row of rows) {
      const bucket = byStore.get(row.storeName) ?? [];
      bucket.push(row);
      byStore.set(row.storeName, bucket);
    }
    return [...byStore.entries()];
  }, [rows]);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      setDir(key === 'title' || key === 'storeName' ? 'asc' : 'asc');
    }
  };

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input
            className="input pl-9"
            placeholder="Buscar producto, categoría o tienda…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          {term && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-dim hover:text-ink"
              onClick={() => setTerm('')}
            >
              <X size={13} />
            </button>
          )}
        </div>

        <select className="input w-auto" value={store} onChange={(e) => setStore(e.target.value)}>
          <option value="all">Todas las tiendas</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <span className="text-[12px] text-muted">{num(rows.length)} productos</span>

        <a className="btn btn-xs" href="/api/export.csv" download>
          <Download size={13} />
          CSV
        </a>
      </div>

      {error && <ErrorNote message={error} />}
      {loading && rows.length === 0 ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="panel">
          <EmptyState message="No hay productos que coincidan con el filtro." />
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="border-b border-line-soft bg-raised/40">
                <tr>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={`th cursor-pointer select-none hover:text-muted ${col.className ?? ''}`}
                      onClick={() => toggleSort(col.key)}
                    >
                      {col.label}
                      {sort === col.key && <span className="ml-1 text-brand">{dir === 'asc' ? '▲' : '▼'}</span>}
                    </th>
                  ))}
                  <th className="th text-right">Stock</th>
                  <th className="th">Tendencia</th>
                </tr>
              </thead>
              {grouped.map(([storeName, items]) => (
                <tbody key={storeName}>
                  <tr className="bg-canvas/60">
                    <td colSpan={6} className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-dim">
                      {storeName} · {items.length} productos
                    </td>
                  </tr>
                  {items.map((row) => {
                    const availability = AVAILABILITY[row.product.availability];
                    return (
                      <tr
                        key={`${row.storeId}-${row.product.id}`}
                        className="border-t border-line-soft hover:bg-raised/40"
                      >
                        <td className="td">
                          <div className="flex items-center gap-2.5">
                            {row.product.image && (
                              <img
                                src={row.product.image}
                                alt=""
                                loading="lazy"
                                className="h-8 w-8 shrink-0 rounded bg-canvas object-contain"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            )}
                            <div className="min-w-0">
                              <p className="truncate font-medium">{row.product.title}</p>
                              <p className="truncate text-[10px] text-dim">
                                {row.product.category}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="td text-[12px] text-muted">{row.storeName}</td>
                        <td className="td text-right font-mono tabular-nums">
                          {money(row.product.price, row.product.currency)}
                          {row.delta !== null && (
                            <span
                              className={`ml-1.5 text-[10px] ${
                                row.delta > 0 ? 'text-up' : row.delta < 0 ? 'text-down' : 'text-dim'
                              }`}
                            >
                              {row.delta > 0 ? '+' : ''}
                              {row.delta.toFixed(2)}
                            </span>
                          )}
                        </td>
                        <td className="td text-right">
                          <DeltaPill value={row.deltaPct} />
                        </td>
                        <td className="td text-right">
                          <span className={availability.className}>
                            {availability.label}
                            {row.product.stock !== null && row.product.stock > 0 && (
                              <span className="ml-1 font-mono text-[10px] text-dim">
                                ({row.product.stock})
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="td">
                          <Sparkline values={row.series} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line-soft px-4 py-2 text-[10px] text-dim">
            <span>Ordenado por {sort} ({dir === 'asc' ? 'ascendente' : 'descendente'})</span>
            <span>La tendencia muestra las últimas 16 corridas</span>
          </div>
        </div>
      )}
    </div>
  );
}

export { pct, Chip };
