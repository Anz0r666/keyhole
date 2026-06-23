'use strict';
// ============================================================================
//  Keyhole · Операционный движок
//  Личность (подпись) → Правила → Подтверждение → Доверие → РЕЛЬСЫ → списание
//  Асинхронный: реальные платёжные рельсы всегда async.
// ============================================================================

const crypto = require('crypto');
const { db, nextId, persist } = require('./store');
const { evaluate } = require('./policy');
const { getRails } = require('./rails');
const rep = require('./reputation');

// Каноническое сообщение операции — именно его подписывает агент
function canonical(charge) {
  return JSON.stringify({
    agentId: charge.agentId,
    amount: charge.amount,
    category: charge.category,
    merchant: charge.merchant,
    counterpartyAgentId: charge.counterpartyAgentId || null,
    nonce: charge.nonce,
  });
}

// Агент подписывает операцию приватным ключом (PEM)
function signCharge(agent, charge) {
  const msg = Buffer.from(canonical(charge));
  return crypto.sign(null, msg, agent.privateKeyPem).toString('base64');
}

// Keyhole проверяет подпись публичным ключом из «паспорта» (PEM)
function verifyCharge(agent, charge, signatureB64) {
  const msg = Buffer.from(canonical(charge));
  const sig = Buffer.from(signatureB64, 'base64');
  return crypto.verify(null, msg, agent.publicKeyPem, sig);
}

function record(entry) {
  const row = { id: nextId('txn'), at: new Date().toISOString(), ...entry };
  db.ledger.unshift(row);
  return row;
}

/**
 * Провести трату агента. ASYNC — проходит ворота, затем рельсы.
 */
async function processPay({ agentId, amount, category, merchant, counterpartyAgentId, autoApprove }) {
  const agent = db.agents[agentId];
  const wallet = db.wallets[agentId];
  if (!agent) return { ok: false, error: 'Агент не найден' };
  if (!wallet) return { ok: false, error: 'У агента нет кошелька с правилами' };

  // Защита движка (defense-in-depth): даже если валидатор на входе обошли —
  // сумма обязана быть конечным положительным числом, иначе деньги не двигаем.
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, error: 'Недопустимая сумма операции' };
  }
  // Нельзя торговать с самим собой (накрутка репутации/баланса).
  if (counterpartyAgentId && counterpartyAgentId === agentId) {
    return { ok: false, error: 'Контрагент не может совпадать с плательщиком' };
  }

  const charge = {
    agentId, amount: Number(amount), category, merchant,
    counterpartyAgentId: counterpartyAgentId || null,
    nonce: crypto.randomBytes(6).toString('hex'),
  };

  // === Ворота 1: ЛИЧНОСТЬ ===================================================
  const signature = signCharge(agent, charge);
  if (!verifyCharge(agent, charge, signature)) {
    const row = record({ ...charge, status: 'denied', stage: 'identity',
      reason: 'Подпись агента не прошла проверку', agentName: agent.name });
    persist();
    return { ok: true, decision: 'deny', row };
  }

  // === Ворота 2: ПРАВИЛА ====================================================
  const verdict = evaluate(wallet, charge);
  if (verdict.decision === 'deny') {
    rep.recordDenied(agentId);
    const row = record({ ...charge, status: 'denied', stage: 'policy',
      reason: verdict.reason, rule: verdict.rule, agentName: agent.name });
    persist();
    return { ok: true, decision: 'deny', row };
  }

  // === Ворота 3: ПОДТВЕРЖДЕНИЕ ЧЕЛОВЕКА =====================================
  if (verdict.decision === 'needs_approval' && !autoApprove) {
    const ap = { id: nextId('appr'), agentId, charge, signature,
      status: 'pending', reason: verdict.reason };
    db.approvals[ap.id] = ap;
    const row = record({ ...charge, status: 'pending', stage: 'approval',
      reason: verdict.reason, rule: verdict.rule, agentName: agent.name, approvalId: ap.id });
    persist();
    return { ok: true, decision: 'needs_approval', approvalId: ap.id, row };
  }

  // === Ворота 4: ДОВЕРИЕ КОНТРАГЕНТУ ========================================
  if (counterpartyAgentId) {
    const other = db.agents[counterpartyAgentId];
    if (!other) {
      const row = record({ ...charge, status: 'denied', stage: 'trust',
        reason: 'Контрагент-агент не найден в реестре Keyhole', agentName: agent.name });
      persist();
      return { ok: true, decision: 'deny', row };
    }
    if (other.reputation < 20) {
      const row = record({ ...charge, status: 'denied', stage: 'trust',
        reason: `Низкая репутация контрагента (${other.reputation}/100) — сделка заблокирована`,
        agentName: agent.name });
      persist();
      return { ok: true, decision: 'deny', row };
    }
  }

  // === РЕЛЬСЫ: авторизация средств (sandbox / Stripe / стейблкоин) ==========
  const rails = getRails();
  let railsRef;
  try {
    const auth = await rails.authorize(charge);
    railsRef = auth.ref;
  } catch (err) {
    const row = record({ ...charge, status: 'denied', stage: 'rails',
      reason: `Рельсы (${rails.name}) отклонили: ${err.message}`, agentName: agent.name });
    persist();
    return { ok: true, decision: 'deny', row };
  }

  // === Списание + зачисление контрагенту ===================================
  if (counterpartyAgentId) {
    const otherWallet = db.wallets[counterpartyAgentId];
    if (otherWallet) otherWallet.balance += charge.amount;
  }
  wallet.balance -= charge.amount;
  wallet.spentToday += charge.amount;
  // Репутационный граф: успешная операция наращивает историю обоих агентов.
  rep.recordApproved(charge);

  const row = record({ ...charge, status: 'approved', stage: 'settled',
    reason: 'Оплата проведена', agentName: agent.name, rails: rails.name, railsRef,
    counterpartyName: counterpartyAgentId ? db.agents[counterpartyAgentId].name : null,
    signature: signature.slice(0, 24) + '…' });
  persist();
  return { ok: true, decision: 'allow', row };
}

// Человек подтверждает зависшую крупную трату
async function approve(approvalId) {
  const ap = db.approvals[approvalId];
  if (!ap || ap.status !== 'pending') return { ok: false, error: 'Запрос не найден или уже обработан' };
  ap.status = 'approved';
  persist();
  return processPay({ ...ap.charge, autoApprove: true });
}

// Разрешение спора: человек помечает проведённую операцию как недобросовестную.
// Бьёт по репутации агента-плательщика (один спор стоит дорого — см. reputation.js).
function dispute(txnId) {
  const row = db.ledger.find((r) => r.id === txnId);
  if (!row) return { ok: false, error: 'Операция не найдена' };
  if (row.status !== 'approved') return { ok: false, error: 'Спорить можно только по проведённой операции' };
  if (row.disputed) return { ok: false, error: 'По этой операции уже открыт спор' };
  if (!rep.recordDispute(row.agentId)) return { ok: false, error: 'Агент не найден' };
  row.disputed = true;
  persist();
  return { ok: true, txnId, agentId: row.agentId, reputation: db.agents[row.agentId].reputation };
}

module.exports = { processPay, approve, dispute, signCharge, verifyCharge };
