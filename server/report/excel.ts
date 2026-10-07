import ExcelJS from 'exceljs';
import { getDb } from '../store.ts';
import { PILOT_BUDGET_MXN } from '../../shared/traders.ts';
import { dateTime } from '../format.ts';

const MXN_FMT = '"$"#,##0.00';
const PCT_FMT = '0.00"%"';

function header(ws: ExcelJS.Worksheet, titles: string[]): void {
  ws.addRow(titles);
  const row = ws.getRow(ws.rowCount);
  row.font = { bold: true };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B1C20' } };
}

/** Filtros de Excel sobre el encabezado (hasta la última fila con datos). */
function autofilter(ws: ExcelJS.Worksheet, headerRow: number): void {
  if (ws.rowCount <= headerRow) return;
  const lastCol = String.fromCharCode('A'.charCodeAt(0) + ws.columnCount - 1);
  ws.autoFilter = `A${headerRow}:${lastCol}${ws.rowCount}`;
}

/** Motivos internos en español plano, igual que en pantalla. */
function motive(note: string): string {
  const map: Record<string, string> = {
    'bajón fuerte': 'bajón fuerte',
    'bajón leve': 'bajón leve',
    'inversión inicial': 'inversión inicial',
    objetivo: 'objetivo cumplido',
    stop: 'stop de pérdida',
    'señal': 'se perdió la señal',
  };
  return map[note] ?? note;
}

/**
 * Reporte compacto en 3 hojas: resumen con posiciones, operaciones
 * con motivos claros y las alertas que sí llegaron al correo.
 */
export async function buildExcel(): Promise<Buffer> {
  const db = getDb();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Agente de precios';
  wb.created = new Date();

  // 1) Resumen: KPIs por cliente + total, y debajo las posiciones abiertas.
  const summary = wb.addWorksheet('Resumen');
  summary.addRow([`Reporte piloto · ${dateTime(new Date().toISOString())} · ${PILOT_BUDGET_MXN} por cliente (ficticio)`]);
  summary.addRow([]);
  const kpiHeader = summary.rowCount + 1;
  header(summary, ['Cliente', 'Presupuesto', 'Invertido', 'Efectivo', 'Valor actual', 'P&L MXN', 'P&L %', 'Realizado', 'Posiciones']);
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
  autofilter(summary, kpiHeader);

  summary.addRow([]);
  summary.addRow(['Posiciones abiertas']);
  const posHeader = summary.rowCount + 1;
  header(summary, ['Cliente', 'Moneda', 'Entrada MXN', 'Precio entrada', 'Valor actual', 'P&L MXN', 'P&L %', 'Plan de venta']);
  let openCount = 0;
  for (const w of db.wallets) {
    for (const p of w.positions) {
      summary.addRow([
        w.horizon,
        `${p.symbol}`,
        p.amountMxn,
        p.priceAt,
        p.valueNowMxn,
        p.pnlMxn,
        p.pnlPct / 100,
        p.plan.text,
      ]);
      openCount++;
    }
  }
  if (openCount === 0) summary.addRow(['(sin posiciones abiertas)']);
  summary.getColumn(8).width = 52;
  autofilter(summary, posHeader);
  summary.views = [{ state: 'frozen', ySplit: 3 }];

  // 2) Operaciones: la bitácora completa (máx 200), motivos en claro.
  const trades = wb.addWorksheet('Operaciones');
  header(trades, ['Fecha', 'Cliente', 'Lado', 'Moneda', 'Monto MXN', 'Precio MXN', 'P&L %', 'Motivo']);
  for (const t of [...db.trades].reverse()) {
    trades.addRow([
      dateTime(t.at),
      t.horizon,
      t.side === 'compra' ? 'Compra' : 'Venta',
      t.symbol,
      t.side === 'venta' && t.pnlPct !== null ? t.amountMxn * (1 + t.pnlPct / 100) : t.amountMxn,
      t.priceMxn,
      t.pnlPct !== null ? t.pnlPct / 100 : '',
      motive(t.note),
    ]);
  }
  trades.columns.forEach((c) => {
    c.width = 20;
  });
  trades.getColumn(1).width = 24;
  trades.getColumn(6).width = 32;
  for (const col of [5, 6]) trades.getColumn(col).numFmt = MXN_FMT;
  trades.getColumn(7).numFmt = PCT_FMT;
  autofilter(trades, 1);

  // 3) Alertas: las que sí llegaron al correo (movers email), recientes primero.
  const alerts = wb.addWorksheet('Alertas');
  header(alerts, ['Fecha', 'Moneda', 'Movimiento', 'Precio anterior', 'Precio nuevo', 'Variación %', 'Ventana']);
  const sent = [...db.moverAlerts].reverse().slice(0, 100);
  for (const m of sent) {
    alerts.addRow([
      dateTime(m.at),
      `${m.name} (${m.symbol})`,
      m.changePct >= 0 ? 'Subió' : 'Bajó',
      m.priceThen,
      m.priceNow,
      m.changePct / 100,
      `${m.minutes} min`,
    ]);
  }
  if (sent.length === 0) alerts.addRow(['(aún no se ha enviado ninguna alerta)']);
  alerts.columns.forEach((c) => {
    c.width = 20;
  });
  alerts.getColumn(2).width = 32;
  for (const col of [4, 5]) alerts.getColumn(col).numFmt = MXN_FMT;
  alerts.getColumn(6).numFmt = PCT_FMT;
  autofilter(alerts, 1);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
