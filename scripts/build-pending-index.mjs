import { readJson, rebuildIndex, SOURCE_FILE } from "./lib.mjs";

const videos = await readJson(SOURCE_FILE);
const index = await rebuildIndex(videos);
console.log(`Built site index for ${index.totals.videos} videos.`);
