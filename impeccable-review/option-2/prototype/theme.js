// Option 2 · Pure Apple: short title, a large-title greeting, chevron rows (prototype only).
(() => {
  const h1 = document.querySelector("#chat-view > header h1");
  if (h1) h1.textContent = "Scout";
  const empty = document.getElementById("empty");
  if (empty && !document.querySelector(".rev-large")) {
    empty.insertAdjacentHTML("beforeend", '<p class="rev-large"><b>Ask Scout</b><span>About this page, or a task to do on it.</span></p>');
  }
  for (const svg of document.querySelectorAll("#starters svg.i")) svg.innerHTML = '<path d="m9 6 6 6-6 6"/>';
})();
