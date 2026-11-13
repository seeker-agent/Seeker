/*
  Seeker — статус подписки из базы (Supabase → public.subscriptions).

  Модуль сам следит за входом/выходом и пишет результат в разметку:
    #subStatus        — плашка статуса (получает data-state)
    #subStatusTitle   — заголовок («Подписка Seeker Pro активна» / «Подписки нет»)
    #subStatusMeta    — пояснение (дата окончания и т.п.)
    #subStatusBadge   — короткий бейдж (Активна / Нет подписки)
    #subStatusDetails — список деталей (тариф, статус, оплачено до, автопродление)
    #subStatusCta     — кнопка: «Продлить» для активной, «Оформить Pro» для остальных

  Дополнительно бросает событие document → "seeker:subscription" с detail = info.
*/

import {
  getSession,
  onAuthChange,
  fetchSubscription,
  subscriptionInfo,
  humanAuthError,
} from "./supabase-client.js";

const els = {
  box: document.getElementById("subStatus"),
  title: document.getElementById("subStatusTitle"),
  meta: document.getElementById("subStatusMeta"),
  badge: document.getElementById("subStatusBadge"),
  details: document.getElementById("subStatusDetails"),
  cta: document.getElementById("subStatusCta"),
};

let lastUserId = null;
let pending = null;

function fmtDate(date) {
  if (!date) return null;
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function fmtDays(days) {
  if (days === null || days === undefined) return null;
  if (days <= 0) return "последний день";
  const mod10 = days % 10;
  const mod100 = days % 100;
  let word = "дней";
  if (mod10 === 1 && mod100 !== 11) word = "день";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = "дня";
  return `${days} ${word}`;
}

function paint(state, title, meta, badgeText) {
  if (els.box) els.box.dataset.state = state;
  if (els.title) els.title.textContent = title;
  if (els.meta) els.meta.textContent = meta || "";
  if (els.badge) {
    els.badge.textContent = badgeText || "";
    els.badge.hidden = !badgeText;
  }
}

function paintDetails(info) {
  if (!els.details) return;
  els.details.textContent = "";

  if (!info.hasSubscription) {
    els.details.hidden = true;
    return;
  }

  const rows = [];
  if (info.plan) rows.push(`Тариф: ${info.planLabel}`);
  rows.push(`Статус: ${info.statusLabel}`);
  const until = fmtDate(info.expiresAt);
  if (until) rows.push(`${info.active ? "Оплачено до" : "Истекла"}: ${until}`);
  if (info.active && info.daysLeft !== null) rows.push(`Осталось: ${fmtDays(info.daysLeft)}`);
  if (info.autoRenew !== null) rows.push(`Автопродление: ${info.autoRenew ? "включено" : "выключено"}`);
  if (info.provider) rows.push(`Способ оплаты: ${info.provider}`);

  for (const text of rows) {
    const li = document.createElement("li");
    li.textContent = text;
    els.details.appendChild(li);
  }
  els.details.hidden = rows.length === 0;
}

function paintCta(info) {
  if (!els.cta) return;
  if (info && info.active) {
    els.cta.textContent = "Продлить подписку";
    els.cta.href = "pricing.html#buy";
  } else {
    els.cta.textContent = "Оформить Seeker Pro";
    els.cta.href = "pricing.html#buy";
  }
}

function renderLoading() {
  paint("loading", "Проверяем подписку в базе…", "Запрос к таблице subscriptions", "");
  if (els.details) els.details.hidden = true;
  paintCta(null);
}

function renderSignedOut() {
  paint("guest", "Войдите, чтобы увидеть подписку", "Статус подписки хранится в аккаунте Seeker", "");
  if (els.details) els.details.hidden = true;
  paintCta(null);
  document.dispatchEvent(new CustomEvent("seeker:subscription", { detail: { signedIn: false } }));
}

function render(info) {
  paint(info.state, info.title, info.note, info.statusLabel);
  paintDetails(info);
  paintCta(info);
  document.dispatchEvent(new CustomEvent("seeker:subscription", { detail: info }));
}

function renderError(error) {
  const message = humanAuthError(error);
  paint("error", "Не удалось проверить подписку", message, "Ошибка");
  if (els.details) els.details.hidden = true;
  paintCta(null);
}

/** Перечитать подписку из базы. Можно звать вручную: seekerRefreshSubscription() */
export async function refreshSubscription(userId) {
  if (!userId) {
    lastUserId = null;
    renderSignedOut();
    return null;
  }
  if (pending && lastUserId === userId) return pending;

  lastUserId = userId;
  renderLoading();

  pending = (async () => {
    try {
      const sub = await fetchSubscription(userId);
      const info = subscriptionInfo(sub);
      render(info);
      return info;
    } catch (error) {
      renderError(error);
      return null;
    } finally {
      pending = null;
    }
  })();

  return pending;
}

/* ---------- запуск ---------- */

if (els.box) {
  renderLoading();

  onAuthChange((event, session) => {
    if (event === "TOKEN_REFRESHED") return; // сессия та же — подписку не перезапрашиваем
    const userId = session && session.user ? session.user.id : null;
    if (event === "SIGNED_OUT") {
      refreshSubscription(null);
      return;
    }
    refreshSubscription(userId);
  });

  getSession()
    .then(({ data }) => {
      const session = data ? data.session : null;
      return refreshSubscription(session && session.user ? session.user.id : null);
    })
    .catch((error) => renderError(error));

  // Кнопка «Обновить статус» на дашборде
  const reloadBtn = document.getElementById("subStatusReload");
  if (reloadBtn) {
    reloadBtn.addEventListener("click", async () => {
      reloadBtn.disabled = true;
      const { data } = await getSession();
      const session = data ? data.session : null;
      lastUserId = null;
      pending = null;
      await refreshSubscription(session && session.user ? session.user.id : null);
      reloadBtn.disabled = false;
    });
  }

  window.seekerRefreshSubscription = refreshSubscription;
}
