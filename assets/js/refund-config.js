/*
  Настройки приёма заявок на возврат / обращений по чарджбэку.

  Подключать ДО assets/js/payment.js:
    <script src="assets/js/refund-config.js"></script>
    <script src="assets/js/payment.js"></script>

  Куда уходит заявка — по порядку приоритета:
    1) endpoint     — любой HTTP-приёмник (Formspree, Web3Forms, Make/n8n,
                      своя Cloudflare/Netlify/Vercel-функция). Ожидается
                      JSON { ok: true, refundId: "..." } (не обязательно).
    2) supabaseUrl + supabaseKey — вставка строки в таблицу refund_requests
                      проекта Supabase (см. supabase/refund_requests.sql).
    3) ничего не настроено — форма честно предложит написать письмо,
                      письмо с уже заполненными полями откроется в почте.

  Значения по умолчанию подставляет скрипт на странице из supabase-config.js,
  так что руками дублировать URL и ключ не нужно.
*/
window.SEEKER_REFUND = Object.assign(
  {
    endpoint: "", // например "https://formspree.io/f/xxxxxxx" — раскомментируйте, если нужен почтовый приёмник
    table: "refund_requests",
    fallbackEmail: "support@seeker.ru"
  },
  window.SEEKER_REFUND || {}
);
