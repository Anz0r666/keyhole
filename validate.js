'use strict';
// ============================================================================
//  Keyhole · Валидация входных данных
//  Первый рубеж обороны: ни одна «грязь» не доходит до движка денег.
//  Закрывает: отрицательные/NaN суммы, мусорные строки, инъекции в категории.
// ============================================================================

const MAX_AMOUNT = 1e9;        // потолок суммы одной операции
const MAX_BALANCE = 1e12;      // потолок баланса
const MAX_NAME = 64;           // длина имени/владельца
const MAX_CATS = 50;           // макс. категорий в списке
const CATEGORY_RE = /^[a-z0-9_-]{1,40}$/;
const CONTROL_RE = /[\x00-\x1f\x7f]/g;

class ValidationError extends Error {}

// Конечное положительное число в разумных границах
function amount(x, { max = MAX_AMOUNT } = {}) {
  const n = Number(x);
  if (!Number.isFinite(n)) throw new ValidationError('Сумма должна быть числом');
  if (n <= 0) throw new ValidationError('Сумма должна быть больше нуля');
  if (n > max) throw new ValidationError(`Сумма превышает максимум ($${max})`);
  return n;
}

// Неотрицательное конечное число (для балансов, лимитов)
function nonNegative(x, { max = MAX_BALANCE, field = 'значение' } = {}) {
  const n = Number(x);
  if (!Number.isFinite(n)) throw new ValidationError(`${field}: должно быть числом`);
  if (n < 0) throw new ValidationError(`${field}: не может быть отрицательным`);
  if (n > max) throw new ValidationError(`${field}: превышает максимум`);
  return n;
}

// Строка: режем контрол-символы, ограничиваем длину
function text(x, { max = MAX_NAME, field = 'строка', required = true } = {}) {
  if (x === undefined || x === null || x === '') {
    if (required) throw new ValidationError(`${field}: обязательное поле`);
    return '';
  }
  if (typeof x !== 'string') throw new ValidationError(`${field}: должно быть строкой`);
  // eslint-disable-next-line no-control-regex
  const clean = x.replace(CONTROL_RE, '').trim();
  if (!clean) throw new ValidationError(`${field}: пустое значение`);
  if (clean.length > max) throw new ValidationError(`${field}: слишком длинно (макс ${max})`);
  return clean;
}

// Категория: строгий формат, никакого мусора
function category(x) {
  const c = String(x || '').trim().toLowerCase();
  if (!CATEGORY_RE.test(c)) {
    throw new ValidationError(`Категория «${x}» недопустима (только a-z, 0-9, _, -; до 40 симв.)`);
  }
  return c;
}

// Список категорий
function categoryList(arr, { field = 'категории' } = {}) {
  if (arr === undefined || arr === null) return [];
  if (!Array.isArray(arr)) throw new ValidationError(`${field}: должно быть списком`);
  if (arr.length > MAX_CATS) throw new ValidationError(`${field}: слишком много (макс ${MAX_CATS})`);
  return arr.map((c) => category(c));
}

// Правила кошелька целиком
function rules(r) {
  if (r === undefined || r === null) r = {};
  if (typeof r !== 'object' || Array.isArray(r)) throw new ValidationError('rules: должно быть объектом');
  return {
    dailyLimit: r.dailyLimit === undefined ? undefined
      : nonNegative(r.dailyLimit, { field: 'dailyLimit' }),
    perTxnApprovalThreshold: r.perTxnApprovalThreshold === undefined ? undefined
      : nonNegative(r.perTxnApprovalThreshold, { field: 'perTxnApprovalThreshold' }),
    allowedCategories: categoryList(r.allowedCategories, { field: 'allowedCategories' }),
    blockedCategories: categoryList(r.blockedCategories, { field: 'blockedCategories' }),
  };
}

// id-ссылки на агентов
function id(x, { field = 'id', required = true } = {}) {
  if (!x) {
    if (required) throw new ValidationError(`${field}: обязательное поле`);
    return undefined;
  }
  const s = String(x);
  if (!/^[a-z0-9_]{1,40}$/i.test(s)) throw new ValidationError(`${field}: недопустимый формат`);
  return s;
}

module.exports = {
  ValidationError, amount, nonNegative, text, category, categoryList, rules, id,
  MAX_AMOUNT, MAX_BALANCE, MAX_NAME,
};
