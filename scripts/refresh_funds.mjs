// Refresh selected funds in data.json from live SEC EDGAR.
// Usage:  node scripts/refresh_funds.mjs                  # refresh the 3 known-stale funds
//         node scripts/refresh_funds.mjs Coatue Altimeter # refresh by shortLabel
//
// This script:
//   1. Fetches the latest 13F-HR per fund directly from SEC.
//   2. Maps each SEC issuer name to a ticker (extends the spreadsheet map).
//   3. Categorizes per the same buckets used by scripts/build_data.py.
//   4. Replaces the fund's holdings (+ totals/percentages) in data.json.
//   5. Re-bakes the JSON into the <script id="bakedData"> block in index.html.

import { readFileSync, writeFileSync } from 'fs';
import { makeResolver, loadSecIndex } from '../api/lib/sec_tickers.mjs';

const SEC_UA = process.env.SEC_USER_AGENT || '13F Tracker richard@taylor.st';

const DEFAULT_REFRESH = ['Light Street', 'Tiger Global', 'Whale Rock'];

// shortLabel -> CIK for funds not in data.json yet (also serves as a quick lookup)
const KNOWN_CIKS = {
  'Maytree':         '0001869683',
  'Trivest':         '0001555623',
  'Broad Peak':      '0001547349',
  'CloudAlpha':      '0001745907',
  'WT Asset Mgmt':   '0001780365',
  'AI-Squared':      '0001933952',
  'Anatole':         '0001693745',
  'Blue Whale':      '0001801547',
  'Styrax':          '0001904897',
  'Tensor Edge':     '0002096531',
  'Analog Century':  '0001753384',
  'Avalon Global':   '0001314273',
  'Elemental':       '0001860672',
  'Deepwater':       '0001964171',
  'Dedeker':         '0002113408',
  'Arosa':           '0001596053',
  'PIAR':            '0002054677',
};

// ----------------------------------------------------------------------------
// Categorization — must mirror scripts/build_data.py exactly
// ----------------------------------------------------------------------------
const CATEGORIES = {
  'GPU & AI compute':               ['NVDA', 'AVGO', 'AMD', 'ALAB'],
  'Foundry & semis':                ['TSM', 'INTC', 'TSEM', 'ARM'],
  'Semis equipment':                ['AMAT', 'ASML', 'LRCX', 'KLAC'],
  'Memory & storage':               ['MU', 'SNDK', 'STX', 'WDC'],
  'Optics & networking':            ['LITE', 'COHR', 'ANET', 'CIEN'],
  'AI cloud & neoclouds':           ['CRWV', 'NBIS', 'WYFI'],
  'BTC miners pivoting to AI':      ['CORZ', 'IREN', 'APLD', 'CIFR', 'RIOT', 'HUT', 'BTDR', 'BITF', 'CLSK'],
  'Power & energy (data center)':   ['BE', 'VST', 'CEG', 'GEV', 'VRT', 'ETN', 'EQT', 'SEI', 'BW', 'PSIX', 'FIX', 'EME', 'LBRT', 'PUMP'],
  'AI software / hyperscaler':      ['MSFT', 'GOOGL', 'META', 'AMZN', 'ORCL', 'AAPL', 'APP', 'CRM'],
};
const TICKER_TO_CAT = {};
for (const [c, ts] of Object.entries(CATEGORIES)) for (const t of ts) TICKER_TO_CAT[t] = c;
const getCategory = (ticker) => {
  if (TICKER_TO_CAT[ticker]) return TICKER_TO_CAT[ticker];
  if (ticker === 'GLXY') return 'BTC miners pivoting to AI';
  return 'Other';
};

// ----------------------------------------------------------------------------
// Issuer → ticker map. SEC names tend to be UPPERCASE, slightly different
// from spreadsheet versions. We normalize aggressively.
// ----------------------------------------------------------------------------
const ISSUER_TO_TICKER = {
  // Spreadsheet variants (in case the build script ever feeds us raw sheet names)
  'NEBIUSGROUP': 'NBIS', 'LAMRESEARCH': 'LRCX', 'ADVANCEDMICRODEVICES': 'AMD',
  'ASTERALABS': 'ALAB', 'SNOWFLAKE': 'SNOW', 'KLA': 'KLAC',
  'TALENENERGY': 'TLN', 'QUALCOMM': 'QCOM', 'ARGAN': 'AGX',
  'SEAGATETECHNOLOGY': 'STX', 'SEAGATETECHNOLOGYHLDNGSPL': 'STX',
  'NXPSEMICONDUCTORS': 'NXPI', 'MKS': 'MKSI', 'MKSINSTRUMENTS': 'MKSI',
  'ANALOGDEVICES': 'ADI', 'GDSHOLDINGSLTD': 'GDS',
  'SPOTIFYTECHNOLOGYSA': 'SPOT', 'TESLA': 'TSLA',
  'TAKETWOINTERACTIVESOFTWAR': 'TTWO', 'TAKE2INTERACTIVESOFTWARE': 'TTWO',
  'APOLLOGLOBALMGMT': 'APO', 'APOLLOGLOBALMANAGEMENT': 'APO',
  'FLUTTERENTMTPLC': 'FLUT', 'FLUTTERENTERTAINMENTPLC': 'FLUT',
  'VEEVASYSTEMS': 'VEEV', 'CORPAY': 'CPAY', 'ZILLOWGROUP': 'Z',
  'GRABHOLDINGSLIMITED': 'GRAB', 'BLOCK': 'SQ', 'ZSCALER': 'ZS',
  'SERVICENOW': 'NOW', 'LIBERTYMEDIACORPDEL': 'FWONK',
  'WORKDAY': 'WDAY', 'WEALTHFRONT': 'WLTH', 'PROCORETECHNOLOGIES': 'PCOR',
  'COSTARGROUP': 'CSGP', 'UNITEDHEALTHGROUP': 'UNH',
  'ELASTICNV': 'ESTC', 'HINGEHEALTH': 'HNGE', 'SHERWINWILLIAMS': 'SHW',
  'ATRENEW': 'RERE', 'PONYAI': 'PONY', 'CIRCLEINTERNETGROUP': 'CRCL',
  'JDCOM': 'JD', 'NETSKOPE': 'NTSK', 'KLARNAGROUP': 'KLAR',
  'BULLISH': 'BLSH', 'ETOROGROUP': 'ETOR', 'FIGMA': 'FIG',
  'ACCELERANTHOLDINGS': 'ARX', 'GEMINISPACESTA': 'GEMI', 'MNTN': 'MNTN',
  'NUHOLDINGS': 'NU', 'NUHLDGSLTD': 'NU',
  'NATERA': 'NTRA', 'INTUITIVESURGICAL': 'ISRG', 'ADOBE': 'ADBE',
  'FIRSTCTZNSBANCSHARES': 'FCNCA', 'FIRSTCITIZENSBANCSHARES': 'FCNCA',
  'CARISLIFESCIENCES': 'CAI',
  'ROCKETCOS': 'RKT', 'ROCKETCOMPANIES': 'RKT',
  'PAYPALHOLDINGS': 'PYPL', 'PAYPALHLDGS': 'PYPL',
  'AXONENTERPRISE': 'AXON',
  'CHROBINSONWORLDWIDE': 'CHRW', 'EXPEDITORSINTLWASH': 'EXPD',
  'GENERACHOLDINGS': 'GNRC', 'SPROUTSFMRSMKT': 'SFM', 'SPROUTSFARMERSMARKET': 'SFM',
  'QUANTUMSCAPE': 'QS', 'CHAGEEHOLDINGS': 'CHA',
  'SPGLOBAL': 'SPGI', 'MOODYS': 'MCO',
  'MEDICALPPTYS': 'MPW', 'MEDICALPROPERTIES': 'MPW',
  'NAVAN': 'NAVA', 'MODERNA': 'MRNA',
  'ISHARESBITCOINTRUSTETF': 'IBIT', 'ISHARESTR': 'ISHARES', 'ISHARESINC': 'ISHARES',
  'WEBULL': 'BULL',
  'GITLAB': 'GTLB', 'CONFLUENT': 'CFLT', 'AMPLITUDE': 'AMPL',
  'CELLEBRITEDI': 'CLBT', 'MASTEC': 'MTZ', 'JFROG': 'FROG',
  'TTMTECHNOLOGIES': 'TTMI', 'SEMTECH': 'SMTC', 'FABRINET': 'FN',
  'MONGODB': 'MDB', 'SITIMECORP': 'SITM', 'SITIME': 'SITM',
  'CORNING': 'GLW', 'CIENA': 'CIEN', 'IMPINJ': 'PI',
  'MACOMTECHSOLUTIONSHLDGS': 'MTSI', 'MACOMTECHNOLOGYSOLUTIONS': 'MTSI',
  'KLAVIYO': 'KVYO', 'HUBSPOT': 'HUBS',
  'HEWLETTPACKARDENTERPRISE': 'HPE', 'OKTA': 'OKTA',
  'KKR': 'KKR', 'KKRCO': 'KKR',
  'CAPITALONEFINL': 'COF', 'MEDLINE': 'MDLN', 'VULCANMATLS': 'VMC',
  'PHILIPMORRISINTL': 'PM', 'CARPENTERTECHNOLOGY': 'CRS', 'WINGSTOP': 'WING',
  'AMPHENOL': 'APH', 'AMPHENOLCORPNEW': 'APH',
  'TENETHEALTHCARE': 'THC', 'CLEANHARBORS': 'CLH',
  'AFFIRMHOLDINGS': 'AFRM', 'AFFIRMHLDGS': 'AFRM',
  'ENTEGRIS': 'ENTG', 'MASTERCARDINCORPORATED': 'MA',
  'TRANSDIGMGROUP': 'TDG', 'BOOKINGHOLDINGS': 'BKNG',
  'BOSTONSCIENTIFIC': 'BSX', 'HILTONWORLDWIDEHLDGS': 'HLT', 'VISA': 'V',

  // Common SEC variants (uppercase, sometimes truncated to 40 chars by EDGAR)
  'NVIDIACORPORATION': 'NVDA', 'NVIDIA': 'NVDA',
  'BROADCOM': 'AVGO', 'BROADCOMINC': 'AVGO',
  'ALPHABETINC': 'GOOGL', 'ALPHABET': 'GOOGL',
  'AMAZONCOM': 'AMZN', 'AMAZON': 'AMZN', 'AMAZONCOMINC': 'AMZN',
  'METAPLATFORMS': 'META', 'METAPLATFORMSINC': 'META',
  'MICROSOFT': 'MSFT', 'MICROSOFTCORP': 'MSFT',
  'APPLEINC': 'AAPL', 'APPLE': 'AAPL',
  'TAIWANSEMICONDUCTORMFG': 'TSM', 'TAIWANSEMICONDUCTORMANUFAC': 'TSM',
  'TAIWANSEMICONDUCTORMANUFACTURIN': 'TSM',
  'INTELCORP': 'INTC', 'INTEL': 'INTC',
  'TOWERSEMICONDUCTOR': 'TSEM', 'TOWERSEMICONDUCTORLTD': 'TSEM',
  'ARMHOLDINGSPLC': 'ARM', 'ARMHOLDINGS': 'ARM',
  'APPLIEDMATLS': 'AMAT', 'APPLIEDMATERIALS': 'AMAT',
  'ASMLHLDGNV': 'ASML', 'ASMLHOLDINGNV': 'ASML', 'ASMLHOLDING': 'ASML',
  'LAMRESEARCHCORP': 'LRCX', 'KLACORP': 'KLAC',
  'MICRONTECHNOLOGY': 'MU',
  'SANDISKCORP': 'SNDK', 'SEAGATETECHNOLOGYHLDGS': 'STX',
  'WESTERNDIGITAL': 'WDC', 'WESTERNDIGITALCORP': 'WDC',
  'LUMENTUMHLDGS': 'LITE', 'LUMENTUMHOLDINGS': 'LITE',
  'COHERENTCORP': 'COHR', 'COHERENT': 'COHR',
  'ARISTANETWORKS': 'ANET',
  'CIENACORP': 'CIEN',
  'COREWEAVE': 'CRWV', 'COREWEAVEINC': 'CRWV',
  'NEBIUSGROUPNV': 'NBIS',
  'WHITEFIBER': 'WYFI', 'WHITEFIBERINC': 'WYFI',
  'CORESCIENTIFICINCNEW': 'CORZ', 'CORESCIENTIFIC': 'CORZ',
  'IRENLIMITED': 'IREN', 'IREN': 'IREN',
  'APPLIEDDIGITAL': 'APLD', 'APPLIEDDIGITALCORP': 'APLD',
  'CIPHERMINING': 'CIFR',
  'RIOTPLATFORMS': 'RIOT',
  'HUT8CORP': 'HUT', 'HUT8': 'HUT',
  'BITDEERTECHNOLOGIESGROUP': 'BTDR',
  'BITFARMSLTD': 'BITF', 'BITFARMS': 'BITF',
  'CLEANSPARK': 'CLSK',
  'BLOOMENERGYCORP': 'BE', 'BLOOMENERGY': 'BE',
  'VISTRACORP': 'VST', 'VISTRA': 'VST',
  'CONSTELLATIONENERGY': 'CEG', 'CONSTELLATIONENERGYCORP': 'CEG',
  'GEVERNOVA': 'GEV', 'GEVERNOVAINC': 'GEV',
  'VERTIVHOLDINGS': 'VRT',
  'EATONCORPPLC': 'ETN', 'EATONCORP': 'ETN',
  'EQTCORP': 'EQT',
  'SOLARISENERGYINFRAS': 'SEI',
  'BABCOCKWILCOXENTERPRISES': 'BW',
  'POWERSOLUTIONSINTL': 'PSIX',
  'COMFORTSYSUSA': 'FIX',
  'EMCORGROUP': 'EME',
  'LIBERTYENERGY': 'LBRT',
  'PROPETROHLDGCORP': 'PUMP', 'PROPETROHOLDING': 'PUMP',
  'ORACLECORP': 'ORCL', 'ORACLE': 'ORCL',
  'APPLOVIN': 'APP', 'APPLOVINCORP': 'APP',
  'SALESFORCE': 'CRM', 'SALESFORCECOM': 'CRM',

  // New names showing up in Q1 2026 filings
  'ADVANCEDENERGYINDS': 'AEIS', 'ADVANCEDENERGYINDUSTRIES': 'AEIS',
  'VIAVISOLUTIONS': 'VIAV',
  'SAMSARA': 'IOT', 'SAMSARAINC': 'IOT',
  'DATADOG': 'DDOG',
  'COUPANG': 'CPNG', 'COUPANGINC': 'CPNG',
  'BILLHOLDINGS': 'BILL',
  'AMKORTECHNOLOGY': 'AMKR',
  'ATLASSIANCORPORATION': 'TEAM', 'ATLASSIAN': 'TEAM',
  'EQUIPMENTSHARECOM': 'EQS', // private — placeholder
  'ROBINHOODVENTURESFDI': 'RBNHV', // private SPV — placeholder
  'PAYPAYCORP': 'PAYPAY', // private (Japan) — placeholder
  'XANADUQUANTUMTECHNOLOLTD': 'XANADU', // private — placeholder
  'GALAXYDIGITAL': 'GLXY',
  'MERCADOLIBRE': 'MELI',
  'DOORDASH': 'DASH',
  'NETFLIX': 'NFLX',
  'REDDIT': 'RDDT',
  'CARVANACO': 'CVNA', 'CARVANA': 'CVNA',
  'SEALTD': 'SE', 'SEAINC': 'SE',
  'ROBLOXCORP': 'RBLX', 'ROBLOX': 'RBLX',
  'CELESTICA': 'CLS', 'CELESTICAINC': 'CLS',
  'UBERTECHNOLOGIES': 'UBER',
  'SHOPIFYINC': 'SHOP', 'SHOPIFY': 'SHOP',
  'COREPOINTLODGING': 'CPLG',
  'DUOLINGOINC': 'DUOL', 'DUOLINGO': 'DUOL',
  'CHIMEFINLINC': 'CHYM', 'CHIMEFINANCIAL': 'CHYM',
  'INFOSYSLTD': 'INFY', 'INFOSYS': 'INFY',
  'LPLFINLHLDGS': 'LPLA', 'LPLFINANCIALHOLDINGS': 'LPLA',
  'BROOKFIELDCORP': 'BN',
  'SPLUNK': 'SPLK',
  'SHERWINWILLIAMSCO': 'SHW',

  // Resolve the remaining truncated/abbreviated names SEC's master file misses
  'MACOMTECHSOLUTIONSHLDGSI': 'MTSI', 'MACOMTECHSOL': 'MTSI',
  'COMFORTSYSUSAINC': 'FIX', 'COMFORTSYSUSA': 'FIX',
  'ROBINHOODMKTSINC': 'HOOD', 'ROBINHOODMKTS': 'HOOD',
  'INVESCOQQQTR': 'QQQ', 'INVESCOQQQ': 'QQQ',
  'MONOLITHICPWRSYSINC': 'MPWR', 'MONOLITHICPWRSYS': 'MPWR', 'MONOLITHICPWR': 'MPWR',
  'TSSINCDEL': 'TSSI',
  'MODINEMFGCO': 'MOD', 'MODINEMFG': 'MOD',
  'COREPOINTLODGINGINC': 'CPLG',
  'LIBERTYENERGYINC': 'LBRT',
  'PROPETROHLDGCORP': 'PUMP',
  'BABCOCKWILCOXENTERPRISES': 'BW',
  'POWERSOLUTIONSINTLINC': 'PSIX',
  'EMCORGROUPINC': 'EME',
  'ARGANINC': 'AGX',
  'AAONINC': 'AAON',
  'CIPHERMININGINC': 'CIFR',
  'BKVCORP': 'BKV',
  'WHITEFIBERINC': 'WYFI',
  'NEBIUSGROUPNV': 'NBIS',
  'COREWEAVEINC': 'CRWV',
  'IRENLIMITED': 'IREN',
  'APPLIEDDIGITALCORP': 'APLD',
  'HUT8CORP': 'HUT',
  'BITDEERTECHNOLOGIESGROUP': 'BTDR',
  'TOWERSEMICONDUCTORLTD': 'TSEM',
  'SOLARISENERGYINFRASINC': 'SEI',
  'EATONCORPPLC': 'ETN',
  'GEVERNOVAINC': 'GEV',
  'CONSTELLATIONENERGYCORP': 'CEG',
  'VERTIVHOLDINGSCO': 'VRT',
  'ARMHOLDINGSPLC': 'ARM',
  'ASTERALABSINC': 'ALAB',
  'ADVANCEDMICRODEVICESINC': 'AMD',
  'BLOOMENERGYCORP': 'BE',
  'VISTRACORP': 'VST',
  'NRGENERGYINC': 'NRG',
  'EQTCORP': 'EQT',
  'HALLADORENERGYCOMPANY': 'HNRG',
  'TALENENERGYCORP': 'TLN',
  'GALAXYDIGITALINC': 'GLXY',
};

// Resolver: hand-tuned overrides first, then SEC's master ticker file as fallback.
const resolveTicker = makeResolver(ISSUER_TO_TICKER);

// ----------------------------------------------------------------------------
// SEC fetchers (mirror api/edgar.js)
// ----------------------------------------------------------------------------
async function fetchSec(url) {
  const r = await fetch(url, { headers: { 'User-Agent': SEC_UA, 'Host': new URL(url).host } });
  if (!r.ok) throw new Error(`SEC ${r.status} ${url}`);
  return r;
}
async function latest13F(cik) {
  const padded = String(cik).padStart(10, '0');
  const subs = await (await fetchSec(`https://data.sec.gov/submissions/CIK${padded}.json`)).json();
  const r = subs.filings.recent;
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] === '13F-HR' || r.form[i] === '13F-HR/A') {
      return { acc: r.accessionNumber[i], filingDate: r.filingDate[i], periodOfReport: r.reportDate[i], company: subs.name };
    }
  }
  return null;
}
async function infoTableXml(cik, accession) {
  const folder = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik,10)}/${accession.replace(/-/g,'')}/`;
  const idx = await (await fetchSec(folder + 'index.json')).json();
  let f = idx.directory.item.find(it => /info(?:rmation)?table.*\.xml$/i.test(it.name));
  if (!f) f = idx.directory.item.find(it => /\.xml$/i.test(it.name) && !/primary_doc/i.test(it.name));
  return await (await fetchSec(folder + f.name)).text();
}
function parseInfoTable(xml) {
  const x = xml.replace(/(<\/?)[a-zA-Z0-9]+:/g, '$1');
  const decode = s => s ? s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : null;
  const out = [];
  const re = /<infoTable>([\s\S]*?)<\/infoTable>/g; let m;
  while ((m = re.exec(x))) {
    const b = m[1], g = rgx => { const r = b.match(rgx); return r ? r[1].trim() : null; };
    out.push({
      issuer: decode(g(/<nameOfIssuer>([\s\S]*?)<\/nameOfIssuer>/)),
      titleOfClass: g(/<titleOfClass>([\s\S]*?)<\/titleOfClass>/),
      cusip: g(/<cusip>([\s\S]*?)<\/cusip>/),
      value: parseFloat(g(/<value>([\s\S]*?)<\/value>/) || '0'),
      putCall: g(/<putCall>([\s\S]*?)<\/putCall>/),
    });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Build a fund object from a parsed 13F
// ----------------------------------------------------------------------------
async function buildFundFromEntries(existing, entries, filingDate, periodOfReport) {
  // Aggregate by issuer
  const agg = new Map();
  for (const e of entries) {
    const key = e.issuer || '(unknown)';
    if (!agg.has(key)) agg.set(key, { issuer: key, equity: 0, calls: 0, puts: 0 });
    const a = agg.get(key);
    if (e.putCall === 'Call') a.calls += e.value;
    else if (e.putCall === 'Put') a.puts += e.value;
    else a.equity += e.value;
  }
  const positions = [];
  let totalAll = 0;
  for (const [issuer, v] of agg.entries()) {
    const total = v.equity + v.calls + v.puts;
    if (total <= 0) continue;
    const ticker = await resolveTicker(issuer);
    positions.push({
      issuer, ticker,
      // Convert SEC dollars to $M to match spreadsheet convention
      equity: v.equity / 1e6,
      calls: v.calls / 1e6,
      puts: v.puts / 1e6,
      total: total / 1e6,
    });
    totalAll += total;
  }
  positions.sort((a, b) => b.total - a.total);
  positions.forEach((p, i) => {
    p.rank = i + 1;
    p.pct = (p.total * 1e6) / totalAll;
    p.category = getCategory(p.ticker);
    p.tickerInSheet = false;  // came from SEC, not the spreadsheet
  });

  const totalEquity = positions.reduce((s, p) => s + p.equity, 0);
  const totalCalls = positions.reduce((s, p) => s + p.calls, 0);
  const totalPuts = positions.reduce((s, p) => s + p.puts, 0);
  const top10Sum = positions.slice(0, 10).reduce((s, p) => s + p.pct, 0);
  const optionsHeavy = (totalCalls + totalPuts) / (totalAll / 1e6) > 0.1;

  return {
    ...existing,
    holdings: positions,
    hasHoldings: true,
    totalBn: totalAll / 1e9,
    numIssuers: positions.length,
    equityPct: totalEquity / (totalAll / 1e6),
    callsPct: totalCalls / (totalAll / 1e6),
    putsPct: totalPuts / (totalAll / 1e6),
    optionsHeavy,
    top10Concentration: top10Sum,
    filingDate,
    periodOfReport,
    sourceTag: 'edgar',
  };
}

// ----------------------------------------------------------------------------
// Inline-bake JSON into index.html (mirror of the python logic)
// ----------------------------------------------------------------------------
function bakeIntoHtml(htmlPath, data) {
  const html = readFileSync(htmlPath, 'utf8');
  const inline = JSON.stringify(data).replace(/<\//g, '<\\/');
  const out = html.replace(
    /(<script id="bakedData" type="application\/json">)([\s\S]*?)(<\/script>)/,
    (_m, a, _b, c) => a + inline + c,
  );
  writeFileSync(htmlPath, out);
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_REFRESH;
const dataPath = 'data.json';
const htmlPath = 'index.html';
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

console.log(`Refreshing ${targets.length} fund(s) from SEC EDGAR...\n`);

// Warm the SEC company-tickers index so the first resolveTicker() call
// doesn't pay the fetch cost.
try {
  const idx = await loadSecIndex();
  console.log(`Loaded SEC ticker index: ${idx.size} name variants\n`);
} catch (e) {
  console.log(`Warning: SEC ticker index unavailable (${e.message}). Falling back to manual map only.\n`);
}
let touchedAny = false;
for (const tgt of targets) {
  const fund = data.funds.find(f => f.shortLabel === tgt || f.name === tgt);
  if (!fund) { console.log(`  Skipping unknown fund: ${tgt}`); continue; }
  if (!fund.cik) { console.log(`  ${tgt}: no CIK on file (non-filer), skipping`); continue; }
  try {
    const filing = await latest13F(fund.cik);
    const xml = await infoTableXml(fund.cik, filing.acc);
    const entries = parseInfoTable(xml);
    const updated = await buildFundFromEntries(fund, entries, filing.filingDate, filing.periodOfReport);
    Object.assign(fund, updated);
    console.log(`  ${tgt.padEnd(22)} -> filed ${filing.filingDate}, period ${filing.periodOfReport}, ${updated.numIssuers} issuers, $${updated.totalBn.toFixed(2)}B`);
    touchedAny = true;
  } catch (e) {
    console.log(`  ${tgt}: ERROR ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 200));
}

if (touchedAny) {
  // Add an `asOfByFund` map so the UI can show which fund is at which period
  data.asOfByFund = {};
  for (const f of data.funds) if (f.hasHoldings) data.asOfByFund[f.shortLabel] = f.periodOfReport || data.asOf;

  writeFileSync(dataPath, JSON.stringify(data, null, 2));
  bakeIntoHtml(htmlPath, data);
  console.log(`\nWrote ${dataPath} and re-baked ${htmlPath}.`);
} else {
  console.log('\nNothing to update.');
}
