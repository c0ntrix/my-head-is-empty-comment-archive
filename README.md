# YouTube comment archive

A dependency-free Node.js collector and static website for preserving public YouTube video metadata, comments, replies, and their visible counts before videos disappear. The 121 unique video IDs from the supplied PDF are already imported into [`source/videos.json`](source/videos.json).

The generated site lives entirely in `docs/`, so GitHub Pages can host it without a server or an exposed API key.

## What is archived

- Video title, description, channel, publication date, tags, duration, status, view count, like count, public comment count, and the best available thumbnail
- Every publicly returned top-level comment and reply, including author name/channel, text, publication/edit dates, and comment like count
- The time of capture and the order returned by YouTube's relevance sort
- Optional local copies of commenter avatars

YouTube's public API does **not** expose comment dislikes, the people who liked something, private/deleted comments, or comments held for moderation. Video dislike counts are private unless the request is authenticated by the video's owner.

## 1. Create a YouTube API key

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **YouTube Data API v3**.
3. Under **APIs & Services → Credentials**, create an API key.
4. Restrict the key to the YouTube Data API v3. Do not put it in the website or commit it.
5. In PowerShell, create your local environment file:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

Add the key after `YOUTUBE_API_KEY=`. The collector uses only read requests. A normal API project has a daily quota; completed videos are skipped on later runs so an interrupted collection can resume without starting over.

## 2. Install the Topic-video comments fallback

These links are auto-generated YouTube Music/Topic releases. YouTube's Data API reports their public comment counts but returns `commentsDisabled` when asked to list the comments. The collector therefore uses the official API for metadata and normal videos, then falls back to yt-dlp's comments-only web extraction for affected Topic videos.

Install the current official yt-dlp executable into the ignored `.tools/` directory:

```powershell
npm run setup:comments
```

This does not download videos or audio. The archive invokes it with `--skip-download` and saves only temporary JSON, which is converted into the site's per-video archive and removed.

The fallback is sequential, explicitly uses the installed Node.js runtime for YouTube's JavaScript challenges, and waits 0.25 seconds between web requests to reduce throttling risk. You can increase that delay in `.env` with `YOUTUBE_WEB_REQUEST_DELAY=0.5` if YouTube starts returning HTTP 429 responses. Unlike the official Data API, the web interface has no published request quota or guaranteed archival endpoint.

## 3. Capture everything

Install [Node.js 20 or newer](https://nodejs.org/), then run:

```powershell
npm run archive
```

Each video is saved immediately to `docs/data/videos/`, and `docs/data/index.json` is updated after every video. Keep the terminal open until it reports that it is done. Topic videos with thousands of comments can take several minutes each. If quota, connectivity, or YouTube interrupts it, run the same command again later.

The fallback reads both YouTube's **top** and **new** comment orderings and merges them by comment ID with anything collected on prior runs. Existing comments are never discarded. When YouTube stops exposing continuation pages before its displayed total is reached, the site labels that video as a partial capture instead of claiming that every comment was found.

Useful options:

```powershell
# Archive one or several comma-separated IDs
npm run archive -- --only=bFNq9iS4Xn4,HndF_Abg0sI

# Re-fetch videos already completed
npm run archive -- --refresh

# Also download commenter profile pictures; potentially many files
npm run archive -- --download-avatars
```

Thumbnails are always downloaded. Avatars are optional because a large comment collection can create thousands of files and approach free-hosting/repository limits. Their original URLs are preserved either way.

To preview the site locally:

```powershell
npm run serve
```

Then open <http://localhost:8080>. Do not open `docs/index.html` directly: browsers block the JSON requests used by the site on `file://` URLs.

## 4. Publish free with GitHub Pages

GitHub Pages is the best fit here: the output is static, it supports custom domains and HTTPS, and GitHub Free can publish from a public repository. GitHub currently recommends a repository/site size below 1 GB and applies a soft 100 GB monthly bandwidth limit.

1. Create a new public GitHub repository. Do **not** add `.env`.
2. Commit this project, including the generated `docs/data/` and `docs/assets/` files, and push it.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, select **Deploy from a branch**, choose `main` and `/docs`, then save.
5. GitHub will show the public `https://YOUR-NAME.github.io/REPOSITORY/` address after deployment.

Netlify and Cloudflare Pages would also host this static output for free, but GitHub Pages is simpler for an archive already stored in Git. If the generated repository approaches 1 GB, omit avatars first; for a substantially larger archive, Cloudflare Pages plus object storage is a better next step.

## Updating the source list

`scripts/import-list.mjs` accepts plain text containing YouTube links. It uses the nearest preceding non-empty line as the source title and deduplicates repeated video IDs:

```powershell
node scripts/import-list.mjs path\to\list.txt
npm run build:index
```

Re-importing changes `source/videos.json` but does not delete any already archived per-video files.

## Maintenance and preservation notes

- Commit the generated archive promptly after collection. The API key is needed only on the collecting computer, never by visitors.
- `npm run archive` skips genuinely complete captures. It automatically retries contradictory or partial Topic-video captures and merges newly found comments with the existing archive. `--refresh` also refreshes complete videos.
- The site renders comment text as plain text rather than trusting YouTube-provided HTML, preventing archived content from injecting scripts.
- Public comments can still contain personal information. Keep a clear contact/removal policy if you publish the archive widely, and make sure your use complies with applicable platform terms and law.

Run the checks with `npm test`.
