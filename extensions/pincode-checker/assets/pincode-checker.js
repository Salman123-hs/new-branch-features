(function () {
  var root = (window.Shopify && Shopify.routes && Shopify.routes.root) || "/";

  // 147 → "2h 27m"
  function fmt(minutes) {
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    return h ? h + "h " + m + "m" : m + "m";
  }

  function init(box) {
    if (box.dataset.pdcReady) return;
    box.dataset.pdcReady = "1";

    var form = box.querySelector(".pdc__form");
    var input = box.querySelector(".pdc__input");
    var button = box.querySelector(".pdc__button");
    var result = box.querySelector(".pdc__result");

    var country = (box.dataset.country || "IN").toUpperCase();
    var STORAGE_KEY = "pdc_last_postcode_" + country;
    var timer = null; // naya: countdown ka interval

    input.addEventListener("input", function () {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9 -]/g, "").slice(0, 10);
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      check(input.value.trim());
    });

    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        input.value = saved;
        check(saved);
      }
    } catch (err) {}

    function looksValid(code) {
      var clean = code.replace(/[\s-]/g, "");
      if (country === "IN") return /^\d{6}$/.test(clean);
      return /^[A-Z0-9]{3,10}$/.test(clean);
    }

    function stopTimer() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    // Result saaf karo aur naya type lagao
    function reset(type) {
      stopTimer();
      result.className = "pdc__result pdc__result--" + type;
      result.textContent = "";
    }

    // Ek line jodo (textContent = safe, koi HTML inject nahi ho sakta)
    function line(text, cls) {
      var p = document.createElement("p");
      p.textContent = text;
      if (cls) p.className = cls;
      result.appendChild(p);
      return p;
    }

    // naya: live countdown; cut-off nikalte hi dobara check karke nayi date lao
    function startCountdown(minutesLeft, suffix, code) {
      var deadline = Date.now() + minutesLeft * 60000;
      var el = line("", "pdc__countdown");
      function tick() {
        var left = Math.ceil((deadline - Date.now()) / 60000);
        if (left <= 0) {
          stopTimer();
          check(code, true);
          return;
        }
        el.textContent = "⏰ Order within " + fmt(left) + " " + suffix;
      }
      tick();
      timer = setInterval(tick, 30000);
    }

    function check(code, silent) {
      if (!looksValid(code)) {
        reset("error");
        line(country === "IN" ? "Please enter a valid 6-digit pincode" : "Please enter a valid postal code");
        return;
      }
      button.disabled = true;
      if (!silent) {
        reset("loading");
        line("Checking...");
      }

      fetch(
        root +
          "apps/pincode/check?pincode=" + encodeURIComponent(code) +
          "&country=" + encodeURIComponent(country),
        { headers: { Accept: "application/json" } }
      )
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) {
            reset("error");
            line(data.message || "Something went wrong");
            return;
          }
          try { localStorage.setItem(STORAGE_KEY, code); } catch (err) {}

          if (data.available) {
            reset("success");
            line("🚚 " + data.message);
            line(
              data.codAvailable ? "💵 Cash on Delivery available" : "Cash on Delivery not available",
              data.codAvailable ? "" : "pdc__no-cod"
            );
            if (typeof data.cutoffMinutesLeft === "number" && data.cutoffMinutesLeft > 0) {
              startCountdown(
                data.cutoffMinutesLeft,
                data.dispatchToday ? "for dispatch today" : "to get it by " + data.deliveryTo,
                code
              );
            }
            if (data.disclaimer) line(data.disclaimer, "pdc__note");
          } else {
            reset("error");
            line(data.message);
          }
        })
        .catch(function () {
          reset("error");
          line("Could not check right now. Please try again.");
        })
        .finally(function () {
          button.disabled = false;
        });
    }
  }

  function initAll() {
    document.querySelectorAll("[data-pincode-checker]").forEach(init);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }

  document.addEventListener("shopify:section:load", initAll);
  document.addEventListener("shopify:block:select", initAll);
})();