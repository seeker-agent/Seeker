-- =====================================================================
--  Seeker — приём заявок на возврат и обращений по чарджбэку.
--
--  Выполните этот файл в Supabase → SQL Editor → New query → Run.
--  После этого форма на payment-refund.html начнёт писать заявки в таблицу
--  refund_requests (а не в несуществующий /api/refund).
--
--  Кто и что может:
--    * любой посетитель сайта (роль anon) — только ДОБАВИТЬ заявку;
--    * прочитать заявки может только вошедший пользователь — свои;
--    * вы (владелец проекта) видите все заявки в Table Editor.
-- =====================================================================

create extension if not exists "pgcrypto";

create table if not exists public.refund_requests (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  kind        text not null default 'refund',          -- refund | chargeback
  order_ref   text not null,                            -- номер заказа
  email       text not null,                            -- почта плательщика
  reason      text,                                     -- код причины
  comment     text,                                     -- комментарий
  paid_on     date,                                     -- дата оплаты (необязательно)
  status      text not null default 'new',              -- new | in_progress | approved | declined
  user_id     uuid references auth.users (id) on delete set null,
  page        text,                                     -- адрес страницы, с которой отправили
  user_agent  text,
  constraint refund_order_len   check (char_length(order_ref) between 2 and 120),
  constraint refund_email_len   check (char_length(email) between 3 and 200),
  constraint refund_comment_len check (comment is null or char_length(comment) <= 4000),
  constraint refund_email_shape check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create index if not exists refund_requests_created_at_idx
  on public.refund_requests (created_at desc);

create index if not exists refund_requests_email_idx
  on public.refund_requests (lower(email));

alter table public.refund_requests enable row level security;

-- Посетитель сайта может только добавить заявку.
drop policy if exists "refund_requests_insert_public" on public.refund_requests;
create policy "refund_requests_insert_public"
  on public.refund_requests
  for insert
  to anon, authenticated
  with check (
    status = 'new'
    and char_length(order_ref) between 2 and 120
    and char_length(email) between 3 and 200
    and (comment is null or char_length(comment) <= 4000)
  );

-- Вошедший пользователь видит свои заявки (например, в панели управления).
drop policy if exists "refund_requests_select_own" on public.refund_requests;
create policy "refund_requests_select_own"
  on public.refund_requests
  for select
  to authenticated
  using (auth.uid() = user_id);

grant insert on public.refund_requests to anon, authenticated;
grant select on public.refund_requests to authenticated;

-- ---------------------------------------------------------------------
--  Уведомление о новой заявке (по желанию, но очень полезно).
--  Вариант «без кода»: Supabase → Database → Webhooks → Create a new hook
--    Table: refund_requests, Events: INSERT, Type: HTTP Request,
--    URL: адрес вашей точки приёма (Telegram-бот через Edge Function,
--    Make/Zapier/n8n, или почтовый шлюз вроде Resend/SendGrid).
--
--  Вариант «письмо сразу из базы» через pg_net — раскомментируйте и
--  подставьте свой webhook:
--
--  create or replace function public.notify_refund_request()
--  returns trigger
--  language plpgsql
--  security definer
--  set search_path = public
--  as $$
--  begin
--    perform net.http_post(
--      url     := 'https://ВАШ-ВЕБХУК',
--      headers := jsonb_build_object('Content-Type', 'application/json'),
--      body    := jsonb_build_object(
--                   'text', 'Заявка на возврат: ' || new.order_ref
--                           || ' / ' || new.email
--                           || ' / ' || coalesce(new.reason, '—')
--                           || ' / ' || coalesce(new.comment, '')
--                 )
--    );
--    return new;
--  end;
--  $$;
--
--  create trigger refund_request_notify
--    after insert on public.refund_requests
--    for each row execute function public.notify_refund_request();
-- ---------------------------------------------------------------------
