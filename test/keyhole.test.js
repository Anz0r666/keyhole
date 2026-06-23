'use strict';
// ============================================================================
//  Keyhole · Автотесты движка
//  Запуск:  node --test
//  Проверяют сердце продукта: правила, личность, ворота, сделки агент↔агент.
// ============================================================================

process.env.KEYHOLE_NO_PERSIST = '1'; // тесты не пишут на диск

const { test } = require('node:test');
const assert = require('node:assert');

const { evaluate } = require('../policy');
const { createAgent, setWallet, reset, db } = require('../store');
const { processPay, approve, signCharge, verifyCharge } = require('../engine');

const RULES = {
  dailyLimit: 200,
  perTxnApprovalThreshold: 50,
  allowedCategories: ['cloud', 'saas', 'data'],
  blockedCategories: ['gambling'],
};

// ---------- Движок правил (чистая функция) ----------------------------------
test('policy: трата в рамках правил → allow', () => {
  const w = { rules: RULES, spentToday: 0 };
  assert.equal(evaluate(w, { amount: 20, category: 'cloud' }).decision, 'allow');
});

test('policy: запрещённая категория → deny', () => {
  const w = { rules: RULES, spentToday: 0 };
  assert.equal(evaluate(w, { amount: 5, category: 'gambling' }).decision, 'deny');
});

test('policy: категория вне белого списка → deny', () => {
  const w = { rules: RULES, spentToday: 0 };
  assert.equal(evaluate(w, { amount: 5, category: 'weapons' }).decision, 'deny');
});

test('policy: превышение дневного лимита → deny', () => {
  const w = { rules: RULES, spentToday: 190 };
  assert.equal(evaluate(w, { amount: 20, category: 'cloud' }).decision, 'deny');
});

test('policy: сумма выше порога → needs_approval', () => {
  const w = { rules: RULES, spentToday: 0 };
  assert.equal(evaluate(w, { amount: 75, category: 'data' }).decision, 'needs_approval');
});

// ---------- Личность (криптоподпись) ----------------------------------------
test('identity: валидная подпись проходит, подделка — нет', () => {
  reset();
  const a = createAgent('Signer', 'test');
  const charge = { agentId: a.id, amount: 10, category: 'cloud', merchant: 'x', nonce: 'n1' };
  const sig = signCharge(a, charge);
  assert.equal(verifyCharge(a, charge, sig), true);
  // меняем сумму — подпись больше не валидна
  assert.equal(verifyCharge(a, { ...charge, amount: 9999 }, sig), false);
});

// ---------- Движок целиком (async) ------------------------------------------
test('engine: проводит разрешённую трату и списывает баланс', async () => {
  reset();
  const a = createAgent('Buyer', 'test');
  setWallet(a.id, 100, RULES);
  const r = await processPay({ agentId: a.id, amount: 20, category: 'cloud', merchant: 'AWS' });
  assert.equal(r.decision, 'allow');
  assert.equal(db.wallets[a.id].balance, 80);
  assert.equal(db.wallets[a.id].spentToday, 20);
});

test('engine: блокирует запрещённую категорию, баланс не трогает', async () => {
  reset();
  const a = createAgent('Buyer', 'test');
  setWallet(a.id, 100, RULES);
  const r = await processPay({ agentId: a.id, amount: 10, category: 'gambling', merchant: 'Casino' });
  assert.equal(r.decision, 'deny');
  assert.equal(db.wallets[a.id].balance, 100);
});

test('engine: крупная трата ждёт подтверждения, затем проводится', async () => {
  reset();
  const a = createAgent('Buyer', 'test');
  setWallet(a.id, 100, RULES);
  const r = await processPay({ agentId: a.id, amount: 75, category: 'data', merchant: 'Dataset' });
  assert.equal(r.decision, 'needs_approval');
  assert.equal(db.wallets[a.id].balance, 100); // пока не списано
  const ar = await approve(r.approvalId);
  assert.equal(ar.decision, 'allow');
  assert.equal(db.wallets[a.id].balance, 25); // после подтверждения списано
});

test('engine: сделка агент↔агент зачисляет средства контрагенту', async () => {
  reset();
  const buyer = createAgent('Buyer', 'test');
  const seller = createAgent('Seller', 'test');
  setWallet(buyer.id, 100, RULES);
  setWallet(seller.id, 0, RULES);
  const r = await processPay({
    agentId: buyer.id, amount: 30, category: 'saas', merchant: 'Seller',
    counterpartyAgentId: seller.id,
  });
  assert.equal(r.decision, 'allow');
  assert.equal(db.wallets[buyer.id].balance, 70);
  assert.equal(db.wallets[seller.id].balance, 30); // продавцу зачислено
});
