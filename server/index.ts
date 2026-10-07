import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { loadDb, getDb } from './store.ts';
import { api } from './routes.ts';
import { restartScheduler, runNow, stopScheduler } from './scheduler.ts';
import { runAutopilot } from './sim/autopilot.ts';
import { backfillNext, preloadHistory } from './sim/history.ts';

async function main(): Promise<void> {
  await loadDb();
  // El piloto decide con 7d/30d desde la primera corrida: precargar evita que
  // arranque degradado a 24h y contradiga sus propias decisiones al minuto.
  await preloadHistory();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', api);

  // Rutas /api inexistentes: 404 en JSON.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
  });

  // Frontend compilado (vite build -> dist/). En Render el mismo servicio
  // sirve la UI y la API; en dev no existe dist/ y Vite atiende el puerto 5173.
  const distDir = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(path.join(distDir, 'index.html'))) {
    app.use(express.static(distDir));
    // Fallback SPA: cualquier ruta no-/api devuelve index.html.
    app.use((req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(distDir, 'index.html'), (err) => {
        if (err) next(err);
      });
    });
  }

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

  // Piloto automático desde el primer paint: decide con lo que haya en vivo.
  try {
    const pilot = runAutopilot();
    console.log(
      `[server] piloto listo: ${pilot.investingCount}/4 invierten (${pilot.decisions.map((d) => `${d.horizon}:${d.action}`).join(', ')}).`,
    );
  } catch (err) {
    console.warn('[server] piloto inicial no disponible:', err);
  }

  // Histórico en background: gradual (1 moneda/turno, sin ráfagas ni 429)
  // y nunca bloquea ni rompe la demo.
  void backfillNext().then((filled) => {
    if (filled) {
      console.log(`[server] histórico iniciado: ${filled}.`);
      try {
        runAutopilot();
      } catch {
        /* la próxima corrida decide */
      }
    }
  });

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
