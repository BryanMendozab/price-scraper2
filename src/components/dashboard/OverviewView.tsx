import type { DashboardData } from '../../../shared/types';
import { ErrorNote, Eyebrow, Spinner } from '../ui';
import { TrendChart } from './TrendChart';

export function OverviewView({
  data,
  loading,
  error,
}: {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  onGoToAlerts?: () => void;
  onGoToPilot?: () => void;
}) {
  if (loading && !data) return <Spinner label="Conectando con el agente" />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;

  return (
    <div className="flex min-h-[calc(100dvh-2.5rem)] flex-col">
      {error && <ErrorNote message={error} />}
      <Eyebrow>Tendencia</Eyebrow>
      <div className="mt-2 h-[calc(100dvh-10rem)] min-h-[420px]">
        <TrendChart bare fill />
      </div>
    </div>
  );
}
