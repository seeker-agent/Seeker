-- =====================================================================
--  Seeker — роль «модератор», доступ к заявкам на возврат и журналам.
--
--  Как применить:
--    1) Supabase → SQL Editor → New query → вставьте этот файл → Run.
--    2) Выдайте себе роль:
--         select public.grant_role_by_email('ваша@почта.ru', 'moderator');
--    3) Обновите dashboard.html — появится кнопка «Режим модератора».
--
--  Кто и что может:
--    * обычный посетитель  — отправить заявку (insert в refund_requests);
--    * вошедший пользователь — увидеть свои заявки;
--    * модератор (support / moderator / admin / owner) — увидеть все заявки,
--      менять их статус, писать комментарии, читать журналы;
--    * менять роли может только владелец проекта через SQL Editor —
--      клиентские приложения не могут выдать себе роль.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
--  0. Базовая таблица заявок (если supabase/refund_requests.sql
--     ещё не выполнялся). Блок безопасно запускать повторно.
-- ---------------------------------------------------------------------

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

-- 0.1. Если таблица уже была создана более старой версией скрипта,
--      догоняем недостающие поля (иначе упадут индексы и политики ниже).
alter table public.refund_requests
  add column if not exists kind           text default 'refund',
  add column if not exists order_ref      text,
  add column if not exists email          text,
  add column if not exists reason         text,
  add column if not exists comment        text,
  add column if not exists paid_on        date,
  add column if not exists status         text default 'new',
  add column if not exists user_id        uuid,
  add column if not exists page           text,
  add column if not exists user_agent     text,
  add column if not exists refund_amount  numeric(12, 2),
  add column if not exists currency       text default 'RUB',
  add column if not exists moderator_note text,
  add column if not exists handled_by     uuid,
  add column if not exists handled_at     timestamptz;

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

-- Вошедший пользователь видит свои заявки.
drop policy if exists "refund_requests_select_own" on public.refund_requests;
create policy "refund_requests_select_own"
  on public.refund_requests
  for select
  to authenticated
  using (auth.uid() = user_id);

grant insert on public.refund_requests to anon, authenticated;
grant select on public.refund_requests to authenticated;

-- ---------------------------------------------------------------------
--  1. Таблица ролей
-- ---------------------------------------------------------------------

create table if not exists public.user_roles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  role         text not null default 'user',
  email        text,
  display_name text,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint user_roles_role_check
    check (role in ('user', 'support', 'moderator', 'admin', 'owner'))
);

create index if not exists user_roles_role_idx on public.user_roles (role);
create index if not exists user_roles_email_idx on public.user_roles (lower(email));

alter table public.user_roles enable row level security;

-- ---------------------------------------------------------------------
--  2. Проверка «это модератор?»
--     security definer — функция читает таблицу в обход RLS,
--     наружу отдаёт только boolean, поэтому безопасна.
-- ---------------------------------------------------------------------

create or replace function public.is_moderator(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles r
     where r.user_id = p_user
       and r.role in ('support', 'moderator', 'admin', 'owner')
  );
$$;

revoke all on function public.is_moderator(uuid) from public;
grant execute on function public.is_moderator(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
--  3. Выдача и снятие роли по почте (только из SQL Editor / service_role)
-- ---------------------------------------------------------------------

create or replace function public.grant_role_by_email(
  p_email text,
  p_role  text default 'moderator',
  p_note  text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid;
  v_email text := lower(trim(p_email));
begin
  if v_email is null or v_email = '' then
    return 'ошибка: не указана почта';
  end if;

  if p_role not in ('user', 'support', 'moderator', 'admin', 'owner') then
    return 'ошибка: неизвестная роль ' || coalesce(p_role, 'null');
  end if;

  select u.id
    into v_user
    from auth.users u
   where lower(u.email) = v_email
   order by u.created_at
   limit 1;

  if v_user is null then
    return 'пользователь ' || v_email || ' ещё не входил на сайт — пусть войдёт и повторите';
  end if;

  insert into public.user_roles (user_id, role, email, note, updated_at)
  values (v_user, p_role, v_email, p_note, now())
  on conflict (user_id) do update
    set role       = excluded.role,
        email      = coalesce(excluded.email, public.user_roles.email),
        note       = coalesce(excluded.note, public.user_roles.note),
        updated_at = now();

  return 'ok: ' || v_email || ' → ' || p_role;
end;
$$;

create or replace function public.revoke_role(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
begin
  update public.user_roles
     set role = 'user', updated_at = now()
   where lower(email) = v_email;

  if not found then
    return 'запись не найдена для ' || coalesce(v_email, 'null');
  end if;

  return 'ok: ' || v_email || ' → user';
end;
$$;

revoke all on function public.grant_role_by_email(text, text, text) from public, anon, authenticated;
revoke all on function public.revoke_role(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  4. Политики доступа к user_roles
--     Читать: свою строку или модератор. Писать: только SQL Editor.
-- ---------------------------------------------------------------------

drop policy if exists "user_roles_select_own" on public.user_roles;
create policy "user_roles_select_own"
  on public.user_roles
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_roles_select_moderator" on public.user_roles;
create policy "user_roles_select_moderator"
  on public.user_roles
  for select
  to authenticated
  using (public.is_moderator());

grant select on public.user_roles to authenticated;

-- ---------------------------------------------------------------------
--  5. Поля модератора в refund_requests
-- ---------------------------------------------------------------------

alter table public.refund_requests
  add column if not exists moderator_note   text,
  add column if not exists handled_by       uuid references auth.users (id) on delete set null,
  add column if not exists handled_by_email text,
  add column if not exists handled_at       timestamptz,
  add column if not exists refund_amount    numeric(12, 2);

create index if not exists refund_requests_status_idx
  on public.refund_requests (status, created_at desc);

create index if not exists refund_requests_kind_idx
  on public.refund_requests (kind, created_at desc);

-- Модератор видит все заявки
drop policy if exists "refund_requests_select_moderator" on public.refund_requests;
create policy "refund_requests_select_moderator"
  on public.refund_requests
  for select
  to authenticated
  using (public.is_moderator());

-- Модератор меняет статус и комментарий
drop policy if exists "refund_requests_update_moderator" on public.refund_requests;
create policy "refund_requests_update_moderator"
  on public.refund_requests
  for update
  to authenticated
  using (public.is_moderator())
  with check (public.is_moderator());

grant update on public.refund_requests to authenticated;

-- ---------------------------------------------------------------------
--  6. Журнал действий по заявкам
-- ---------------------------------------------------------------------

create table if not exists public.refund_events (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  request_id   uuid references public.refund_requests (id) on delete cascade,
  order_ref    text,
  action       text not null,
  from_status  text,
  to_status    text,
  actor_id     uuid references auth.users (id) on delete set null,
  actor_email  text,
  note         text
);

create index if not exists refund_events_created_idx
  on public.refund_events (created_at desc);

create index if not exists refund_events_request_idx
  on public.refund_events (request_id, created_at desc);

alter table public.refund_events enable row level security;

drop policy if exists "refund_events_select_moderator" on public.refund_events;
create policy "refund_events_select_moderator"
  on public.refund_events
  for select
  to authenticated
  using (public.is_moderator());

drop policy if exists "refund_events_insert_moderator" on public.refund_events;
create policy "refund_events_insert_moderator"
  on public.refund_events
  for insert
  to authenticated
  with check (public.is_moderator() and actor_id = auth.uid());

grant select, insert on public.refund_events to authenticated;

-- ---------------------------------------------------------------------
--  7. Журнал ответов платёжной системы (пишет payment-callback.html)
-- ---------------------------------------------------------------------

create table if not exists public.payment_events (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  order_id    text,
  status      text,
  raw_status  text,
  plan        text,
  amount      text,
  email       text,
  reason      text,
  refund_id   text,
  case_id     text,
  source      text default 'payment-callback',
  raw         jsonb
);

create index if not exists payment_events_created_idx
  on public.payment_events (created_at desc);

create index if not exists payment_events_order_idx
  on public.payment_events (order_id);

alter table public.payment_events enable row level security;

-- Ответ платёжной системы может записать кто угодно (это публичная страница),
-- но прочитать его может только модератор.
drop policy if exists "payment_events_insert_public" on public.payment_events;
create policy "payment_events_insert_public"
  on public.payment_events
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "payment_events_select_moderator" on public.payment_events;
create policy "payment_events_select_moderator"
  on public.payment_events
  for select
  to authenticated
  using (public.is_moderator());

grant insert on public.payment_events to anon, authenticated;
grant select on public.payment_events to authenticated;

-- ---------------------------------------------------------------------
--  8. Сводка для панели модератора
-- ---------------------------------------------------------------------

create or replace view public.moderation_summary as
select
  count(*)                                              as total,
  count(*) filter (where status = 'new')                as new_count,
  count(*) filter (where status = 'in_progress')        as in_progress_count,
  count(*) filter (where status = 'approved')           as approved_count,
  count(*) filter (where status = 'declined')           as declined_count,
  count(*) filter (where kind = 'chargeback')           as chargeback_count,
  coalesce(sum(refund_amount) filter (where status = 'approved'), 0) as approved_amount
from public.refund_requests;

grant select on public.moderation_summary to authenticated;
