/* ============================================================
   Seeker — роли пользователя
   Читает public.user_roles и говорит, можно ли открыть
   «Режим модератора». Таблица и правила доступа описаны
   в supabase/moderator.sql.
   ============================================================ */

import { supabase, getSession, onAuthChange } from "./supabase-client.js";

/** Роли, которым доступна панель модератора. */
export const MOD_ROLES = ["support", "moderator", "admin", "owner"];

export const ROLE_LABELS = {
  user: "Пользователь",
  support: "Поддержка",
  moderator: "Модератор",
  admin: "Администратор",
  owner: "Владелец",
};

/** Таблица ролей ещё не создана в базе? */
function isMissingTable(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const text = String(error.message || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /does not exist|Could not find the table/i.test(text)
  );
}

/**
 * Роль текущего пользователя.
 * Возвращает { role, label, isModerator, setup } — без исключений.
 */
export async function fetchRole(userId) {
  const empty = { role: null, label: ROLE_LABELS.user, isModerator: false, setup: false };
  if (!userId) return empty;

  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) return { ...empty, setup: true };
    console.warn("Seeker: не удалось прочитать роль —", error.message);
    return empty;
  }

  const role = data?.role || null;
  return {
    role,
    label: ROLE_LABELS[role] || ROLE_LABELS.user,
    isModerator: MOD_ROLES.includes(role),
    setup: false,
  };
}

/** Роль текущей сессии (или null, если не вошли). */
export async function currentRole() {
  const { data } = await getSession();
  const session = data?.session ?? null;
  const user = session?.user ?? null;

  if (!user) {
    return { role: null, label: ROLE_LABELS.user, isModerator: false, setup: false, user: null };
  }

  const info = await fetchRole(user.id);
  return { ...info, user };
}

/**
 * Показывает элементы с data-mod-only, если у пользователя есть роль,
 * и скрывает их в остальных случаях.
 */
export async function mountModEntry(info) {
  const state = info || (await currentRole());
  const nodes = document.querySelectorAll("[data-mod-only]");

  nodes.forEach((node) => {
    node.hidden = !state.isModerator;
    if (state.isModerator) {
      node.querySelectorAll("[data-mod-role]").forEach((label) => {
        label.textContent = state.label;
      });
    }
  });

  return state;
}

/* На дашборде используем как автоматический модуль. */
if (document.querySelector("[data-mod-only]")) {
  mountModEntry().catch((error) => console.warn("Seeker: роли —", error?.message || error));

  /* Вошёл/вышел — сразу пересчитываем доступ, без перезагрузки страницы. */
  onAuthChange(() => {
    mountModEntry().catch(() => {});
  });
}
