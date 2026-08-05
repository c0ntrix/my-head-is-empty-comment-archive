import { readJson, rebuildIndex, SOURCE_FILE } from "./lib.mjs";
import { writeReadableCommentsExport } from "./comments-export.mjs";

const videos = await readJson(SOURCE_FILE);
const index = await rebuildIndex(videos);
await writeReadableCommentsExport(index);
console.log(`Built site index for ${index.totals.videos} videos.`);
