# my head is empty comment archive

[View the hosted comment archive](https://c0ntrix.github.io/my-head-is-empty-comment-archive/)

A static archive of public comments, replies, thumbnails, and video metadata from 121 `my head is empty` videos scheduled for deletion. No video or audio is downloaded.

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

The collector processes one video at a time and saves every completed result immediately. It reads both the top and newest comment orderings, merges entries by comment ID, and preserves comments found by earlier runs. It can be stopped with `Ctrl+C` and resumed with the same command.

Useful options:

```powershell
# Collect specific videos
npm run archive -- --only=bFNq9iS4Xn4,HndF_Abg0sI

# Refresh videos that are already considered complete
npm run archive -- --refresh

# Save commenter profile pictures locally as well
npm run archive -- --download-avatars
```

YouTube sometimes stops returning continuation pages before its displayed total is reached. Those videos are labeled as partial rather than complete. Running the collector again can recover more comments without removing anything already preserved.

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
- `docs/` — complete static website

To import a different plain-text list containing YouTube links:

```powershell
node scripts/import-list.mjs path\to\list.txt
npm run build:index
```

The public API does not expose comment dislikes, liker identities, private or deleted comments, or comments held for moderation.
