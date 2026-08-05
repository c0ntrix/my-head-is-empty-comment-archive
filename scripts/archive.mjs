import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import {
  asNumber,
  AVATAR_DIR,
  hashUrl,
  publicVideoSummary,
  readJson,
  rebuildIndex,
  ROOT,
  SOURCE_FILE,
  THUMBNAIL_DIR,
  VIDEO_DATA_DIR,
  writeJsonAtomic,
} from "./lib.mjs";
import { writeReadableCommentsExport } from "./comments-export.mjs";

const API_ROOT = "https://www.googleapis.com/youtube/v3";
const args = new Set(process.argv.slice(2));
const refresh = args.has("--refresh");
const check = args.has("--check");
const downloadAvatars = args.has("--download-avatars");
const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const only = onlyArg ? new Set(onlyArg.slice(7).split(",").map((id) => id.trim())) : null;

await loadDotEnv();
const apiKey = process.env.YOUTUBE_API_KEY;
if (!apiKey) {
  throw new Error(
    "YOUTUBE_API_KEY is missing. Copy .env.example to .env and add your YouTube Data API v3 key.",
  );
}

const allSources = await readJson(SOURCE_FILE);
const sources = only ? allSources.filter((video) => only.has(video.id)) : allSources;
if (only && sources.length !== only.size) {
  const found = new Set(sources.map((video) => video.id));
  const missing = [...only].filter((id) => !found.has(id));
  throw new Error(`Unknown --only video ID(s): ${missing.join(", ")}`);
}

await Promise.all([
  mkdir(VIDEO_DATA_DIR, { recursive: true }),
  mkdir(THUMBNAIL_DIR, { recursive: true }),
  downloadAvatars ? mkdir(AVATAR_DIR, { recursive: true }) : Promise.resolve(),
]);

console.log(
  check
    ? `Checking ${sources.length} video(s) for new comments.`
    : `Archiving ${sources.length} video(s)${refresh ? " (refreshing completed archives)" : ""}.`,
);

let processed = 0;
for (const source of sources) {
  const outputFile = path.join(VIDEO_DATA_DIR, `${source.id}.json`);
  const existing = await readJson(outputFile, null);
  const existingLooksComplete =
    existing?.archiveStatus === "complete" &&
    publicVideoSummary(existing).archiveStatus === "complete";
  if (existingLooksComplete && !refresh && !check) {
    console.log(`[${++processed}/${sources.length}] ${source.id} already archived; skipping.`);
    continue;
  }

  console.log(`[${processed + 1}/${sources.length}] ${source.title ?? source.id}`);
  const metadata = await fetchVideo(source.id);
  const checkedAt = new Date().toISOString();
  if (!metadata) {
    if (existing?.comments?.length || ["complete", "partial"].includes(existing?.archiveStatus)) {
      console.warn("  Video is no longer returned by the API; preserving the existing archive.");
      await writeJsonAtomic(outputFile, { ...existing, lastCheckedAt: checkedAt });
    } else {
      await writeJsonAtomic(outputFile, {
        schemaVersion: 1,
        id: source.id,
        sourceTitle: source.title,
        originalUrl: source.url,
        archiveStatus: "unavailable",
        commentsStatus: "unavailable",
        archivedAt: checkedAt,
        lastCheckedAt: checkedAt,
        comments: [],
      });
    }
    processed += 1;
    await rebuildIndex(allSources);
    continue;
  }

  const reportedCommentCount = Number(metadata.statistics?.commentCount ?? 0);
  const existingCommentCount = countComments(existing?.comments ?? []);
  const hasExistingArchive =
    Array.isArray(existing?.comments) &&
    ["complete", "partial"].includes(existing?.archiveStatus);
  const needsCommentRefresh =
    refresh || !hasExistingArchive || reportedCommentCount > existingCommentCount;
  if (check && !needsCommentRefresh) {
    const commentsStatus = existing.commentsStatus === "partial"
      ? "complete"
      : existing.commentsStatus;
    const checkedVideo = mapVideo(
      metadata,
      source,
      existing.thumbnail,
      existing.comments,
      commentsStatus,
      existing.commentsSource,
      existing.archivedAt ?? checkedAt,
      existing,
      checkedAt,
    );
    await writeJsonAtomic(outputFile, checkedVideo);
    await rebuildIndex(allSources);
    processed += 1;
    console.log(
      `  Up to date: ${existingCommentCount} archived, ${reportedCommentCount} currently reported.`,
    );
    continue;
  }

  const thumbnail = await archiveThumbnail(source.id, metadata.snippet.thumbnails);
  let commentResult = await fetchAllCommentThreads(source.id);
  if (commentResult.status === "disabled" && reportedCommentCount > 0) {
    console.warn(
      `  The API says disabled, but the video reports ${reportedCommentCount} comments. Using the web fallback.`,
    );
    commentResult = await fetchCommentsWithYtDlp(source);
  }
  let comments = commentResult.comments;
  let commentsStatus = commentResult.status;
  if (commentsStatus === "disabled" && existing?.comments?.length) {
    comments = existing.comments;
    commentsStatus = "archived-before-disabled";
    console.warn("  Comments are now disabled; preserving previously archived comments.");
  }
  if (existing?.comments?.length) {
    comments = mergeArchivedCommentThreads(existing.comments, comments);
  }
  if (
    reportedCommentCount > 0 &&
    countComments(comments) < reportedCommentCount
  ) {
    commentsStatus = "partial";
    console.warn(
      `  Preserved ${countComments(comments)} of about ${reportedCommentCount} reported comments; marked partial.`,
    );
  }
  if (downloadAvatars) await archiveCommentAvatars(comments);

  const now = new Date().toISOString();
  const video = mapVideo(
    metadata,
    source,
    thumbnail,
    comments,
    commentsStatus,
    commentResult.source,
    now,
    existing,
    now,
  );
  await writeJsonAtomic(outputFile, video);
  await rebuildIndex(allSources);
  processed += 1;
  console.log(
    `  Saved ${comments.length} top-level comments and ${comments.reduce((n, c) => n + c.replies.length, 0)} replies.`,
  );
}

const index = await rebuildIndex(allSources);
await writeReadableCommentsExport(index);
console.log(
  `Done. ${index.totals.archived}/${index.totals.videos} videos and ${index.totals.comments} comments/replies are in docs/.`,
);

async function loadDotEnv() {
  try {
    const contents = await readFile(path.join(ROOT, ".env"), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function youtubeGet(resource, parameters) {
  const url = new URL(`${API_ROOT}/${resource}`);
  for (const [key, value] of Object.entries({ ...parameters, key: apiKey })) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const body = await response.json().catch(() => ({}));
    if (response.ok) return body;

    const reason = body.error?.errors?.[0]?.reason;
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 3) {
      await delay(750 * 2 ** attempt);
      continue;
    }
    const error = new Error(
      body.error?.message ?? `YouTube API returned HTTP ${response.status}`,
    );
    error.status = response.status;
    error.reason = reason;
    throw error;
  }
}

async function fetchVideo(id) {
  const response = await youtubeGet("videos", {
    part: "snippet,statistics,contentDetails,status",
    id,
  });
  return response.items?.[0] ?? null;
}

async function fetchAllCommentThreads(videoId) {
  const comments = [];
  let pageToken;
  let order = 0;
  try {
    do {
      const page = await youtubeGet("commentThreads", {
        part: "snippet,replies",
        videoId,
        maxResults: 100,
        order: "relevance",
        textFormat: "plainText",
        pageToken,
      });
      for (const thread of page.items ?? []) {
        const topLevel = mapComment(thread.snippet.topLevelComment, order++);
        const embedded = thread.replies?.comments ?? [];
        const totalReplies = Number(thread.snippet.totalReplyCount ?? 0);
        const replyResources =
          totalReplies > embedded.length
            ? await fetchAllReplies(topLevel.id)
            : embedded;
        comments.push({
          ...topLevel,
          canReply: thread.snippet.canReply ?? null,
          isPublic: thread.snippet.isPublic ?? null,
          totalReplyCountAtArchive: totalReplies,
          replies: replyResources.map((comment, replyOrder) => mapComment(comment, replyOrder)),
        });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return { status: "complete", source: "youtube-data-api", comments };
  } catch (error) {
    if (error.reason === "commentsDisabled") {
      console.warn("  Comments are disabled for this video.");
      return { status: "disabled", source: "youtube-data-api", comments: [] };
    }
    throw error;
  }
}

async function fetchAllReplies(parentId) {
  const replies = [];
  let pageToken;
  do {
    const page = await youtubeGet("comments", {
      part: "snippet",
      parentId,
      maxResults: 100,
      textFormat: "plainText",
      pageToken,
    });
    replies.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return replies;
}

function mapComment(resource, archiveOrder) {
  const snippet = resource.snippet ?? {};
  return {
    id: resource.id,
    parentId: snippet.parentId ?? null,
    author: {
      name: snippet.authorDisplayName ?? "Unknown author",
      channelUrl: snippet.authorChannelUrl ?? null,
      channelId: snippet.authorChannelId?.value ?? null,
      profileImageUrl: snippet.authorProfileImageUrl ?? null,
      avatar: null,
    },
    text: snippet.textOriginal ?? snippet.textDisplay ?? "",
    likeCount: asNumber(snippet.likeCount) ?? 0,
    publishedAt: snippet.publishedAt ?? null,
    updatedAt: snippet.updatedAt ?? null,
    viewerRating: snippet.viewerRating ?? null,
    moderationStatus: snippet.moderationStatus ?? null,
    archiveOrder,
  };
}

async function fetchCommentsWithYtDlp(source) {
  const executable = await findYtDlp();
  if (!executable) {
    throw new Error(
      "This Topic video needs the comments fallback. Run `npm run setup:comments`, then rerun `npm run archive -- --refresh`.",
    );
  }

  const cacheDirectory = path.join(ROOT, ".cache", "comments");
  await mkdir(cacheDirectory, { recursive: true });
  const allById = new Map();
  let reportedCount = 0;
  let successfulSorts = 0;
  for (const sort of ["top", "new"]) {
    console.log(`  Reading comments sorted by ${sort}...`);
    const outputTemplate = path.join(cacheDirectory, `%(id)s.${sort}`);
    const infoFile = path.join(cacheDirectory, `${source.id}.${sort}.info.json`);
    await rm(infoFile, { force: true });
    const commandArgs = [
      "--ignore-config",
      "--js-runtimes",
      `node:${process.execPath}`,
      "--sleep-requests",
      process.env.YOUTUBE_WEB_REQUEST_DELAY ?? "0.25",
      "--skip-download",
      "--write-info-json",
      "--write-comments",
      "--no-playlist",
      "--extractor-args",
      `youtube:max_comments=all,all,all,all,all;comment_sort=${sort}`,
      "--output",
      outputTemplate,
      source.url,
    ];
    try {
      await runYtDlpWithProgress(
        executable.command,
        [...executable.prefix, ...commandArgs],
        sort,
      );
      const info = await readJson(infoFile);
      reportedCount = Math.max(reportedCount, Number(info.comment_count ?? 0));
      for (const comment of info.comments ?? []) allById.set(comment.id, comment);
      successfulSorts += 1;
      console.log(`  ${allById.size} unique comments found so far.`);
    } catch (error) {
      console.warn(`  The ${sort} comment pass failed: ${error.message}`);
    } finally {
      await rm(infoFile, { force: true });
    }
  }
  const flatComments = [...allById.values()];
  if (!successfulSorts) throw new Error("Both YouTube web comment passes failed; no archive was replaced.");
  if (!flatComments.length && reportedCount > 0) {
    throw new Error(
      `The web fallback returned no comments even though the page reports ${reportedCount}. Update it with npm run setup:comments and retry.`,
    );
  }
  return {
    status: "complete",
    source: "youtube-web-via-yt-dlp",
    comments: mapYtDlpComments(flatComments),
  };
}

function mergeArchivedCommentThreads(existingThreads, newThreads) {
  const merged = [];
  const existingById = new Map(existingThreads.map((thread) => [thread.id, thread]));
  for (const thread of newThreads) {
    const old = existingById.get(thread.id);
    if (!old) {
      merged.push(thread);
      continue;
    }
    existingById.delete(thread.id);
    const replies = new Map((old.replies ?? []).map((reply) => [reply.id, reply]));
    for (const reply of thread.replies ?? []) replies.set(reply.id, reply);
    merged.push({ ...old, ...thread, replies: [...replies.values()] });
  }
  merged.push(...existingById.values());
  return merged;
}

function countComments(threads) {
  return threads.reduce((total, thread) => total + 1 + (thread.replies?.length ?? 0), 0);
}

async function findYtDlp() {
  const bundled = path.join(
    ROOT,
    ".tools",
    process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
  );
  try {
    await access(bundled);
    return { command: bundled, prefix: [] };
  } catch {}

  const command = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  try {
    await runProcess(command, ["--version"], { quiet: true });
    return { command, prefix: [] };
  } catch {
    return null;
  }
}

function runProcess(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      stdio: options.quiet ? "ignore" : "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with code ${code}`));
    });
  });
}

function runYtDlpWithProgress(command, commandArgs, sort) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let current = 0;
    let total = 0;
    let lastDisplay = "";

    const render = () => {
      const width = 28;
      const ratio = total > 0 ? Math.min(current / total, 1) : 0;
      const filled = Math.round(width * ratio);
      const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
      const count = total > 0
        ? `${current.toLocaleString()}/~${total.toLocaleString()}`
        : `${current.toLocaleString()} found`;
      const percent = total > 0 ? ` ${Math.floor(ratio * 100)}%` : "";
      const display = `  ${sort.padEnd(3)} [${bar}] ${count}${percent}`;
      if (display === lastDisplay) return;
      lastDisplay = display;
      process.stdout.write(`\r\x1b[2K${display}`);
    };

    const handleLine = (line, isErrorOutput = false) => {
      const estimated = line.match(/Downloading ~([\d,]+) comments/i);
      if (estimated) total = Number(estimated[1].replaceAll(",", ""));
      const pageProgress = line.match(/\(([\d,]+)\/~?([\d,]+)\)/);
      if (pageProgress) {
        current = Math.max(current, Number(pageProgress[1].replaceAll(",", "")));
        total = Math.max(total, Number(pageProgress[2].replaceAll(",", "")));
      }
      const extracted = line.match(/Extracted ([\d,]+) comments/i);
      if (extracted) current = Math.max(current, Number(extracted[1].replaceAll(",", "")));
      if (estimated || pageProgress || extracted) render();

      if (isErrorOutput && /^(?:WARNING|ERROR):/.test(line)) {
        process.stdout.write("\r\x1b[2K");
        console.warn(`  ${line}`);
        render();
      }
    };

    const stdout = createInterface({ input: child.stdout });
    const stderr = createInterface({ input: child.stderr });
    stdout.on("line", (line) => handleLine(line));
    stderr.on("line", (line) => handleLine(line, true));
    child.once("error", reject);
    child.once("exit", (code) => {
      stdout.close();
      stderr.close();
      if (lastDisplay) process.stdout.write("\r\x1b[2K");
      if (code === 0) {
        const suffix = total > 0 ? ` of about ${total.toLocaleString()}` : "";
        console.log(`  ${sort} pass finished: ${current.toLocaleString()}${suffix} comments read.`);
        resolve();
      } else {
        reject(new Error(`${path.basename(command)} exited with code ${code}`));
      }
    });
  });
}

function mapYtDlpComments(flatComments) {
  const topLevel = [];
  const topLevelById = new Map();
  const pendingReplies = [];

  for (const [archiveOrder, raw] of flatComments.entries()) {
    const comment = {
      id: raw.id,
      parentId: raw.parent === "root" ? null : raw.parent ?? null,
      author: {
        name: raw.author ?? "Unknown author",
        channelUrl: raw.author_url ?? null,
        channelId: raw.author_id ?? null,
        profileImageUrl: raw.author_thumbnail ?? null,
        avatar: null,
        isUploader: raw.author_is_uploader ?? null,
        isVerified: raw.author_is_verified ?? null,
      },
      text: raw.text ?? "",
      likeCount: asNumber(raw.like_count) ?? 0,
      publishedAt: raw.timestamp ? new Date(raw.timestamp * 1000).toISOString() : null,
      relativeTimeAtArchive: raw._time_text ?? null,
      updatedAt: null,
      viewerRating: null,
      moderationStatus: null,
      isPinned: raw.is_pinned ?? false,
      isFavorited: raw.is_favorited ?? null,
      archiveOrder,
    };
    if (!comment.parentId) {
      const thread = {
        ...comment,
        canReply: null,
        isPublic: true,
        totalReplyCountAtArchive: 0,
        replies: [],
      };
      topLevel.push(thread);
      topLevelById.set(comment.id, thread);
    } else {
      pendingReplies.push(comment);
    }
  }

  for (const reply of pendingReplies) {
    const parent = topLevelById.get(reply.parentId);
    if (parent) {
      reply.archiveOrder = parent.replies.length;
      parent.replies.push(reply);
      parent.totalReplyCountAtArchive += 1;
    } else {
      // Keep a reply visible if YouTube omitted its top-level parent.
      topLevel.push({
        ...reply,
        parentId: null,
        canReply: null,
        isPublic: true,
        totalReplyCountAtArchive: 0,
        replies: [],
      });
    }
  }
  return topLevel;
}

function mapVideo(
  resource,
  source,
  thumbnail,
  comments,
  commentsStatus,
  commentsSource,
  archivedAt,
  existing,
  lastCheckedAt,
) {
  const snippet = resource.snippet ?? {};
  const statistics = resource.statistics ?? {};
  const details = resource.contentDetails ?? {};
  const status = resource.status ?? {};
  return {
    schemaVersion: 1,
    id: resource.id,
    sourceTitle: source.title,
    originalUrl: source.url,
    title: snippet.title ?? source.title,
    description: snippet.description ?? "",
    channelId: snippet.channelId ?? null,
    channelTitle: snippet.channelTitle ?? null,
    publishedAt: snippet.publishedAt ?? null,
    tags: snippet.tags ?? [],
    categoryId: snippet.categoryId ?? null,
    defaultLanguage: snippet.defaultLanguage ?? null,
    liveBroadcastContent: snippet.liveBroadcastContent ?? null,
    thumbnail,
    originalThumbnails: snippet.thumbnails ?? {},
    duration: details.duration ?? null,
    definition: details.definition ?? null,
    caption: details.caption ?? null,
    licensedContent: details.licensedContent ?? null,
    projection: details.projection ?? null,
    privacyStatus: status.privacyStatus ?? null,
    embeddable: status.embeddable ?? null,
    madeForKids: status.madeForKids ?? null,
    statistics: {
      viewCount: asNumber(statistics.viewCount),
      likeCount: asNumber(statistics.likeCount),
      commentCount: asNumber(statistics.commentCount),
      favoriteCount: asNumber(statistics.favoriteCount),
    },
    archiveStatus: commentsStatus === "partial" ? "partial" : "complete",
    commentsStatus,
    commentsSource,
    firstArchivedAt: existing?.firstArchivedAt ?? existing?.archivedAt ?? archivedAt,
    archivedAt,
    lastCheckedAt,
    comments,
  };
}

async function archiveThumbnail(id, thumbnails = {}) {
  const preferred =
    thumbnails.maxres ?? thumbnails.standard ?? thumbnails.high ?? thumbnails.medium ?? thumbnails.default;
  if (!preferred?.url) return null;
  return downloadImage(preferred.url, THUMBNAIL_DIR, id, "assets/thumbnails");
}

async function archiveCommentAvatars(comments) {
  const all = comments.flatMap((comment) => [comment, ...comment.replies]);
  const byUrl = new Map();
  for (const comment of all) {
    const url = comment.author.profileImageUrl;
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, { stem: hashUrl(url), comments: [] });
    byUrl.get(url).comments.push(comment);
  }
  let completed = 0;
  for (const [url, group] of byUrl) {
    try {
      const local = await downloadImage(url, AVATAR_DIR, group.stem, "assets/avatars");
      for (const comment of group.comments) comment.author.avatar = local;
    } catch (error) {
      console.warn(`  Could not archive avatar: ${error.message}`);
    }
    completed += 1;
    if (completed % 100 === 0) console.log(`  Archived ${completed}/${byUrl.size} avatars...`);
  }
}

async function downloadImage(url, directory, stem, publicDirectory) {
  for (const extension of ["jpg", "png", "webp", "gif"]) {
    const existing = path.join(directory, `${stem}.${extension}`);
    try {
      await access(existing);
      return `${publicDirectory}/${stem}.${extension}`;
    } catch {}
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image download returned HTTP ${response.status}`);
  const mime = response.headers.get("content-type")?.split(";")[0];
  const extension = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  }[mime] ?? "jpg";
  const file = path.join(directory, `${stem}.${extension}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  return `${publicDirectory}/${stem}.${extension}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
