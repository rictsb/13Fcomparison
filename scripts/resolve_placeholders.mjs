// Backfill placeholder ("?XXX") tickers in data.json by resolving each
// holding's CUSIP via OpenFIGI.
//
// Run AFTER refresh_funds.mjs has populated holdings + CUSIPs:
//   node scripts/resolve_placeholders.mjs
//
// Rebakes index.html when done so the inline data stays in sync.

import { readFileSync, writeFileSync } from 'fs';
import { resolveCusips } from '../api/lib/cusip_resolver.mjs';

// Same categorization map used by refresh_funds (kept inline to avoid an extra import).
const CATEGORIES = {
  'GPU & AI compute':            ['NVDA', 'AVGO', 'AMD', 'ALAB'],
  'Foundry & semis':             ['TSM', 'INTC', 'TSEM', 'ARM'],
  'Semis equipment':             ['AMAT', 'ASML', 'LRCX', 'KLAC'],
  'Memory & storage':            ['MU', 'SNDK', 'STX', 'WDC'],
  'Optics & networking':         ['LITE', 'COHR', 'ANET', 'CIEN'],
  'AI cloud & neoclouds':        ['CRWV', 'NBIS', 'WYFI'],
  'BTC miners pivoting to AI':   ['CORZ', 'IREN', 'APLD', 'CIFR', 'RIOT', 'HUT', 'BTDR', 'BITF', 'CLSK'],
  'Power & energy (data center)':['BE', 'VST', 'CEG', 'GEV', 'VRT', 'ETN', 'EQT', 'SEI', 'BW', 'PSIX', 'FIX', 'EME', 'LBRT', 'PUMP'],
  'AI software / hyperscaler':   ['MSFT', 'GOOGL', 'META', 'AMZN', 'ORCL', 'AAPL', 'APP', 'CRM'],
};
const TICKER_TO_CAT = {};
for (const [c, ts] of Object.entries(CATEGORIES)) for (const t of ts) TICKER_TO_CAT[t] = c;
const getCategory = (t) => TICKER_TO_CAT[t] || (t === 'GLXY' ? 'BTC miners pivoting to AI' : 'Other');

// Hand-fallbacks for CUSIPs that OpenFIGI doesn't carry — typically
// foreign-domiciled issuers with US listings.
const CUSIP_FALLBACKS = {
  'N07059210': 'ASML',  // ASML Holding N.V. — N.Y. registry
  'G6700G107': 'NVT',   // nVent Electric plc (Ireland-domiciled, NYSE-listed)
  '422704906': 'HL',    // Hecla Mining
};

const dataPath = 'data.json';
const htmlPath = 'index.html';
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

// Collect every CUSIP behind a "?" placeholder ticker.
const unresolvedHoldings = [];   // [{ fundIdx, holdingIdx, cusip, ticker }]
for (let fi = 0; fi < data.funds.length; fi++) {
  const f = data.funds[fi];
  if (!f.holdings) continue;
  for (let hi = 0; hi < f.holdings.length; hi++) {
    const h = f.holdings[hi];
    if (h.ticker?.startsWith('?') && h.cusip) {
      unresolvedHoldings.push({ fundIdx: fi, holdingIdx: hi, cusip: h.cusip, issuer: h.issuer });
    }
  }
}

const cusips = [...new Set(unresolvedHoldings.map(u => u.cusip))];
console.log(`${unresolvedHoldings.length} placeholder holdings across ${cusips.length} unique CUSIPs.\n`);

if (!cusips.length) {
  console.log('Nothing to resolve. Did you run refresh_funds.mjs after pulling the latest code? CUSIPs are persisted from there.');
  process.exit(0);
}

console.log('Resolving via OpenFIGI…');
const cusipMap = await resolveCusips(cusips, {
  onProgress: (n, total) => process.stdout.write(`  ${n}/${total}\r`),
});
console.log('');

let resolved = 0, stillMissing = 0;
const examples = { resolved: [], missing: [] };
for (const u of unresolvedHoldings) {
  const hit = cusipMap[u.cusip];
  const fallback = CUSIP_FALLBACKS[u.cusip];
  const ticker = hit?.ticker
    ? String(hit.ticker).toUpperCase()
    : (fallback ? fallback.toUpperCase() : null);
  if (ticker) {
    const h = data.funds[u.fundIdx].holdings[u.holdingIdx];
    if (examples.resolved.length < 12) examples.resolved.push(`${h.ticker} -> ${ticker}  (${u.issuer})`);
    h.ticker = ticker;
    h.category = getCategory(ticker);
    resolved++;
  } else {
    stillMissing++;
    if (examples.missing.length < 8) examples.missing.push(`${u.cusip}  ${u.issuer}`);
  }
}

console.log(`Resolved: ${resolved}`);
console.log(`Still missing: ${stillMissing}`);
console.log('\nExamples:');
for (const e of examples.resolved) console.log('  ' + e);
if (examples.missing.length) {
  console.log('\nStill unresolved (likely private funds or rare instruments):');
  for (const e of examples.missing) console.log('  ' + e);
}

writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log(`\nWrote ${dataPath}`);

// Re-bake inline data into index.html
const html = readFileSync(htmlPath, 'utf8');
const inline = JSON.stringify(data).replace(/<\//g, '<\\/');
const out = html.replace(
  /(<script id="bakedData" type="application\/json">)([\s\S]*?)(<\/script>)/,
  (_m, a, _b, c) => a + inline + c,
);
writeFileSync(htmlPath, out);
console.log(`Re-baked ${htmlPath}`);
