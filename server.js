// Render-compatible Express server.
//
// Render serves everything through one Web Service, so we host the static
// frontend AND the /api/edgar endpoint from the same Node process.
//
// The same `api/edgar.js` handler runs unmodified on Vercel as a serverless
// function — Vercel's (req, res) signature is API-compatible with Express.

import express from 'express';
import edgarHandler from './api/edgar.js';
import pricesHandler from './api/prices.js';
import searchHandler from './api/search.js';
import { createBoardsProxy } from './api/earnings-boards.js';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

export function createApp({ boardsProxyOptions, earningsDirectory = join(__dirname, 'earnings', 'out') } = {}) {
  const app = express();

  // Preserve the existing 13F API paths and Render health check.
  app.get('/api/edgar', edgarHandler);
  app.get('/api/prices', pricesHandler);
  app.get('/api/search', searchHandler);
  app.get('/healthz', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  // API comes before the exported earnings assets. Unknown API paths stay 404;
  // they must never fall back to a page or expose application source files.
  app.use('/earnings-tracker/api/boards', createBoardsProxy(boardsProxyOptions));
  app.use('/earnings-tracker/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use('/earnings-tracker', express.static(earningsDirectory, {
    setHeaders: (res, path) => {
      if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    },
  }));

  // Serve only the original public files. Serving the whole repository would
  // expose the new earnings source and other server implementation files.
  app.get(['/', '/index.html'], (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(join(__dirname, 'index.html'));
  });
  app.get('/data.json', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.sendFile(join(__dirname, 'data.json'));
  });
  app.get('/AI_Hedge_Funds_13F_Tracker.xlsx', (_req, res) => {
    res.sendFile(join(__dirname, 'AI_Hedge_Funds_13F_Tracker.xlsx'));
  });

  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApp().listen(PORT, () => {
    console.log(`13F Tracker listening on http://localhost:${PORT}`);
  });
}
