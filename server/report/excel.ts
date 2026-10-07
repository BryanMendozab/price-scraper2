import ExcelJS from 'exceljs';
import { getDb } from '../store.ts';
import { dateTime, money } from '../format.ts';

function header(ws: ExcelJS.Worksheet, titles: string[]): void {
  ws.addRow(titles);
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B1C20' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/**
 * Exporta lo más importante a Excel: billeteras con posiciones y planes,
 * operaciones del piloto y alertas relevantes. Sin ruido.
 */
export async function buildExcel(): Promise<Buffer> {
  const db = getDb();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Agente de precios';
  wb.created = new Date();

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

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
