import test from "node:test";
import assert from "node:assert/strict";
import { publicVideoSummary, videoIdFromUrl } from "../scripts/lib.mjs";

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
