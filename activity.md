# Activity

The build log is kept in the owner's private repository, not here.

Ask the owner for it, and record new entries there.

## 2026-11-08 YouTube Summarize like Comet

Owner compared Scout's "Summarize the video" (short intro, 5 one-line bullets, single times) with Comet's for the same video. Now Summarize on a YouTube video (the starter and the Summarize chip) asks for the central takeaway, 4 to 7 numbered takeaways each with a bold heading line, a 2-3 sentence explanation and a time range like [1:31–3:22], then "Why it matters". The panel reads ranges and lists of ranges as chips that play from the start, keeps a numbered list together across blank lines, and puts an explanation on its own line under a bold heading. Evidence: `tests/unit/video-summary.test.ts`, e2e "Summarize on a YouTube video ..." (Chromium locally; WebKit not installed in the container). Live model output still to check on a real video.
