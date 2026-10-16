// Background (non-persistent) script. The agent loop arrives in T010.
browser.runtime.onMessage.addListener((message: unknown) => {
  if (message === "ping") {
    return Promise.resolve({ ok: true, from: "background" });
  }
  return undefined;
});
