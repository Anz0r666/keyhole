'use strict';
// ============================================================================
//  Keyhole · Движок правил (Policy Engine)
//  Сердце продукта: решает, можно ли агенту провести трату.
//  Возвращает одно из трёх решений: allow | needs_approval | deny
// ============================================================================

/**
 * @param {object} wallet  кошелёк агента (rules, spentToday)
 * @param {object} charge  трата { amount, category, merchant }
 * @returns {{decision:'allow'|'needs_approval'|'deny', reason:string, rule:string}}
 */
function evaluate(wallet, charge) {
  const r = wallet.rules;
  const amount = Number(charge.amount);
  const cat = (charge.category || '').toLowerCase();

  // 1) Чёрный список категорий — жёсткий запрет
  if (Array.isArray(r.blockedCategories) && r.blockedCategories.includes(cat)) {
    return {
      decision: 'deny',
      reason: `Категория «${cat}» в чёрном списке`,
      rule: 'blockedCategories',
    };
  }

  // 2) Белый список категорий — если задан, всё остальное запрещено
  if (Array.isArray(r.allowedCategories) && r.allowedCategories.length > 0
      && !r.allowedCategories.includes(cat)) {
    return {
      decision: 'deny',
      reason: `Категория «${cat}» вне списка разрешённых`,
      rule: 'allowedCategories',
    };
  }

  // 3) Дневной лимит — нельзя выйти за рамки суммарных трат за день
  if (typeof r.dailyLimit === 'number' && (wallet.spentToday + amount) > r.dailyLimit) {
    return {
      decision: 'deny',
      reason: `Превышен дневной лимит ($${r.dailyLimit}). Уже потрачено $${wallet.spentToday}, попытка +$${amount}`,
      rule: 'dailyLimit',
    };
  }

  // 4) Порог подтверждения человеком — крупная трата требует «зелёного света»
  if (typeof r.perTxnApprovalThreshold === 'number' && amount > r.perTxnApprovalThreshold) {
    return {
      decision: 'needs_approval',
      reason: `Сумма $${amount} выше порога $${r.perTxnApprovalThreshold} — нужно подтверждение человека`,
      rule: 'perTxnApprovalThreshold',
    };
  }

  // 5) Всё чисто — пропускаем
  return {
    decision: 'allow',
    reason: 'Трата в рамках всех правил',
    rule: 'ok',
  };
}

module.exports = { evaluate };
