import express from 'express';
import cors from 'cors';
import { config } from './config.ts';
import { loadDb, getDb } from './store.ts';
import { api } from './routes.ts';
import { restartScheduler, runNow, stopScheduler } from './scheduler.ts';

async function main(): Promise<void> {
  await loadDb();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', api);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
  });

  const server = app.listen(config.port, () => {
    const { intervalSeconds, autoScrape } = getDb().settings;
    console.log(`[server] agente de scraping escuchando en http://localhost:${config.port}`);
    console.log(
      `[server] scraping automatico ${autoScrape ? `cada ${intervalSeconds}s` : 'desactivado'}`,
    );
  });

  // Primer scraping al arrancar: si no, el dashboard aparece vacio.
  console.log('[server] primer scraping en curso...');
  const first = await runNow('startup');
  if ('skipped' in first) {
    console.log('[server] el scraping inicial fue omitido.');
  } else {
    const { run, newEvents, failures } = first;
    console.log(
      `[server] scraping inicial: ${run.okCount} fuentes ok, ${run.failCount} con error, ` +
        `${run.itemCount} productos, ${newEvents.length} eventos nuevos.`,
    );
    for (const failure of failures) {
      console.warn(`[server]   ${failure.storeId}: ${failure.error}`);
    }
  }

  restartScheduler();

  const shutdown = (signal: string) => {
    console.log(`\n[server] ${signal} recibido, cerrando...`);
    stopScheduler();
    server.close(() => process.exit(0));
    // Si algun request queda colgado, no esperamos indefinidamente.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] fallo al arrancar:', err);
  process.exit(1);
});
