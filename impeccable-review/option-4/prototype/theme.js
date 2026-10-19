// Option 4 · Deal Hunter: headline and Find coupons as the first big tile (prototype only).
(() => {
  const h1 = document.querySelector("#chat-view > header h1");
  if (h1) h1.textContent = "Scout";
  const list = document.getElementById("starters");
  const mark = document.querySelector("#empty .scout-mark");
  if (mark && !document.querySelector(".rev-hunt")) {
    mark.insertAdjacentHTML("afterend", '<p class="rev-hunt">What are we hunting?<span>Deals, answers, or a job done on this page.</span></p>');
    const tag = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12 12 20 3 11V3h8Z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>';
    list?.insertAdjacentHTML("afterbegin", `<li><button type="button"><span>Find coupons for this cart</span>${tag}</button></li>`);
    const btns = list?.querySelectorAll("button");
    if (btns?.[1]) btns[1].querySelector("span").textContent = "Summarize";
    if (btns?.[2]) btns[2].querySelector("span").textContent = "Key points";
  }
})();
