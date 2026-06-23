'use strict';
// ============================================================================
//  Пример: автономный ИИ-агент, который сам закупается через Keyhole SDK
//  Запуск (сервер должен быть запущен: node server.js):
//      node example-agent.js
//
//  Это показывает, как разработчик встраивает Keyhole за 3 строки — и его
//  агент получает безопасные деньги: личность, лимиты, ответственность.
// ============================================================================

const Keyhole = require('./keyhole-sdk');
const fs = require('fs');
const path = require('path');

// Берём API-ключ: из env, иначе локально из сохранённого состояния (удобство для теста)
function localApiKey() {
  if (process.env.KEYHOLE_KEY) return process.env.KEYHOLE_KEY;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'state.json'), 'utf8'));
    return (d.apiKeys && d.apiKeys[0]) || '';
  } catch { return ''; }
}

// --- Имитация «мышления» агента: список задач, которые он решил оплатить ----
const SHOPPING_PLAN = [
  { amount: 19,  category: 'saas',     merchant: 'OpenRouter API', why: 'нужны кредиты на LLM' },
  { amount: 12,  category: 'cloud',    merchant: 'AWS S3',         why: 'хранилище для данных' },
  { amount: 250, category: 'cloud',    merchant: 'GPU instance',   why: 'хочу арендовать GPU' },
  { amount: 8,   category: 'gambling', merchant: 'BetSite',        why: 'агента «занесло»' },
  { amount: 70,  category: 'data',     merchant: 'Dataset Pro',    why: 'купить датасет' },
];

async function main() {
  console.log('\n  🤖 Автономный агент стартует. Подключаю Keyhole (3 строки)…\n');

  // ===== 3 строки интеграции =====
  const kh = new Keyhole('http://localhost:4178', localApiKey());
  const agent = await kh.createAgent('AutoShopper', {
    balance: 300, dailyLimit: 200, threshold: 50,
    allowed: ['saas', 'cloud', 'data', 'api'], blocked: ['gambling'],
  });
  // ================================

  console.log(`  🪪 Агент зарегистрирован: ${agent.info.name} (паспорт #${agent.info.fingerprint})`);
  console.log(`  💼 Бюджет $300 · лимит $200/день · авто до $50 · блок: gambling\n`);
  console.log('  ' + '─'.repeat(64));

  for (const task of SHOPPING_PLAN) {
    const r = await agent.pay(task);
    const icon = r.decision === 'allow' ? '✅' : r.decision === 'deny' ? '⛔' : '⏳';
    const verdict = r.decision === 'allow' ? 'КУПЛЕНО'
      : r.decision === 'deny' ? 'ЗАБЛОКИРОВАНО' : 'ЖДЁТ ЧЕЛОВЕКА';
    console.log(`  ${icon} «${task.why}»`);
    console.log(`     $${task.amount} · ${task.category} · ${task.merchant} → ${verdict}`);
    console.log(`     ↳ ${r.reason}`);
    console.log('  ' + '─'.repeat(64));
  }

  const bal = await agent.balance();
  const rep = await agent.reputation();
  console.log(`\n  💰 Остаток бюджета агента: $${bal}`);
  console.log(`  🕸️ Балл доверия агента (репутационный граф): ${rep}/100`);
  console.log('  🔑 Keyhole не дал агенту выйти за рамки. Деньги под контролем.\n');
}

main().catch((e) => {
  console.error('\n  ⚠️  Сервер не запущен? Сначала: node server.js');
  console.error('     ' + e.message + '\n');
});
