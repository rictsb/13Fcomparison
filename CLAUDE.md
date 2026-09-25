# 13F Tracker and Earnings Desk

This is the active repository for both apps: https://github.com/rictsb/13Fcomparison.

The owner requested Earnings Desk inside the existing 13F Render service with no additional hosting charge. Do not create a separate paid service or disk. The existing service is `13f-tracker` (`srv-d83qdubtqb8s73em77t0`), Starter plan, connected to main. Its base URL is https://one3f-tracker-rlht.onrender.com. Verify current deployment state before claiming a change is live.

## Architecture and source

- `/`: original 13F dashboard, `index.html`, `data.json`, existing financial-data APIs. Preserve its behavior and data.
- `/earnings-tracker/`: Earnings Desk, statically built from `earnings/` into ignored `earnings/out/`.
- `/earnings-tracker/api/boards`: fixed server-side proxy in `api/earnings-boards.js` to the existing public Site's saved rankings API.
- `server.js`: Express serves both apps and existing `/healthz` in one process. Node 20 remains the configured Render runtime; there is no Next server or SQLite database in this process.

**Keep the original Site active:** https://earnings-desk-richard-dan.ricnyc.chatgpt.site. It owns the persistent rankings in D1. The Render and original pages share the same data through this API. Do not delete the Site or replace shared storage with localStorage or ephemeral Render files. Never copy credentials from Codex; this public API requires no secrets. Proxy requests deliberately omit incoming credentials and Origin.

## Product behavior

Richard and Dan independently rank up to five companies, enter a price target, target note and thesis, then explicitly save. Both profiles are publicly editable by anyone with the link as requested. Preserve conflict responses, versions, independent drafts and unsaved-change protections. Codex's read-only ranking is LRCX, MKSI, MTSI, Ibiden (4062), FORM. Compare shows all three.

UI: `earnings/app/earnings-desk.tsx`, `earnings/app/codex-picks.tsx`, `earnings/app/globals.css`. Data: `earnings/lib/candidates.json` and `earnings/lib/codex-picks.ts`. The browser's API URLs and generated assets must retain `/earnings-tracker` prefix.

Research is dated September 25, 2026, with September 24 price closes. Preserve estimate dates, fiscal labels, currencies, source links, provisional report dates and Ibiden's split warning. Distinguish company guidance, consensus, SemiAnalysis's dated views and your own judgments; do not imply live market data.

## Build, test and publish

Run `npm ci`, `npm run build`, `npm run test:proxy`, then `npm start`. Build installs the frontend's locked dependencies and exports static assets. Tests use mocked storage and never modify production rankings. Local preview normally uses port 3000; set PORT for another port.

Render's build command is `npm install && npm run build`; start remains `npm start`. Push reviewed changes to the existing repository's main branch and verify the existing service's deployment. Keep the service name, plan, region, environment variables and health path intact. Existing API credentials remain in Render; do not print or commit them.

For Claude Code, open this folder (not the sibling `site` standalone prototype). Render's official Claude plugin can be installed using `/plugin install render`, then `/reload-plugins` and browser OAuth. GitHub deployment can proceed through the existing connected repository. Preserve the existing 13F app while editing Earnings Desk.
