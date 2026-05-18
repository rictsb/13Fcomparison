// /api/edgar?ciks=A,B,...&full=1
//
// Fetches the latest 13F-HR for each CIK directly from SEC EDGAR, parses the
// informationtable XML, and returns:
//
//   - if `full=1` (default): full fund objects matching data.json's schema,
//     so the frontend's "Update from EDGAR" button can swap them into STATE
//     and re-render. Includes per-position holdings, sorted by % of 13F,
//     with category tags applied.
//
//   - if `full=0`: a lightweight summary (period, # issuers, totals) — used
//     by the old status-panel codepath.
//
// SEC rules we honor:
//   - User-Agent must identify the requester (name + contact email)
//   - Polite rate limiting (~150ms between requests)

const SEC_USER_AGENT = process.env.SEC_USER_AGENT || '13F Tracker richard@taylor.st';

// ---------------------------------------------------------------------------
// All funds the dashboard knows about. Adding a new CIK here is the only
// thing required to make the Update-from-EDGAR button pick it up.
// ---------------------------------------------------------------------------
const FUND_BY_CIK = {
  // Original 8 anchor funds (Situational Awareness peer group)
  '0002045724': { name: 'Situational Awareness LP',              short: 'Situational Awareness', manager: 'Leopold Aschenbrenner', isRef: true },
  '0001963565': { name: 'Value Aligned Research Advisors',       short: 'VARA',                  manager: 'Ben Hoskin & David Field' },
  '0001569049': { name: 'Light Street Capital',                  short: 'Light Street',          manager: 'Glen Kacher' },
  '0001135730': { name: 'Coatue Management',                     short: 'Coatue',                manager: 'Philippe Laffont' },
  '0001541617': { name: 'Altimeter Capital',                     short: 'Altimeter',             manager: 'Brad Gerstner' },
  '0001167483': { name: 'Tiger Global Management',               short: 'Tiger Global',          manager: 'Chase Coleman' },
  '0001387322': { name: 'Whale Rock Capital Management',         short: 'Whale Rock',            manager: 'Alex Sacerdote' },
  '0001061165': { name: 'Lone Pine Capital',                     short: 'Lone Pine',             manager: 'Stephen Mandel' },
  // Newer additions — Asia/Asia-aligned + US specialists
  '0001869683': { name: 'Maytree Asset Management Ltd',          short: 'Maytree' },
  '0001555623': { name: 'Trivest Advisors Ltd',                  short: 'Trivest' },
  '0001547349': { name: 'Broad Peak Investment Advisers Pte Ltd',short: 'Broad Peak' },
  '0001745907': { name: 'CloudAlpha Capital Management Ltd',     short: 'CloudAlpha' },
  '0001780365': { name: 'WT Asset Management Ltd',               short: 'WT Asset Mgmt' },
  '0001933952': { name: 'AI-Squared Management Ltd',             short: 'AI-Squared' },
  '0001693745': { name: 'Anatole Investment Management Ltd',     short: 'Anatole' },
  '0001801547': { name: 'Blue Whale Capital LLP',                short: 'Blue Whale',            manager: 'Stephen Yiu' },
  '0001904897': { name: 'Styrax Capital LP',                     short: 'Styrax' },
  '0002096531': { name: 'Tensor Edge Capital LLC',               short: 'Tensor Edge' },
  '0001753384': { name: 'Analog Century Management LP',          short: 'Analog Century',        manager: 'Pankaj Patel' },
  '0001314273': { name: 'Avalon Global Asset Management LLC',    short: 'Avalon Global' },
  '0001860672': { name: 'Elemental Capital Partners LLC',        short: 'Elemental' },
  '0001964171': { name: 'Deepwater Asset Management LLC',        short: 'Deepwater',             manager: 'Doug Clinton' },
  '0002113408': { name: 'Dedeker Financial LLC',                 short: 'Dedeker' },
  '0001596053': { name: 'Arosa Capital Management LP',           short: 'Arosa',                 manager: 'Till Bechtolsheimer' },
  '0002054677': { name: 'PIAR LLC',                              short: 'PIAR' },
  '0001595888': { name: 'Jane Street Group, LLC',                short: 'Jane Street' },
};

// "New" badge in the UI fires for periods after this.
// Bump when re-baking with a new quarter as the baseline.
const PREVIOUS_PERIOD = '2026-03-31';

// ---------------------------------------------------------------------------
// Categorization (mirror of scripts/build_data.py)
// ---------------------------------------------------------------------------
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
const getCategory = (ticker) => TICKER_TO_CAT[ticker] || (ticker === 'GLXY' ? 'BTC miners pivoting to AI' : 'Other');

// Issuer → ticker map (subset that resolves Q1 SEC EDGAR XML names).
// Synced with scripts/refresh_funds.mjs.
const ISSUER_TO_TICKER = {
  'NVIDIACORPORATION': 'NVDA', 'NVIDIACORP': 'NVDA',
  'BROADCOMINC': 'AVGO', 'BROADCOMCORP': 'AVGO',
  'ALPHABETINC': 'GOOGL', 'ALPHABET': 'GOOGL',
  'AMAZONCOM': 'AMZN', 'AMAZONCOMINC': 'AMZN',
  'METAPLATFORMSINC': 'META', 'METAPLATFORMS': 'META',
  'MICROSOFTCORP': 'MSFT', 'MICROSOFT': 'MSFT',
  'APPLEINC': 'AAPL',
  'TAIWANSEMICONDUCTORMANUFAC': 'TSM', 'TAIWANSEMICONDUCTORMFG': 'TSM', 'TAIWANSEMICONDUCTORMANUFACTURIN': 'TSM',
  'INTELCORP': 'INTC',
  'TOWERSEMICONDUCTORLTD': 'TSEM', 'TOWERSEMICONDUCTOR': 'TSEM',
  'ARMHOLDINGSPLC': 'ARM',
  'APPLIEDMATLSINC': 'AMAT', 'APPLIEDMATERIALSINC': 'AMAT', 'APPLIEDMATLS': 'AMAT',
  'ASMLHLDGNV': 'ASML', 'ASMLHOLDINGNV': 'ASML',
  'LAMRESEARCHCORP': 'LRCX',
  'KLACORP': 'KLAC',
  'MICRONTECHNOLOGYINC': 'MU', 'MICRONTECHNOLOGY': 'MU',
  'SANDISKCORP': 'SNDK',
  'SEAGATETECHNOLOGYHLDNGSPL': 'STX', 'SEAGATETECHNOLOGYHLDGS': 'STX',
  'WESTERNDIGITALCORP': 'WDC',
  'LUMENTUMHLDGSINC': 'LITE', 'LUMENTUMHOLDINGS': 'LITE',
  'COHERENTCORP': 'COHR', 'COHERENTINC': 'COHR',
  'ARISTANETWORKS': 'ANET', 'ARISTANETWORKSINC': 'ANET',
  'CIENACORP': 'CIEN',
  'COREWEAVEINC': 'CRWV',
  'NEBIUSGROUPNV': 'NBIS',
  'WHITEFIBERINC': 'WYFI',
  'CORESCIENTIFICINCNEW': 'CORZ', 'CORESCIENTIFICINC': 'CORZ',
  'IRENLIMITED': 'IREN',
  'APPLIEDDIGITALCORP': 'APLD',
  'CIPHERMININGINC': 'CIFR',
  'RIOTPLATFORMSINC': 'RIOT',
  'HUT8CORP': 'HUT',
  'BITDEERTECHNOLOGIESGROUP': 'BTDR',
  'BITFARMSLTD': 'BITF',
  'CLEANSPARKINC': 'CLSK',
  'BLOOMENERGYCORP': 'BE',
  'VISTRACORP': 'VST',
  'CONSTELLATIONENERGYCORP': 'CEG',
  'GEVERNOVAINC': 'GEV',
  'VERTIVHOLDINGSCO': 'VRT', 'VERTIVHOLDINGS': 'VRT',
  'EATONCORPPLC': 'ETN',
  'EQTCORP': 'EQT',
  'SOLARISENERGYINFRASINC': 'SEI',
  'BABCOCKWILCOXENTERPRISES': 'BW',
  'POWERSOLUTIONSINTLINC': 'PSIX',
  'COMFORTSYSUSAINC': 'FIX',
  'EMCORGROUPINC': 'EME',
  'LIBERTYENERGYINC': 'LBRT',
  'PROPETROHLDGCORP': 'PUMP',
  'ORACLECORP': 'ORCL',
  'APPLOVINCORP': 'APP',
  'SALESFORCEINC': 'CRM',
  'ADVANCEDMICRODEVICESINC': 'AMD',
  'ASTERALABSINC': 'ALAB',
  'GALAXYDIGITALINC': 'GLXY',
};

const norm = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function resolveTicker(issuer) {
  const n = norm(issuer);
  if (ISSUER_TO_TICKER[n]) return ISSUER_TO_TICKER[n];
  const trimmed = n.replace(/(INC|CORP|CORPORATION|LTD|LIMITED|PLC|HOLDINGS|HLDGS|HOLDING|GROUP|CO|COMPANY|NV|SA)$/g, '');
  if (ISSUER_TO_TICKER[trimmed]) return ISSUER_TO_TICKER[trimmed];
  return '?' + n.slice(0, 12);
}

// ---------------------------------------------------------------------------
// SEC fetchers
// ---------------------------------------------------------------------------
async function fetchSec(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': SEC_USER_AGENT, 'Host': new URL(url).host },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`SEC ${r.status} ${url}: ${body.slice(0, 200)}`);
  }
  return r;
}

async function getLatest13F(cik) {
  const padded = String(cik).padStart(10, '0');
  const res = await fetchSec(`https://data.sec.gov/submissions/CIK${padded}.json`);
  const subs = await res.json();
  const r = subs.filings.recent;
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] === '13F-HR' || r.form[i] === '13F-HR/A') {
      return {
        accession: r.accessionNumber[i],
        filingDate: r.filingDate[i],
        periodOfReport: r.reportDate[i],
        company: subs.name,
      };
    }
  }
  return null;
}

async function getInfoTableXml(cik, accession) {
  const cikInt = parseInt(cik, 10);
  const accClean = accession.replace(/-/g, '');
  const folder = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accClean}/`;
  const idxRes = await fetchSec(folder + 'index.json');
  const idx = await idxRes.json();
  const items = idx.directory.item || [];
  let infoFile = items.find(it => /info(?:rmation)?table.*\.xml$/i.test(it.name));
  if (!infoFile) {
    infoFile = items.find(it =>
      /\.xml$/i.test(it.name)
      && !/primary_doc/i.test(it.name)
      && !/_def\.xml$|_lab\.xml$|_pre\.xml$/.test(it.name)
    );
  }
  if (!infoFile) throw new Error('No information table XML found in filing');
  const xmlRes = await fetchSec(folder + infoFile.name);
  return await xmlRes.text();
}

function parseInfoTable(xml) {
  const x = xml.replace(/(<\/?)[a-zA-Z0-9]+:/g, '$1');
  const decode = (s) => s ? s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : null;
  const entries = [];
  const re = /<infoTable>([\s\S]*?)<\/infoTable>/g;
  let m;
  while ((m = re.exec(x))) {
    const body = m[1];
    const get = (rgx) => { const r = body.match(rgx); return r ? r[1].trim() : null; };
    entries.push({
      nameOfIssuer: decode(get(/<nameOfIssuer>([\s\S]*?)<\/nameOfIssuer>/)),
      titleOfClass: get(/<titleOfClass>([\s\S]*?)<\/titleOfClass>/),
      cusip: get(/<cusip>([\s\S]*?)<\/cusip>/),
      value: parseFloat(get(/<value>([\s\S]*?)<\/value>/) || '0'),
      sshPrnamt: parseFloat(get(/<sshPrnamt>([\s\S]*?)<\/sshPrnamt>/) || '0'),
      putCall: get(/<putCall>([\s\S]*?)<\/putCall>/),
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Aggregate entries into a fund object that matches data.json's schema
// ---------------------------------------------------------------------------
function buildFundFromFiling(cik, meta, entries, filing) {
  const agg = new Map();
  for (const e of entries) {
    const key = e.nameOfIssuer || '(unknown)';
    if (!agg.has(key)) agg.set(key, { issuer: key, equity: 0, calls: 0, puts: 0 });
    const a = agg.get(key);
    const v = e.value || 0;
    if (e.putCall === 'Call') a.calls += v;
    else if (e.putCall === 'Put') a.puts += v;
    else a.equity += v;
  }

  const positions = [];
  let totalAll = 0;
  for (const v of agg.values()) {
    const total = v.equity + v.calls + v.puts;
    if (total <= 0) continue;
    const ticker = resolveTicker(v.issuer);
    positions.push({
      issuer: v.issuer, ticker,
      equity: v.equity / 1e6, calls: v.calls / 1e6, puts: v.puts / 1e6,
      total: total / 1e6,
    });
    totalAll += total;
  }
  positions.sort((a, b) => b.total - a.total);
  positions.forEach((p, i) => {
    p.rank = i + 1;
    p.pct = totalAll > 0 ? (p.total * 1e6) / totalAll : 0;
    p.category = getCategory(p.ticker);
    p.tickerInSheet = false;
  });

  const totalEquity = positions.reduce((s, p) => s + p.equity, 0);
  const totalCalls = positions.reduce((s, p) => s + p.calls, 0);
  const totalPuts = positions.reduce((s, p) => s + p.puts, 0);
  const top10Sum = positions.slice(0, 10).reduce((s, p) => s + p.pct, 0);
  const totalM = totalAll / 1e6;

  return {
    name: meta.name,
    shortLabel: meta.short || meta.name,
    manager: meta.manager || '',
    cik,
    filesOwn13F: true,
    totalBn: totalAll / 1e9,
    numIssuers: positions.length,
    equityPct: totalM > 0 ? totalEquity / totalM : 0,
    callsPct: totalM > 0 ? totalCalls / totalM : 0,
    putsPct: totalM > 0 ? totalPuts / totalM : 0,
    optionsHeavy: totalM > 0 && (totalCalls + totalPuts) / totalM > 0.1,
    top10Concentration: top10Sum,
    filingDate: filing.filingDate,
    periodOfReport: filing.periodOfReport,
    isReference: !!meta.isRef,
    sourceTag: 'edgar',
    hasHoldings: true,
    holdings: positions,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const ciksRaw = (req.query?.ciks || '').toString();
  let ciks = ciksRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (!ciks.length) ciks = Object.keys(FUND_BY_CIK);
  const fullMode = (req.query?.full || '1') !== '0';

  const results = [];
  for (const cik of ciks) {
    const meta = FUND_BY_CIK[cik] || { name: cik, short: cik };
    try {
      const filing = await getLatest13F(cik);
      if (!filing) throw new Error('No 13F-HR filing in recent submissions');
      const xml = await getInfoTableXml(cik, filing.accession);
      const entries = parseInfoTable(xml);

      if (fullMode) {
        const fund = buildFundFromFiling(cik, meta, entries, filing);
        fund.isNew = (filing.periodOfReport || '') > PREVIOUS_PERIOD;
        results.push({ cik, fund });
      } else {
        // Lightweight summary (legacy callers)
        const issuers = new Set(entries.map(e => e.nameOfIssuer));
        let eq = 0, ca = 0, pu = 0;
        for (const e of entries) {
          if (e.putCall === 'Call') ca += e.value;
          else if (e.putCall === 'Put') pu += e.value;
          else eq += e.value;
        }
        results.push({
          cik, fundName: meta.name,
          filingDate: filing.filingDate,
          periodOfReport: filing.periodOfReport,
          isNew: (filing.periodOfReport || '') > PREVIOUS_PERIOD,
          numIssuers: issuers.size,
          numEntries: entries.length,
          totals: { equity: eq, calls: ca, puts: pu, all: eq + ca + pu },
        });
      }
    } catch (err) {
      results.push({ cik, fundName: meta.name, error: err.message || String(err) });
    }
    // Respect SEC's rate limit (≤10 req/sec)
    await new Promise(r => setTimeout(r, 150));
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    fetchedAt: new Date().toISOString(),
    secUserAgent: SEC_USER_AGENT.replace(/(.{3}).*?@/, '$1***@'),
    previousPeriod: PREVIOUS_PERIOD,
    funds: results.map(r => r.fund ? { cik: r.cik, fundName: r.fund.name, periodOfReport: r.fund.periodOfReport, filingDate: r.fund.filingDate, numIssuers: r.fund.numIssuers, isNew: r.fund.isNew } : r),
    // Full fund objects only included when full=1
    funds_full: fullMode ? results.filter(r => r.fund).map(r => r.fund) : undefined,
    errors: results.filter(r => r.error),
  });
}
