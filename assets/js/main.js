/* ============================================================
   Seeker — взаимодействия интерфейса
   ============================================================ */
(function () {
  "use strict";

  /* ---------- год в футере ---------- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- фон навигации при скролле ---------- */
  var nav = document.getElementById("nav");
  function onScroll() {
    if (!nav) return;
    nav.classList.toggle("scrolled", window.scrollY > 12);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- мобильное меню ---------- */
  var toggle = document.getElementById("navToggle");
  var drawer = document.getElementById("navDrawer");

  function closeDrawer() {
    if (!drawer || !toggle) return;
    drawer.classList.remove("open");
    toggle.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("locked");
  }

  if (toggle && drawer) {
    toggle.addEventListener("click", function () {
      var open = drawer.classList.toggle("open");
      toggle.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      document.body.classList.toggle("locked", open);
    });

    drawer.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeDrawer);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDrawer();
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 860) closeDrawer();
    });
  }

  /* ---------- появление блоков при скролле ---------- */
  var revealEls = document.querySelectorAll(".reveal");

  if ("IntersectionObserver" in window && revealEls.length) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    revealEls.forEach(function (el) {
      io.observe(el);
    });
  } else {
    revealEls.forEach(function (el) {
      el.classList.add("in");
    });
  }

  /* ---------- показ контента после входа в аккаунт ---------- */
  document.addEventListener("seeker:auth", function (e) {
    if (!e.detail || !e.detail.signedIn) return;
    document.querySelectorAll(".reveal").forEach(function (el) {
      el.classList.add("in");
    });
  });

  /* ---------- переключатель месяц / год ---------- */
  var billing = document.querySelector(".billing-toggle");
  if (billing) {
    var buttons = billing.querySelectorAll("button");
    var glider = billing.querySelector(".glider");
    var amount = document.getElementById("planAmount");
    var period = document.getElementById("planPeriod");
    var sub = document.getElementById("planSub");

    var plans = {
      month: {
        amount: "1 199 ₽",
        period: "/ месяц",
        sub: "Списание каждый месяц. Отменить можно в любой момент."
      },
      year: {
        amount: "11 999 ₽",
        period: "/ год",
        sub: 'Экономия 2 389 ₽ — это два месяца в подарок.'
      }
    };

    function moveGlider(btn) {
      if (!glider) return;
      glider.style.width = btn.offsetWidth + "px";
      glider.style.transform = "translateX(" + (btn.offsetLeft - 5) + "px)";
    }

    function applyPlan(key) {
      var data = plans[key];
      if (!data) return;

      if (amount) amount.textContent = data.amount;
      if (period) period.textContent = data.period;
      if (sub) {
        sub.innerHTML =
          key === "year"
            ? '<span class="save-line">Экономия 2 389 ₽</span> — это два месяца в подарок.'
            : data.sub;
      }
    }

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        buttons.forEach(function (b) {
          b.classList.toggle("active", b === btn);
          b.setAttribute("aria-pressed", String(b === btn));
        });
        moveGlider(btn);
        applyPlan(btn.dataset.plan);
      });
    });

    var initial = billing.querySelector("button.active") || buttons[0];
    if (initial) {
      requestAnimationFrame(function () {
        moveGlider(initial);
      });
      applyPlan(initial.dataset.plan || "month");
    }

    window.addEventListener("resize", function () {
      var active = billing.querySelector("button.active") || buttons[0];
      if (active) moveGlider(active);
    });
  }

  /* ---------- подсветка активного раздела в меню ---------- */
  var sections = document.querySelectorAll("main section[id]");
  var navLinks = document.querySelectorAll(".nav-links a[href^='#']");

  if (sections.length && navLinks.length && "IntersectionObserver" in window) {
    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var id = entry.target.id;
          navLinks.forEach(function (link) {
            link.classList.toggle("active", link.getAttribute("href") === "#" + id);
          });
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );

    sections.forEach(function (s) {
      spy.observe(s);
    });
  }
})();
