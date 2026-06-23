'use strict';
// ============================================================================
//  Keyhole · Локальный API-сервер + дашборд  (чистый Node, без зависимостей)
//  Вся логика маршрутизации — в router.js (общая с serverless-точкой Vercel).
//  Запуск:  node local-server.js   →   http://localhost:4178
// ============================================================================

const http = require('http');
const { load, ensureApiKey } = require('./store');
const { getRails } = require('./rails');
const { handle, sendJSON } = require('./router');

const PORT = process.env.PORT || 4178;

// --- Устойчивость: ни одно исключение не роняет сервер ----------------------
const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('  ⚠️ Непойманная ошибка:', err && err.message);
    try { sendJSON(res, 500, { error: 'Внутренняя ошибка сервера' }); } catch (_) { /* ответ уже отправлен */ }
  });
});

process.on('uncaughtException', (err) => console.error('  ⚠️ uncaughtException:', err && err.message));
process.on('unhandledRejection', (err) => console.error('  ⚠️ unhandledRejection:', err && (err.message || err)));

// Локальный запуск (node local-server.js). На Vercel этот файл не используется —
// там точка входа api/index.js сама делает hydrate → handle → flush.
if (require.main === module) {
  const restored = load();
  const apiKey = ensureApiKey();
  server.listen(PORT, () => {
    console.log(`\n  🔑 Keyhole [ТЕСТОВЫЙ режим] запущен`);
    console.log(`  → Дашборд:     http://localhost:${PORT}`);
    console.log(`  → Презентация: http://localhost:${PORT}/deck`);
    console.log(`  → Health:      http://localhost:${PORT}/health`);
    console.log(`  → Рельсы:      ${getRails().name}`);
    console.log(`  → Состояние:   ${restored ? 'восстановлено с диска' : 'чистое'}`);
    console.log(`  → API-ключ:    ${apiKey}`);
    console.log(`  Защита: валидация · auth · rate-limit · заголовки · устойчивость.\n`);
  });
}

module.exports = { server, handle, runScenario: require('./router').runScenario };
