// Ticker resolver backed by SEC's master company_tickers list.
//
// SEC publishes a definitive ticker↔CIK↔name index at:
//   https://www.sec.gov/files/company_tickers.json
//
// We fetch it once per process, build a normalized-name → ticker map, and
// use it as a fallback when the hand-curated ISSUER_TO_TICKER overrides
// don't have a hit. This eliminates the "?XXX" placeholders for any
// US-listed issuer that has SEC-registered tickers.

const SEC_UA = process.env.SEC_USER_AGENT || '13F Tracker richard@taylor.st';

const norm = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const SUFFIX_RE = /(INCORPORATED|CORPORATION|HOLDINGS|HOLDING|LIMITED|COMPANY|GROUP|TRUST|HLDGS|INC|CORP|LTD|PLC|LLC|LP|CO|NV|SA|AG|FUND|FD|ETF|TR)$/g;
const stripSuffixes = (n) => {
  let prev = n, cur = n.replace(SUFFIX_RE, '');
  while (cur !== prev) { prev = cur; cur = cur.replace(SUFFIX_RE, ''); }
  return cur;
};

let SEC_INDEX = null;
let LOAD_PROMISE = null;

export async function loadSecIndex() {
  if (SEC_INDEX) return SEC_INDEX;
  if (LOAD_PROMISE) return LOAD_PROMISE;
  LOAD_PROMISE = (async () => {
    const r = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': SEC_UA, 'Accept': 'application/json' },
    });
    if (!r.ok) throw new Error(`SEC ${r.status}`);
    const data = await r.json();
    // Build a name-variant index. Multiple entries can map to the same ticker
    // (different name variants), and we keep all variants for fuzzy hits.
    const idx = new Map();
    for (const k in data) {
      const e = data[k];
      if (!e?.ticker || !e?.title) continue;
      const ticker = String(e.ticker).toUpperCase();
      const full = norm(e.title);
      const stripped = stripSuffixes(full);
      // Don't overwrite — first-seen wins (file is roughly ordered by CIK)
      if (!idx.has(full)) idx.set(full, ticker);
      if (stripped && !idx.has(stripped)) idx.set(stripped, ticker);
    }
    SEC_INDEX = idx;
    return idx;
  })();
  return LOAD_PROMISE;
}

// Build a fast resolver using the SEC index + an optional manual override map.
// The override map is consulted first (so hand-tuned mappings still apply for
// edge cases like share-class quirks).
export function makeResolver(overrideMap = {}) {
  return async function resolveTicker(issuer) {
    if (!issuer) return '?';
    const n = norm(issuer);
    if (overrideMap[n]) return overrideMap[n];
    const stripped = stripSuffixes(n);
    if (overrideMap[stripped]) return overrideMap[stripped];
    try {
      const idx = await loadSecIndex();
      if (idx.has(n)) return idx.get(n);
      if (idx.has(stripped)) return idx.get(stripped);
      // One more pass: try matching the first long-enough prefix
      // (catches "ARM HOLDINGS PLC" matching "ARM HOLDINGS")
      for (let i = stripped.length; i > 6; i--) {
        const prefix = stripped.slice(0, i);
        if (idx.has(prefix)) return idx.get(prefix);
      }
    } catch (_) { /* fall through to placeholder */ }
    return '?' + n.slice(0, 12);
  };
}
