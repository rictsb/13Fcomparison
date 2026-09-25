import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

const boards = {
  Richard: { person: 'Richard', version: 0, picks: [], updatedAt: null },
  Dan: { person: 'Dan', version: 0, picks: [], updatedAt: null },
};
const savedBoard = { person: 'Richard', version: 1, picks: [{ ticker: 'MU', target: 120, targetNote: 'Test target', thesis: 'Test thesis' }], updatedAt: '2026-09-25T12:00:00.000Z' };
const candidate = { ticker: 'CUSTOM', name: 'Custom company', currency: 'USD', group: 'watchlist', reportDate: null, sources: [] };
let baseUrl, server, directory, responseFactory, calls;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'earnings-proxy-test-'));
  await mkdir(join(directory, '_next', 'static'), { recursive: true });
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Earnings test</title>');
  await writeFile(join(directory, '_next', 'static', 'test.js'), 'window.earningsTest = true;');
  const app = createApp({
    earningsDirectory: directory,
    boardsProxyOptions: {
      timeoutMs: 40,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return responseFactory(url, options);
      },
    },
  });
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
});

function setup(payload = { boards }, status = 200) {
  calls = [];
  responseFactory = () => Response.json(payload, { status });
}

function put(body, extra = {}) {
  return fetch(`${baseUrl}/earnings-tracker/api/boards`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: baseUrl, ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function postCandidate(body, extra = {}) {
  return fetch(`${baseUrl}/earnings-tracker/api/candidates?url=https://untrusted.invalid/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl, ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('GET preserves shared boards, uses fixed upstream, and strips incoming credentials', async () => {
  setup();
  const response = await fetch(`${baseUrl}/earnings-tracker/api/boards?url=https://untrusted.invalid/`, {
    headers: { Cookie: 'private=test', Authorization: 'Bearer test', Origin: 'https://different.example' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { boards });
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://earnings-desk-richard-dan.ricnyc.chatgpt.site/api/boards');
  assert.deepEqual(calls[0].options.headers, { Accept: 'application/json' });
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.cache, 'no-store');
});

test('PUT preserves body and version, and uses the public HTTPS origin behind Render', async () => {
  setup({ board: savedBoard });
  const body = { person: 'Richard', version: 0, picks: savedBoard.picks };
  const response = await put(body, {
    Origin: `https://${new URL(baseUrl).host}`, 'X-Forwarded-Proto': 'https',
    Cookie: 'private=test', Authorization: 'Bearer test',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { board: savedBoard });
  assert.deepEqual(JSON.parse(calls[0].options.body.toString()), body);
  assert.deepEqual(calls[0].options.headers, { Accept: 'application/json', 'Content-Type': 'application/json' });
});

test('GET preserves the shared custom candidate catalog alongside boards', async () => {
  setup({ boards, candidates: [candidate] });
  const response = await fetch(`${baseUrl}/earnings-tracker/api/boards`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { boards, candidates: [candidate] });
});

test('POST forwards stock registration to the fixed endpoint, preserving metadata and stripping credentials', async () => {
  const payload = { candidate, created: true };
  setup(payload);
  const body = { ticker: 'CUSTOM', name: 'Custom company', currency: 'USD' };
  const response = await postCandidate(body, {
    Origin: `https://${new URL(baseUrl).host}`, 'X-Forwarded-Proto': 'https',
    Cookie: 'private=test', Authorization: 'Bearer test',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), payload);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://earnings-desk-richard-dan.ricnyc.chatgpt.site/api/candidates');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body.toString()), body);
  assert.deepEqual(calls[0].options.headers, { Accept: 'application/json', 'Content-Type': 'application/json' });
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.cache, 'no-store');
});

test('stock registration rejects unsafe origin, non-JSON, malformed and oversized requests locally', async () => {
  setup();
  assert.equal((await postCandidate({}, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await postCandidate('{}', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await postCandidate('{')).status, 400);
  assert.equal((await postCandidate({ name: 'x'.repeat(50_000) })).status, 413);
  assert.equal((await postCandidate('{}', { 'Content-Encoding': 'gzip' })).status, 415);
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const response = await fetch(`${baseUrl}/earnings-tracker/api/candidates`, { method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get('allow'), 'POST');
  }
  assert.equal(calls.length, 0);
});

test('stock registration preserves existing-stock responses and upstream validation errors', async () => {
  setup({ candidate, created: false });
  let response = await postCandidate({ ticker: 'CUSTOM' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { candidate, created: false });
  const invalid = { error: 'Enter a valid ticker.' };
  setup(invalid, 400);
  response = await postCandidate({ ticker: '?' });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), invalid);
});

test('stock registration returns JSON 503 for invalid success payloads, failed upstream and timeouts', async () => {
  const factories = [
    () => { throw new Error('connection failed'); },
    () => new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => Response.json({ candidate, created: 'yes' }),
    () => Response.json({ candidate: { ticker: 'CUSTOM' }, created: true }),
    () => Response.json({ error: 'Internal failure' }, { status: 500 }),
    (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  ];
  for (const factory of factories) {
    setup();
    responseFactory = factory;
    const response = await postCandidate({ ticker: 'CUSTOM' });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.match((await response.json()).error, /Adding stocks is temporarily unavailable/);
  }
});

test('PUT rejects cross-origin requests and non-JSON without contacting upstream', async () => {
  setup();
  assert.equal((await put({}, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await put('{}', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal(calls.length, 0);
});

test('PUT rejects malformed JSON and bodies over 50,000 bytes locally', async () => {
  setup();
  assert.equal((await put('{')).status, 400);
  const response = await put(JSON.stringify({ note: 'x'.repeat(50_000) }));
  assert.equal(response.status, 413);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal(calls.length, 0);
});

test('only GET and PUT are allowed', async () => {
  setup();
  for (const method of ['POST', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const response = await fetch(`${baseUrl}/earnings-tracker/api/boards`, { method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get('allow'), 'GET, PUT');
  }
  assert.equal(calls.length, 0);
});

test('upstream validation and conflict statuses preserve their JSON', async () => {
  const invalid = { error: 'Choose an operating company from the watchlist.' };
  setup(invalid, 400);
  let response = await put({});
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), invalid);
  const conflict = { error: 'This ranking changed in another window.', conflict: true, boards };
  setup(conflict, 409);
  response = await put({});
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), conflict);
});

test('unavailable, malformed, and unexpected upstream responses produce JSON 503', async () => {
  const factories = [
    () => { throw new Error('connection failed'); },
    () => new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    () => Response.json({ boards: {} }),
    () => Response.json({ error: 'Internal failure' }, { status: 500 }),
    () => Response.json({ error: 'Wrong success format' }),
  ];
  for (const factory of factories) {
    setup();
    responseFactory = factory;
    const response = await fetch(`${baseUrl}/earnings-tracker/api/boards`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.match((await response.json()).error, /temporarily unavailable/);
  }
});

test('upstream timeout returns 503', async () => {
  setup();
  responseFactory = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const response = await fetch(`${baseUrl}/earnings-tracker/api/boards`);
  assert.equal(response.status, 503);
});

test('existing 13F page, data, workbook, API routing and health check remain available', async () => {
  setup();
  const root = await fetch(baseUrl);
  assert.equal(root.status, 200);
  const html = await root.text();
  assert.match(html, /13F · AI Hedge Fund Tracker/);
  assert.match(html, /href="\/earnings-tracker\/"/);
  const data = await fetch(`${baseUrl}/data.json`);
  assert.equal(data.status, 200);
  assert.ok(Array.isArray((await data.json()).funds));
  const workbook = await fetch(`${baseUrl}/AI_Hedge_Funds_13F_Tracker.xlsx`, { method: 'HEAD' });
  assert.equal(workbook.status, 200);
  assert.ok((await (await fetch(`${baseUrl}/healthz`)).json()).ok);
  // Empty inputs return locally without making financial-data network calls.
  assert.equal((await fetch(`${baseUrl}/api/search`)).status, 400);
  assert.ok([400, 500].includes((await fetch(`${baseUrl}/api/prices`)).status));
  assert.equal(calls.length, 0);
});

test('exported earnings page and assets load while source and unknown API paths stay inaccessible', async () => {
  setup();
  let response = await fetch(`${baseUrl}/earnings-tracker/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Earnings test/);
  response = await fetch(`${baseUrl}/earnings-tracker/_next/static/test.js`);
  assert.equal(response.status, 200);
  for (const path of ['/server.js', '/package.json', '/api/earnings-boards.js', '/earnings/package.json', '/earnings-tracker/db/sqlite.ts', '/earnings-tracker/api/missing', '/earnings-tracker/api/boards/extra', '/earnings-tracker/api/candidates/extra']) {
    assert.equal((await fetch(baseUrl + path)).status, 404, path);
  }
  assert.equal(calls.length, 0);
});
