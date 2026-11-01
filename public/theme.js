(() => {
  const key = "cosmicdesk.theme";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  let preference = null;
  try {
    const saved = window.localStorage.getItem(key);
    if (saved === "light" || saved === "dark") preference = saved;
  } catch {
    /* Theme switching still works when storage is unavailable. */
  }
  let button;
  const apply = () => {
    const theme = preference || (system.matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    if (button) {
      const next = theme === "dark" ? "light" : "dark";
      const label = "Switch to " + next + " mode";
      button.setAttribute("aria-label", label);
      button.title = label;
      button.querySelector("[data-theme-label]").textContent =
        next === "dark" ? "Dark mode" : "Light mode";
      button.hidden = false;
    }
  };
  // Runs before the stylesheet so a saved dark preference does not flash light.
  apply();
  document.addEventListener("DOMContentLoaded", () => {
    button = document.querySelector("[data-theme-toggle]");
    if (!button) return;
    button.addEventListener("click", () => {
      preference =
        document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(key, preference);
      } catch {
        /* Session-only choice. */
      }
      apply();
    });
    apply();
  });
  system.addEventListener("change", () => {
    if (!preference) apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    preference =
      event.newValue === "light" || event.newValue === "dark"
        ? event.newValue
        : null;
    apply();
  });
})();
