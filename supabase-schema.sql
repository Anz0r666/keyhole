-- ============================================================================
--  Keyhole · таблица состояния песочницы для serverless-режима (Vercel)
--  Всё состояние (агенты, кошельки, леджер, репутация, API-ключи) хранится
--  одной строкой-блобом JSONB. Запусти этот скрипт один раз в Supabase:
--    Dashboard → SQL Editor → New query → вставь → Run.
-- ============================================================================

create table if not exists public.keyhole_state (
  id         text primary key,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- RLS включён, политик НЕТ: читать/писать может только service_role-ключ
-- (он обходит RLS). Публичный anon-ключ к этой таблице доступа не имеет.
alter table public.keyhole_state enable row level security;
