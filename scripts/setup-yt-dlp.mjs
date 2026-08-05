import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { ROOT } from "./lib.mjs";

const isWindows = process.platform === "win32";
const filename = isWindows ? "yt-dlp.exe" : "yt-dlp";
const url = isWindows
  ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
  : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
const destination = path.join(ROOT, ".tools", filename);

console.log(`Downloading the official yt-dlp release for ${process.platform}...`);
const response = await fetch(url, { redirect: "follow" });
if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, Buffer.from(await response.arrayBuffer()));
if (!isWindows) await chmod(destination, 0o755);
console.log(`Comments fallback installed at ${path.relative(ROOT, destination)}.`);
