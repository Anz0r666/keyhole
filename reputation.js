'use strict';
// ============================================================================
//  Keyhole · Репутационный граф (это «ров» продукта)
//  Балл доверия агента — НЕ счётчик «+1/−1», а функция от его истории:
//  доля успеха · опыт · разнообразие контрагентов · выдержка временем · споры.
//  Чем дольше агент честно работает в сети — тем дороже его репутация,
//  и тем труднее конкуренту скопировать накопленный граф связей.
// ============================================================================

const { db } = require('./store');

const NEUTRAL = 50; // стартовый балл новичка без истории

function blankStats() {
  return {
    approved: 0,          // успешно проведённых операций
    denied: 0,            // отклонено правилами
    disputed: 0,          // подтверждённых споров против агента
    volume: 0,            // суммарный оборот, прошедший ворота ($)
    counterparties: {},   // id контрагента -> число сделок (рёбра графа)
    firstAt: null,
    lastAt: null,
  };
}

function statsFor(agentId) {
  const a = db.agents[agentId];
  if (!a) return null;
  if (!a.stats) a.stats = blankStats();
  return a.stats;
}

// --- Вычисление балла из истории (0..100) -----------------------------------
function computeScore(stats) {
  if (!stats) return NEUTRAL;
  const total = stats.approved + stats.denied;
  if (total === 0 && stats.disputed === 0) return NEUTRAL; // новичок — нейтрально

  // 1) Надёжность: доля успешных операций.
  const successRate = total > 0 ? stats.approved / total : 0.5;

  // 2) Опыт: насыщается логарифмически (≈50 операций — почти полный вес).
  const experience = Math.min(1, Math.log10(1 + stats.approved) / Math.log10(1 + 50));

  // 3) Разнообразие контрагентов — ключевой сигнал ГРАФА.
  //    Торговля с многими разными агентами честнее, чем накрутка в петле.
  const distinct = Object.keys(stats.counterparties).length;
  const diversity = Math.min(1, distinct / 5);

  // 4) Выдержка временем: возраст истории, насыщается за ~30 дней.
  let ageDays = 0;
  if (stats.firstAt) ageDays = (Date.now() - new Date(stats.firstAt).getTime()) / 86400000;
  const maturity = Math.min(1, Math.max(0, ageDays) / 30);

  // Композит положительной репутации.
  let score =
    NEUTRAL +
    successRate * 25 +
    experience * 10 +
    diversity * 8 +
    maturity * 7;

  // Споры бьют резко и нелинейно — один подтверждённый спор стоит дорого.
  score -= stats.disputed * 15;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// Пересчитать и записать балл агента (вызывается после каждого события).
function refresh(agentId) {
  const a = db.agents[agentId];
  if (!a) return NEUTRAL;
  a.reputation = computeScore(statsFor(agentId));
  return a.reputation;
}

// --- События, двигающие репутацию -------------------------------------------
function recordApproved(charge) {
  const s = statsFor(charge.agentId);
  if (!s) return;
  const now = new Date().toISOString();
  s.approved += 1;
  s.volume += Number(charge.amount) || 0;
  s.firstAt = s.firstAt || now;
  s.lastAt = now;
  if (charge.counterpartyAgentId) {
    s.counterparties[charge.counterpartyAgentId] =
      (s.counterparties[charge.counterpartyAgentId] || 0) + 1;
    // Контрагент тоже наращивает историю (получил честную сделку).
    const cs = statsFor(charge.counterpartyAgentId);
    if (cs) {
      cs.approved += 1;
      cs.counterparties[charge.agentId] = (cs.counterparties[charge.agentId] || 0) + 1;
      cs.firstAt = cs.firstAt || now;
      cs.lastAt = now;
      refresh(charge.counterpartyAgentId);
    }
  }
  refresh(charge.agentId);
}

function recordDenied(agentId) {
  const s = statsFor(agentId);
  if (!s) return;
  s.denied += 1;
  s.lastAt = new Date().toISOString();
  refresh(agentId);
}

// Подтверждённый спор: человек/контрагент доказал, что агент повёл себя плохо.
function recordDispute(agentId) {
  const s = statsFor(agentId);
  if (!s) return false;
  s.disputed += 1;
  s.lastAt = new Date().toISOString();
  refresh(agentId);
  return true;
}

// --- Срез графа наружу (узлы + рёбра) для дашборда/инспекции -----------------
function graph() {
  const nodes = Object.values(db.agents).map((a) => ({
    id: a.id,
    name: a.name,
    reputation: a.reputation,
    approved: (a.stats && a.stats.approved) || 0,
    disputed: (a.stats && a.stats.disputed) || 0,
    volume: (a.stats && a.stats.volume) || 0,
  }));
  const edges = [];
  for (const a of Object.values(db.agents)) {
    const cps = (a.stats && a.stats.counterparties) || {};
    for (const [to, count] of Object.entries(cps)) {
      edges.push({ from: a.id, to, count });
    }
  }
  return { nodes, edges };
}

module.exports = {
  blankStats, statsFor, computeScore, refresh,
  recordApproved, recordDenied, recordDispute, graph, NEUTRAL,
};
