'use strict';
// ============================================================================
//  Keyhole · Демо из терминала (без сервера и браузера)
//  Запуск:  node demo.js
//  Показывает все ворота Keyhole прямо в консоли.
// ============================================================================

process.env.KEYHOLE_NO_PERSIST = '1'; // демо не трогает сохранённое состояние

const { createAgent, setWallet, reset, snapshot } = require('./store');
const { processPay, approve } = require('./engine');

function line() { console.log('─'.repeat(66)); }

async function main() {
  reset();
  console.log('\n  🔑 KEYHOLE — демонстрация (ТЕСТОВЫЙ режим, без реальных денег)');
  line();

  const shopper = createAgent('ShopperBot', 'Ты (владелец)');
  const supplier = createAgent('SupplierBot', 'Партнёр-магазин');

  setWallet(shopper.id, 500, {
    dailyLimit: 200,
    perTxnApprovalThreshold: 50,
    allowedCategories: ['cloud', 'saas', 'data', 'api'],
    blockedCategories: ['gambling', 'crypto-gambling'],
  });
  setWallet(supplier.id, 0, {
    dailyLimit: 1000, perTxnApprovalThreshold: 1000,
    allowedCategories: [], blockedCategories: [],
  });

  console.log(`  🪪 ShopperBot — паспорт #${shopper.fingerprint}, баланс $500`);
  console.log(`  🪪 SupplierBot — паспорт #${supplier.fingerprint}`);
  console.log(`  🎛️ Правила ShopperBot: $200/день · авто до $50 · разрешено cloud/saas/data/api · блок gambling`);
  line();

  const steps = [
    { amount: 20,  category: 'cloud',    merchant: 'AWS credits' },
    { amount: 300, category: 'cloud',    merchant: 'Big server' },
    { amount: 10,  category: 'gambling', merchant: 'Casino API' },
    { amount: 75,  category: 'data',     merchant: 'Dataset Pro' },
    { amount: 30,  category: 'saas',     merchant: 'SupplierBot', counterpartyAgentId: supplier.id },
  ];

  let pendingId = null;
  for (const s of steps) {
    const r = await processPay({ agentId: shopper.id, ...s });
    const icon = r.decision === 'allow' ? '✅' : r.decision === 'deny' ? '⛔' : '⏳';
    console.log(`  ${icon} $${String(s.amount).padEnd(4)} ${s.category.padEnd(9)} ${s.merchant.padEnd(14)} → ${r.decision.toUpperCase()}`);
    console.log(`      ↳ ${r.row.reason}`);
    if (r.decision === 'needs_approval') pendingId = r.approvalId;
  }

  if (pendingId) {
    line();
    console.log('  👤 Человек подтверждает крупную трату $75…');
    const ar = await approve(pendingId);
    const icon = ar.decision === 'allow' ? '✅' : '⛔';
    console.log(`  ${icon} После подтверждения → ${ar.decision.toUpperCase()} (${ar.row.reason})`);
  }

  line();
  const st = snapshot();
  const sw = st.wallets.find((w) => w.agentId === shopper.id);
  const pw = st.wallets.find((w) => w.agentId === supplier.id);
  console.log(`  💰 Итог ShopperBot: баланс $${sw.balance}, потрачено за день $${sw.spentToday}`);
  console.log(`  💰 Итог SupplierBot: получено $${pw.balance}`);
  console.log(`  📒 Операций в леджере: ${st.ledger.length} (все подписаны и проверены)`);
  line();
  console.log('  Готово. Это ядро Keyhole в действии.\n');
}

main();
