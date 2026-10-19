// Option 1 · Trailhead: a greeting under the badge and short starter labels (prototype only).
(() => {
  const h1 = document.querySelector("#chat-view > header h1");
  if (h1) h1.textContent = "Scout";
  const mark = document.querySelector("#empty .scout-mark");
  if (mark && !document.querySelector(".rev-greet")) {
    mark.insertAdjacentHTML("afterend", '<p class="rev-greet"><b>Where to next?</b><span>Ask about this page, or send Scout to do it.</span></p>');
  }
  const labels = { summarize: "Summarize this page", "Explain the most important points on this page.": "Explain the key points" };
  for (const b of document.querySelectorAll("#starters button")) {
    const icon = b.querySelector("svg");
    if (icon) icon.innerHTML = b.dataset.prompt === "summarize" ? '<path d="M5 6h14M5 11h14M5 16h9"/>' : '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.5"/>';
    void labels;
  }
})();
