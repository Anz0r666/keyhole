'use strict';
// ============================================================================
//  Keyhole · Роутер (чистая логика обработки запросов, без http-сервера)
//  Используется и локальным сервером (server.js), и serverless-точкой Vercel
//  (api/index.js). Намеренно НЕ содержит http.createServer/listen — иначе
//  сборщик Vercel принимает модуль за серверную точку входа.
//  Защита: валидация · API-ключи · rate limit · лимит тела · заголовки.
// ============================================================================

const fs = require('fs');
const path = require('path');
const store = require('./store');
const { snapshot, reset, createAgent, setWallet, db } = store;
const { processPay, approve, dispute } = require('./engine');
const { getRails } = require('./rails');
const rep = require('./reputation');
const V = require('./validate');
const sec = require('./security');

const PORT = process.env.PORT || 4178; // используется только как база для разбора URL

// Мутирующие эндпоинты — только с валидным API-ключом
const PROTECTED = new Set([
  '/api/scenario', '/api/reset', '/api/agents', '/api/wallets', '/api/pay', '/api/approve', '/api/dispute',
]);

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...sec.securityHeaders() });
  res.end(JSON.stringify(obj));
}

// Отдать HTML с инъекцией API-ключа (дашборд авторизуется этим ключом)
function serveHtml(res, file, apiKey) {
  fs.readFile(file, 'utf8', (err, html) => {
    if (err) { sendJSON(res, 500, { error: 'file not found' }); return; }
    const inject = `<script>window.KEYHOLE_KEY=${JSON.stringify(apiKey)};</script>`;
    const out = html.replace('</head>', inject + '</head>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...sec.securityHeaders() });
    res.end(out);
  });
}

// --- Готовый демо-сценарий --------------------------------------------------
async function runScenario() {
  reset();
  const log = [];
  const shopper = createAgent('ShopperBot', 'Ты (владелец)');
  const supplier = createAgent('SupplierBot', 'Партнёр-магазин');

  setWallet(shopper.id, 500, {
    dailyLimit: 200, perTxnApprovalThreshold: 50,
    allowedCategories: ['cloud', 'saas', 'data', 'api'],
    blockedCategories: ['gambling', 'crypto-gambling'],
  });
  setWallet(supplier.id, 0, {
    dailyLimit: 1000, perTxnApprovalThreshold: 1000,
    allowedCategories: [], blockedCategories: [],
  });

  log.push(`🪪 Созданы агенты: ${shopper.name} (паспорт ${shopper.fingerprint}) и ${supplier.name}`);
  log.push(`🎛️ Кошелёк ShopperBot: лимит $200/день, авто до $50, разрешены [cloud, saas, data, api], блок [gambling]`);

  const steps = [
    { amount: 20, category: 'cloud', merchant: 'AWS credits' },
    { amount: 300, category: 'cloud', merchant: 'Big server' },
    { amount: 10, category: 'gambling', merchant: 'Casino API' },
    { amount: 75, category: 'data', merchant: 'Dataset Pro' },
    { amount: 30, category: 'saas', merchant: supplier.name, counterpartyAgentId: supplier.id },
  ];

  let pendingId = null;
  for (const s of steps) {
    const r = await processPay({ agentId: shopper.id, ...s });
    const icon = r.decision === 'allow' ? '✅' : r.decision === 'deny' ? '⛔' : '⏳';
    log.push(`${icon} $${s.amount} · ${s.category} · ${s.merchant} → ${r.decision.toUpperCase()} (${r.row.reason})`);
    if (r.decision === 'needs_approval') pendingId = r.approvalId;
  }
  if (pendingId) {
    const ar = await approve(pendingId);
    log.push(`👤 Человек подтвердил зависшую трату → ${ar.decision.toUpperCase()} (${ar.row.reason})`);
  }
  log.push(`🤝 Все операции подписаны и проверены.`);
  return log;
}

// --- Роутер -----------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // 1) Rate limiting (анти-DoS / анти-брутфорс)
  const rl = sec.rateLimit(req);
  if (!rl.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfter), ...sec.securityHeaders() });
    return res.end(JSON.stringify({ error: 'Слишком много запросов. Попробуйте позже.' }));
  }

  // 2) Health-check (открытый, для мониторинга)
  if (p === '/health' && req.method === 'GET') {
    return sendJSON(res, 200, {
      ok: true, uptime: Math.round(process.uptime()),
      agents: Object.keys(db.agents).length, rails: getRails().name,
    });
  }

  // 3) Статика (с инъекцией ключа)
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    return serveHtml(res, path.join(__dirname, 'public', 'index.html'), db.apiKeys[0]);
  }
  if (req.method === 'GET' && (p === '/deck' || p === '/deck.html')) {
    return serveHtml(res, path.join(__dirname, 'public', 'deck.html'), db.apiKeys[0]);
  }

  // 4) Открытое чтение
  if (p === '/api/state' && req.method === 'GET') {
    return sendJSON(res, 200, snapshot());
  }
  if (p === '/api/graph' && req.method === 'GET') {
    return sendJSON(res, 200, rep.graph());
  }

  // 5) Аутентификация для мутирующих эндпоинтов
  if (PROTECTED.has(p)) {
    if (!sec.checkAuth(req)) {
      return sendJSON(res, 401, { error: 'Требуется валидный API-ключ (Authorization: Bearer ...)' });
    }
  }

  // 6) Мутирующие эндпоинты (с валидацией)
  try {
    if (p === '/api/scenario' && req.method === 'POST') {
      const log = await runScenario();
      return sendJSON(res, 200, { log, state: snapshot() });
    }
    if (p === '/api/reset' && req.method === 'POST') {
      reset();
      return sendJSON(res, 200, { ok: true, state: snapshot() });
    }

    if (p === '/api/agents' && req.method === 'POST') {
      const parsed = await sec.readBodyLimited(req);
      if (!parsed.ok) return sendJSON(res, parsed.tooLarge ? 413 : 400, { error: parsed.tooLarge ? 'Тело запроса слишком большое' : 'Некорректный JSON' });
      const name = V.text(parsed.body.name, { field: 'name' });
      const owner = V.text(parsed.body.owner, { field: 'owner', required: false }) || 'unknown';
      const a = createAgent(name, owner);
      return sendJSON(res, 200, { ok: true, agent: { id: a.id, name: a.name, fingerprint: a.fingerprint } });
    }

    if (p === '/api/wallets' && req.method === 'POST') {
      const parsed = await sec.readBodyLimited(req);
      if (!parsed.ok) return sendJSON(res, parsed.tooLarge ? 413 : 400, { error: parsed.tooLarge ? 'Тело запроса слишком большое' : 'Некорректный JSON' });
      const agentId = V.id(parsed.body.agentId, { field: 'agentId' });
      if (!db.agents[agentId]) return sendJSON(res, 404, { error: 'Агент не найден' });
      const balance = V.nonNegative(parsed.body.balance ?? 0, { field: 'balance' });
      const rules = V.rules(parsed.body.rules);
      const w = setWallet(agentId, balance, rules);
      return sendJSON(res, 200, { ok: true, wallet: w });
    }

    if (p === '/api/pay' && req.method === 'POST') {
      const parsed = await sec.readBodyLimited(req);
      if (!parsed.ok) return sendJSON(res, parsed.tooLarge ? 413 : 400, { error: parsed.tooLarge ? 'Тело запроса слишком большое' : 'Некорректный JSON' });
      const b = parsed.body;
      const payload = {
        agentId: V.id(b.agentId, { field: 'agentId' }),
        amount: V.amount(b.amount),
        category: V.category(b.category),
        merchant: V.text(b.merchant, { field: 'merchant', max: 80 }),
        counterpartyAgentId: V.id(b.counterpartyAgentId, { field: 'counterpartyAgentId', required: false }),
      };
      const r = await processPay(payload);
      return sendJSON(res, r.ok ? 200 : 400, r);
    }

    if (p === '/api/approve' && req.method === 'POST') {
      const parsed = await sec.readBodyLimited(req);
      if (!parsed.ok) return sendJSON(res, parsed.tooLarge ? 413 : 400, { error: parsed.tooLarge ? 'Тело запроса слишком большое' : 'Некорректный JSON' });
      const approvalId = V.id(parsed.body.approvalId, { field: 'approvalId' });
      const r = await approve(approvalId);
      return sendJSON(res, r.ok ? 200 : 400, r);
    }

    if (p === '/api/dispute' && req.method === 'POST') {
      const parsed = await sec.readBodyLimited(req);
      if (!parsed.ok) return sendJSON(res, parsed.tooLarge ? 413 : 400, { error: parsed.tooLarge ? 'Тело запроса слишком большое' : 'Некорректный JSON' });
      const txnId = V.id(parsed.body.txnId, { field: 'txnId' });
      const r = dispute(txnId);
      return sendJSON(res, r.ok ? 200 : 400, r);
    }
  } catch (err) {
    if (err instanceof V.ValidationError) {
      return sendJSON(res, 400, { error: err.message });
    }
    console.error('  ⚠️ Ошибка обработки запроса:', err.message);
    return sendJSON(res, 500, { error: 'Внутренняя ошибка сервера' });
  }

  return sendJSON(res, 404, { error: 'not found' });
}

module.exports = { handle, runScenario, sendJSON };
