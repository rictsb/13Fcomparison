// CUSIP -> ticker resolver via OpenFIGI.
//
// OpenFIGI's /v3/mapping endpoint accepts up to 100 jobs per request and
// works without an API key at 25 req/min. Set OPENFIGI_API_KEY to bump
// the limit to 600 req/min (free key from openfigi.com).
//
// Usage:
//   const map = await resolveCusips(['92189F106', '74762E102', ...]);
//   map['92189F106'] -> { ticker: 'GDX', name: 'VANECK GOLD MINERS ETF' }

const OPENFIGI_KEY = process.env.OPENFIGI_API_KEY;
// Without an API key: max 10 jobs/req, max 25 req/min.
// With a (free) API key: max 100 jobs/req, max 600 req/min.
const BATCH_SIZE = OPENFIGI_KEY ? 100 : 10;

async function callOpenFigi(jobs) {
  const headers = { 'Content-Type': 'application/json' };
  if (OPENFIGI_KEY) headers['X-OPENFIGI-APIKEY'] = OPENFIGI_KEY;
  const r = await fetch('https://api.openfigi.com/v3/mapping', {
    method: 'POST',
    headers,
    body: JSON.stringify(jobs),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`OpenFIGI ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

export async function resolveCusips(cusips, { onProgress } = {}) {
  const out = {};
  const unique = [...new Set(cusips.filter(c => /^[A-Z0-9]{9}$/i.test(c)))];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const jobs = batch.map(c => ({ idType: 'ID_CUSIP', idValue: c }));
    const results = await callOpenFigi(jobs);
    results.forEach((r, j) => {
      const c = batch[j];
      if (r.data && r.data[0]) {
        // 13F filings list US-listed securities. OpenFIGI often returns
        // multiple matches across global exchanges (PLUG Power → PLUG in
        // NY but PLUN in Frankfurt). Prefer:
        //   1. US Common Stock / ETF / ADR
        //   2. Any US-exchange listing
        //   3. Fall back to whatever's first
        // US exchange codes per OpenFIGI: UN (NYSE), UQ (Nasdaq GS), UR (NYSE Arca),
        // UA (NYSE American), UV/UW (Nasdaq), UP (NYSE Pacific), US (US Composite),
        // UF (BATS). Note: do NOT fall back to "any non-spaced ticker" — German
        // listings (GR/GF/GD/GY/GS/GM/GI/GH) also satisfy that.
        const isUS = (d) => /^(UN|UQ|UR|UA|UV|UW|UP|US|UF)$/.test(d.exchCode || '');
        const isEquityish = (d) => /common|etf|equity|adr|depositary/i.test(d.securityType || '');
        const preferred =
          r.data.find(d => isUS(d) && isEquityish(d)) ||
          r.data.find(d => isUS(d)) ||
          r.data.find(d => isEquityish(d)) ||
          r.data[0];
        out[c] = { ticker: preferred.ticker, name: preferred.name, securityType: preferred.securityType, exchCode: preferred.exchCode };
      } else {
        out[c] = null;
      }
    });
    if (onProgress) onProgress(Math.min(i + BATCH_SIZE, unique.length), unique.length);
    // 25 req/min without key — sleep enough between batches to stay safe
    if (i + BATCH_SIZE < unique.length) {
      await new Promise(r => setTimeout(r, OPENFIGI_KEY ? 200 : 3000));
    }
  }
  return out;
}
