import { useEffect, useMemo, useState } from 'react';
import { Download, Search, X } from 'lucide-react';
import { api, type ProductRow } from '../../lib/api';
import { money, num } from '../../lib/format';
import { DeltaPill, EmptyState, ErrorNote, Spinner, Sparkline } from '../ui';

type SortKey = 'title' | 'price' | 'change10mPct';

const COLUMNS: Array<{ key: SortKey; label: string; className?: string }> = [
  { key: 'title', label: 'Moneda' },
  { key: 'price', label: 'Precio MXN', className: 'text-right' },
  { key: 'change10mPct', label: 'Cambio 10 min', className: 'text-right' },
];

/** "Bitcoin (BTC/MXN)" -> "Bitcoin (BTC)": toda la página ya es MXN. */
function shortTitle(title: string): string {
  return title.replace('/MXN', '');
}

export function ProductsView() {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState<SortKey>('change10mPct');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api.products({ q: term });
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
  }, [term]);

  /** Orden local: el cambio se ordena por magnitud (los que más se movieron primero). */
  const display = useMemo(() => {
    const direction = dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      if (sort === 'title') return a.product.title.localeCompare(b.product.title) * direction;
      if (sort === 'price') return (a.product.price - b.product.price) * direction;
      const av = Math.abs(a.change10mPct ?? -Infinity);
      const bv = Math.abs(b.change10mPct ?? -Infinity);
      return (av - bv) * direction;
    });
  }, [rows, sort, dir]);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      setDir(key === 'title' ? 'asc' : 'desc');
    }
  };

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input
            className="input pl-9"
            placeholder="Buscar moneda…"
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

        <span className="text-[12px] text-muted">{num(rows.length)} monedas</span>

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
          <EmptyState message="No hay monedas que coincidan con el filtro." />
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
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
                  <th className="th">Tendencia</th>
                </tr>
              </thead>
              <tbody>
                {display.map((row) => (
                  <tr
                    key={`${row.storeId}-${row.product.id}`}
                    className="border-t border-line-soft hover:bg-raised/40"
                  >
                    <td className="td font-medium">{shortTitle(row.product.title)}</td>
                    <td className="td text-right font-mono tabular-nums">
                      {money(row.product.price, row.product.currency)}
                    </td>
                    <td className="td text-right">
                      <DeltaPill value={row.change10mPct} />
                    </td>
                    <td className="td">
                      <Sparkline values={row.series} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line-soft px-4 py-2 text-[10px] text-dim">
            <span>Ordenado por movimiento (los que más se movieron primero)</span>
            <span>La tendencia muestra las últimas 16 corridas</span>
          </div>
        </div>
      )}
    </div>
  );
}
