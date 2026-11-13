/*
  Seeker — единый клиент Supabase (Auth) для сайта.

  Модуль можно подключать на любой странице:
    import { supabase, signInWithGoogle, signOutSeeker, humanAuthError } from "./supabase-client.js";

  Здесь только публичные данные проекта (URL + publishable-ключ).
  Service/secret ключи в браузер не попадают никогда.
*/
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

export { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY };

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
    storageKey: "seeker-auth",
  },
});

/* ---------- окружение ---------- */

export function isFileProtocol() {
  return window.location.protocol === "file:";
}

/** Адрес возврата после Google — текущая страница без OAuth-параметров. */
export function authRedirectUrl() {
  const url = new URL(window.location.href);
  url.hash = "";
  ["code", "state", "error", "error_code", "error_description", "error_hint"].forEach((p) => {
    url.searchParams.delete(p);
  });
  return url.toString();
}

/* ---------- ошибки ---------- */

export function humanAuthError(error) {
  const raw = (error && (error.message || error.error_description || error.msg || error)) || "";
  const msg = String(raw);
  const code = msg.toLowerCase();
  const back = authRedirectUrl();

  if (code.includes("provider is not enabled") || code.includes("unsupported provider")) {
    return "Вход через Google не включён в проекте Supabase. Включите провайдер Google в Authentication → Providers и укажите Client ID/Secret из Google Cloud Console.";
  }
  if (code.includes("redirect_uri_mismatch") || (code.includes("redirect") && (code.includes("not allowed") || code.includes("invalid")))) {
    return `Supabase не разрешает возврат на этот адрес. Добавьте ${back} в Authentication → URL Configuration → Redirect URLs (и этот же адрес в Google Cloud Console → Authorized redirect URIs).`;
  }
  if (code.includes("invalid api key") || code.includes("no api key") || code.includes("apikey")) {
    return "Ключ проекта Supabase не подошёл. Проверьте SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY в assets/js/supabase-config.js.";
  }
  if (code.includes("popup") || code.includes("window closed") || code.includes("closed")) {
    return "Окно входа было закрыто. Попробуйте ещё раз.";
  }
  if (code.includes("network") || code.includes("failed to fetch") || code.includes("load failed")) {
    return "Нет связи с сервером авторизации. Проверьте интернет или блокировщик рекламы и попробуйте снова.";
  }
  if (code.includes("access_denied")) {
    return "Доступ к аккаунту Google не был выдан. Нажмите «Продолжить с Google» и разрешите вход.";
  }
  return msg || "Не удалось войти через Google. Попробуйте ещё раз.";
}

/* ---------- действия ---------- */

export async function signInWithGoogle(redirectTo = authRedirectUrl()) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
  return data;
}

export async function signOutSeeker() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function getSession() {
  return supabase.auth.getSession();
}

export function onAuthChange(handler) {
  return supabase.auth.onAuthStateChange(handler);
}

/* ---------- профиль ---------- */

export function displayName(user) {
  const meta = (user && user.user_metadata) || {};
  const name = meta.full_name || meta.name || (user && user.email ? String(user.email).split("@")[0] : "");
  return (name || "Аккаунт Seeker").trim();
}

/** Заполняет блок вида:
 *  <span data-user-avatar>  <b data-user-name>  <small data-user-email>
 */
export function renderUser(root, user) {
  if (!root || !user) return;
  const meta = user.user_metadata || {};
  const name = displayName(user);
  const initial = name.charAt(0).toUpperCase() || "S";

  const nameEl = root.querySelector("[data-user-name]");
  const emailEl = root.querySelector("[data-user-email]");
  const avatarEl = root.querySelector("[data-user-avatar]");

  if (nameEl) nameEl.textContent = name;
  if (emailEl) emailEl.textContent = user.email || "";

  if (avatarEl) {
    const photo = meta.avatar_url || meta.picture;
    if (photo) {
      avatarEl.style.backgroundImage = `url("${photo}")`;
      avatarEl.textContent = "";
      avatarEl.classList.add("has-photo");
    } else {
      avatarEl.style.backgroundImage = "";
      avatarEl.textContent = initial;
      avatarEl.classList.remove("has-photo");
    }
  }
}

/* ---------- подписка (таблица subscriptions) ---------- */

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);
const GRACE_STATUSES = new Set(["canceled", "cancelled"]);

const PLAN_LABELS = {
  free: "Бесплатный",
  basic: "Seeker Basic",
  pro: "Seeker Pro",
  "seeker-pro": "Seeker Pro",
  trial: "Пробный период",
  team: "Seeker Team",
  business: "Seeker Business",
};

const STATUS_LABELS = {
  active: "Активна",
  trialing: "Пробный период",
  past_due: "Ожидает оплаты",
  canceled: "Отменена",
  cancelled: "Отменена",
  expired: "Истекла",
  paused: "Приостановлена",
  inactive: "Неактивна",
  none: "Нет подписки",
};

const SUBSCRIPTION_COLUMNS =
  "plan,status,started_at,expires_at,auto_renew,provider,updated_at";

export function planLabel(plan) {
  if (!plan) return "Без тарифа";
  const key = String(plan).trim().toLowerCase();
  return PLAN_LABELS[key] || String(plan);
}

export function statusLabel(status) {
  if (!status) return STATUS_LABELS.none;
  const key = String(status).trim().toLowerCase();
  return STATUS_LABELS[key] || String(status);
}

/** Читает подписку текущего пользователя. RLS отдаёт только свою строку. */
export async function fetchSubscription(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (Array.isArray(data) && data[0]) || null;
}

/** Профиль пользователя (таблица profiles) — запасной источник display_name/email. */
export async function fetchProfile(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,display_name")
    .eq("id", userId)
    .limit(1);
  if (error) throw error;
  return (Array.isArray(data) && data[0]) || null;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Разбирает строку subscriptions и говорит, есть ли подписка сейчас.
 * Возвращает готовый к показу объект.
 */
export function subscriptionInfo(sub, now = new Date()) {
  if (!sub) {
    return {
      hasSubscription: false,
      active: false,
      state: "none",
      plan: null,
      planLabel: planLabel(null),
      status: null,
      statusLabel: statusLabel(null),
      startedAt: null,
      expiresAt: null,
      autoRenew: null,
      provider: null,
      daysLeft: null,
      title: "Подписки нет",
      note: "Оформите Seeker Pro — включится агент Seeker v1 и лимит токенов.",
    };
  }

  const status = sub.status ? String(sub.status).trim().toLowerCase() : null;
  const expiresAt = parseDate(sub.expires_at);
  const startedAt = parseDate(sub.started_at);
  const expired = Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
  const daysLeft = expiresAt
    ? Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000))
    : null;

  const active = !expired && (ACTIVE_STATUSES.has(status) || (GRACE_STATUSES.has(status) && Boolean(expiresAt)));

  let state = "inactive";
  if (active) state = status === "trialing" ? "trial" : status === "past_due" ? "warning" : "active";
  else if (expired) state = "expired";

  const plan = sub.plan || null;
  const fmt = (d) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

  let title;
  let note;
  if (state === "active") {
    title = `Подписка ${planLabel(plan)} активна`;
    note = expiresAt ? `Оплачена до ${fmt(expiresAt)}` : "Без даты окончания";
  } else if (state === "trial") {
    title = "Пробный период активен";
    note = expiresAt ? `Действует до ${fmt(expiresAt)}` : "Дата окончания не указана";
  } else if (state === "warning") {
    title = "Подписка ждёт оплаты";
    note = expiresAt ? `Доступ сохраняется до ${fmt(expiresAt)}` : "Обновите способ оплаты";
  } else if (state === "expired") {
    title = "Подписка истекла";
    note = `Срок закончился ${fmt(expiresAt)} — продлите Seeker Pro.`;
  } else {
    title = `Подписка ${statusLabel(status).toLowerCase()}`;
    note = "Активной подписки нет — продлите Seeker Pro.";
  }

  return {
    hasSubscription: true,
    active,
    state,
    plan,
    planLabel: planLabel(plan),
    status,
    statusLabel: statusLabel(status),
    startedAt,
    expiresAt,
    autoRenew: typeof sub.auto_renew === "boolean" ? sub.auto_renew : null,
    provider: sub.provider || null,
    daysLeft,
    title,
    note,
  };
}
