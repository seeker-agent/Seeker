/* ============================================================
   Seeker — панель модератора
   Читает заявки на возврат, позволяет менять статус и писать
   комментарий, показывает журнал платежей и историю действий.
   Правила доступа живут в базе (supabase/moderator.sql):
   клиент лишь проверяет роль, чтобы показать или скрыть интерфейс.
   ============================================================ */

import { supabase } from "./supabase-client.js";
import { currentRole } from "./role.js";

const STATUS_LABELS = {
  new: "Новая",
  in_progress: "В работе",
  approved: "Одобрена",
  declined: "Отклонена",
};

const KIND_LABELS = {
  refund: "Возврат",
  chargeback: "Чарджбэк",
};

const REASON_LABELS = {
  not_needed: "Больше не нужна подписка",
  too_expensive: "Дорого",
  wrong_plan: "Оформил не тот тариф",
  double_charge: "Двойное списание",
  no_access: "Нет доступа к функциям",
  quality: "Не устроило качество",
  other: "Другая причина",
  card_declined: "Банк отклонил карту",
  insufficient_funds: "Недостаточно средств",
  expired_card: "Истёк срок карты",
  invalid_card: "Неверные данные карты",
  "3ds_failed": "Не пройдена проверка 3-D Secure",
  timeout: "Таймаут оплаты",
  canceled_by_user: "Отменено пользователем",
  fraud_suspected: "Подозрение на мошенничество",
  permission_revoked: "Доступ отозван",
  unknown: "Неизвестно",
};

const state = {
  role: null,
  items: [],
  filter: "all",
  query: "",
  busy: false,
};

/* ---------- помощники ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }

  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }

  return node;
}

function fmtDate(value, withTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const options = withTime
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" };
  return date.toLocaleString("ru-RU", options);
}

function fmtMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " ₽";
}

const statusLabel = (status) => STATUS_LABELS[status] || status || "—";
const reasonLabel = (reason) => (reason ? REASON_LABELS[reason] || reason : "—");

function badgeStatus(status) {
  if (status === "succeeded" || status === "refunded") return "approved";
  if (status === "pending") return "in_progress";
  if (status === "canceled" || status === "failed") return "declined";
  return "new";
}

function say(text, tone = "info") {
  const box = $("#modMessages");
  if (!box) return;
  box.hidden = !text;
  box.textContent = text || "";
  box.style.color = tone === "error" ? "#fca5a5" : tone === "ok" ? "#6ee7b7" : "";
}

function missingTable(error) {
  if (!error) return false;
  const code = String(error.code || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /does not exist|Could not find the table/i.test(String(error.message || ""))
  );
}

function actor(key) {
  const user = state.role && state.role.user;
  if (!user) return null;
  return key === "id" ? user.id : user.email;
}

/* ---------- доступ ---------- */

function showGate(title, text) {
  const gate = $("#modGate");
  if (!gate) return;
  gate.hidden = false;
  $("#modGateTitle").textContent = title;
  $("#modGateText").textContent = text;
  $("#modGateActions").hidden = false;
}

function openPanel() {
  $("#modGate").hidden = true;
  $("#modPanel").hidden = false;
  $("#payments").hidden = false;
  $("#events").hidden = false;
}

async function boot() {
  const info = await currentRole();

  if (!info.user) {
    showGate(
      "Нужно войти",
      "Панель модератора доступна только аккаунту Seeker со специальной ролью. Войдите через Google в панели управления и вернитесь сюда."
    );
    return;
  }

  if (info.setup) {
    showGate(
      "Таблицы ролей нет",
      "В базе отсутствует public.user_roles. Откройте Supabase → SQL Editor и выполните файл supabase/moderator.sql целиком."
    );
    return;
  }

  if (!info.isModerator) {
    showGate(
      "Доступа нет",
      "Аккаунт " + (info.user.email || "") +
        " не имеет роли модератора. Роль выдаётся в базе: select public.grant_role_by_email('ваша@почта', 'moderator');"
    );
    return;
  }

  state.role = info;
  openPanel();
  say("Загрузка заявок…");
  await Promise.all([loadRequests(), loadPayments(), loadEvents()]);
  say("");
}

/* ---------- заявки ---------- */

async function loadRequests() {
  const { data, error } = await supabase
    .from("refund_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    say(
      missingTable(error)
        ? "Таблица refund_requests не создана. Выполните supabase/moderator.sql в SQL Editor."
        : "Не удалось загрузить заявки: " + error.message,
      "error"
    );
    state.items = [];
    render();
    return;
  }

  state.items = Array.isArray(data) ? data : [];
  render();
}

function visibleItems() {
  const query = state.query.trim().toLowerCase();

  return state.items.filter((item) => {
    if (state.filter !== "all" && item.status !== state.filter) return false;
    if (!query) return true;

    return [item.order_ref, item.email, item.comment, item.reason]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function counts() {
  const base = { all: state.items.length, new: 0, in_progress: 0, approved: 0, declined: 0 };
  state.items.forEach((item) => {
    if (item.status in base) base[item.status] += 1;
  });
  return base;
}

function renderStats() {
  const c = counts();
  const chargeback = state.items.filter((item) => item.kind === "chargeback").length;

  $$("[data-stat]").forEach((node) => {
    const key = node.dataset.stat;
    if (key === "total") node.textContent = String(state.items.length);
    else if (key === "chargeback") node.textContent = String(chargeback);
    else node.textContent = String(c[key] || 0);
  });

  $$("[data-count]").forEach((node) => {
    node.textContent = String(c[node.dataset.count] || 0);
  });
}

function render() {
  renderStats();

  const list = $("#modList");
  if (!list) return;

  const items = visibleItems();
  list.textContent = "";

  if (!items.length) {
    list.append(
      h(
        "div",
        { class: "mod-empty" },
        state.items.length
          ? "По фильтру ничего не найдено."
          : "Заявок пока нет. Как только посетитель отправит форму возврата, она появится здесь."
      )
    );
    return;
  }

  items.forEach((item) => list.append(renderItem(item)));
}

function renderItem(item) {
  const status = item.status || "new";

  const summary = h(
    "summary",
    {},
    h("span", { class: "mod-badge", "data-status": status, text: statusLabel(status) }),
    h("span", { class: "mod-item-id", text: item.order_ref || item.id }),
    h("span", { class: "mod-item-mail", text: item.email || "—" }),
    h("span", { class: "mod-item-date", text: fmtDate(item.created_at) })
  );

  const fields = h(
    "dl",
    { class: "mod-fields" },
    h("div", {}, h("dt", { text: "Тип" }), h("dd", { text: KIND_LABELS[item.kind] || item.kind || "—" })),
    h("div", {}, h("dt", { text: "Причина" }), h("dd", { text: reasonLabel(item.reason) })),
    h("div", {}, h("dt", { text: "Дата оплаты" }), h("dd", { text: item.paid_on ? fmtDate(item.paid_on, false) : "—" })),
    h("div", {}, h("dt", { text: "Сумма возврата" }), h("dd", { text: fmtMoney(item.refund_amount) })),
    h("div", {}, h("dt", { text: "Обработал" }), h("dd", { text: item.handled_by_email || "—" })),
    h("div", {}, h("dt", { text: "Когда" }), h("dd", { text: item.handled_at ? fmtDate(item.handled_at) : "—" })),
    h("div", {}, h("dt", { text: "Страница" }), h("dd", { text: item.page || "—" })),
    h("div", {}, h("dt", { text: "ID заявки" }), h("dd", { text: item.id }))
  );

  const body = h("div", { class: "mod-body" }, fields);

  if (item.comment) {
    body.append(h("p", { class: "mod-comment", text: item.comment }));
  }

  if (item.moderator_note) {
    body.append(h("p", { class: "mod-comment", text: "Комментарий модератора: " + item.moderator_note }));
  }

  body.append(renderStatusForm(item));

  return h("details", { class: "mod-item" }, summary, body);
}

function renderStatusForm(item) {
  const select = h(
    "select",
    { name: "status", "aria-label": "Статус заявки" },
    ...Object.entries(STATUS_LABELS).map(([value, label]) =>
      h("option", { value, selected: (item.status || "new") === value }, label)
    )
  );

  const amount = h("input", {
    name: "amount",
    type: "number",
    min: "0",
    step: "0.01",
    inputmode: "decimal",
    placeholder: "Сумма возврата, ₽",
    "aria-label": "Сумма возврата",
    value: item.refund_amount === null || item.refund_amount === undefined ? "" : String(item.refund_amount),
  });

  const note = h("textarea", {
    name: "note",
    placeholder: "Комментарий в историю: что сделано, номер возврата, причина отказа",
    "aria-label": "Комментарий модератора",
  });
  note.value = item.moderator_note || "";

  const button = h("button", { class: "btn btn-primary btn-sm", type: "submit" }, "Сохранить");

  const form = h(
    "form",
    { class: "mod-form" },
    h("div", { class: "mod-form-row" }, select, amount, button),
    note,
    h("p", { class: "mod-note", text: "Изменение статуса фиксируется в истории действий." })
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) return;

    const nextStatus = select.value;
    const nextNote = note.value.trim();
    const rawAmount = amount.value.trim();
    const nextAmount = rawAmount === "" ? null : Number(rawAmount);

    if (rawAmount !== "" && (!Number.isFinite(nextAmount) || nextAmount < 0)) {
      say("Сумма возврата должна быть неотрицательным числом.", "error");
      return;
    }

    state.busy = true;
    button.disabled = true;
    button.textContent = "Сохраняем…";

    const patch = {
      status: nextStatus,
      moderator_note: nextNote || null,
      refund_amount: nextAmount,
      handled_by: actor("id"),
      handled_by_email: actor("email"),
      handled_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("refund_requests").update(patch).eq("id", item.id);

    state.busy = false;
    button.disabled = false;
    button.textContent = "Сохранить";

    if (error) {
      say("Не удалось сохранить: " + error.message, "error");
      return;
    }

    await supabase.from("refund_events").insert({
      request_id: item.id,
      order_ref: item.order_ref,
      action: "status_update",
      from_status: item.status || "new",
      to_status: nextStatus,
      actor_id: actor("id"),
      actor_email: actor("email"),
      note: nextNote || null,
    });

    Object.assign(item, patch);
    say("Заявка " + (item.order_ref || item.id) + ": " + statusLabel(nextStatus) + ".", "ok");
    render();
    loadEvents();
  });

  return form;
}

/* ---------- журнал платежей ---------- */

async function loadPayments() {
  const list = $("#payList");
  const box = $("#payMessages");
  if (!list) return;

  const { data, error } = await supabase
    .from("payment_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(60);

  list.textContent = "";

  if (error) {
    box.hidden = false;
    box.style.color = "#fca5a5";
    box.textContent = missingTable(error)
      ? "Таблица payment_events не создана. Выполните supabase/moderator.sql в SQL Editor."
      : "Не удалось загрузить журнал платежей: " + error.message;
    return;
  }

  box.hidden = true;

  if (!data || !data.length) {
    list.append(h("div", { class: "mod-empty" }, "Ответов от платёжной системы пока не было."));
    return;
  }

  data.forEach((row) => {
    const summary = h(
      "summary",
      {},
      h("span", { class: "mod-badge", "data-status": badgeStatus(row.status), text: row.status || "—" }),
      h("span", { class: "mod-item-id", text: row.order_id || "без номера" }),
      h("span", { class: "mod-item-mail", text: row.email || row.raw_status || "—" }),
      h("span", { class: "mod-item-date", text: fmtDate(row.created_at) })
    );

    const fields = h(
      "dl",
      { class: "mod-fields" },
      h("div", {}, h("dt", { text: "Тариф" }), h("dd", { text: row.plan || "—" })),
      h("div", {}, h("dt", { text: "Сумма" }), h("dd", { text: row.amount || "—" })),
      h("div", {}, h("dt", { text: "Статус провайдера" }), h("dd", { text: row.raw_status || "—" })),
      h("div", {}, h("dt", { text: "Причина" }), h("dd", { text: reasonLabel(row.reason) })),
      h("div", {}, h("dt", { text: "Возврат" }), h("dd", { text: row.refund_id || "—" })),
      h("div", {}, h("dt", { text: "Обращение" }), h("dd", { text: row.case_id || "—" })),
      h("div", {}, h("dt", { text: "Страница" }), h("dd", { text: row.page || "—" })),
      h("div", {}, h("dt", { text: "ID записи" }), h("dd", { text: row.id }))
    );

    const body = h("div", { class: "mod-body" }, fields);

    if (row.query_string) {
      body.append(h("p", { class: "mod-comment", text: row.query_string }));
    }

    list.append(h("details", { class: "mod-item" }, summary, body));
  });
}

/* ---------- история действий ---------- */

async function loadEvents() {
  const list = $("#eventList");
  if (!list) return;

  const { data, error } = await supabase
    .from("refund_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(40);

  list.textContent = "";

  if (error) {
    list.append(
      h(
        "li",
        { class: "mod-empty" },
        missingTable(error)
          ? "Таблица refund_events не создана. Выполните supabase/moderator.sql."
          : "Не удалось загрузить историю: " + error.message
      )
    );
    return;
  }

  if (!data || !data.length) {
    list.append(h("li", { class: "mod-empty" }, "История пуста."));
    return;
  }

  data.forEach((row) => {
    const move = row.from_status && row.to_status
      ? statusLabel(row.from_status) + " → " + statusLabel(row.to_status)
      : row.action || "—";

    list.append(
      h(
        "li",
        {},
        h("time", { text: fmtDate(row.created_at) }),
        h("span", { text: (row.order_ref || row.request_id || "—") + " · " + move }),
        h("span", { class: "mod-item-mail", text: row.actor_email || "система" }),
        row.note ? h("span", { class: "mod-comment", text: row.note }) : null
      )
    );
  });
}

/* ---------- интерфейс ---------- */

function wire() {
  const search = $("#modSearch");
  if (search) {
    search.addEventListener("input", () => {
      state.query = search.value;
      render();
    });
  }

  const filters = $("#modFilters");
  if (filters) {
    filters.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-filter]");
      if (!chip) return;
      state.filter = chip.dataset.filter;
      $$("[data-filter]", filters).forEach((node) => {
        node.setAttribute("aria-pressed", node === chip ? "true" : "false");
      });
      render();
    });
  }

  const refresh = $("#modRefresh");
  if (refresh) {
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      say("Обновляем…");
      await Promise.all([loadRequests(), loadPayments(), loadEvents()]);
      say("Данные обновлены.", "ok");
      refresh.disabled = false;
    });
  }
}

wire();
boot();
