'use strict';
// ============================================================================
//  Keyhole · Тесты репутационного графа
//  Запуск: node --test
//  Проверяют, что балл доверия растёт из честной истории и рушится от споров.
// ============================================================================

process.env.KEYHOLE_NO_PERSIST = '1';

const { test } = require('node:test');
const assert = require('node:assert');

const { createAgent, setWallet, reset, db } = require('../store');
const { processPay, dispute } = require('../engine');
const rep = require('../reputation');

const openRules = { dailyLimit: 1e9, perTxnApprovalThreshold: 1e9, allowedCategories: [], blockedCategories: [] };

test('reputation: новичок без истории = нейтральные 50', () => {
  reset();
  const a = createAgent('Fresh', 'test');
  assert.equal(rep.computeScore(a.stats), 50);
});

test('reputation: успешные операции поднимают балл выше 50', async () => {
  reset();
  const a = createAgent('Worker', 'test');
  setWallet(a.id, 10000, openRules);
  for (let i = 0; i < 5; i++) {
    await processPay({ agentId: a.id, amount: 10, category: 'cloud', merchant: 'x' });
  }
  assert.ok(db.agents[a.id].reputation > 50, `ожидали >50, получили ${db.agents[a.id].reputation}`);
});

test('reputation: отказы правил тянут долю успеха вниз', async () => {
  reset();
  const a = createAgent('Sloppy', 'test');
  setWallet(a.id, 10000, { dailyLimit: 1e9, perTxnApprovalThreshold: 1e9, allowedCategories: ['cloud'], blockedCategories: [] });
  await processPay({ agentId: a.id, amount: 10, category: 'cloud', merchant: 'x' });   // allow
  for (let i = 0; i < 4; i++) {
    await processPay({ agentId: a.id, amount: 10, category: 'data', merchant: 'x' });  // deny (нет в allowed)
  }
  // 1 успех из 5 → доля успеха низкая, балл ниже, чем у чистого новичка-работяги
  assert.ok(db.agents[a.id].reputation < 60, `ожидали <60, получили ${db.agents[a.id].reputation}`);
});

test('reputation: подтверждённый спор резко роняет балл', async () => {
  reset();
  const a = createAgent('Cheater', 'test');
  setWallet(a.id, 10000, openRules);
  const r = await processPay({ agentId: a.id, amount: 10, category: 'cloud', merchant: 'x' });
  const before = db.agents[a.id].reputation;
  const d = dispute(r.row.id);
  assert.equal(d.ok, true);
  assert.ok(db.agents[a.id].reputation < before - 10, `спор должен срезать >10 пунктов (было ${before}, стало ${db.agents[a.id].reputation})`);
});

test('reputation: повторный спор по той же операции отвергается', async () => {
  reset();
  const a = createAgent('Once', 'test');
  setWallet(a.id, 10000, openRules);
  const r = await processPay({ agentId: a.id, amount: 10, category: 'cloud', merchant: 'x' });
  assert.equal(dispute(r.row.id).ok, true);
  assert.equal(dispute(r.row.id).ok, false);
});

test('reputation: спор возможен только по проведённой операции', async () => {
  reset();
  const a = createAgent('Blocked', 'test');
  setWallet(a.id, 100, { dailyLimit: 5, perTxnApprovalThreshold: 1e9, allowedCategories: [], blockedCategories: [] });
  const r = await processPay({ agentId: a.id, amount: 10, category: 'cloud', merchant: 'x' }); // deny (лимит)
  assert.equal(dispute(r.row.id).ok, false);
});

test('reputation.graph: строит узлы и рёбра по сделкам агент↔агент', async () => {
  reset();
  const buyer = createAgent('Buyer', 'test');
  const seller = createAgent('Seller', 'test');
  setWallet(buyer.id, 10000, openRules);
  setWallet(seller.id, 0, openRules);
  await processPay({ agentId: buyer.id, amount: 30, category: 'saas', merchant: 'Seller', counterpartyAgentId: seller.id });
  const g = rep.graph();
  assert.equal(g.nodes.length, 2);
  const edge = g.edges.find((e) => e.from === buyer.id && e.to === seller.id);
  assert.ok(edge, 'ребро покупатель→продавец должно существовать');
  assert.equal(edge.count, 1);
});

test('reputation: разнообразие контрагентов поднимает балл выше, чем одна петля', async () => {
  // Агент A торгует с 4 разными → выше, чем агент B, гоняющий тот же объём в одного контрагента.
  reset();
  const A = createAgent('Diverse', 'test');
  setWallet(A.id, 100000, openRules);
  for (let i = 0; i < 4; i++) {
    const cp = createAgent('CP' + i, 'test');
    setWallet(cp.id, 0, openRules);
    await processPay({ agentId: A.id, amount: 10, category: 'saas', merchant: 'cp', counterpartyAgentId: cp.id });
  }
  const B = createAgent('Loopy', 'test');
  const single = createAgent('OnlyPartner', 'test');
  setWallet(B.id, 100000, openRules);
  setWallet(single.id, 0, openRules);
  for (let i = 0; i < 4; i++) {
    await processPay({ agentId: B.id, amount: 10, category: 'saas', merchant: 'p', counterpartyAgentId: single.id });
  }
  assert.ok(db.agents[A.id].reputation > db.agents[B.id].reputation,
    `разнообразие (${db.agents[A.id].reputation}) должно бить петлю (${db.agents[B.id].reputation})`);
});
