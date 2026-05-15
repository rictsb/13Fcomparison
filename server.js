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
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// APIs
app.get('/api/edgar', edgarHandler);
app.get('/api/prices', pricesHandler);

// Static files (index.html, data.json, AI_Hedge_Funds_13F_Tracker.xlsx)
app.use(express.static(__dirname, {
  // index.html should never be cached so a re-deploy is picked up immediately;
  // data.json gets aggressive caching but cache-busts via the ?v= query param.
  setHeaders: (res, path) => {
    if (path.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store');
    else if (path.endsWith('data.json')) res.setHeader('Cache-Control', 'public, max-age=300');
  },
}));

// Health check (Render pings this)
app.get('/healthz', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`13F Tracker listening on http://localhost:${PORT}`);
});
