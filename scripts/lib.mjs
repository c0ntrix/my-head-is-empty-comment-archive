import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const SOURCE_FILE = path.join(ROOT, "source", "videos.json");
export const SITE_DIR = path.join(ROOT, "docs");
export const DATA_DIR = path.join(SITE_DIR, "data");
export const VIDEO_DATA_DIR = path.join(DATA_DIR, "videos");
export const THUMBNAIL_DIR = path.join(SITE_DIR, "assets", "thumbnails");
export const AVATAR_DIR = path.join(SITE_DIR, "assets", "avatars");

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && arguments.length > 1) return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(temporary, file);
  } catch (error) {
    // Windows cannot replace an existing destination with rename().
    if (error.code !== "EEXIST" && error.code !== "EPERM") throw error;
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rm(temporary, { force: true });
  }
}

export function videoIdFromUrl(value) {
  const text = String(value ?? "").trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0];
    if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/);
      if (match) return match[1];
    }
  } catch {}
  return null;
}

export function hashUrl(url) {
  return createHash("sha256").update(url).digest("hex").slice(0, 24);
}

export function asNumber(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : String(value);
}

export function publicVideoSummary(video) {
  const topLevel = video.comments?.length ?? 0;
  const replies = (video.comments ?? []).reduce(
    (sum, thread) => sum + (thread.replies?.length ?? 0),
    0,
  );
  const reportedComments = Number(video.statistics?.commentCount ?? 0);
  const apiContradictsCount = video.commentsStatus === "disabled" && reportedComments > 0;
  const webCaptureIsShort =
    video.commentsSource === "youtube-web-via-yt-dlp" &&
    reportedComments > 0 &&
    topLevel + replies < reportedComments;
  const commentsArePartial =
    apiContradictsCount || webCaptureIsShort || video.commentsStatus === "partial";
  return {
    id: video.id,
    sourceTitle: video.sourceTitle ?? null,
    title: video.title ?? video.sourceTitle ?? `Video ${video.id}`,
    channelTitle: video.channelTitle ?? null,
    publishedAt: video.publishedAt ?? null,
    duration: video.duration ?? null,
    thumbnail: video.thumbnail ?? null,
    statistics: video.statistics ?? {},
    archivedComments: topLevel + replies,
    archivedTopLevelComments: topLevel,
    archivedReplies: replies,
    archiveStatus: commentsArePartial ? "partial" : video.archiveStatus,
    commentsStatus: video.commentsStatus ?? null,
    archivedAt: video.archivedAt ?? null,
    lastCheckedAt: video.lastCheckedAt ?? video.archivedAt ?? null,
    originalUrl: video.originalUrl ?? `https://www.youtube.com/watch?v=${video.id}`,
  };
}

export async function rebuildIndex(sourceVideos) {
  const items = [];
  for (const source of sourceVideos) {
    const file = path.join(VIDEO_DATA_DIR, `${source.id}.json`);
    const archived = await readJson(file, null);
    if (archived) {
      items.push(publicVideoSummary(archived));
    } else {
      items.push({
        id: source.id,
        sourceTitle: source.title,
        title: source.title || `Video ${source.id}`,
        thumbnail: `https://i.ytimg.com/vi/${source.id}/hqdefault.jpg`,
        statistics: {},
        archivedComments: 0,
        archivedTopLevelComments: 0,
        archivedReplies: 0,
        archiveStatus: "pending",
        commentsStatus: null,
        archivedAt: null,
        lastCheckedAt: null,
        originalUrl: source.url,
      });
    }
  }

  const archivedDates = items.map((item) => item.archivedAt).filter(Boolean).sort();
  const checkedDates = items.map((item) => item.lastCheckedAt).filter(Boolean).sort();
  const index = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    lastArchivedAt: archivedDates.at(-1) ?? null,
    lastCheckedAt: checkedDates.at(-1) ?? null,
    totals: {
      videos: items.length,
      archived: items.filter((item) => ["complete", "partial"].includes(item.archiveStatus)).length,
      comments: items.reduce((sum, item) => sum + item.archivedComments, 0),
    },
    videos: items,
  };
  await writeJsonAtomic(path.join(DATA_DIR, "index.json"), index);
  return index;
}
