// /api/prices?tickers=NVDA,TSM,...
//
// Returns the current (intraday) close price per ticker, via Finnhub's free
// /quote endpoint. The dashboard combines this with the historical
// "since" close baked into data.json (see scripts/refresh_prices.mjs) to
// compute "% since reporting date" per holding.
//
// Why split it that way: historical candles are a paid Finnhub endpoint,
// and Yahoo's chart API rate-limits aggressively from shared cloud IPs.
// Baking historicals via the script keeps the live endpoint cheap (1 call
// per ticker per page load), and historicals don't move anyway.
//
// Caching:
//   - Per-ticker quote cached 5 min.
//   - Memory resets on deploy / cold start.

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const latestCache = new Map();   // "TICKER" -> { price, asOf, fetchedAt }
const LATEST_TTL_MS = 5 * 60 * 1000;

const isResolvableTicker = (t) => /^[A-Z][A-Z0-9.\-]{0,6}$/.test(t || '');
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

async function finnhubQuote(ticker) {
  if (!FINNHUB_KEY) throw new Error('FINNHUB_API_KEY not set');
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Finnhub ${r.status}`);
  const d = await r.json();
  if (!d.c || d.c === 0) throw new Error('empty quote');
  return { price: d.c, asOf: d.t ? ymd(d.t * 1000) : ymd(Date.now()) };
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try { out[i] = await fn(items[i]); }
      catch (e) { out[i] = { error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!FINNHUB_KEY) {
    res.status(500).json({ error: 'Server missing FINNHUB_API_KEY env var' });
    return;
  }
  const tickersRaw = (req.query?.tickers || '').toString();
  const tickers = [...new Set(tickersRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))];
  if (!tickers.length) {
    res.status(400).json({ error: 'Required: tickers (comma-sep)' });
    return;
  }
  const resolvable = tickers.filter(isResolvableTicker);
  const skipped = tickers.filter(t => !isResolvableTicker(t));

  const results = await mapWithConcurrency(resolvable, 6, async (t) => {
    const hit = latestCache.get(t);
    if (hit && (Date.now() - hit.fetchedAt) < LATEST_TTL_MS) {
      return { ticker: t, price: hit.price, asOf: hit.asOf, cached: true };
    }
    const q = await finnhubQuote(t);
    latestCache.set(t, { price: q.price, asOf: q.asOf, fetchedAt: Date.now() });
    return { ticker: t, price: q.price, asOf: q.asOf };
  });

  const prices = {};
  const errors = [];
  for (let i = 0; i < resolvable.length; i++) {
    const r = results[i];
    if (r && !r.error) prices[r.ticker] = { price: r.price, asOf: r.asOf };
    else errors.push({ ticker: resolvable[i], error: r?.error || 'unknown' });
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({
    fetchedAt: new Date().toISOString(),
    prices, errors, skipped,
  });
}
