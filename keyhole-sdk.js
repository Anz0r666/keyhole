'use strict';
// ============================================================================
//  Keyhole SDK · клиент для разработчиков ИИ-агентов
//  Подключение в 3 строки:
//
//    const Keyhole = require('./keyhole-sdk');
//    const kh = new Keyhole('http://localhost:4178');
//    const agent = await kh.createAgent('MyAgent', { balance: 300, dailyLimit: 100 });
//    await agent.pay({ amount: 20, category: 'cloud', merchant: 'AWS' });
//
//  Дальше агент сам тратит — а Keyhole держит личность, лимиты и ответственность.
// ============================================================================

class KeyholeAgent {
  constructor(client, id, info) {
    this._client = client;
    this.id = id;
    this.info = info; // { name, fingerprint }
  }

  /** Провести трату. Возвращает { decision: 'allow'|'deny'|'needs_approval', reason } */
  async pay({ amount, category, merchant, counterparty }) {
    const r = await this._client._post('/api/pay', {
      agentId: this.id, amount, category, merchant,
      counterpartyAgentId: counterparty ? counterparty.id : undefined,
    });
    return { decision: r.decision, reason: r.row ? r.row.reason : r.error, raw: r };
  }

  /** Текущий баланс агента из песочницы */
  async balance() {
    const st = await this._client._get('/api/state');
    const w = st.wallets.find((x) => x.agentId === this.id);
    return w ? w.balance : 0;
  }

  /** Текущий балл доверия агента (0..100) из репутационного графа */
  async reputation() {
    const st = await this._client._get('/api/state');
    const a = st.agents.find((x) => x.id === this.id);
    return a ? a.reputation : 50;
  }
}

class Keyhole {
  constructor(baseUrl = 'http://localhost:4178', apiKey = process.env.KEYHOLE_KEY || '') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = 'Bearer ' + this.apiKey;
    return h;
  }

  async _post(path, body) {
    const res = await fetch(this.baseUrl + path, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body),
    });
    return res.json();
  }
  async _get(path) {
    const res = await fetch(this.baseUrl + path, { headers: this._headers() });
    return res.json();
  }

  /** Репутационный граф сети: узлы (агенты + балл) и рёбра (сделки) */
  async graph() {
    return this._get('/api/graph');
  }

  /** Открыть спор по проведённой операции — бьёт по репутации агента-плательщика */
  async dispute(txnId) {
    return this._post('/api/dispute', { txnId });
  }

  /**
   * Регистрирует агента: выдаёт ему криптоличность + кошелёк с правилами.
   * @param {string} name
   * @param {object} opts { balance, dailyLimit, threshold, allowed[], blocked[] }
   */
  async createAgent(name, opts = {}) {
    const a = await this._post('/api/agents', { name, owner: opts.owner || 'sdk' });
    await this._post('/api/wallets', {
      agentId: a.agent.id,
      balance: opts.balance ?? 500,
      rules: {
        dailyLimit: opts.dailyLimit ?? 200,
        perTxnApprovalThreshold: opts.threshold ?? 50,
        allowedCategories: opts.allowed ?? [],
        blockedCategories: opts.blocked ?? [],
      },
    });
    return new KeyholeAgent(this, a.agent.id, { name, fingerprint: a.agent.fingerprint });
  }
}

module.exports = Keyhole;
module.exports.Keyhole = Keyhole;
