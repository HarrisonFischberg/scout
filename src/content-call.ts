// Calls a handler that one of Scout's content scripts registers in a tab,
// injecting the script first when it is missing (first call, or the page
// navigated). Used by the worker (Scout mode) and the popup (Find coupons'
// overlay). Kept free of side effects.
// Content-script calls from the worker, the way the popup makes them
// (scripting.executeScript with a func): on iOS a tabs.sendMessage went
// unanswered (T018), while executeScript results arrive reliably. The script
// is injected first when its handler is missing (first call, or the page
// navigated); page failures come back as an envelope, never as a silent null.
export async function callInjected(tabId: number, file: string, handler: string, req: unknown): Promise<unknown> {
  const once = async (): Promise<{ ok: true; value: unknown } | { ok: false; why: string }> => {
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      func: (r: unknown, name: string) => {
        try {
          const h = (globalThis as unknown as Record<string, ((x: unknown) => unknown) | undefined>)[name];
          if (!h) return { ok: false, why: "no-handler" };
          const out = h(r);
          if (out && typeof (out as Promise<unknown>).then === "function") {
            return (out as Promise<unknown>).then(
              (value) => ({ ok: true, value }),
              () => ({ ok: false, why: "threw-async" }),
            );
          }
          return { ok: true, value: out };
        } catch {
          return { ok: false, why: "threw" };
        }
      },
      args: [req, handler],
    });
    const env = res?.result as { ok?: boolean; value?: unknown; why?: string } | null | undefined;
    if (!env || env.ok !== true) return { ok: false, why: env ? (env.why ?? "bad-envelope") : "null-result" };
    return { ok: true, value: env.value };
  };
  let out = await once().catch(() => ({ ok: false as const, why: "threw-call" }));
  if (!out.ok && /no-handler|null-result|threw-call/.test(out.why)) {
    await browser.scripting.executeScript({ target: { tabId }, files: [file] });
    out = await once();
  }
  if (!out.ok) throw new Error("content call failed: " + out.why);
  return out.value;
}


