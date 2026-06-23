# 🚀 План запуска Keyhole — готовые тексты

Аудитория **узкая и точная**: разработчики ИИ-агентов (LangChain, AutoGPT, CrewAI, MCP, кастомные агенты).
Не «для всех» — а для тех, кто прямо сейчас строит автономных агентов и упрётся в вопрос «как агенту платить безопасно».

Логика дистрибуции: **GitHub — это дом продукта** (SDK = точка входа разработчика, наш «ров»).
Reddit / Hacker News / Discord — это **трафик в дом**. Сначала дом, потом трафик.

---

## Очередность (по дням)

| День | Канал | Действие |
|------|-------|----------|
| 1 | **GitHub** | Залить репозиторий, оформить README, повесить топики `ai-agents` `payments` `autonomous-agents` |
| 2 | **Reddit r/AI_Agents** | Пост «Show: …» (текст ниже) |
| 3 | **Reddit r/LocalLLaMA + r/SideProject** | Адаптированные посты |
| 4 | **Hacker News** | «Show HN» (текст ниже) — постить во вторник–четверг ~16:00 UTC |
| 5 | **Discord-сообщества** | LangChain, AutoGPT, CrewAI — короткое сообщение в #show-and-tell |
| 7 | **Product Hunt** | Запуск (опционально, когда будет демо-видео) |

> Правило: на каждый пост — **отвечать на все комментарии в первые 2 часа**. Ранний отклик = вес в ленте.

---

## 1. GitHub — описание репозитория (About)

> Payment + identity + programmable-rules layer for autonomous AI agents. When the agent — not the human — clicks "buy": who is it, what's allowed, who's liable. Pure Node, zero deps.

Топики: `ai-agents` `autonomous-agents` `payments` `identity` `ed25519` `mcp` `langchain` `nodejs`

---

## 2. Reddit — r/AI_Agents

**Заголовок:**
`I built a "Stripe for AI agents" — identity + spending rules layer so your agent can pay safely (open source, zero deps)`

**Текст:**
```
Когда автономный агент сам жмёт "купить", встаёт три вопроса: кто это, что ему можно, и кто отвечает если он ошибётся.

Я собрал Keyhole — слой, через который проходит каждая операция агента, прежде чем уйдут деньги:

🪪 Identity — у каждого агента своя криптопара (Ed25519). Агент подписывает операцию, самозванец отсекается.
🎛️ Rules — дневной лимит, белый/чёрный список категорий, порог авто-подтверждения. Зашиты на уровне платежа, а не "честного слова" модели.
👤 Human approval — крупная трата зависает и ждёт человека.
🤝 Agent-to-agent trust — сделка между двумя агентами проверяет репутацию контрагента.

Чистый Node, ноль зависимостей. Запуск: `node server.js` → дашборд + интерактивный конструктор, где можно руками гонять траты и смотреть, как они проходят/блокируются.

Пока это sandbox (без реальных денег) — но движение денег вынесено в адаптер, под Stripe Issuing / стейблкоины каркас готов.

Репо: <ССЫЛКА GITHUB>

Строю в открытую. Буду рад жёсткой обратной связи: какой защиты не хватает вашему агенту?
```

---

## 3. Reddit — r/SideProject (тон «индихакер»)

**Заголовок:**
`Solo dev, $0 budget: built the payment+identity layer for AI agents in pure Node`

**Текст:** (короче, упор на историю «один человек + ПК»)
```
Тезис простой: будет золотая лихорадка автономных агентов — продавай лопаты, а не золото.
Лопата здесь — слой, который отвечает за вопрос "как агенту платить, не разорив владельца".

Keyhole пропускает каждую операцию агента через 4 ворот: личность (Ed25519-подпись), правила (лимиты/категории), подтверждение человека на крупное, доверие агент↔агент.

Чистый Node, ноль зависимостей, 26 автотестов, аудит безопасности в репо.
Сейчас тестовый режим — показать суть. Дальше реальные рельсы.

<ССЫЛКА GITHUB>

Что бы вы добавили первым делом?
```

---

## 4. Hacker News — Show HN

**Заголовок:**
`Show HN: Keyhole – Identity and spending-rules layer for autonomous AI agents`

**Первый комментарий (от автора, обязателен):**
```
Author here. The problem I kept hitting: the moment you let an agent spend money
autonomously, you have no enforcement boundary. The model "promises" to stay
within budget, but nothing actually stops it.

Keyhole puts a gate in front of the money. Every operation goes through:
identity (each agent signs with its own Ed25519 key), rules (daily limit,
category allow/block, approval threshold — enforced at the payment layer, not in
the prompt), human approval for large amounts, and agent-to-agent trust checks.

Pure Node, zero dependencies. Currently sandbox-only (no real money) so the
mechanics are easy to inspect; money movement is behind a rails adapter with
Stripe Issuing / stablecoin stubs ready.

Security audit and 26 tests are in the repo. Would love feedback on the threat
model — especially what enforcement you'd want before trusting an agent with a
real card.
```

---

## 5. Discord (LangChain / AutoGPT / CrewAI, канал #show-and-tell)

```
Сделал open-source слой для платежей агентов: identity (Ed25519) + правила трат
(лимиты/категории/порог подтверждения) + доверие агент↔агент. Чистый Node, ноль
зависимостей, есть SDK на 3 строки. Sandbox-режим, аудит безопасности внутри.
Буду рад фидбэку → <ССЫЛКА GITHUB>
```

---

## Что важно НЕ делать

- Не спамить одинаковым текстом во все сабреддиты в один день — забанят. Разнести по дням, адаптировать тон.
- Не называть это «продакшн для реальных денег» — пока sandbox. Честность = доверие = первые звёзды.
- Не просить звёзды напрямую. Просить **фидбэк по threat-модели** — это и есть приглашение посмотреть код.

---

## Метрики первой недели (за чем следим)

- ⭐ GitHub stars (цель недели: 50 — порог, после которого репо начинает само попадать в trending)
- 🧵 Комментарии на Reddit/HN (каждый — потенциальный первый пользователь SDK)
- 🔱 Forks (форк = кто-то реально пробует встроить)
