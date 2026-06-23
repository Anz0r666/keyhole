'use strict';
// ============================================================================
//  Keyhole · Модуль безопасности
//  Rate limiting · лимит тела запроса · security-заголовки · проверка Bearer
// ============================================================================

const { isValidApiKey } = require('./store');

// --- Security-заголовки на каждый ответ -------------------------------------
function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; " +
      "base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
  };
}

// --- Rate limiter: фиксированное окно по IP ---------------------------------
const WINDOW_MS = 60 * 1000;   // окно 60 секунд
const MAX_REQ = 300;            // запросов на IP за окно (с запасом на поллинг дашборда)
const hits = new Map();         // ip -> { count, resetAt }

function clientIp(req) {
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function rateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  let rec = hits.get(ip);
  if (!rec || now > rec.resetAt) {
    rec = { count: 0, resetAt: now + WINDOW_MS };
    hits.set(ip, rec);
  }
  rec.count += 1;
  return { allowed: rec.count <= MAX_REQ, retryAfter: Math.ceil((rec.resetAt - now) / 1000) };
}

// Чистка старых записей, чтобы Map не рос бесконечно (анти-утечка памяти)
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) if (now > rec.resetAt) hits.delete(ip);
}, WINDOW_MS).unref();

// --- Проверка Bearer-токена -------------------------------------------------
function checkAuth(req) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return false;
  return isValidApiKey(m[1].trim());
}

// --- Чтение тела с лимитом размера ------------------------------------------
const MAX_BODY = 256 * 1024; // 256 КБ

function readBodyLimited(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY) {
        aborted = true;
        resolve({ ok: false, tooLarge: true });
        // Не рвём сокет (иначе клиент не получит ответ 413) — просто
        // сбрасываем остаток тела в «никуда», чтобы соединение завершилось чисто.
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve({ ok: true, body: raw ? JSON.parse(raw) : {} }); }
      catch { resolve({ ok: false, badJson: true }); }
    });
    req.on('error', () => { if (!aborted) resolve({ ok: false, badJson: true }); });
  });
}

module.exports = {
  securityHeaders, rateLimit, checkAuth, readBodyLimited, clientIp,
  MAX_BODY, MAX_REQ,
};
