'use strict';
// ============================================================================
//  Keyhole · Хранилище (с персистентностью на диск)
//  Тестовый режим: реальных денег нет, но состояние переживает перезапуск.
//  Ключи агентов хранятся в PEM (сериализуемо в JSON).
// ============================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');

// --- Удалённое хранилище (Supabase) для serverless-режима (Vercel) ----------
//  Всё состояние песочницы живёт одним JSON-блобом в таблице keyhole_state.
//  Включается, когда заданы SUPABASE_URL + SUPABASE_SERVICE_KEY.
const REMOTE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const REMOTE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const REMOTE_TABLE = process.env.KEYHOLE_STATE_TABLE || 'keyhole_state';
const REMOTE_ROW = 'singleton';
function remoteEnabled() {
  return !!(REMOTE_URL && REMOTE_KEY);
}

const db = {
  agents: {},    // id -> { id, name, owner, fingerprint, publicKeyPem, privateKeyPem, reputation }
  wallets: {},   // agentId -> { agentId, balance, spentToday, rules }
  ledger: [],    // проведённые/отклонённые операции
  approvals: {}, // id -> { id, charge, agentId, status }
  apiKeys: [],   // список действующих API-ключей (Bearer)
  seq: 1,
};

// --- API-ключи: гарантируем, что хотя бы один ключ существует ----------------
function ensureApiKey() {
  if (!Array.isArray(db.apiKeys)) db.apiKeys = [];
  // Стабильный публичный ключ песочницы можно задать через env (нужно для Vercel,
  // где каждый запрос — холодный старт: ключ должен быть один и тот же).
  const envKey = process.env.KEYHOLE_KEY;
  if (envKey && !db.apiKeys.includes(envKey)) db.apiKeys.unshift(envKey);
  if (db.apiKeys.length === 0) {
    db.apiKeys.push('kh_test_' + crypto.randomBytes(24).toString('hex'));
    persist();
  }
  return db.apiKeys[0];
}

function isValidApiKey(key) {
  return typeof key === 'string' && db.apiKeys.includes(key);
}

// --- (Де)сериализация состояния (общая для диска и Supabase) -----------------
function serializeState() {
  return {
    agents: db.agents, wallets: db.wallets, ledger: db.ledger,
    approvals: db.approvals, apiKeys: db.apiKeys, seq: db.seq,
  };
}
function applyState(d) {
  db.agents = d.agents || {};
  db.wallets = d.wallets || {};
  db.ledger = d.ledger || [];
  db.approvals = d.approvals || {};
  db.apiKeys = d.apiKeys || [];
  db.seq = d.seq || 1;
}

// --- Персистентность --------------------------------------------------------
function persist() {
  if (process.env.KEYHOLE_NO_PERSIST) return; // тесты не пишут на диск
  if (remoteEnabled()) return; // в serverless всё состояние сбрасывается одним flush() в конце запроса
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(serializeState(), null, 2));
  } catch (e) {
    console.error('  ⚠️ Не удалось сохранить состояние:', e.message);
  }
}

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      applyState(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
      return true;
    }
  } catch (e) {
    console.error('  ⚠️ Не удалось загрузить состояние:', e.message);
  }
  return false;
}

// --- Удалённое состояние (Supabase REST, на голом fetch, без зависимостей) ---
async function hydrate() {
  if (!remoteEnabled()) { load(); return false; }
  try {
    const url = `${REMOTE_URL}/rest/v1/${REMOTE_TABLE}?id=eq.${REMOTE_ROW}&select=data`;
    const r = await fetch(url, { headers: { apikey: REMOTE_KEY, Authorization: 'Bearer ' + REMOTE_KEY } });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows[0] && rows[0].data) { applyState(rows[0].data); return true; }
    }
  } catch (e) {
    console.error('  ⚠️ Не удалось загрузить состояние из Supabase:', e.message);
  }
  return false;
}

async function flush() {
  if (!remoteEnabled()) { persist(); return; }
  try {
    const url = `${REMOTE_URL}/rest/v1/${REMOTE_TABLE}`;
    await fetch(url, {
      method: 'POST',
      headers: {
        apikey: REMOTE_KEY, Authorization: 'Bearer ' + REMOTE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([{ id: REMOTE_ROW, data: serializeState() }]),
    });
  } catch (e) {
    console.error('  ⚠️ Не удалось сохранить состояние в Supabase:', e.message);
  }
}

function nextId(prefix) {
  return `${prefix}_${(db.seq++).toString(36)}${crypto.randomBytes(2).toString('hex')}`;
}

// --- Агенты: настоящая криптоличность (Ed25519), ключи в PEM -----------------
function createAgent(name, owner) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const fingerprint = crypto
    .createHash('sha256')
    .update(publicKeyPem)
    .digest('hex')
    .slice(0, 16);

  const id = nextId('agent');
  db.agents[id] = {
    id,
    name,
    owner,
    fingerprint,
    publicKeyPem,
    privateKeyPem, // ⚠️ в проде ключ так не хранится — это тестовый режим
    reputation: 50,
    stats: { approved: 0, denied: 0, disputed: 0, volume: 0, counterparties: {}, firstAt: null, lastAt: null },
    createdAt: new Date().toISOString(),
  };
  persist();
  return db.agents[id];
}

function setWallet(agentId, balance, rules) {
  db.wallets[agentId] = { agentId, balance: Number(balance), spentToday: 0, rules };
  persist();
  return db.wallets[agentId];
}

function reset() {
  // Чистим данные песочницы, но СОХРАНЯЕМ API-ключи (иначе дашборд отвалится)
  db.agents = {};
  db.wallets = {};
  db.ledger = [];
  db.approvals = {};
  db.seq = 1;
  persist();
}

function snapshot() {
  // Безопасный срез наружу — БЕЗ приватных ключей
  return {
    agents: Object.values(db.agents).map((a) => ({
      id: a.id, name: a.name, owner: a.owner,
      fingerprint: a.fingerprint, reputation: a.reputation,
      stats: a.stats || { approved: 0, denied: 0, disputed: 0, volume: 0, counterparties: {} },
    })),
    wallets: Object.values(db.wallets),
    ledger: db.ledger,
    approvals: Object.values(db.approvals),
  };
}

module.exports = {
  db, nextId, createAgent, setWallet, reset, snapshot, persist, load,
  ensureApiKey, isValidApiKey, hydrate, flush, remoteEnabled,
};
