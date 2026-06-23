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
  if (db.apiKeys.length === 0) {
    db.apiKeys.push('kh_test_' + crypto.randomBytes(24).toString('hex'));
    persist();
  }
  return db.apiKeys[0];
}

function isValidApiKey(key) {
  return typeof key === 'string' && db.apiKeys.includes(key);
}

// --- Персистентность --------------------------------------------------------
function persist() {
  if (process.env.KEYHOLE_NO_PERSIST) return; // тесты не пишут на диск
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('  ⚠️ Не удалось сохранить состояние:', e.message);
  }
}

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      db.agents = d.agents || {};
      db.wallets = d.wallets || {};
      db.ledger = d.ledger || [];
      db.approvals = d.approvals || {};
      db.apiKeys = d.apiKeys || [];
      db.seq = d.seq || 1;
      return true;
    }
  } catch (e) {
    console.error('  ⚠️ Не удалось загрузить состояние:', e.message);
  }
  return false;
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
    })),
    wallets: Object.values(db.wallets),
    ledger: db.ledger,
    approvals: Object.values(db.approvals),
  };
}

module.exports = {
  db, nextId, createAgent, setWallet, reset, snapshot, persist, load,
  ensureApiKey, isValidApiKey,
};
