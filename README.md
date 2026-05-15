# AI Hedge Fund 13F Tracker

Interactive dashboard for exploring AI-aligned hedge fund holdings, sourced
from primary SEC EDGAR 13F filings. Single-file vanilla HTML/CSS/JS front-end
plus one Node/Express server that proxies SEC EDGAR for live refreshes.

```
.
├── index.html              # the dashboard (no build step)
├── data.json               # baked from the spreadsheet (also inlined into index.html)
├── server.js               # Express server for Render
├── api/
│   └── edgar.js            # handler — runs as Vercel function OR via server.js
├── scripts/
│   ├── build_data.py       # bakes data.json from the .xlsx
│   └── refresh_funds.mjs   # overlays live EDGAR data for selected funds
├── AI_Hedge_Funds_13F_Tracker.xlsx
├── render.yaml             # Render blueprint
├── vercel.json             # (kept for optional Vercel deploys)
└── package.json
```

## Local dev

```sh
npm install
npm start                            # serves on http://localhost:3000
```

Or if you don't want to run a server, just open `index.html` directly — the
data is baked inline so it works via `file://` too. The **Update from EDGAR**
button needs the server running.

To re-bake `data.json` from the spreadsheet:

```sh
npm run build:data
```

To refresh selected funds from SEC EDGAR (skips the spreadsheet):

```sh
npm run refresh                              # refreshes the 3 known-fresh funds
node scripts/refresh_funds.mjs Coatue        # or refresh specific funds by shortLabel
```

To bake historical close prices for the "Δ since reporting date" column:

```sh
npm run refresh:prices                       # fetches Yahoo close prices for
                                             # every ticker at every fund's
                                             # period-of-report date, writes
                                             # them into data.json under
                                             # `historicalPrices` and re-bakes
                                             # the inline data into index.html.
```

The live "now" prices come from Finnhub via `/api/prices`; the historical
"since" prices are baked at this step. Run after each `npm run refresh` to
fill in prices for any newly-imported holdings.

## Deploy to Render (recommended)

1. Push this repo to GitHub.
2. In Render: **New → Blueprint** → connect this repo → Apply.
   `render.yaml` configures a free-tier Node Web Service running `npm start`.
3. After the first deploy, go to the service's **Environment** tab and set:
   - `SEC_USER_AGENT` to your own `Name email@domain.com` — SEC requires
     this header on every request.
   - `FINNHUB_API_KEY` to your free Finnhub token (finnhub.io). Powers the
     "Δ since report" column's live current-price fetch. Without it that
     column will show "—" but the rest of the dashboard works.

That's it. Future pushes to `main` auto-deploy.

Free-tier services spin down after ~15 min of inactivity (~3–5s cold start on
the next visit). Bump to the **Standard** plan if you want it always warm.

## Deploy to Vercel (alternative)

```sh
vercel deploy --prod
```

The `api/edgar.js` file works unchanged as a Vercel serverless function.
Set `SEC_USER_AGENT` as a Vercel env var. The `vercel.json` is still in the
repo so this path is available — pick whichever host you prefer.

## How the categorization works

Each ticker is bucketed into one of these categories (edit
`scripts/build_data.py` to tune):

- **GPU & AI compute** — NVDA, AVGO, AMD, ALAB
- **Foundry & semis** — TSM, INTC, TSEM, ARM
- **Semis equipment** — AMAT, ASML, LRCX, KLAC
- **Memory & storage** — MU, SNDK, STX, WDC
- **Optics & networking** — LITE, COHR, ANET, CIEN
- **AI cloud & neoclouds** — CRWV, NBIS, WYFI
- **BTC miners pivoting to AI** — CORZ, IREN, APLD, CIFR, RIOT, HUT, BTDR, BITF, CLSK
- **Power & energy (data center)** — BE, VST, CEG, GEV, VRT, ETN, EQT, SEI, BW, PSIX, FIX, EME, LBRT, PUMP
- **AI software / hyperscaler** — MSFT, GOOGL, META, AMZN, ORCL, AAPL, APP, CRM
- **Other** — everything else

## Adding a new quarter

1. Click **Update from EDGAR** in the UI — newly-available filings get a
   "NEW" badge in the response.
2. Either run `npm run refresh` to overlay the new data into `data.json`, or
   update the spreadsheet and run `npm run build:data`.
3. Commit and push — Render redeploys automatically.

## Caveats

13F is US-listed longs only — no shorts, no SK Hynix/Samsung/Kioxia, no
privates. Options are reported at underlying notional, not premium paid, so
options-heavy funds (SA, VARA) look bigger than their actual capital deployed.
Whale Rock AI Fund and Point72 Turion don't file standalone 13Fs — they roll
up into parent filings.
