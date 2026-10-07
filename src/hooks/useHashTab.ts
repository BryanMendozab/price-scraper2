import { useEffect, useState } from 'react';

export type TabId = 'resumen' | 'productos' | 'simulador' | 'alertas' | 'piloto' | 'historial' | 'reporte' | 'config';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'productos', label: 'Productos' },
  { id: 'simulador', label: 'Simulador' },
  { id: 'alertas', label: 'Alertas' },
  { id: 'piloto', label: 'Piloto' },
  { id: 'historial', label: 'Historial' },
  { id: 'reporte', label: 'Reporte' },
  { id: 'config', label: 'Configuración' },
];

function readHash(): TabId {
  const hash = window.location.hash.replace('#', '') as TabId;
  return TABS.some((t) => t.id === hash) ? hash : 'resumen';
}

/** Sincroniza la pestana activa con el hash de la URL, para poder compartir links. */
export function useHashTab(): [TabId, (tab: TabId) => void] {
  const [tab, setTab] = useState<TabId>(readHash);

  useEffect(() => {
    const onChange = () => setTab(readHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const go = (next: TabId) => {
    window.location.hash = next;
    setTab(next);
  };

  return [tab, go];
}

export { TABS };
