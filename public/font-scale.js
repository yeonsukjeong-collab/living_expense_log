"use strict";
(function () {
  const STEPS = [14, 16, 18, 20, 22, 24];
  const KEY = "fontScalePx";

  function getScale() {
    const saved = Number(localStorage.getItem(KEY));
    return STEPS.includes(saved) ? saved : 16;
  }

  function applyScale(px) {
    document.documentElement.style.fontSize = `${px}px`;
  }

  function setScale(px) {
    localStorage.setItem(KEY, String(px));
    applyScale(px);
  }

  applyScale(getScale());

  document.addEventListener("DOMContentLoaded", () => {
    const incBtn = document.getElementById("font-increase-btn");
    const decBtn = document.getElementById("font-decrease-btn");
    if (incBtn) {
      incBtn.addEventListener("click", () => {
        const idx = STEPS.indexOf(getScale());
        setScale(STEPS[Math.min(idx + 1, STEPS.length - 1)]);
      });
    }
    if (decBtn) {
      decBtn.addEventListener("click", () => {
        const idx = STEPS.indexOf(getScale());
        setScale(STEPS[Math.max(idx - 1, 0)]);
      });
    }
  });
})();
