/*
  Seeker — вход в аккаунт Seeker через Google (Supabase Auth).

  Используется на страницах с гейтом: dashboard.html и т.п.

  Разметка, которую ожидает скрипт (все элементы опциональны):
    #authGate    — карточка входа (показывается, когда сессии нет)
    #dashApp     — защищённый контент (показывается, когда сессия есть)
    #googleSignIn, #authError, #authNote, #authUser, #signOut
*/

const gate = document.getElementById("authGate");
const app = document.getElementById("dashApp");
const googleBtn = document.getElementById("googleSignIn");
const errorBox = document.getElementById("authError");
const statusBox = document.getElementById("authNote");
const userBox = document.getElementById("authUser");
const signOutBtn = document.getElementById("signOut");

const GOOGLE_LABEL = "Продолжить с Google";
const GOOGLE_LABEL_BUSY = "Переходим в Google…";

let lib = null; // модуль supabase-client.js
let busy = false;
let signedIn = false;

/* ---------- helpers ---------- */

function showError(message) {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  if (!errorBox) return;
  errorBox.hidden = true;
  errorBox.textContent = "";
}

function setNote(text) {
  if (statusBox) statusBox.textContent = text;
}

function setBusy(next, text) {
  busy = Boolean(next);
  if (googleBtn) {
    googleBtn.disabled = busy || !lib;
    googleBtn.classList.toggle("is-loading", busy);
    const label = googleBtn.querySelector(".btn-google-label");
    if (label) label.textContent = busy ? GOOGLE_LABEL_BUSY : GOOGLE_LABEL;
  }
  if (text) setNote(text);
}

function setButtonsEnabled() {
  if (googleBtn) googleBtn.disabled = busy || !lib || signedIn;
}

function applySession(session) {
  signedIn = Boolean(session && session.user);

  if (gate) gate.hidden = signedIn;
  if (app) app.hidden = !signedIn;
  if (userBox) userBox.hidden = !signedIn;

  document.documentElement.classList.toggle("is-authed", signedIn);
  document.dispatchEvent(new CustomEvent("seeker:auth", { detail: { session, signedIn } }));

  if (signedIn) {
    hideError();
    if (lib) lib.renderUser(userBox, session.user);
    setNote(`Вы вошли как ${lib ? lib.displayName(session.user) : "аккаунт Seeker"}.`);
    setBusy(false);
  } else {
    setNote("Доступ только для аккаунта Seeker — вход через Google.");
  }
  setButtonsEnabled();
}

function clearOAuthParams() {
  const url = new URL(window.location.href);
  url.hash = "";
  ["code", "state", "error", "error_code", "error_description", "error_hint"].forEach((p) => {
    url.searchParams.delete(p);
  });
  window.history.replaceState(null, "", url.pathname + url.search);
}

/* ---------- действия ---------- */

async function signInWithGoogle() {
  hideError();
  if (!lib) {
    showError("Модуль авторизации ещё не загрузился. Обновите страницу.");
    return;
  }
  if (lib.isFileProtocol()) {
    showError(
      "Страница открыта как файл (file://), а Google-вход работает только на сайте по http(s). " +
        "Запустите в папке проекта start-server.cmd и откройте http://localhost:5500/dashboard.html"
    );
    return;
  }

  setBusy(true, "Открываем страницу Google…");
  try {
    await lib.signInWithGoogle(lib.authRedirectUrl());
    // Дальше браузер уходит на accounts.google.com — ждём возврата.
  } catch (error) {
    setBusy(false);
    showError(lib.humanAuthError(error));
  }
}

async function signOut() {
  if (!lib) return;
  hideError();
  if (signOutBtn) signOutBtn.disabled = true;
  try {
    await lib.signOutSeeker();
  } catch (error) {
    showError(lib.humanAuthError(error));
  }
  if (signOutBtn) signOutBtn.disabled = false;
  applySession(null);
  setNote("Вы вышли из аккаунта.");
}

/* ---------- запуск ---------- */

if (googleBtn) {
  googleBtn.disabled = true; // включим, когда загрузится Supabase
  googleBtn.addEventListener("click", signInWithGoogle);
}
if (signOutBtn) signOutBtn.addEventListener("click", signOut);

setNote("Проверяем вход…");

try {
  lib = await import("./supabase-client.js");
} catch (error) {
  lib = null;
  setNote("Авторизация недоступна.");
  showError(
    "Не удалось загрузить библиотеку Supabase (нужен интернет и доступ к cdn.jsdelivr.net). " +
      "Проверьте соединение и обновите страницу."
  );
  applySession(null);
}

if (lib) {
  /* Ошибка возврата от OAuth приходит в #hash или в query (?error=...) */
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search);
  const oauthError =
    hashParams.get("error_description") ||
    hashParams.get("error") ||
    queryParams.get("error_description") ||
    queryParams.get("error");

  if (oauthError) {
    showError(lib.humanAuthError(oauthError));
    clearOAuthParams();
  }

  lib.onAuthChange((event, session) => {
    applySession(session);
    // Чистим адрес только после успешного обмена кода на сессию.
    if (event === "SIGNED_IN") clearOAuthParams();
  });

  try {
    const { data } = await lib.getSession();
    applySession(data ? data.session : null);
    if (data && data.session && /[?#](code|error|access_token)/.test(window.location.href)) clearOAuthParams();
  } catch (error) {
    applySession(null);
    showError(lib.humanAuthError(error));
  }

  setBusy(false);
  setButtonsEnabled();

  /* Подсказка-адрес (только при ?debug=1): этот URL должен быть в Supabase → URL Configuration */
  const redirectHint = document.querySelector("[data-auth-redirect]");
  if (redirectHint && /[?&]debug\b/.test(window.location.search)) {
    redirectHint.textContent = lib.authRedirectUrl();
    redirectHint.hidden = false;
    if (redirectHint.parentElement) redirectHint.parentElement.hidden = false;
  }
}
