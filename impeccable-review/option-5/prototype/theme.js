// Option 5 · Ink & Paper: masthead greeting and numbered starters (prototype only).
(() => {
  const h1 = document.querySelector("#chat-view > header h1");
  if (h1) h1.textContent = "Scout";
  const list = document.getElementById("starters");
  if (list && !document.querySelector(".rev-mast")) {
    document.getElementById("empty")?.insertAdjacentHTML("beforeend", '<p class="rev-mast"><small>On this page</small><b>What would you like <i>to know?</i></b></p>');
    list.querySelectorAll("button").forEach((b, i) => { b.dataset.n = String(i + 1).padStart(2, "0"); });
    for (const svg of list.querySelectorAll("svg.i")) svg.innerHTML = '<path d="M5 12h14M13 6l6 6-6 6"/>';
  }
})();
