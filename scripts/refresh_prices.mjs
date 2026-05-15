// Bake historical "as-of-reporting-date" close prices into data.json.
//
// Usage:  node scripts/refresh_prices.mjs
//
// What it does:
//   1. Walks data.json and collects every (ticker, period-of-report) pair.
//   2. Hits Yahoo Finance's chart endpoint once per (ticker, period) to get
//      the close at/just-after that date.
//   3. Writes the result into data.json under `historicalPrices[period][ticker]`.
//   4. Re-bakes the inline data into index.html so file:// keeps working.
//
// Why Yahoo and not Finnhub: historical candles are a paid Finnhub endpoint.
// Yahoo's chart API is free and works fine from a normal residential or
// Render IP (it can rate-limit shared cloud IPs aggressively — if you see
// 429s, just re-run; the script caches successes across runs).

import { readFileSync, writeFileSync, existsSync } from 'fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15';

const dataPath = 'data.json';
const htmlPath = 'index.html';
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

const isResolvable = (t) => /^[A-Z][A-Z0-9.\-]{0,6}$/.test(t || '');
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const unix = (s) => Math.floor(new Date(s + 'T00:00:00Z').getTime() / 1000);

async function yahooClose(ticker, dateStr) {
  const fromTs = unix(dateStr) - 86400 * 7;
  const toTs = unix(dateStr) + 86400 * 7;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${fromTs}&period2=${toTs}&interval=1d`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const d = await r.json();
  const result = d?.chart?.result?.[0];
  if (!result) throw new Error('no data');
  const ts = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const targetUnix = unix(dateStr);
  // First close at or after the requested date
  let idx = ts.findIndex((t, i) => t >= targetUnix && closes[i] != null);
  if (idx < 0) idx = closes.findIndex(c => c != null);
  if (idx < 0) throw new Error('no close in range');
  return { price: closes[idx], asOf: ymd(ts[idx] * 1000) };
}

// Build the work list: { period -> Set(tickers) }
const work = new Map();
for (const fund of data.funds) {
  if (!fund.hasHoldings) continue;
  const period = fund.periodOfReport || data.asOf;
  if (!work.has(period)) work.set(period, new Set());
  for (const h of fund.holdings) {
    if (isResolvable(h.ticker)) work.get(period).add(h.ticker);
  }
}

// Preserve anything already baked (so re-runs only fill gaps)
data.historicalPrices = data.historicalPrices || {};

const periods = [...work.keys()].sort();
let totalNeeded = 0, totalFetched = 0, totalCached = 0, totalErrors = 0;
const errors = [];

for (const period of periods) {
  data.historicalPrices[period] = data.historicalPrices[period] || {};
  const baked = data.historicalPrices[period];
  const tickers = [...work.get(period)].sort();
  totalNeeded += tickers.length;

  process.stdout.write(`\nPeriod ${period} (${tickers.length} tickers):\n`);
  for (const ticker of tickers) {
    if (baked[ticker]) {
      totalCached++;
      continue;
    }
    try {
      const { price, asOf } = await yahooClose(ticker, period);
      baked[ticker] = { price, asOf };
      totalFetched++;
      process.stdout.write(`  ${ticker.padEnd(8)} ${asOf}  $${price.toFixed(2)}\n`);
    } catch (e) {
      totalErrors++;
      errors.push({ ticker, period, error: e.message });
      process.stdout.write(`  ${ticker.padEnd(8)} ERROR ${e.message}\n`);
    }
    // Be polite to Yahoo
    await new Promise(r => setTimeout(r, 300));
  }
}

console.log(`\nDone. Fetched ${totalFetched}, cached ${totalCached}, errors ${totalErrors} (of ${totalNeeded}).`);
if (errors.length) {
  console.log('Errors (re-run later to fill these in):');
  for (const e of errors.slice(0, 10)) console.log(`  ${e.ticker} @ ${e.period}: ${e.error}`);
}

writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log(`Wrote ${dataPath}`);

// Re-bake inline
if (existsSync(htmlPath)) {
  const html = readFileSync(htmlPath, 'utf8');
  const inline = JSON.stringify(data).replace(/<\//g, '<\\/');
  const out = html.replace(
    /(<script id="bakedData" type="application\/json">)([\s\S]*?)(<\/script>)/,
    (_m, a, _b, c) => a + inline + c,
  );
  writeFileSync(htmlPath, out);
  console.log(`Re-baked ${htmlPath}`);
}
