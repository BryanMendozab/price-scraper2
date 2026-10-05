import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardData } from '../../shared/types';
import { api, ApiError } from '../lib/api';

/** Sondea el dashboard. 5s alcanza para ver moverse la demo sin castigar la API. */
export function useDashboard(pollMs = 5000) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number>(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await api.dashboard();
      setData(next);
      setError(null);
      setFetchedAt(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo contactar al servidor.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  return { data, loading, error, refresh, fetchedAt };
}

/**
 * Envoltorio para botones que disparan acciones (scraping, envio, etc):
 * trackea el estado pendiente y el ultimo error para poder mostrarlo.
 */
export function useAction<T>(action: () => Promise<T>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<T | null>(null);

  const run = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const value = await action();
      setResult(value);
      return value;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ocurrio un error inesperado.');
      return null;
    } finally {
      setPending(false);
    }
  }, [action]);

  return { run, pending, error, result, reset: () => setError(null) };
}
