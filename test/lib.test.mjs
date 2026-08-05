import test from "node:test";
import assert from "node:assert/strict";
import { publicVideoSummary, videoIdFromUrl } from "../scripts/lib.mjs";
import { formatReadableCommentsExport } from "../scripts/comments-export.mjs";

test("extracts video IDs from common YouTube URLs", () => {
  assert.equal(videoIdFromUrl("https://www.youtube.com/watch?v=bFNq9iS4Xn4&t=2"), "bFNq9iS4Xn4");
  assert.equal(videoIdFromUrl("https://music.youtube.com/watch?v=ErslxA1LmMk"), "ErslxA1LmMk");
  assert.equal(videoIdFromUrl("https://youtu.be/bFNq9iS4Xn4"), "bFNq9iS4Xn4");
  assert.equal(videoIdFromUrl("https://youtube.com/shorts/bFNq9iS4Xn4"), "bFNq9iS4Xn4");
  assert.equal(videoIdFromUrl("not a URL"), null);
});

test("summarizes top-level comments and replies", () => {
  const result = publicVideoSummary({
    id: "bFNq9iS4Xn4",
    sourceTitle: "Song",
    archiveStatus: "complete",
    comments: [{ replies: [{}, {}] }, { replies: [] }],
  });
  assert.equal(result.archivedTopLevelComments, 2);
  assert.equal(result.archivedReplies, 2);
  assert.equal(result.archivedComments, 4);
});

test("marks API-disabled videos with reported comments as partial", () => {
  const result = publicVideoSummary({
    id: "bFNq9iS4Xn4",
    archiveStatus: "complete",
    commentsStatus: "disabled",
    statistics: { commentCount: 9115 },
    comments: [],
  });
  assert.equal(result.archiveStatus, "partial");
});

test("marks materially incomplete web captures as partial", () => {
  const result = publicVideoSummary({
    id: "bFNq9iS4Xn4",
    archiveStatus: "complete",
    commentsStatus: "complete",
    commentsSource: "youtube-web-via-yt-dlp",
    statistics: { commentCount: 100 },
    comments: [{ replies: [] }],
  });
  assert.equal(result.archiveStatus, "partial");
});

test("marks even a small web capture shortfall as partial", () => {
  const result = publicVideoSummary({
    id: "bFNq9iS4Xn4",
    archiveStatus: "complete",
    commentsStatus: "complete",
    commentsSource: "youtube-web-via-yt-dlp",
    statistics: { commentCount: 9115 },
    comments: Array.from({ length: 8983 }, () => ({ replies: [] })),
  });
  assert.equal(result.archivedComments, 8983);
  assert.equal(result.archiveStatus, "partial");
});

test("formats comments and replies as a readable text export", () => {
  const text = formatReadableCommentsExport([
    {
      id: "bFNq9iS4Xn4",
      title: "A song",
      channelTitle: "my head is empty",
      publishedAt: "2024-01-02T12:00:00Z",
      originalUrl: "https://www.youtube.com/watch?v=bFNq9iS4Xn4",
      comments: [{
        author: { name: "Listener" },
        text: "This meant a lot.",
        likeCount: 2,
        publishedAt: "2024-02-03T12:00:00Z",
        replies: [{
          author: { name: "Artist", isUploader: true },
          text: "Thank you.",
          likeCount: 1,
          publishedAt: "2024-02-04T12:00:00Z",
        }],
      }],
    },
  ], { lastCheckedAt: "2026-08-06T12:00:00Z" });

  assert.match(text, /Title: A song/);
  assert.match(text, /Listener · 2024-02-03 · 2 likes/);
  assert.match(text, /↳ Artist · 2024-02-04 · 1 like · artist/);
  assert.match(text, /Comments and replies: 2/);
});
