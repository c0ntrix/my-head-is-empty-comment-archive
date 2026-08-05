import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, SOURCE_FILE, videoIdFromUrl, writeJsonAtomic } from "./lib.mjs";

const input = path.resolve(ROOT, process.argv[2] ?? "video-list.txt");
const raw = await readFile(input, "utf8");
const lines = raw
  .replaceAll("\u200b", "")
  .split(/\r?\n/)
  .map((line) => line.replaceAll("\f", "").trim());

const ignored = [
  /^[-–—_\s]+$/,
  /^links? to /i,
  /^yesterday at /i,
  /^today at /i,
  /^\w+day at /i,
];
const videos = [];
const seen = new Set();
let candidateTitle = "";

for (const line of lines) {
  if (!line) continue;
  const urlMatch = line.match(/https?:\/\/[^\s)]+/i);
  const id = urlMatch ? videoIdFromUrl(urlMatch[0]) : null;
  if (id) {
    if (!seen.has(id)) {
      seen.add(id);
      videos.push({
        id,
        title: candidateTitle || null,
        url: `https://www.youtube.com/watch?v=${id}`,
      });
    }
    candidateTitle = "";
    continue;
  }
  if (!ignored.some((pattern) => pattern.test(line))) candidateTitle = line;
}

if (!videos.length) throw new Error(`No YouTube video URLs found in ${input}`);
await writeJsonAtomic(SOURCE_FILE, videos);
console.log(`Imported ${videos.length} unique videos into ${path.relative(ROOT, SOURCE_FILE)}.`);
