// Option 3 · Night Ops: commands with shortcuts, including the two hidden behind + (prototype only).
(() => {
  const h1 = document.querySelector("#chat-view > header h1");
  if (h1) h1.textContent = "Scout";
  const list = document.getElementById("starters");
  const empty = document.getElementById("empty");
  if (empty && !document.querySelector(".rev-cmd-title")) {
    empty.insertAdjacentHTML("beforeend", '<p class="rev-cmd-title">What should Scout do?<span>Type a question, or pick a command.</span></p>');
    const cmds = [["/summarize", "⌘1"], ["/explain", "⌘2"]];
    list?.querySelectorAll("button").forEach((b, i) => { b.dataset.cmd = cmds[i][0]; b.dataset.key = cmds[i][1]; });
    list?.insertAdjacentHTML("beforeend",
      '<li><button type="button" data-cmd="/coupons" data-key="⌘3"><span>Find and test coupon codes</span></button></li>' +
      '<li><button type="button" data-cmd="/scout" data-key="⌘4"><span>Do a task on this page</span></button></li>');
  }
})();
