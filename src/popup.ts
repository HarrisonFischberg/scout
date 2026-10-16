// Popup UI. Chat screen (S04) arrives in T007.
const statusEl = document.getElementById("status");

browser.runtime
  .sendMessage("ping")
  .then((reply) => {
    const ok = (reply as { ok?: boolean } | undefined)?.ok === true;
    if (statusEl) statusEl.textContent = ok ? "Background connected." : "Background error.";
  })
  .catch(() => {
    if (statusEl) statusEl.textContent = "Background unreachable.";
  });
