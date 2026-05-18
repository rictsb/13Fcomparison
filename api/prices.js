// /api/prices?tickers=NVDA,TSM,...
//
// Returns pre-computed price returns from Finnhub for each ticker, plus the
// current quote. The dashboard maps these to "% since reporting date":
//
//   - Q1 2026 funds (period 2026-03-31): use 13-week return (proxy — actual
//     elapsed time since Q1-end is ~7 weeks; 13W is the closest free metric).
//   - Q4 2025 funds (period 2025-12-31): use 26-week return (actual elapsed
//     time is ~20 weeks).
//
// Why this instead of fetching historical candles directly: Finnhub's
// /stock/candle endpoint requires a paid plan. /quote and /stock/metric
// are both on the free tier and give us enough to compute meaningful
// since-report returns.
//
// Server caches each ticker's metric block for 10 min to stay well under
// Finnhub's 60 req/min free-tier limit.

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const cache = new Map();             // TICKER -> { data, fetchedAt }
const CACHE_TTL_MS = 10 * 60 * 1000;

const isResolvableTicker = (t) => /^[A-Z][A-Z0-9.\-]{0,6}$/.test(t || '');
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

async function fetchTickerData(ticker) {
  if (!FINNHUB_KEY) throw new Error('FINNHUB_API_KEY not set');
  const cached = cache.get(ticker);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) return cached.data;

  const [quoteR, metricR] = await Promise.all([
    fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`),
    fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${FINNHUB_KEY}`),
  ]);
  if (!quoteR.ok) throw new Error(`Finnhub quote ${quoteR.status}`);
  if (!metricR.ok) throw new Error(`Finnhub metric ${metricR.status}`);
  const quote = await quoteR.json();
  const metric = await metricR.json();
  if (!quote.c) throw new Error('empty quote');

  const m = metric.metric || {};
  const data = {
    price: quote.c,
    asOf: quote.t ? ymd(quote.t * 1000) : ymd(Date.now()),
    // Pre-computed returns from Finnhub (percentages, e.g. 20.53 means +20.53%)
    return5D:   m['5DayPriceReturnDaily'],
    return13W:  m['13WeekPriceReturnDaily'],
    return26W:  m['26WeekPriceReturnDaily'],
    return52W:  m['52WeekPriceReturnDaily'],
    returnMTD:  m['monthToDatePriceReturnDaily'],
    returnYTD:  m['yearToDatePriceReturnDaily'],
    high52W:    m['52WeekHigh'],
    low52W:     m['52WeekLow'],
  };
  cache.set(ticker, { data, fetchedAt: Date.now() });
  return data;
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

  const results = await mapWithConcurrency(resolvable, 5, async (t) => {
    const data = await fetchTickerData(t);
    return { ticker: t, ...data };
  });

  const prices = {};
  const errors = [];
  for (let i = 0; i < resolvable.length; i++) {
    const r = results[i];
    if (r && !r.error) prices[r.ticker] = r;
    else errors.push({ ticker: resolvable[i], error: r?.error || 'unknown' });
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({
    fetchedAt: new Date().toISOString(),
    prices, errors, skipped,
    source: 'finnhub',
  });
}
