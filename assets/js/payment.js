/* ============================================================
   Seeker — платёжные страницы (успех, ошибка, возврат, чарджбэк).

   Один скрипт для всех страниц результата. Он:
     1) читает параметры из адресной строки и подставляет их в разметку
        (элементы с атрибутом data-pay-field="...");
     2) скрывает строки, для которых данных нет (.pay-row);
     3) опрашивает /api/payment-status на странице успеха/ошибки, чтобы
        показать реальный статус платежа, а не только query-параметр;
     4) отправляет заявку на возврат с data-refund-form.

   Ожидаемые query-параметры (любой провайдер приводится к ним):
     order / order_id / payment_id  — номер заказа или платежа
     status                         — succeeded | pending | canceled | refunded
     plan                           — month | year
     amount                         — сумма («1 199 ₽» или «1199»)
     email                          — почта плательщика
     date / paid_at                 — дата платежа (ISO)
     reason / error                 — код причины отказа (card_declined и т.п.)
     refund_id                      — номер возврата
     case / chargeback_id           — номер обращения по чарджбэку
   ============================================================ */
(function () {
  "use strict";

  var STATUS = {
    succeeded: { pill: "success", text: "Оплата подтверждена" },
    paid: { pill: "success", text: "Оплата подтверждена" },
    pending: { pill: "pending", text: "Платёж обрабатывается" },
    waiting_for_capture: { pill: "pending", text: "Платёж обрабатывается" },
    canceled: { pill: "fail", text: "Платёж отменён" },
    cancelled: { pill: "fail", text: "Платёж отменён" },
    refunded: { pill: "info", text: "Средства возвращены" }
  };

  var PLAN_LABEL = {
    month: "Seeker Pro — месяц",
    year: "Seeker Pro — год"
  };

  var REASONS = {
    card_declined: "Банк отклонил операцию по карте.",
    insufficient_funds: "На карте недостаточно средств.",
    expired_card: "Истёк срок действия карты.",
    invalid_card: "Банк не принял данные карты.",
    "3ds_failed": "Не пройдена проверка 3-D Secure.",
    three_ds_failed: "Не пройдена проверка 3-D Secure.",
    timeout: "Платёжный шлюз не ответил вовремя.",
    canceled_by_user: "Оплата отменена до подтверждения.",
    cancelled_by_user: "Оплата отменена до подтверждения.",
    fraud_suspected: "Операция заблокирована как подозрительная.",
    permission_revoked: "Банк отозвал разрешение на списание.",
    unknown: "Платёжный провайдер не сообщил точную причину."
  };

  /* ---------- утилиты ---------- */

  function params() {
    var out = {};
    try {
      new URLSearchParams(window.location.search).forEach(function (value, key) {
        out[key] = value;
      });
    } catch (e) {
      /* без параметров */
    }
    return out;
  }

  function pick(source, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      var value = source[keys[i]];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }
    return "";
  }

  function fmtDate(value) {
    if (!value) return "";
    var date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function fmtAmount(value) {
    if (!value) return "";
    if (/[^\d\s.,]/.test(value)) return value; // уже с валютой
    var num = Number(String(value).replace(/\s/g, "").replace(",", "."));
    if (isNaN(num)) return value;
    return num.toLocaleString("ru-RU") + " ₽";
  }

  function setField(name, value) {
    var nodes = document.querySelectorAll('[data-pay-field="' + name + '"]');
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      var row = node.closest(".pay-row");
      if (!value) {
        if (row) row.hidden = true;
        else node.textContent = "—";
        continue;
      }
      if (row) row.hidden = false;
      node.textContent = value;
    }
  }

  function setPill(state, text) {
    var pill = document.querySelector("[data-pay-pill]");
    if (!pill) return;
    pill.dataset.state = state;
    var label = pill.querySelector("span");
    if (label) label.textContent = text;
    else pill.textContent = text;
  }

  /* ---------- данные из адреса ---------- */

  var q = params();

  var orderId = pick(q, ["order", "order_id", "orderId", "payment_id", "paymentId", "payment"]);
  var plan = pick(q, ["plan", "tariff"]);
  var amount = fmtAmount(pick(q, ["amount", "sum", "value"]));
  var email = pick(q, ["email", "customer_email"]);
  var paidAt = fmtDate(pick(q, ["date", "paid_at", "paidAt", "created_at"]));
  var status = pick(q, ["status", "payment_status"]).toLowerCase();
  var reasonCode = pick(q, ["reason", "error", "error_code"]).toLowerCase();
  var refundId = pick(q, ["refund_id", "refundId", "refund"]);
  var caseId = pick(q, ["case", "chargeback_id", "case_id"]);

  setField("order", orderId);
  setField("plan", plan ? PLAN_LABEL[plan] || plan : "");
  setField("amount", amount);
  setField("email", email);
  setField("date", paidAt);
  setField("refund", refundId);
  setField("case", caseId);
  setField("reason", reasonCode ? REASONS[reasonCode] || REASONS.unknown : "");

  if (status && STATUS[status]) setPill(STATUS[status].pill, STATUS[status].text);

  /* ---------- копирование номера заказа ---------- */

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(area);
        ok ? resolve() : reject(new Error("copy failed"));
      } catch (e) {
        reject(e);
      }
    });
  }

  var copyButtons = document.querySelectorAll("[data-pay-copy]");
  Array.prototype.forEach.call(copyButtons, function (btn) {
    btn.addEventListener("click", function () {
      var target = document.querySelector('[data-pay-field="' + btn.dataset.payCopy + '"]');
      var text = target ? target.textContent.trim() : "";
      if (!text || text === "—") return;

      var label = btn.textContent;
      copyText(text).then(
        function () {
          btn.textContent = "Скопировано";
        },
        function () {
          btn.textContent = "Не вышло";
        }
      );
      setTimeout(function () {
        btn.textContent = label;
      }, 1600);
    });
  });

  /* ---------- проверка реального статуса на сервере ---------- */

  var verifyBox = document.querySelector("[data-pay-verify]");
  if (verifyBox && orderId) {
    var endpoint = verifyBox.dataset.payVerify + "?paymentId=" + encodeURIComponent(orderId);
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, 8000);

    fetch(endpoint, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        clearTimeout(timer);
        if (!data || !data.ok) return;

        var state = String(data.status || "").toLowerCase();
        if (STATUS[state]) setPill(STATUS[state].pill, STATUS[state].text);
        if (data.amount) setField("amount", fmtAmount(String(data.amount)));
        if (data.plan) setField("plan", PLAN_LABEL[data.plan] || data.plan);
        if (data.email) setField("email", data.email);
        if (data.paidAt) setField("date", fmtDate(data.paidAt));
        if (data.reasonCode) setField("reason", REASONS[data.reasonCode] || REASONS.unknown);

        var ok = document.querySelector("[data-pay-verified]");
        if (ok) ok.hidden = false;
      })
      .catch(function () {
        clearTimeout(timer);
        var offline = document.querySelector("[data-pay-note-offline]");
        if (offline) offline.hidden = false;
      });
  }

  /* ---------- заявка на возврат ---------- */

  var refundForm = document.querySelector("[data-refund-form]");
  if (refundForm) {
    var result = document.querySelector("[data-refund-result]");
    var orderInput = refundForm.querySelector('[name="order"]');
    var reasonSelect = refundForm.querySelector('[name="reason"]');

    if (orderInput && orderId && !orderInput.value) orderInput.value = orderId;
    if (reasonSelect && reasonCode && !reasonSelect.value) reasonSelect.value = "other";

    var say = function (text, tone, asHtml) {
      if (!result) return;
      result.hidden = false;
      if (asHtml) result.innerHTML = text;
      else result.textContent = text;
      result.classList.remove("pay-note-fail", "pay-note-warn");
      if (tone === "fail") result.classList.add("pay-note-fail");
      if (tone === "warn") result.classList.add("pay-note-warn");
    };

    /* ---------- куда реально уходит заявка ---------- */

    var cfg = function () {
      var c = window.SEEKER_REFUND || {};
      return {
        endpoint: c.endpoint || "",
        supabaseUrl: c.supabaseUrl || "",
        supabaseKey: c.supabaseKey || "",
        table: c.table || "refund_requests",
        fallbackEmail: c.fallbackEmail || "support@seeker.ru"
      };
    };

    /* письмо как резервный канал — с уже заполненными полями */
    var mailtoFor = function (payload) {
      var to = cfg().fallbackEmail;
      var body = [
        "Номер заказа: " + (payload.order || "—"),
        "Почта аккаунта: " + (payload.email || "—"),
        "Причина: " + (payload.reason || "—"),
        "Дата оплаты: " + (payload.date || "—"),
        "",
        payload.comment || "(без комментария)"
      ].join("\n");
      return (
        "mailto:" +
        to +
        "?subject=" +
        encodeURIComponent("Возврат по заказу " + (payload.order || "")) +
        "&body=" +
        encodeURIComponent(body)
      );
    };

    var shortId = function (id) {
      if (!id) return "";
      return "RF-" + String(id).replace(/-/g, "").slice(0, 8).toUpperCase();
    };

    var sendRefund = function (payload) {
      var c = cfg();
      var row = {
        kind: "refund",
        order_ref: payload.order,
        email: payload.email,
        reason: payload.reason || null,
        comment: payload.comment || null,
        paid_on: payload.date || null,
        page: String(window.location.href).slice(0, 500),
        user_agent: String(navigator.userAgent || "").slice(0, 300)
      };

      if (c.endpoint) {
        return fetch(c.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(row)
        }).then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json().catch(function () {
            return {};
          });
        }).then(function (data) {
          return { refundId: shortId(data && (data.refundId || data.id || data.reference)) };
        });
      }

      if (c.supabaseUrl && c.supabaseKey) {
        return fetch(String(c.supabaseUrl).replace(/\/+$/, "") + "/rest/v1/" + c.table, {
          method: "POST",
          headers: {
            apikey: c.supabaseKey,
            Authorization: "Bearer " + c.supabaseKey,
            "Content-Type": "application/json",
            Accept: "application/json",
            Prefer: "return=representation"
          },
          body: JSON.stringify([row])
        }).then(function (res) {
          return res.json().catch(function () {
            return null;
          }).then(function (data) {
            if (!res.ok) {
              var msg = (data && (data.message || data.hint || data.details)) || "HTTP " + res.status;
              throw new Error(msg);
            }
            var first = Array.isArray(data) ? data[0] : data;
            return { refundId: shortId(first && first.id) };
          });
        });
      }

      return Promise.reject(new Error("not-configured"));
    };

    refundForm.addEventListener("submit", function (event) {
      event.preventDefault();

      var submit = refundForm.querySelector('[type="submit"]');
      var value = function (name) {
        var field = refundForm.querySelector('[name="' + name + '"]');
        return field ? field.value.trim() : "";
      };

      var payload = {
        order: value("order"),
        email: value("email"),
        reason: value("reason"),
        date: value("date"),
        comment: value("comment")
      };

      if (!payload.order || !payload.email) {
        say("Укажите номер заказа и почту, на которую оформлялась подписка.", "warn");
        return;
      }

      if (submit) {
        submit.dataset.label = submit.dataset.label || submit.textContent;
        submit.disabled = true;
        submit.textContent = "Отправляем…";
      }

      var restore = function () {
        if (submit) {
          submit.disabled = false;
          submit.textContent = submit.dataset.label || "Отправить заявку";
        }
      };

      sendRefund(payload)
        .then(function (res) {
          restore();
          refundForm.reset();
          say(
            "Заявка принята" +
              (res.refundId ? " №" + res.refundId : "") +
              ". Возврат занимает до 3 рабочих дней, деньги приходят на ту же карту в течение 3–10 рабочих дней." +
              ' Уточнить статус можно на почте <a href="mailto:' +
              cfg().fallbackEmail +
              '">' +
              cfg().fallbackEmail +
              "</a>.",
            "",
            true
          );
        })
        .catch(function (error) {
          restore();
          var link = mailtoFor(payload);
          var reason = error && error.message === "not-configured" ? "" : " (" + (error && error.message ? error.message : "сеть") + ")";
          say(
            "Не удалось отправить заявку автоматически" +
              reason +
              '. <a href="' +
              link +
              '">Отправить её письмом в один клик</a> — поля уже заполнены, заявку оформим вручную.',
            "fail",
            true
          );
        });
    });
  }

  /* ---------- год в мини-футере ---------- */

  var year = document.querySelector("[data-pay-year]");
  if (year) year.textContent = new Date().getFullYear();
})();
