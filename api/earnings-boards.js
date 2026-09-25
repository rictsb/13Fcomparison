import express from 'express';

// This existing Site owns the durable D1 rankings. Keep it deployed while the
// Render-hosted earnings page uses this route; no extra Render disk is needed.
const BOARDS_URL = 'https://earnings-desk-richard-dan.ricnyc.chatgpt.site/api/boards';
const BODY_LIMIT = 50_000;
const unavailable = { error: 'Saved rankings are temporarily unavailable. Your draft is still on this page.' };

function isSameOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    const protocol = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
    if (protocol !== 'http' && protocol !== 'https') return false;
    return origin === new URL(`${protocol}://${req.get('host')}`).origin;
  } catch {
    return false;
  }
}

function isBoard(board, person) {
  return board && typeof board === 'object' && !Array.isArray(board)
    && board.person === person && Number.isSafeInteger(board.version) && board.version >= 0
    && (board.updatedAt === null || typeof board.updatedAt === 'string')
    && Array.isArray(board.picks) && board.picks.length <= 5
    && board.picks.every(pick => pick && typeof pick.ticker === 'string'
      && (pick.target === null || (typeof pick.target === 'number' && Number.isFinite(pick.target)))
      && typeof pick.targetNote === 'string' && typeof pick.thesis === 'string');
}

function isBoards(boards) {
  return boards && isBoard(boards.Richard, 'Richard') && isBoard(boards.Dan, 'Dan');
}

function isValidPayload(payload, method, status) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (status >= 400 && status < 500) {
    return typeof payload.error === 'string' && payload.error.length > 0
      && (payload.boards === undefined || isBoards(payload.boards));
  }
  if (status !== 200) return false;
  return method === 'GET'
    ? isBoards(payload.boards)
    : ['Richard', 'Dan'].some(person => isBoard(payload.board, person));
}

// Only the fetch function and timeout are injectable for isolated tests. The
// upstream URL cannot be changed by a request, query string, or environment var.
export function createBoardsProxy({ fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  const router = express.Router();

  router.all('/', (req, res, next) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    if (req.method !== 'GET' && req.method !== 'PUT') {
      res.set('Allow', 'GET, PUT');
      return res.status(405).json({ error: 'Use GET or PUT for rankings.' });
    }
    if (req.method === 'PUT') {
      if (!isSameOrigin(req)) return res.status(403).json({ error: 'Use this page to save rankings.' });
      if (req.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return res.status(415).json({ error: 'Expected JSON.' });
      }
    }
    next();
  });

  router.put('/', express.raw({ type: () => true, limit: BODY_LIMIT, inflate: false }));

  router.all('/', async (req, res) => {
    if (req.method === 'PUT') {
      try {
        JSON.parse(req.body.toString('utf8'));
      } catch {
        return res.status(400).json({ error: 'Invalid JSON.' });
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Deliberately construct fresh headers: no cookies, authorization, Origin,
      // forwarded host, or other incoming credentials go to the Site.
      const response = await fetchImpl(BOARDS_URL, {
        method: req.method,
        headers: req.method === 'PUT'
          ? { Accept: 'application/json', 'Content-Type': 'application/json' }
          : { Accept: 'application/json' },
        ...(req.method === 'PUT' ? { body: req.body } : {}),
        signal: controller.signal,
        redirect: 'error',
        cache: 'no-store',
      });
      if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new Error('Upstream did not return JSON');
      }
      const payload = await response.json();
      if (!isValidPayload(payload, req.method, response.status)) throw new Error('Invalid upstream response');
      return res.status(response.status).json(payload);
    } catch {
      return res.status(503).json(unavailable);
    } finally {
      clearTimeout(timer);
    }
  });

  router.use((error, _req, res, _next) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'These notes are too long.' });
    if (error.type === 'encoding.unsupported') return res.status(415).json({ error: 'Send uncompressed JSON.' });
    return res.status(400).json({ error: 'Could not read the ranking request.' });
  });
  return router;
}
