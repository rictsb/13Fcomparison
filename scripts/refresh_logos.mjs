// Bake fund logo URLs into data.json so the fund cards can render them
// as semi-transparent backgrounds.
//
// Looks up each fund's domain via Clearbit Autocomplete (free, no key) and
// stores both the domain and the Clearbit logo URL. The browser later loads
// the logo from logo.clearbit.com; if a particular logo doesn't exist, the
// CSS monogram fallback (first letter of the fund's short label) shows
// through instead.
//
// Usage:  node scripts/refresh_logos.mjs
//
// Re-running merges into existing data — funds that already have a logo are
// skipped. Set fund.logo = null in data.json to force a refresh for that fund.

import { readFileSync, writeFileSync } from 'fs';

const dataPath = 'data.json';
const htmlPath = 'index.html';
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

// Hand-curated overrides for funds where Clearbit's first match is wrong
// (common with niche/private hedge funds whose names collide with other businesses).
const DOMAIN_OVERRIDES = {
  'Atreides':        'atreidesmgmt.com',
  'Coatue':          'coatue.com',
  'Tiger Global':    'tigerglobal.com',
  'Altimeter':       'altimeter.com',
  'Lone Pine':       'lonepinecapital.com',
  'Whale Rock':      'whalerockcap.com',
  'Light Street':    'lightstreet.com',
  'Jane Street':     'janestreet.com',
  'VARA':            'vara.com',
  'Blue Whale':      'bluewhale.co.uk',
  'Analog Century':  'analogcentury.com',
  'Arosa':           'arosacap.com',
  'Deepwater':       'deepwatermgmt.com',
  // Many smaller funds simply don't have public sites — left blank to use monogram
};

async function clearbitDomain(name) {
  try {
    const url = `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`;
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) return null;
    const arr = await r.json();
    if (!Array.isArray(arr) || !arr.length) return null;
    // Prefer the entry whose name most closely matches our query
    const lower = name.toLowerCase();
    const best = arr.find(it => (it.name || '').toLowerCase().startsWith(lower)) || arr[0];
    return best?.domain || null;
  } catch (_) {
    return null;
  }
}

let fetched = 0, cached = 0, blank = 0;
for (const f of data.funds) {
  if (f.logo && f.domain) { cached++; continue; }
  const queryName = (f.name || f.shortLabel || '').replace(/[,.].*$/, '').trim();
  if (!queryName) { blank++; continue; }

  // 1. Override map
  let domain = DOMAIN_OVERRIDES[f.shortLabel];

  // 2. Clearbit Autocomplete lookup
  if (!domain) {
    domain = await clearbitDomain(queryName);
    await new Promise(r => setTimeout(r, 250));
  }

  if (domain) {
    f.domain = domain;
    // Clearbit's free logo API was shut down after the HubSpot acquisition (2024).
    // Google's faviconV2 endpoint serves 128px PNG favicons for nearly every
    // domain at no cost and no auth — perfect for a low-opacity card background.
    f.logo = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
    fetched++;
    console.log(`  ${f.shortLabel.padEnd(24)} -> ${domain}`);
  } else {
    f.domain = null;
    f.logo = null;
    blank++;
    console.log(`  ${f.shortLabel.padEnd(24)} -> (no domain found)`);
  }
}

console.log(`\nFetched ${fetched}, cached ${cached}, blank ${blank}.`);

writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log(`Wrote ${dataPath}`);

// Re-bake inline data
const html = readFileSync(htmlPath, 'utf8');
const inline = JSON.stringify(data).replace(/<\//g, '<\\/');
const out = html.replace(
  /(<script id="bakedData" type="application\/json">)([\s\S]*?)(<\/script>)/,
  (_m, a, _b, c) => a + inline + c,
);
writeFileSync(htmlPath, out);
console.log(`Re-baked ${htmlPath}`);
