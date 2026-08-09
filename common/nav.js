// ---------------------------------------------------------------------------
// nav.js — injects a persistent "Game Night" home link on every game page.
// Imported (as a side effect) by common/firebase-config.js, so every game
// picks it up automatically. Edit the link/label here once.
// Hidden during active gameplay (#screen-game) so it never covers the board.
// ---------------------------------------------------------------------------
(function () {
  function inject() {
    if (document.getElementById("ls-home-link")) return;
    if (document.getElementById("app")) return; // SPA shell handles its own nav
    const css = document.createElement("style");
    css.textContent =
      ".ls-home-link{position:fixed;top:12px;left:12px;z-index:200;display:inline-flex;align-items:center;" +
      "gap:5px;font-size:12px;font-weight:800;letter-spacing:.02em;color:#2451a9;background:#fff;" +
      "border:1px solid #e3e9f2;border-radius:999px;padding:7px 13px;text-decoration:none;" +
      "box-shadow:0 6px 16px rgba(20,40,80,.12);font-family:'Segoe UI',system-ui,sans-serif;}" +
      ".ls-home-link:hover{background:#f0f7fe;}" +
      "body:has(#screen-game.active) .ls-home-link{display:none;}";
    document.head.appendChild(css);
    const a = document.createElement("a");
    a.id = "ls-home-link"; a.className = "ls-home-link"; a.href = "../";
    a.title = "Back to Game Night"; a.textContent = "\u2190 Game Night";
    document.body.appendChild(a);
  }
  if (document.body) inject();
  else document.addEventListener("DOMContentLoaded", inject);
})();
