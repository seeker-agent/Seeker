/* ============================================================
   Seeker — страница обработки ответа платёжной системы.

   1) читает параметры, которые провайдер добавил к адресу возврата
      (у каждого провайдера свои имена — приводим к общим);
   2) распознаёт статус: успех / в обработке / отказ / возврат / чарджбэк;
   3) при необходимости проверяет статус на сервере (statusEndpoint);
   4) по желанию пишет ответ в журнал Supabase (таблица payment_events);
   5) перенаправляет на страницу результата с нормальными параметрами
      (?order=…&status=…&amount=…), которые понимает assets/js/payment.js.

   Если данных не хватает, страница не угадывает результат, а показывает
   ручной разбор и ссылки на нужные страницы.

   Настройки — в assets/js/callback-config.js.
   ============================================================ */
(function () {
  "use strict";

  var DEFAULTS = {
    statusEndpoint: "",
    supabaseUrl: "",
    supabaseKey: "",
    table: "payment_events",
    autoRedirect: true,
    delay: 900,
    timeout: 7000,
    supportEmail: "support@seeker.ru",
    pages: {}
  };

  var PAGES = {
    success: "payment-success.html",
    pending: "payment-success.html",
    fail: "payment-fail.html",
    refund: "payment-success.html",
    chargeback: "payment-chargeback.html"
  };

  var cfg = {};
  Object.keys(DEFAULTS).forEach(function (key) { cfg[key] = DEFAULTS[key]; });

  var user = window.SEEKER_CALLBACK || {};
  Object.keys(user).forEach(function (key) {
    if (key !== "pages") cfg[key] = user[key];
  });

  var pages = {};
  Object.keys(PAGES).forEach(function (key) { pages[key] = PAGES[key]; });
  Object.keys(user.pages || {}).forEach(function (key) { pages[key] = user.pages[key]; });

  /* ---------- имена параметров у разных провайдеров ---------- */

  var ALIASES = {
    order: ["order", "order_id", "orderid", "order_number", "ordernumber",
            "payment_id", "paymentid", "transaction_id", "transactionid",
            "transaction", "invoice_id", "invoiceid", "invoice",
            "merchant_order_id", "inv_id", "bill_id", "reference"],
    rawStatus: ["status", "payment_status", "paymentstatus", "result", "state",
                "outcome", "success", "paid", "operation_status"],
    plan: ["plan", "product", "products", "sku", "tariff", "offer", "subscription"],
    amount: ["amount", "sum", "total", "price", "out_sum", "outsum", "value",
             "amount_rub", "payment_amount"],
    email: ["email", "customer_email", "payer_email", "user_email", "client_email",
            "receipt_email", "buyer_email"],
    date: ["date", "paid_at", "payment_date", "created_at", "createdat", "timestamp",
           "datetime", "completed_at", "operation_time"],
    reason: ["reason", "error", "error_code", "errorcode", "fail_reason",
             "decline_reason", "failure_reason"],
    refundId: ["refund_id", "refundid", "refund", "refund_number"],
    caseId: ["case", "case_id", "chargeback_id", "chargebackid", "dispute_id"]
  };

  /* ---------- распознавание статуса ---------- */

  var STATUS_MAP = {
    success: ["success", "succeeded", "successful", "ok", "okay", "paid", "completed",
              "complete", "captured", "settled", "approved", "accepted", "done",
              "true", "1", "yes", "y", "confirmed", "paid_out"],
    pending: ["pending", "processing", "waiting", "waiting_for_capture", "waitingforcapture",
              "in_progress", "inprogress", "hold", "authorized", "authorised", "created",
              "new", "3ds", "redirect", "checking"],
    fail: ["fail", "failed", "failure", "cancel", "canceled", "cancelled", "declined",
           "decline", "rejected", "reject", "error", "expired", "timeout", "false",
           "0", "no", "n", "aborted", "abort", "denied"],
    refund: ["refund", "refunded", "refunding", "reversed", "returned", "partial_refunded"],
    chargeback: ["chargeback", "chargebacked", "disputed", "dispute", "arbitration"]
  };

  var LOOKUP = (function () {
    var map = {};
    Object.keys(STATUS_MAP).forEach(function (group) {
      STATUS_MAP[group].forEach(function (token) { map[token] = group; });
    });
    return map;
  })();

  var STATUS_LABEL = {
    success: "Оплата подтверждена",
    pending: "Платёж обрабатывается",
    fail: "Платёж не прошёл",
    refund: "Средства возвращены",
    chargeback: "Открыт чарджбэк"
  };

  var PILL = {
    success: "success",
    pending: "pending",
    fail: "fail",
    refund: "info",
    chargeback: "info"
  };

  /* ---------- утилиты ---------- */

  function readParams() {
    var out = {};
    function absorb(search) {
      if (!search) return;
      var clean = search.charAt(0) === "?" || search.charAt(0) === "#" ? search.slice(1) : search;
      try {
        new URLSearchParams(clean).forEach(function (value, key) { out[key] = value; });
      } catch (e) { /* адрес без параметров */ }
    }
    absorb(window.location.search);
    absorb(window.location.hash);
    return out;
  }

  function pick(source, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      var value = source[keys[i]];
      if (value === undefined || value === null) continue;
      var text = String(value).trim();
      if (!text) continue;
      var low = text.toLowerCase();
      if (low === "null" || low === "undefined" || low === "none") continue;
      return text;
    }
    return "";
  }

  /* то же, но без учёта регистра и стиля написания ключей */
  function pickCI(source, keys) {
    var direct = pick(source, keys);
    if (direct) return direct;

    var flat = {};
    Object.keys(source).forEach(function (key) {
      flat[key.toLowerCase().replace(/[_\-\s]/g, "")] = source[key];
    });

    for (var i = 0; i < keys.length; i += 1) {
      var value = flat[keys[i].toLowerCase().replace(/[_\-\s]/g, "")];
      if (value === undefined || value === null) continue;
      var text = String(value).trim();
      if (!text) continue;
      var low = text.toLowerCase();
      if (low === "null" || low === "undefined" || low === "none") continue;
      return text;
    }
    return "";
  }

  function normalizeStatus(raw) {
    if (!raw) return "";
    var token = String(raw).trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (LOOKUP[token]) return LOOKUP[token];

    var squeezed = token.replace(/_/g, "");
    if (LOOKUP[squeezed]) return LOOKUP[squeezed];

    var keys = Object.keys(LOOKUP);
    for (var i = 0; i < keys.length; i += 1) {
      if (keys[i].indexOf("_") === -1 && keys[i].length > 3 && token.indexOf(keys[i]) !== -1) {
        return LOOKUP[keys[i]];
      }
    }
    return "";
  }

  function fmtAmount(value) {
    if (!value) return "";
    if (/[^\d\s.,]/.test(value)) return value;
    var num = Number(String(value).replace(/\s/g, "").replace(",", "."));
    if (isNaN(num)) return value;
    return num.toLocaleString("ru-RU") + " ₽";
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

  function hasFlag(name) {
    var value = readParams()[name];
    if (value === undefined) return false;
    var v = String(value).toLowerCase();
    return v !== "0" && v !== "false" && v !== "no";
  }

  function fetchWithTimeout(url, options, ms) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, ms);
    var opts = options || {};
    if (controller) opts.signal = controller.signal;
    return fetch(url, opts).finally(function () { clearTimeout(timer); });
  }

  /* ---------- разбор ответа ---------- */

  function normalize(params) {
    var rawStatus = pickCI(params, ALIASES.rawStatus);
    return {
      order: pickCI(params, ALIASES.order),
      rawStatus: rawStatus,
      status: normalizeStatus(rawStatus),
      plan: pickCI(params, ALIASES.plan),
      amount: pickCI(params, ALIASES.amount),
      email: pickCI(params, ALIASES.email),
      date: pickCI(params, ALIASES.date),
      reason: pickCI(params, ALIASES.reason),
      refundId: pickCI(params, ALIASES.refundId),
      caseId: pickCI(params, ALIASES.caseId),
      verified: false
    };
  }

  /* ---------- проверка на сервере ---------- */

  function verify(data) {
    if (!cfg.statusEndpoint || !data.order) return Promise.resolve(null);
    var joiner = String(cfg.statusEndpoint).indexOf("?") === -1 ? "?" : "&";
    var url = cfg.statusEndpoint + joiner + "order=" + encodeURIComponent(data.order);

    return fetchWithTimeout(url, { headers: { Accept: "application/json" } }, cfg.timeout)
      .then(function (response) { return response.ok ? response.json() : null; })
      .catch(function () { return null; });
  }

  function merge(data, remote) {
    if (!remote || typeof remote !== "object") return data;

    var out = {};
    Object.keys(data).forEach(function (key) { out[key] = data[key]; });

    if (remote.status) {
      var mapped = normalizeStatus(remote.status);
      if (mapped) out.status = mapped;
      out.rawStatus = String(remote.status);
    }
    if (remote.amount) out.amount = String(remote.amount);
    if (remote.email) out.email = String(remote.email);
    if (remote.plan) out.plan = String(remote.plan);
    if (remote.date || remote.paid_at) out.date = String(remote.date || remote.paid_at);
    if (remote.refund_id) out.refundId = String(remote.refund_id);

    out.verified = true;
    return out;
  }

  /* ---------- журнал в Supabase ---------- */

  function logEvent(data, params) {
    if (!cfg.supabaseUrl || !cfg.supabaseKey || !cfg.table) return Promise.resolve();

    var base = String(cfg.supabaseUrl).replace(/\/+$/, "");
    var url = base + "/rest/v1/" + encodeURIComponent(cfg.table);
    var body = {
      order_id: data.order || null,
      status: data.status || null,
      raw_status: data.rawStatus || null,
      plan: data.plan || null,
      amount: data.amount || null,
      email: data.email || null,
      reason: data.reason || null,
      refund_id: data.refundId || null,
      case_id: data.caseId || null,
      source: "payment-callback",
      raw: params
    };

    return fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.supabaseKey,
        Authorization: "Bearer " + cfg.supabaseKey,
        Prefer: "return=minimal"
      },
      body: JSON.stringify(body)
    }, cfg.timeout).catch(function () { return null; });
  }

  /* ---------- адрес страницы результата ---------- */

  function targetUrl(data) {
    var page = pages[data.status] || PAGES.success;
    var query = [];

    function add(key, value) {
      if (value) query.push(key + "=" + encodeURIComponent(value));
    }

    add("order", data.order);
    add("status", data.status === "refund" ? "refunded" : data.status);
    add("plan", data.plan);
    add("amount", data.amount);
    add("email", data.email);
    add("date", data.date);
    add("reason", data.reason);
    add("refund_id", data.refundId);
    add("case", data.caseId);
    if (data.verified) add("checked", "1");

    return page + (query.length ? "?" + query.join("&") : "");
  }

  /* ---------- отрисовка ---------- */

  function setField(name, value, formatter) {
    var nodes = document.querySelectorAll('[data-cb-field="' + name + '"]');
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      var row = node.closest(".pay-row");

      if (!value) {
        if (row) row.hidden = true;
        else node.textContent = "—";
        continue;
      }
      if (row) row.hidden = false;
      node.textContent = formatter ? formatter(value) : value;
    }
  }

  function setPill(state, text) {
    var pill = document.querySelector("[data-cb-pill]");
    if (!pill) return;
    pill.dataset.state = PILL[state] || "info";
    var label = pill.querySelector("span");
    if (label && text) label.textContent = text;
  }

  function setText(selector, text) {
    var node = document.querySelector(selector);
    if (node && text) node.textContent = text;
  }

  function showManual(title, text) {
    var card = document.querySelector("[data-cb-manual]");
    if (!card) return;
    card.hidden = false;
    if (title) setText("[data-cb-manual-title]", title);
    if (text) setText("[data-cb-manual-text]", text);
  }

  function showNote(text) {
    var note = document.querySelector("[data-cb-note]");
    if (!note || !text) return;
    note.textContent = text;
    note.hidden = false;
  }

  function renderDetails(data) {
    var card = document.querySelector("[data-cb-details]");
    if (card) card.hidden = false;

    setField("order", data.order);
    setField("rawStatus", data.rawStatus);
    setField("status", data.status ? (STATUS_LABEL[data.status] || data.status) : "");
    setField("plan", data.plan);
    setField("amount", data.amount, fmtAmount);
    setField("email", data.email);
    setField("date", data.date, fmtDate);
    setField("reason", data.reason);
    setField("refundId", data.refundId);
    setField("caseId", data.caseId);
    setField("target", data.order && data.status ? targetUrl(data) : "");
  }

  function bindCopy(data) {
    var buttons = document.querySelectorAll("[data-cb-copy]");
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener("click", function () {
        var key = this.getAttribute("data-cb-copy");
        var value = data[key] || "";
        if (!value || !navigator.clipboard) return;

        var self = this;
        navigator.clipboard.writeText(value).then(function () {
          self.textContent = "Скопировано";
          setTimeout(function () { self.textContent = "Копировать"; }, 1600);
        }).catch(function () {});
      });
    }
  }

  function applyTone(status) {
    var map = {
      success: "pay-tone-success",
      pending: "pay-tone-info",
      fail: "pay-tone-fail",
      refund: "pay-tone-info",
      chargeback: "pay-tone-warn"
    };
    document.body.className = String(document.body.className || "")
      .replace(/pay-tone-\w+/g, "")
      .trim();
    document.body.classList.add(map[status] || "pay-tone-info");
  }

  function stopSpinner() {
    var icon = document.querySelector(".pay-spinner");
    if (icon) icon.style.animation = "none";
  }

  /* ---------- запуск ---------- */

  var params = readParams();
  var data = normalize(params);
  var debug = hasFlag("debug");
  var manual = hasFlag("manual");

  var year = document.querySelector("[data-pay-year]");
  if (year) year.textContent = String(new Date().getFullYear());

  bindCopy(data);

  if (debug || manual || !data.order || !data.status) renderDetails(data);

  if (!data.order) {
    stopSpinner();
    applyTone("fail");
    setPill("fail", "Нет номера заказа");
    setText("[data-cb-title]", "Ответ пришёл без номера заказа");
    setText(
      "[data-cb-lead]",
      "В ссылке возврата нет параметра с номером заказа, поэтому результат оплаты определить нельзя. " +
        "Так бывает, когда платёжная система присылает подтверждение отдельным уведомлением на сервер, " +
        "а в адрес возврата номер не добавляет."
    );
    showManual(
      "Как открыть результат вручную",
      "Выберите страницу по тому, что показал банк. Номер заказа есть в письме об оплате — " +
        "если его нет, напишите в поддержку, найдём платёж по почте и сумме."
    );
    return;
  }

  if (!data.status) {
    stopSpinner();
    applyTone("pending");
    setPill("pending", "Статус не распознан");
    setText("[data-cb-title]", "Статус из ответа не распознан");
    setText(
      "[data-cb-lead]",
      "Номер заказа получен, но в ответе нет понятного статуса. Мы не угадываем результат: " +
        "проверьте платёж в панели управления или напишите в поддержку — уточним по номеру заказа."
    );
    showManual(
      "Проверить результат вручную",
      "Откройте панель управления: если подписка активна, платёж прошёл. " +
        "Если нет — загляните в письмо от платёжной системы или напишите в поддержку."
    );
    return;
  }

  setPill(data.status, STATUS_LABEL[data.status] || "Обрабатываем");
  setText("[data-cb-title]", "Проверяем платёж");

  verify(data)
    .then(function (remote) {
      var result = merge(data, remote);
      renderDetails(result);
      return logEvent(result, params).then(function () { return result; });
    })
    .then(function (result) {
      var url = targetUrl(result);

      stopSpinner();
      applyTone(result.status);
      setPill(result.status, STATUS_LABEL[result.status] || "Обработано");
      setText("[data-cb-title]", STATUS_LABEL[result.status] || "Ответ обработан");
      setText(
        "[data-cb-lead]",
        result.verified
          ? "Статус подтверждён сервером. Открываем страницу результата."
          : "Статус взят из ответа платёжной системы. Открываем страницу результата."
      );

      if (!cfg.autoRedirect || manual || debug) {
        showManual(
          "Автопереход отключён",
          "Страница открыта в режиме ручного разбора. Перейдите на нужную страницу по кнопке ниже."
        );
        var link = document.querySelector("[data-cb-continue]");
        if (link) {
          link.href = url;
          link.hidden = false;
        }
        return;
      }

      setTimeout(function () {
        window.location.replace(url);
      }, Number(cfg.delay) || 0);

      setTimeout(function () {
        showNote("Переход не сработал — похоже, браузер его заблокировал. Откройте результат по кнопке ниже.");
        showManual("Открыть результат вручную", "Нажмите кнопку — откроется та же страница, что и при автопереходе.");
        var fallback = document.querySelector("[data-cb-continue]");
        if (fallback) {
          fallback.href = url;
          fallback.hidden = false;
        }
      }, (Number(cfg.delay) || 0) + 5000);
    })
    .catch(function () {
      stopSpinner();
      applyTone("pending");
      setPill("pending", "Не удалось обработать");
      setText("[data-cb-title]", "Не удалось обработать ответ");
      setText(
        "[data-cb-lead]",
        "Что-то пошло не так при разборе ответа. Платёж при этом не теряется — " +
          "проверьте подписку в панели управления или напишите в поддержку."
      );
      showManual(
        "Что делать дальше",
        "Откройте панель управления и проверьте статус подписки. Если оплата прошла, " +
          "а подписка не активна — напишите в поддержку и приложите номер заказа."
      );
    });
})();
