import ExcelJS from 'exceljs';
import { getDb } from '../store.ts';
import { PILOT_BUDGET_MXN } from '../../shared/traders.ts';
import { dateTime, money } from '../format.ts';

const MXN_FMT = '"$"#,##0.00';
const PCT_FMT = '0.00"%"';

function header(ws: ExcelJS.Worksheet, titles: string[]): void {
  ws.addRow(titles);
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B1C20' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/** Filtros de Excel sobre el encabezado (hasta la última fila con datos). */
function autofilter(ws: ExcelJS.Worksheet): void {
  if (ws.rowCount < 2) return;
  const lastCol = String.fromCharCode('A'.charCodeAt(0) + ws.columnCount - 1);
  ws.autoFilter = `A1:${lastCol}${ws.rowCount}`;
}

const ACTION_ES: Record<string, string> = {
  invertir: 'Invertir',
  acumular: 'Acumular',
  esperar: 'Esperar',
  evitar: 'Evitar',
};

/**
 * Exporta lo más importante a Excel: resumen del piloto, decisiones vigentes,
 * billeteras con posiciones y planes, operaciones del piloto y alertas
 * relevantes. Sin ruido.
 */
export async function buildExcel(): Promise<Buffer> {
  const db = getDb();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Agente de precios';
  wb.created = new Date();

  // Resumen: KPIs por cliente + total (dinero ficticio, $10.000 por cliente).
  const summary = wb.addWorksheet('Resumen');
  summary.addRow([`Reporte piloto · ${dateTime(new Date().toISOString())} · presupuesto $${PILOT_BUDGET_MXN} por cliente (ficticio)`]);
  summary.addRow([]);
  header(summary, ['Cliente', 'Presupuesto', 'Invertido', 'Efectivo', 'Valor actual', 'P&L MXN', 'P&L %', 'Realizado', 'Posiciones abiertas']);
  const totals = { budget: 0, invested: 0, cash: 0, value: 0, pnl: 0, realized: 0, positions: 0 };
  for (const w of db.wallets) {
    summary.addRow([
      w.horizon,
      w.budgetMxn,
      w.investedMxn,
      w.cashMxn,
      w.valueNowMxn,
      w.pnlMxn,
      w.pnlPct / 100,
      w.realizedMxn,
      w.positions.length,
    ]);
    totals.budget += w.budgetMxn;
    totals.invested += w.investedMxn;
    totals.cash += w.cashMxn;
    totals.value += w.valueNowMxn;
    totals.pnl += w.pnlMxn;
    totals.realized += w.realizedMxn;
    totals.positions += w.positions.length;
  }
  const totalRow = summary.addRow([
    'TOTAL',
    totals.budget,
    totals.invested,
    totals.cash,
    totals.value,
    totals.pnl,
    totals.budget > 0 ? totals.pnl / totals.budget : 0,
    totals.realized,
    totals.positions,
  ]);
  totalRow.font = { bold: true };
  for (const col of [2, 3, 4, 5, 6, 8]) summary.getColumn(col).numFmt = MXN_FMT;
  summary.getColumn(7).numFmt = PCT_FMT;
  summary.columns.forEach((c) => {
    c.width = 18;
  });
  summary.getColumn(1).width = 24;

  // Decisiones vigentes: qué decidió cada cliente y por qué.
  const decisions = wb.addWorksheet('Decisiones');
  header(decisions, ['Cliente', 'Acción', 'Moneda', 'Monto MXN', 'Precio ref.', 'Razón', 'Hora']);
  for (const d of db.decisions) {
    decisions.addRow([
      d.horizon,
      ACTION_ES[d.action] ?? d.action,
      `${d.symbol}`,
      d.amountMxn,
      d.priceAt ?? '',
      d.reason,
      dateTime(d.at),
    ]);
  }
  decisions.getColumn(4).numFmt = MXN_FMT;
  decisions.getColumn(5).numFmt = MXN_FMT;
  decisions.columns.forEach((c) => {
    c.width = 18;
  });
  decisions.getColumn(3).width = 12;
  decisions.getColumn(6).width = 60;
  decisions.getColumn(7).width = 24;
  autofilter(decisions);

  // Billeteras: una fila por posición + totales por cliente.
  const wallets = wb.addWorksheet('Billeteras');
  header(wallets, ['Cliente', 'Moneda', 'Entrada MXN', 'Precio entrada', 'Valor actual', 'P&L MXN', 'P&L %', 'Plan de venta']);
  for (const w of db.wallets) {
    for (const p of w.positions) {
      wallets.addRow([
        w.horizon,
        `${p.symbol}`,
        p.amountMxn,
        p.priceAt,
        p.valueNowMxn,
        p.pnlMxn,
        p.pnlPct,
        p.plan.text,
      ]);
    }
    wallets.addRow([
      `${w.horizon} · total`,
      `${w.positions.length} posiciones · ${money(w.cashMxn, 'MXN')} libre`,
      w.investedMxn,
      '',
      w.valueNowMxn,
      w.pnlMxn,
      w.pnlPct,
      `Realizado: ${money(w.realizedMxn, 'MXN')}${w.lastExit ? ` · ${w.lastExit}` : ''}`,
    ]);
  }
  wallets.columns.forEach((c) => {
    c.width = 22;
  });
  wallets.getColumn(8).width = 52;
  for (const col of [3, 4, 5, 6]) wallets.getColumn(col).numFmt = MXN_FMT;
  wallets.getColumn(7).numFmt = PCT_FMT;
  autofilter(wallets);

  // Operaciones: la bitácora completa (máx 200).
  const trades = wb.addWorksheet('Operaciones');
  header(trades, ['Fecha', 'Cliente', 'Lado', 'Moneda', 'Monto MXN', 'Precio MXN', 'P&L %', 'Motivo']);
  for (const t of [...db.trades].reverse()) {
    trades.addRow([
      dateTime(t.at),
      t.horizon,
      t.side === 'compra' ? 'Compra' : 'Venta',
      t.symbol,
      t.amountMxn,
      t.priceMxn,
      t.pnlPct ?? '',
      t.note,
    ]);
  }
  trades.columns.forEach((c) => {
    c.width = 20;
  });
  trades.getColumn(1).width = 24;
  for (const col of [5, 6]) trades.getColumn(col).numFmt = MXN_FMT;
  trades.getColumn(7).numFmt = PCT_FMT;
  autofilter(trades);

  // Alertas importantes: solo precio medium/high, recientes primero.
  const alerts = wb.addWorksheet('Alertas');
  header(alerts, ['Fecha', 'Moneda', 'Movimiento', 'Precio anterior', 'Precio nuevo', 'Variación %', 'Severidad']);
  const important = db.events
    .filter(
      (e) =>
        (e.kind === 'price_up' || e.kind === 'price_down') &&
        (e.severity === 'high' || e.severity === 'medium'),
    )
    .slice(-100)
    .reverse();
  for (const e of important) {
    alerts.addRow([
      dateTime(e.ts),
      e.title,
      e.kind === 'price_up' ? 'Subió' : 'Bajó',
      e.oldPrice ?? '',
      e.newPrice ?? '',
      e.deltaPct ?? '',
      e.severity,
    ]);
  }
  alerts.columns.forEach((c) => {
    c.width = 20;
  });
  alerts.getColumn(2).width = 32;
  for (const col of [4, 5]) alerts.getColumn(col).numFmt = MXN_FMT;
  alerts.getColumn(6).numFmt = PCT_FMT;
  autofilter(alerts);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
