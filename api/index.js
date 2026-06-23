'use strict';
// ============================================================================
//  Keyhole · точка входа для Vercel (serverless)
//  Каждый запрос — холодный старт, поэтому:
//    1) hydrate() — поднимаем состояние песочницы из Supabase в память;
//    2) handle()  — тот же роутер, что и локально (server.js), без изменений;
//    3) flush()   — сбрасываем всё состояние обратно в Supabase.
//
//  Ответ буферизуется и отправляется ТОЛЬКО после flush() — иначе Vercel
//  может «заморозить» функцию раньше, чем запись в Supabase завершится.
// ============================================================================

const store = require('../store');
const { handle } = require('../router');

module.exports = async (req, res) => {
  await store.hydrate();
  store.ensureApiKey();

  await new Promise((resolve) => {
    const chunks = [];
    let statusCode = 200;
    let headers = {};

    const realWriteHead = res.writeHead.bind(res);
    const realEnd = res.end.bind(res);

    res.writeHead = (code, hdrs) => { statusCode = code; if (hdrs) headers = hdrs; return res; };
    res.write = (chunk) => { if (chunk) chunks.push(Buffer.from(chunk)); return true; };
    res.end = (chunk) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      store.flush().finally(() => {
        realWriteHead(statusCode, headers);
        realEnd(Buffer.concat(chunks));
        resolve();
      });
    };

    handle(req, res).catch((err) => {
      console.error('  ⚠️ Непойманная ошибка:', err && err.message);
      try {
        realWriteHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        realEnd(JSON.stringify({ error: 'Внутренняя ошибка сервера' }));
      } catch (_) { /* ответ уже отправлен */ }
      resolve();
    });
  });
};
