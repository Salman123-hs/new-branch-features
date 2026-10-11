(function () {
  var root = (window.Shopify && Shopify.routes && Shopify.routes.root) || "/";
  var STORAGE_KEY = "pdc_last_pincode";

  function init(box) {
    if (box.dataset.pdcReady) return;
    box.dataset.pdcReady = "1";

    var form = box.querySelector(".pdc__form");
    var input = box.querySelector(".pdc__input");
    var button = box.querySelector(".pdc__button");
    var result = box.querySelector(".pdc__result");

    // sirf number, max 6
    input.addEventListener("input", function () {
      input.value = input.value.replace(/\D/g, "").slice(0, 6);
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      check(input.value.trim());
    });

    // pichhla pincode yaad rakho
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        input.value = saved;
        check(saved);
      }
    } catch (err) {}

    function show(type, lines) {
      result.className = "pdc__result pdc__result--" + type;
      result.textContent = "";
      lines.forEach(function (text) {
        var p = document.createElement("p");
        p.textContent = text;
        result.appendChild(p);
      });
    }

    function check(pincode) {
      if (!/^\d{6}$/.test(pincode)) {
        show("error", ["Please enter a valid 6-digit pincode"]);
        return;
      }
      button.disabled = true;
      show("loading", ["Checking..."]);

      fetch(root + "apps/pincode/check?pincode=" + encodeURIComponent(pincode), {
        headers: { Accept: "application/json" },
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) {
            show("error", [data.message || "Something went wrong"]);
            return;
          }
          try { localStorage.setItem(STORAGE_KEY, pincode); } catch (err) {}

          if (data.available) {
            show("success", [
              "🚚 " + data.message,
              data.codAvailable ? "💵 Cash on Delivery available" : "Cash on Delivery not available",
            ]);
          } else {
            show("error", [data.message]);
          }
        })
        .catch(function () {
          show("error", ["Could not check right now. Please try again."]);
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

  // theme editor mein block add/move hone par
  document.addEventListener("shopify:section:load", initAll);
  document.addEventListener("shopify:block:select", initAll);
})();