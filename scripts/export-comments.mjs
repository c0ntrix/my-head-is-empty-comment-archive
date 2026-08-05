import path from "node:path";
import { writeReadableCommentsExport } from "./comments-export.mjs";

const result = await writeReadableCommentsExport();
console.log(
  `Exported ${result.comments.toLocaleString()} comments and replies from ${result.videos.toLocaleString()} videos to ${path.relative(process.cwd(), result.file)}.`,
);
