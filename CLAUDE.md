# 13F Tracker and Earnings Desk

This is the active repository for both apps: https://github.com/rictsb/13Fcomparison.

The owner requested Earnings Desk inside the existing 13F Render service with no additional hosting charge. Do not create a separate paid service or disk. The existing service is `13f-tracker` (`srv-d83qdubtqb8s73em77t0`), Starter plan, connected to main. Its base URL is https://one3f-tracker-rlht.onrender.com. Verify current deployment state before claiming a change is live.

## Architecture and source

- `/`: original 13F dashboard, `index.html`, `data.json`, existing financial-data APIs. Preserve its behavior and data.
- `/earnings-tracker/`: Earnings Desk, statically built from `earnings/` into ignored `earnings/out/`.
- `/earnings-tracker/api/boards`: fixed server-side proxy in `api/earnings-boards.js` to the existing public Site's saved rankings API; GET also returns shared custom candidates.
- `/earnings-tracker/api/candidates`: POST registers a custom stock through the same Site. It is stored in D1, with no new Render disk.
- `server.js`: Express serves both apps and existing `/healthz` in one process. Node 20 remains the configured Render runtime; there is no Next server or SQLite database in this process.

**Keep the original Site active:** https://earnings-desk-richard-dan.ricnyc.chatgpt.site. It owns the persistent rankings in D1. The Render and original pages share the same data through this API. Do not delete the Site or replace shared storage with localStorage or ephemeral Render files. Never copy credentials from Codex; this public API requires no secrets. Proxy requests deliberately omit incoming credentials and Origin.

## Product behavior

Richard and Dan independently rank up to five companies, enter a price target, target note and thesis, then explicitly save. Each bet is a collapsible card: saved cards start closed, expand read-only, and expose Edit, Save, Cancel and Remove. A card Save commits only that bet's notes, keeping other unfinished drafts local. Remove persists that one deletion immediately. The Save button is always visible directly under each stock name. There is no list-level Save button; a card Save also preserves the displayed relative ranking of saved picks. Preserve these individual-save semantics in `earnings/lib/pick-actions.ts`. Both profiles are publicly editable by anyone with the link as requested. Preserve conflict responses, versions, independent drafts and unsaved-change protections. Codex's read-only ranking is LRCX, MKSI, MTSI, Ibiden (4062), FORM. Compare shows all three. Codex is the first and initially selected tab. Richard and Dan open the full 121-entry watchlist plus shared custom stocks. Every watchlist entry is selectable, including ETFs (which do not have operating-company earnings). Add stock asks for ticker, optional name and currency; registration is shared immediately, while adding it to a personal draft still requires Save picks. New stocks have no invented prices, dates or EPS. Keep the five-pick limit and alternate-listing duplicate guard.

UI: `earnings/app/earnings-desk.tsx`, `earnings/app/codex-picks.tsx`, `earnings/app/globals.css`. Data: `earnings/lib/candidates.json` and `earnings/lib/codex-picks.ts`. The browser's API URLs and generated assets must retain `/earnings-tracker` prefix.

Research is dated September 25, 2026, with September 24 price closes. Preserve estimate dates, fiscal labels, currencies, source links, provisional report dates and Ibiden's split warning. Distinguish company guidance, consensus, SemiAnalysis's dated views and your own judgments; do not imply live market data.

## Build, test and publish

Run `npm ci`, `npm run build`, `npm run test:proxy`, then `npm start`. Build installs the frontend's locked dependencies and exports static assets. Per-card persistence tests run with `node --test tests/earnings-pick-actions.test.mjs` after frontend dependencies are installed. Tests use mocked storage and never modify production rankings. Local preview normally uses port 3000; set PORT for another port.

Render's build command is `npm install && npm run build`; start remains `npm start`. Push reviewed changes to the existing repository's main branch and verify the existing service's deployment. Keep the service name, plan, region, environment variables and health path intact. Existing API credentials remain in Render; do not print or commit them.

For Claude Code, open this folder (not the sibling `site` standalone prototype). Render's official Claude plugin can be installed using `/plugin install render`, then `/reload-plugins` and browser OAuth. GitHub deployment can proceed through the existing connected repository. Preserve the existing 13F app while editing Earnings Desk.
