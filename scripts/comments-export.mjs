import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DATA_DIR,
  readJson,
  SITE_DIR,
  VIDEO_DATA_DIR,
} from "./lib.mjs";

export const COMMENTS_EXPORT_FILE = path.join(
  SITE_DIR,
  "downloads",
  "my-head-is-empty-comments.txt",
);

export async function writeReadableCommentsExport(index = null) {
  const archiveIndex = index ?? await readJson(path.join(DATA_DIR, "index.json"));
  const videos = [];
  for (const summary of archiveIndex.videos) {
    const video = await readJson(path.join(VIDEO_DATA_DIR, `${summary.id}.json`), null);
    if (video) videos.push(video);
  }

  const text = formatReadableCommentsExport(videos, archiveIndex);
  await mkdir(path.dirname(COMMENTS_EXPORT_FILE), { recursive: true });
  const temporary = `${COMMENTS_EXPORT_FILE}.${process.pid}.tmp`;
  await writeFile(temporary, text, "utf8");
  try {
    await rename(temporary, COMMENTS_EXPORT_FILE);
  } catch (error) {
    if (error.code !== "EEXIST" && error.code !== "EPERM") throw error;
    await writeFile(COMMENTS_EXPORT_FILE, text, "utf8");
    await rm(temporary, { force: true });
  }

  return {
    file: COMMENTS_EXPORT_FILE,
    videos: videos.length,
    comments: videos.reduce((total, video) => total + countComments(video.comments ?? []), 0),
  };
}

export function formatReadableCommentsExport(videos, index = {}) {
  const separator = "=".repeat(80);
  const sectionSeparator = "-".repeat(80);
  const commentCount = videos.reduce(
    (total, video) => total + countComments(video.comments ?? []),
    0,
  );
  const snapshotDate = formatDate(index.lastCheckedAt ?? index.lastArchivedAt);
  const lines = [
    "MY HEAD IS EMPTY — COMMENT ARCHIVE",
    separator,
    "",
    "A readable text copy of the public comments and replies preserved by the",
    "my head is empty comment archive.",
    "",
    "Website: https://c0ntrix.github.io/my-head-is-empty-comment-archive/",
    `Snapshot: ${snapshotDate}`,
    `Videos: ${videos.length.toLocaleString("en-US")}`,
    `Comments and replies: ${commentCount.toLocaleString("en-US")}`,
    "",
  ];

  videos.forEach((video, videoIndex) => {
    const comments = video.comments ?? [];
    lines.push(
      separator,
      `VIDEO ${videoIndex + 1} OF ${videos.length}`,
      separator,
      `Title: ${singleLine(video.title ?? video.sourceTitle ?? `Video ${video.id}`)}`,
      `Channel: ${singleLine(video.channelTitle ?? "Unknown channel")}`,
      `Published: ${formatDate(video.publishedAt)}`,
      `Original page: ${video.originalUrl ?? `https://www.youtube.com/watch?v=${video.id}`}`,
      `Comments and replies preserved: ${countComments(comments).toLocaleString("en-US")}`,
      "",
    );

    if (!comments.length) {
      lines.push("No comments were available in this snapshot.", "");
      return;
    }

    comments.forEach((comment, commentIndex) => {
      if (commentIndex > 0) lines.push(sectionSeparator);
      lines.push(...formatComment(comment));
      for (const reply of comment.replies ?? []) {
        lines.push("", ...formatComment(reply, true));
      }
      lines.push("");
    });
  });

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatComment(comment, isReply = false) {
  const indent = isReply ? "    " : "";
  const marker = isReply ? "↳ " : "";
  const author = singleLine(comment.author?.name ?? "Unknown author");
  const likes = Number(comment.likeCount ?? 0);
  const details = [
    formatDate(comment.publishedAt),
    `${likes.toLocaleString("en-US")} ${likes === 1 ? "like" : "likes"}`,
  ];
  if (comment.isPinned) details.push("pinned");
  if (comment.author?.isUploader) details.push("artist");

  const textLines = String(comment.text ?? "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  const bodyIndent = `${indent}  `;
  return [
    `${indent}${marker}${author} · ${details.join(" · ")}`,
    ...(textLines.some((line) => line.length)
      ? textLines.map((line) => `${bodyIndent}${line}`)
      : [`${bodyIndent}(no text)`]),
  ];
}

function countComments(comments) {
  return comments.reduce(
    (total, comment) => total + 1 + (comment.replies?.length ?? 0),
    0,
  );
}

function formatDate(value) {
  if (!value) return "unknown date";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "unknown date" : date.toISOString().slice(0, 10);
}

function singleLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
