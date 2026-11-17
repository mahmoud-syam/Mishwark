// Applies the saved theme before the page paints (no light flash for dark users).
// A separate file because the dashboard's Content-Security-Policy blocks inline scripts.
(function () {
  try {
    var t = localStorage.getItem("mishwark-theme");
    document.documentElement.dataset.theme = t === "dark" ? "dark" : "light";
  } catch (e) {
    document.documentElement.dataset.theme = "light";
  }
})();
