// Bake Finnhub 13W/26W/52W returns + current price for every ticker in
// data.json. The dashboard's fund cards read these baked values so the
// "top 3 by return" mini-list renders instantly without paying a per-card
// /api/prices roundtrip.
//
// Usage:  FINNHUB_API_KEY=... node scripts/refresh_returns.mjs
//
// On the free Finnhub tier (60 req/min, 2 calls per ticker) this takes
// ~5-8 minutes for ~250 unique tickers across 25 funds. With a paid plan
// or pulled-down universe it's near-instant. Re-running merges into the
// existing prices map so unchanged tickers are skipped after the first run.

import { readFileSync, writeFileSync } from 'fs';

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
if (!FINNHUB_KEY) {
  console.error('Set FINNHUB_API_KEY before running.');
  process.exit(1);
}

const dataPath = 'data.json';
const htmlPath = 'index.html';
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const today = ymd(Date.now());

// Collect every unique resolvable ticker across funds
const tickers = new Set();
for (const f of data.funds) {
  if (!f.holdings) continue;
  for (const h of f.holdings) {
    if (/^[A-Z][A-Z0-9.\-]{0,6}$/.test(h.ticker)) tickers.add(h.ticker);
  }
}
const tickerList = [...tickers].sort();
console.log(`${tickerList.length} unique tickers to fetch.`);

data.prices = data.prices || {};

// One Finnhub call per ticker — /stock/metric returns the price-return
// percentages we need. Current price is fetched separately by /api/prices
// for the fund-view detail page.
async function fetchOne(ticker, attempt = 1) {
  const r = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${FINNHUB_KEY}`);
  if (r.status === 429) {
    if (attempt >= 4) throw new Error('429 (gave up)');
    const wait = 30 * attempt * 1000;
    console.log(`  ${ticker}: 429 — waiting ${wait/1000}s before retry`);
    await new Promise(rr => setTimeout(rr, wait));
    return fetchOne(ticker, attempt + 1);
  }
  if (!r.ok) throw new Error(`metric ${r.status}`);
  const m = (await r.json()).metric || {};
  return {
    asOf: today,
    return5D:  m['5DayPriceReturnDaily']  ?? null,
    return13W: m['13WeekPriceReturnDaily']?? null,
    return26W: m['26WeekPriceReturnDaily']?? null,
    return52W: m['52WeekPriceReturnDaily']?? null,
    returnYTD: m['yearToDatePriceReturnDaily'] ?? null,
  };
}

// Re-fetch any ticker whose cache is older than 24h
const STALE_MS = 24 * 3600 * 1000;
let fetched = 0, cached = 0, errors = 0;
const errorList = [];

// Stay well under Finnhub's 60 req/min cap. Single worker, ~1.2s between calls
// = 50 req/min effective rate, leaves headroom and avoids 429s.
const CONCURRENCY = 1;
const BATCH_PAUSE_MS = 1200;

let idx = 0;
async function worker() {
  while (idx < tickerList.length) {
    const i = idx++;
    const t = tickerList[i];
    const existing = data.prices[t];
    const age = existing?.fetchedAt ? Date.now() - new Date(existing.fetchedAt).getTime() : Infinity;
    if (existing && age < STALE_MS) { cached++; continue; }
    try {
      const result = await fetchOne(t);
      data.prices[t] = { ...result, fetchedAt: new Date().toISOString() };
      fetched++;
      if (fetched % 25 === 0) process.stdout.write(`  ${fetched + cached}/${tickerList.length} done…\r`);
    } catch (e) {
      errors++;
      errorList.push({ ticker: t, error: e.message });
    }
    await new Promise(r => setTimeout(r, BATCH_PAUSE_MS));
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`\nDone. Fetched: ${fetched}, cached: ${cached}, errors: ${errors}.`);
if (errors) {
  console.log('First few errors:');
  for (const e of errorList.slice(0, 5)) console.log(`  ${e.ticker}: ${e.error}`);
}

data.pricesAsOf = today;
writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log(`Wrote ${dataPath}`);

// Re-bake inline
const html = readFileSync(htmlPath, 'utf8');
const inline = JSON.stringify(data).replace(/<\//g, '<\\/');
const out = html.replace(
  /(<script id="bakedData" type="application\/json">)([\s\S]*?)(<\/script>)/,
  (_m, a, _b, c) => a + inline + c,
);
writeFileSync(htmlPath, out);
console.log(`Re-baked ${htmlPath}`);
