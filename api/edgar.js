// Vercel serverless function — fetches the latest 13F-HR filing for each CIK,
// parses the informationtable XML, and returns aggregated holdings.
//
// SEC EDGAR rules we honor:
//   - User-Agent must identify the requester (name + contact email)
//   - Polite rate limiting (<10 req/sec — we space ~150ms between calls)
//
// Override SEC_USER_AGENT via Vercel env vars if you fork this.

const SEC_USER_AGENT = process.env.SEC_USER_AGENT || '13F Tracker richard@taylor.st';

const FUND_NAME_BY_CIK = {
  '0002045724': 'Situational Awareness LP',
  '0001963565': 'Value Aligned Research Advisors',
  '0001569049': 'Light Street Capital',
  '0001135730': 'Coatue Management',
  '0001541617': 'Altimeter Capital',
  '0001167483': 'Tiger Global Management',
  '0001387322': 'Whale Rock Capital Management',
  '0001061165': 'Lone Pine Capital',
};

// Anything filed for a period > this is flagged "new" in the UI.
// Bump this when you re-bake data.json with a fresh quarter.
const PREVIOUS_PERIOD = '2025-12-31';

async function fetchSec(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': SEC_USER_AGENT,
      'Accept-Encoding': 'gzip, deflate',
      'Host': new URL(url).host,
    },
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
  // SEC's submissions API uses `reportDate`, not `periodOfReport`
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] === '13F-HR' || r.form[i] === '13F-HR/A') {
      return {
        accession: r.accessionNumber[i],
        filingDate: r.filingDate[i],
        periodOfReport: r.reportDate[i],
        primaryDocument: r.primaryDocument[i],
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

  // SEC filers name the file inconsistently — "infotable.xml",
  // "informationtable.xml", "form13fInfoTable.xml", etc.
  let infoFile = items.find(it => /info(?:rmation)?table.*\.xml$/i.test(it.name));
  if (!infoFile) {
    // Fall back: any .xml that isn't the primary doc / xbrl scaffolding
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
  // SEC XML uses namespaces (ns1:, n1:, ...). Strip them so a flat regex works.
  const x = xml.replace(/(<\/?)[a-zA-Z0-9]+:/g, '$1');
  const entries = [];
  const re = /<infoTable>([\s\S]*?)<\/infoTable>/g;
  let m;
  while ((m = re.exec(x))) {
    const body = m[1];
    const get = (rgx) => {
      const r = body.match(rgx);
      return r ? r[1].trim() : null;
    };
    entries.push({
      nameOfIssuer: get(/<nameOfIssuer>([\s\S]*?)<\/nameOfIssuer>/),
      titleOfClass: get(/<titleOfClass>([\s\S]*?)<\/titleOfClass>/),
      cusip: get(/<cusip>([\s\S]*?)<\/cusip>/),
      value: parseFloat(get(/<value>([\s\S]*?)<\/value>/) || '0'),
      sshPrnamt: parseFloat(get(/<sshPrnamt>([\s\S]*?)<\/sshPrnamt>/) || '0'),
      putCall: get(/<putCall>([\s\S]*?)<\/putCall>/),
    });
  }
  return entries;
}

export default async function handler(req, res) {
  // CORS — harmless for same-origin Vercel but useful when hitting from localhost
  res.setHeader('Access-Control-Allow-Origin', '*');

  const ciksRaw = (req.query?.ciks || '').toString();
  let ciks = ciksRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (!ciks.length) {
    // Default — fetch all known CIKs
    ciks = Object.keys(FUND_NAME_BY_CIK);
  }

  const results = [];
  for (const cik of ciks) {
    try {
      const filing = await getLatest13F(cik);
      if (!filing) throw new Error('No 13F-HR filing found in recent submissions');
      const xml = await getInfoTableXml(cik, filing.accession);
      const entries = parseInfoTable(xml);

      const issuers = new Set(entries.map(e => e.nameOfIssuer));
      const aggByIssuer = {};
      let totalEquity = 0, totalCalls = 0, totalPuts = 0;
      for (const e of entries) {
        const issuer = e.nameOfIssuer || '(unknown)';
        const v = e.value || 0;
        aggByIssuer[issuer] = aggByIssuer[issuer] || { equity: 0, calls: 0, puts: 0 };
        if (e.putCall === 'Call') { aggByIssuer[issuer].calls += v; totalCalls += v; }
        else if (e.putCall === 'Put') { aggByIssuer[issuer].puts += v; totalPuts += v; }
        else { aggByIssuer[issuer].equity += v; totalEquity += v; }
      }

      results.push({
        cik,
        fundName: FUND_NAME_BY_CIK[cik] || filing.company,
        accession: filing.accession,
        filingDate: filing.filingDate,
        periodOfReport: filing.periodOfReport,
        isNew: (filing.periodOfReport || '') > PREVIOUS_PERIOD,
        numIssuers: issuers.size,
        numEntries: entries.length,
        totals: {
          equity: totalEquity,
          calls: totalCalls,
          puts: totalPuts,
          all: totalEquity + totalCalls + totalPuts,
        },
        // Keep the top 60 issuers by total value — full file would be megabytes
        topIssuers: Object.entries(aggByIssuer)
          .map(([name, v]) => ({ name, ...v, total: v.equity + v.calls + v.puts }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 60),
      });
    } catch (err) {
      results.push({
        cik,
        fundName: FUND_NAME_BY_CIK[cik] || cik,
        error: err.message || String(err),
      });
    }
    // SEC asks for ≤10 req/sec — be polite
    await new Promise(r => setTimeout(r, 150));
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    fetchedAt: new Date().toISOString(),
    secUserAgent: SEC_USER_AGENT.replace(/(.{3}).*?@/, '$1***@'),
    previousPeriod: PREVIOUS_PERIOD,
    funds: results,
  });
}
