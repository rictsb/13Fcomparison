// /api/search?q=Renaissance
//
// Server-side proxy for SEC EDGAR's full-text search. We can't hit
// efts.sec.gov directly from the browser because SEC doesn't set CORS
// headers, so the "+ Add fund" dialog calls this instead.
//
// Returns a deduped list of { cik, name } pairs for entities matching
// the query that have filed 13F-HR.

const SEC_USER_AGENT = process.env.SEC_USER_AGENT || '13F Tracker richard@taylor.st';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = (req.query?.q || '').toString().trim();
  if (!q || q.length < 2) {
    res.status(400).json({ error: 'q (query) must be at least 2 chars' });
    return;
  }
  try {
    const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=13F-HR`;
    const r = await fetch(url, {
      headers: { 'User-Agent': SEC_USER_AGENT, 'Accept': 'application/json' },
    });
    if (!r.ok) throw new Error(`SEC ${r.status}`);
    const data = await r.json();
    const hits = data.hits?.hits || [];
    const seen = new Map();   // cik -> display name
    for (const h of hits.slice(0, 30)) {
      const ciks = h._source?.ciks || [];
      const names = h._source?.display_names || [];
      for (let i = 0; i < ciks.length; i++) {
        const cik = String(ciks[i]).padStart(10, '0');
        if (!seen.has(cik)) {
          // Strip the "(CIK NNNNNN)" suffix the SEC appends to display names
          const name = (names[i] || cik).replace(/\s*\(CIK\s+\d+\)$/i, '').trim();
          seen.set(cik, name);
        }
      }
    }
    const results = [...seen.entries()].map(([cik, name]) => ({ cik, name }));
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({ q, results });
  } catch (e) {
    res.status(502).json({ error: e.message || 'SEC search failed' });
  }
}
