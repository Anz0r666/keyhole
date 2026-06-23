'use strict';
// ============================================================================
//  Keyhole · Адаптер платёжных рельсов
//  Абстракция «движения денег». Сейчас — песочница. Завтра — реальные рельсы.
//  Меняешь только реализацию: бизнес-логика (личность/правила/доверие) не трогается.
//
//    authorize(charge) → { ok, ref }   // зарезервировать средства
//
//  Выбор рельсов через окружение:
//    (по умолчанию)        → SandboxRails  (без реальных денег)
//    STRIPE_KEY=sk_...      → StripeRails   (Stripe Issuing, заглушка под ключ)
// ============================================================================

const crypto = require('crypto');

// --- Песочница: имитирует мгновенную авторизацию, денег не двигает ----------
class SandboxRails {
  constructor() { this.name = 'sandbox'; }
  async authorize(charge) {
    return { ok: true, ref: 'sbx_' + crypto.randomBytes(6).toString('hex') };
  }
}

// --- Stripe Issuing: каркас под реальные виртуальные карты -------------------
//     Когда у тебя появится ключ Stripe — здесь подключается настоящий вызов.
class StripeRails {
  constructor(apiKey) { this.name = 'stripe'; this.apiKey = apiKey; }
  async authorize(charge) {
    if (!this.apiKey) {
      throw new Error('StripeRails: нужен ключ Stripe Issuing (env STRIPE_KEY)');
    }
    // TODO (этап «реальные рельсы»):
    //   1. Выпустить/использовать виртуальную карту агента
    //   2. POST authorization в Stripe Issuing на сумму charge.amount
    //   3. Вернуть { ok, ref: stripeAuthId }
    // Сейчас — честная заглушка, чтобы не делать вид, что деньги двигаются.
    throw new Error('StripeRails ещё не активирован — это следующий этап дорожной карты');
  }
}

// --- Стейблкоины (x402 / USDC): второй вектор реальных рельсов ---------------
class StablecoinRails {
  constructor() { this.name = 'stablecoin'; }
  async authorize(charge) {
    throw new Error('StablecoinRails (x402/USDC) — запланирован на этап «реальные рельсы»');
  }
}

let _instance = null;
function getRails() {
  if (_instance) return _instance;
  if (process.env.STRIPE_KEY) _instance = new StripeRails(process.env.STRIPE_KEY);
  else if (process.env.RAILS === 'stablecoin') _instance = new StablecoinRails();
  else _instance = new SandboxRails();
  return _instance;
}

module.exports = { getRails, SandboxRails, StripeRails, StablecoinRails };
