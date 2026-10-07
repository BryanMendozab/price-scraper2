import { useDashboard } from './hooks/useDashboard';
import { useHashTab, TABS } from './hooks/useHashTab';
import { MobileNav, Sidebar, SUBTITLE } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { OverviewView } from './components/dashboard/OverviewView';
import { ProductsView } from './components/products/ProductsView';
import { ProfilesView } from './components/profiles/ProfilesView';
import { SimView } from './components/sim/SimView';
import { AlertsView } from './components/alerts/AlertsView';
import { ReportView } from './components/report/ReportView';
import { SettingsView } from './components/settings/SettingsView';
import { ErrorNote } from './components/ui';

export default function App() {
  const [tab, goTo] = useHashTab();
  const { data, loading, error, refresh } = useDashboard();
  const stores = data?.stores ?? [];
  const title = TABS.find((t) => t.id === tab)?.label ?? 'Resumen';

  return (
    <div className="flex h-full">
      <Sidebar tab={tab} onChange={goTo} alertCount={data?.kpis.events24h ?? 0} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} subtitle={SUBTITLE[tab]} />
        <MobileNav tab={tab} onChange={goTo} />

        <main className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-[1400px]">
            {tab === 'resumen' && (
              <OverviewView data={data} loading={loading} error={error} onGoToAlerts={() => goTo('alertas')} />
            )}
            {tab === 'productos' && <ProductsView stores={stores} />}
            {tab === 'perfiles' && <ProfilesView />}
            {tab === 'simulador' && <SimView />}
            {tab === 'alertas' && <AlertsView stores={stores} />}
            {tab === 'reporte' && <ReportView onSent={() => void refresh()} />}
            {tab === 'config' && <SettingsView onSaved={() => void refresh()} />}
          </div>
        </main>
      </div>

      {error && !data && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2">
          <ErrorNote message={error} />
        </div>
      )}
    </div>
  );
}