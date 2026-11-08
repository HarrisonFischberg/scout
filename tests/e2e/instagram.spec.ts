import { expect, test, type Page } from "@playwright/test";
import { readInstagram, type InstagramRead, type ReadOptions } from "../../src/context/instagram";

// Instagram reader (owner request 2026-11-08): the in-tab half runs in a real
// browser on synthetic Instagram-like pages (tests/fixtures/instagram-*.html).

const read = (page: Page, opts: ReadOptions = {}): Promise<InstagramRead> => page.evaluate(readInstagram, { maxImages: 5, edge: 1092, frames: 3, budgetMs: 4500, ...opts });

const jpegSize = (b64: string): number => Math.round((b64.length * 3) / 4);

test("a reel: account, caption, tags, audio, and frames from across the video, then back where it was", async ({ page }) => {
  await page.goto("/instagram-reel.html");
  await page.locator("#v").evaluate(async (v: HTMLVideoElement) => {
    await v.play();
    await new Promise<void>((r) => {
      const tick = (): void => (v.currentTime > 1 ? r() : void setTimeout(tick, 50));
      tick();
    });
  });
  const r = await read(page);
  expect(r.media).toBe("video");
  expect(r.author).toBe("trailcook");
  expect(r.hashtags).toEqual(["#camping", "#breakfast"]);
  expect(r.location).toBe("Yosemite National Park");
  expect(r.audio).toBe("trailcook · Original audio");
  expect(r.date).toBe("2026-11-01T18:00:00.000Z");
  expect(r.dateLabel).toBe("November 1, 2026");
  // The stale og:description belongs to another address and is not used.
  expect(r.caption).toBeUndefined();
  expect(r.around).toContain("One-pan camp breakfast");
  expect(r.around).toContain("Making this this weekend!");
  // The next reel down is not this post.
  expect(r.around).not.toContain("A different reel's caption");
  expect(r.duration).toBeCloseTo(12, 0);
  expect(r.muted).toBe(true);
  // The frame on screen plus three from across the video, in time order.
  expect(r.images.length).toBe(4);
  expect(r.images.filter((i) => i.label.includes("what the user is seeing now"))).toHaveLength(1);
  const times = r.images.map((i) => /at (\d+):(\d+)/.exec(i.label)!).map((m) => Number(m[1]) * 60 + Number(m[2]));
  expect([...times].sort((a, b) => a - b)).toEqual(times);
  for (const i of r.images) {
    expect(i.mediaType).toBe("image/jpeg");
    expect(Math.max(i.width, i.height)).toBeLessThanOrEqual(1092);
    expect(jpegSize(i.data)).toBeGreaterThan(1000);
  }
  // Back where it was, and still playing.
  const after = await page.locator("#v").evaluate((v: HTMLVideoElement) => ({ t: v.currentTime, paused: v.paused }));
  expect(after.paused).toBe(false);
  expect(Math.abs(after.t - (r.current ?? 0))).toBeLessThan(2);
  expect(r.blocked).toBe(false);
});

test("a carousel post in a dialog: caption from the h1, Instagram's descriptions, slides the canvas may read", async ({ page }) => {
  await page.goto("/instagram-post.html");
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  const r = await read(page);
  expect(r.media).toBe("carousel");
  expect(r.author).toBe("natgeo");
  expect(r.caption).toBe("Three days in the Sierra. Swipe for the tent setup. #hiking");
  expect(r.hashtags).toEqual(["#hiking"]);
  expect(r.alts).toContain("May be an image of mountains and text that says 'DAY 1'");
  // Profile pictures and the feed behind the dialog are left out.
  expect(r.alts.join(" ")).not.toMatch(/profile picture|feed photo/);
  // Same-origin slide, and the cross-origin slide whose CDN allows CORS (fetched again);
  // the slide whose CDN refuses is skipped.
  expect(r.images.map((i) => i.label)).toEqual([
    "Carousel slide on screen: May be an image of mountains and text that says 'DAY 1'",
    "Another carousel slide: May be an image of a tent",
  ]);
  expect(r.blocked).toBe(false);
});

test("pictures the browser refuses to read: none sent, and the reader says so", async ({ page }) => {
  await page.goto("/instagram-post.html");
  await page.evaluate(() => {
    for (const id of ["s1", "s2"]) document.getElementById(id)!.remove();
  });
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  const r = await read(page);
  expect(r.images).toEqual([]);
  expect(r.blocked).toBe(true);
  expect(r.alts).toContain("Cross-origin slide");
});
