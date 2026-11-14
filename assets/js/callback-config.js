/* ============================================================
   Настройки страницы обработки ответа платёжной системы.

   Правьте только этот файл — логика лежит в payment-callback.js.

   statusEndpoint  — необязательный адрес проверки статуса
                     (например "/api/payment-status"). Если пусто,
                     результат берётся из параметров ссылки.
   supabaseUrl     — проект Supabase, чтобы складывать ответы
   supabaseKey     — публичный publishable-ключ        в таблицу
   table           — имя таблицы для журнала ответов
   autoRedirect    — false выключает автопереход (страница
                     остаётся как ручной разбор ответа)
   ============================================================ */

window.SEEKER_CALLBACK = {
  statusEndpoint: "",
  supabaseUrl: "https://yvnqvdyhrmrzxdwhnydc.supabase.co",
  supabaseKey: "sb_publishable_ecd68T10S_gRouDU5q0EwA_ZW0gp3Oy",
  table: "payment_events",
  autoRedirect: true,
  delay: 900,
  timeout: 7000,
  supportEmail: "support@seeker.ru",
  pages: {
    success: "payment-success.html",
    pending: "payment-success.html",
    fail: "payment-fail.html",
    refund: "payment-success.html",
    chargeback: "payment-chargeback.html"
  }
};
