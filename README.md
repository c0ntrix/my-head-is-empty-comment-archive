# my head is empty comment archive

[View the hosted comment archive](https://c0ntrix.github.io/my-head-is-empty-comment-archive/)

A static archive of public comments, replies, thumbnails, and video metadata from 121 `my head is empty` videos scheduled for deletion. No video or audio is downloaded.

The site offers two downloads: a complete ZIP snapshot for preservation and a readable UTF-8 text export of every archived comment and reply. Regenerate the text file at any time with:

```powershell
npm run export:comments
```

The regular archive and index-building commands also refresh this export when they finish.

## Requirements

- Node.js 20 or newer
- A YouTube Data API v3 key
- The comments fallback installed with `npm run setup:comments`

## Setup

Enable **YouTube Data API v3** in [Google Cloud Console](https://console.cloud.google.com/), create an API key, and restrict it to that API.

Create the local environment file:

```powershell
Copy-Item .env.example .env
notepad .env
```

Add the key after `YOUTUBE_API_KEY=`. The `.env` file is ignored by Git and must never be committed.

Install the comments-only fallback:

```powershell
npm run setup:comments
```

The supplied links are YouTube Music/Topic releases. Their public comment counts are visible, but YouTube's official API returns `commentsDisabled` when asked to list them. The collector uses the official API for video metadata and ordinary comment endpoints, then uses yt-dlp's web comment interface only for affected Topic videos.

## Collect comments

```powershell
npm run archive
```

The collector processes one video at a time and saves every completed result immediately. It reads both the top and newest comment orderings, merges entries by comment ID, and preserves comments found by earlier runs. It also retries incomplete YouTube reply pages with a short delay instead of immediately abandoning them. It can be stopped with `Ctrl+C` and resumed with the same command.

To periodically check YouTube's current reported totals, update the percentages on the site, and archive videos whose count has increased:

```powershell
npm run check:comments
```

This metadata check is lightweight for videos that are still at 100%. A video is crawled again only when YouTube reports more comments than the archive contains, or when its existing capture is below 100%.

Useful options:

```powershell
# Collect specific videos
npm run archive -- --only=bFNq9iS4Xn4,HndF_Abg0sI

# Force a full recrawl even when the reported count has not changed
npm run archive -- --refresh

# Save commenter profile pictures locally as well
npm run archive -- --download-avatars
```

YouTube sometimes stops returning continuation pages before its displayed total is reached. The site shows the percentage of the reported comments preserved. Running the collector again can recover more comments without removing anything already preserved. The retry count and delay can be adjusted with `YOUTUBE_COMMENT_RETRIES` and `YOUTUBE_COMMENT_RETRY_SLEEP` in `.env`; the defaults are 12 attempts and one second.

If the same continuation pages fail consistently, the fallback can make an authenticated attempt using an existing Firefox session. Add `YOUTUBE_COOKIES_FROM_BROWSER=firefox` to `.env` and rerun the affected video. Cookies remain in the browser profile and are not written to the archive. Direct Chrome and Edge cookie extraction generally fails on Windows because Chromium uses App-Bound encryption.

For a Chromium session, follow yt-dlp's [YouTube cookie export instructions](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies), save the Netscape-format file as `.cache/youtube-cookies.txt`, replace the browser setting in `.env` with `YOUTUBE_COOKIES_FILE=.cache/youtube-cookies.txt`, and rerun the video. The `.cache` directory is ignored by Git. Set only one cookie option at a time.

## Preview locally

```powershell
npm run serve
```

Open <http://localhost:8080>. Opening `docs/index.html` directly will not work because browsers block its JSON requests on `file://` URLs.

## Files

- `source/videos.json` — ordered source video list
- `docs/data/index.json` — site index and archive totals
- `docs/data/videos/` — one archived JSON document per video
- `docs/assets/thumbnails/` — locally saved video thumbnails
- `docs/downloads/my-head-is-empty-comments.txt` — readable text export of all comments and replies
- `docs/` — complete static website

To import a different plain-text list containing YouTube links:

```powershell
node scripts/import-list.mjs path\to\list.txt
npm run build:index
```

The public API does not expose comment dislikes, liker identities, private or deleted comments, or comments held for moderation.
