const app = document.querySelector("#app");
const snapshotLabel = document.querySelector("#snapshot-label");
const numberFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const fullNumberFormat = new Intl.NumberFormat();
const percentFormat = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
let archiveIndex;

try {
  archiveIndex = await fetchJson("./data/index.json");
  snapshotLabel.textContent = archiveIndex.lastArchivedAt
    ? `snapshot · ${formatDate(archiveIndex.lastArchivedAt)}`
    : "archive awaiting capture";
  await route();
} catch (error) {
  renderError("The archive index could not be loaded.", error);
}

window.addEventListener("popstate", route);

async function route() {
  const id = new URLSearchParams(location.search).get("v");
  if (id) await renderVideo(id);
  else renderIndex();
  window.scrollTo(0, 0);
}

function renderIndex() {
  document.title = "Comment archive";
  const page = element("div");
  page.innerHTML = `
    <section class="hero">
      <h1>my head is empty archive</h1>
      <p class="hero-note">An archive of <em>my head is empty</em> videos that will sadly be deleted, preserving the meaningful comments, diaries, love, and support people shared beneath them.</p>
    </section>
    <section class="archive-stats" aria-label="Archive totals">
      ${stat(archiveIndex.totals.videos, "videos")}
      ${stat(archiveIndex.totals.comments, "comments and replies preserved")}
    </section>
    <section class="catalogue">
      <div class="section-head">
        <div><h2>Videos</h2></div>
        <span class="result-count" id="result-count"></span>
      </div>
      <div class="controls">
        <label class="search-wrap"><span class="visually-hidden">Search videos</span><input id="video-search" type="search" placeholder="Search titles or channel…" autocomplete="off"></label>
        <label><span class="visually-hidden">Sort videos</span><select id="video-sort"><option value="source">Original order</option><option value="title">Title A–Z</option><option value="views">Most viewed</option><option value="comments">Most comments</option><option value="newest">Newest video</option></select></label>
      </div>
      <div class="video-grid" id="video-grid"></div>
    </section>`;
  app.replaceChildren(page);

  const search = page.querySelector("#video-search");
  const sort = page.querySelector("#video-sort");
  const grid = page.querySelector("#video-grid");
  const resultCount = page.querySelector("#result-count");

  const update = () => {
    const query = search.value.trim().toLocaleLowerCase();
    const videos = archiveIndex.videos
      .filter((video) => `${video.title} ${video.channelTitle ?? ""}`.toLocaleLowerCase().includes(query))
      .map((video, sourceOrder) => ({ ...video, sourceOrder }));
    const sorters = {
      source: (a, b) => a.sourceOrder - b.sourceOrder,
      title: (a, b) => a.title.localeCompare(b.title),
      views: (a, b) => numeric(b.statistics?.viewCount) - numeric(a.statistics?.viewCount),
      comments: (a, b) => b.archivedComments - a.archivedComments,
      newest: (a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)),
    };
    videos.sort(sorters[sort.value]);
    resultCount.textContent = `${videos.length} ${videos.length === 1 ? "result" : "results"}`;
    grid.replaceChildren(...videos.map(videoCard));
    if (!videos.length) grid.append(element("p", "empty-state", "Nothing in the archive matches that search."));
  };
  search.addEventListener("input", update);
  sort.addEventListener("change", update);
  update();
}

async function renderVideo(id) {
  const summary = archiveIndex.videos.find((video) => video.id === id);
  if (!summary) {
    renderError("That video is not part of this archive.");
    return;
  }
  if (["pending", "unavailable"].includes(summary.archiveStatus)) {
    document.title = `${summary.title} — Comment archive`;
    app.innerHTML = `<section class="detail"><a class="back-link" href="./">← all videos</a><div class="notice"><strong>${escapeHtml(summary.title)}</strong><p>This video is listed, but its public data has not been captured yet. Run the archive script and reload the site.</p></div></section>`;
    interceptInternalLinks();
    return;
  }

  app.innerHTML = `<div class="loading-state"><span class="loader"></span><p>Opening archived comments…</p></div>`;
  try {
    const video = await fetchJson(`./data/videos/${encodeURIComponent(id)}.json`);
    document.title = `${video.title} — Comment archive`;
    const replies = video.comments.reduce((total, thread) => total + thread.replies.length, 0);
    const totalComments = video.comments.length + replies;
    const archivePercentage = formatArchivePercentage(totalComments, video.statistics.commentCount);
    app.innerHTML = `
      <article class="detail">
        <a class="back-link" href="./">← all videos</a>
        <section class="video-hero">
          <div class="thumbnail-wrap"><img class="thumbnail" src="${escapeAttribute(assetUrl(video.thumbnail) ?? fallbackThumbnail(video.id))}" alt="Archived thumbnail for ${escapeAttribute(video.title)}"></div>
          <div class="detail-copy">
            <p class="eyebrow">archived ${formatDate(video.archivedAt)}</p>
            <h1>${escapeHtml(video.title)}</h1>
            <p class="channel">${escapeHtml(video.channelTitle ?? "Unknown channel")} · ${formatDate(video.publishedAt)}</p>
            <div class="metric-row">
              <span>${formatFull(video.statistics.viewCount)} views</span>
              <span>${formatFull(video.statistics.likeCount)} likes</span>
              <span>${formatFull(totalComments)} saved comments</span>
            </div>
            ${video.description ? `<p class="description" id="description">${escapeHtml(video.description)}</p><button class="text-button" id="toggle-description">show full description</button>` : ""}
            <br><a class="original-link" href="${escapeAttribute(video.originalUrl)}" target="_blank" rel="noopener noreferrer">Original YouTube page ↗</a>
          </div>
        </section>
        <section class="comments-section">
          <div class="comments-heading"><h2>Comments</h2><span>${formatFull(totalComments)} preserved</span></div>
          ${summary.archiveStatus === "partial" ? `<p class="notice">This is a partial capture${archivePercentage ? ` (${archivePercentage} archived)` : ""}. ${formatFull(totalComments)} comments and replies are safely archived so far; YouTube reports approximately ${formatFull(video.statistics.commentCount)} on the original video. Running the collector again may recover more without removing these.</p>` : ""}
          <div class="controls comment-controls">
            <label class="search-wrap"><span class="visually-hidden">Search comments</span><input id="comment-search" type="search" placeholder="Search comments or authors…" autocomplete="off"></label>
            <label><span class="visually-hidden">Sort comments</span><select id="comment-sort"><option value="likes">Most liked</option><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="archive">Original order</option></select></label>
          </div>
          <div id="comment-results"></div>
        </section>
      </article>`;
    interceptInternalLinks();
    setupDescriptionToggle();
    setupComments(video.comments, video.commentsStatus, video.statistics.commentCount);
  } catch (error) {
    renderError("This video's archived data could not be loaded.", error);
  }
}

function setupComments(allComments, status, reportedCommentCount) {
  const search = document.querySelector("#comment-search");
  const sort = document.querySelector("#comment-sort");
  const results = document.querySelector("#comment-results");
  let visible = 40;

  const update = () => {
    const query = search.value.trim().toLocaleLowerCase();
    const comments = allComments.filter((thread) =>
      [thread, ...thread.replies].some((comment) =>
        `${comment.author.name} ${comment.text}`.toLocaleLowerCase().includes(query),
      ),
    );
    const sorters = {
      archive: (a, b) => a.archiveOrder - b.archiveOrder,
      likes: (a, b) => numeric(b.likeCount) - numeric(a.likeCount),
      newest: (a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)),
      oldest: (a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)),
    };
    comments.sort(sorters[sort.value]);
    const list = element("div", "comment-list");
    list.append(...comments.slice(0, visible).map(commentThread));
    results.replaceChildren(list);
    if (!comments.length) {
      let text = "No archived comments match this search.";
      if (!query && status === "disabled" && numeric(reportedCommentCount) > 0) {
        text = `YouTube reports approximately ${formatFull(reportedCommentCount)} comments, but its public API would not return them. No comments have been captured for this video yet.`;
      } else if (!query && status === "disabled") {
        text = "No comments were available to archive when this snapshot was taken.";
      }
      results.replaceChildren(element("p", "notice", text));
    } else if (visible < comments.length) {
      const more = element("button", "load-more", `Show more · ${comments.length - visible} remaining`);
      more.type = "button";
      more.addEventListener("click", () => { visible += 40; update(); });
      results.append(more);
    }
  };
  search.addEventListener("input", () => { visible = 40; update(); });
  sort.addEventListener("change", () => { visible = 40; update(); });
  update();
}

function commentThread(comment) {
  const node = commentNode(comment);
  if (comment.replies.length) {
    const body = node.querySelector(".comment-body");
    const toggle = element(
      "button",
      "reply-toggle",
      `View ${formatFull(comment.replies.length)} ${comment.replies.length === 1 ? "reply" : "replies"}`,
    );
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    const replies = element("div", "replies");
    replies.hidden = true;
    replies.setAttribute("aria-label", `${comment.replies.length} replies`);
    let renderedReplies = 0;

    const showMoreReplies = () => {
      replies.querySelector(".more-replies")?.remove();
      const nextReplies = comment.replies.slice(renderedReplies, renderedReplies + 10);
      replies.append(...nextReplies.map((reply) => commentNode(reply, true)));
      renderedReplies += nextReplies.length;
      if (renderedReplies < comment.replies.length) {
        const more = element("button", "more-replies", "Show more replies");
        more.type = "button";
        more.addEventListener("click", showMoreReplies);
        replies.append(more);
      }
    };

    toggle.addEventListener("click", () => {
      const opening = replies.hidden;
      if (opening && renderedReplies === 0) showMoreReplies();
      replies.hidden = !opening;
      toggle.setAttribute("aria-expanded", String(opening));
      toggle.textContent = opening
        ? "Hide replies"
        : `View ${formatFull(comment.replies.length)} ${comment.replies.length === 1 ? "reply" : "replies"}`;
    });
    body.append(toggle, replies);
  }
  return node;
}

function commentNode(comment, isReply = false) {
  const node = element("article", `comment${isReply ? " reply" : ""}`);
  const avatarSource = assetUrl(comment.author.avatar) ?? comment.author.profileImageUrl;
  const avatar = avatarSource
    ? `<img class="avatar" src="${escapeAttribute(avatarSource)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="avatar avatar-fallback" aria-hidden="true">${escapeHtml(comment.author.name.slice(0, 1).toUpperCase())}</span>`;
  const author = comment.author.channelUrl
    ? `<a class="author" href="${escapeAttribute(comment.author.channelUrl)}" rel="noreferrer">${escapeHtml(comment.author.name)}</a>`
    : `<span class="author">${escapeHtml(comment.author.name)}</span>`;
  const edited = comment.updatedAt && comment.updatedAt !== comment.publishedAt ? `<span class="edited">edited</span>` : "";
  const badges = `${comment.isPinned ? '<span class="comment-badge">Pinned</span>' : ""}${comment.author.isUploader ? '<span class="comment-badge">Artist</span>' : ""}`;
  node.innerHTML = `${avatar}<div class="comment-body"><div class="comment-head">${author}${badges}<time class="comment-date" datetime="${escapeAttribute(comment.publishedAt ?? "")}">${formatDate(comment.publishedAt)}</time>${edited}</div><p class="comment-text">${escapeHtml(comment.text)}</p><span class="comment-likes">♡ ${formatFull(comment.likeCount)}</span></div>`;
  return node;
}

function videoCard(video) {
  const card = element("article", "video-card");
  const status = video.archiveStatus === "complete" ? "archived" : video.archiveStatus;
  const archivePercentage = formatArchivePercentage(
    video.archivedComments,
    video.statistics?.commentCount,
  );
  const statusLabel = status === "partial" && archivePercentage
    ? `partial · ${archivePercentage}`
    : status;
  card.innerHTML = `
    <a class="card-link" href="?v=${encodeURIComponent(video.id)}">
      <div class="thumbnail-wrap">
        <img class="thumbnail" src="${escapeAttribute(assetUrl(video.thumbnail) ?? fallbackThumbnail(video.id))}" alt="" loading="lazy">
        ${video.duration ? `<span class="duration">${formatDuration(video.duration)}</span>` : ""}
        ${status !== "archived" ? `<span class="status-pill">${escapeHtml(statusLabel)}</span>` : ""}
      </div>
      <div class="card-copy">
        <h3>${escapeHtml(video.title)}</h3>
        <div class="card-meta"><span>${formatCompact(video.statistics?.viewCount)} views</span><span>${formatCompact(video.statistics?.likeCount)} likes</span><span>${formatFull(video.archivedComments)} comments</span></div>
      </div>
    </a>`;
  card.querySelector("a").addEventListener("click", navigate);
  return card;
}

function setupDescriptionToggle() {
  const button = document.querySelector("#toggle-description");
  const description = document.querySelector("#description");
  if (!button || !description) return;
  button.addEventListener("click", () => {
    const expanded = description.classList.toggle("expanded");
    button.textContent = expanded ? "collapse description" : "show full description";
  });
}

function interceptInternalLinks() {
  for (const link of app.querySelectorAll('a[href="./"]')) link.addEventListener("click", navigate);
}

function navigate(event) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  history.pushState({}, "", event.currentTarget.href);
  route();
}

function stat(value, label) {
  return `<div class="stat"><strong>${formatFull(value)}</strong><span>${label}</span></div>`;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function assetUrl(value) {
  if (!value) return null;
  return /^https?:\/\//.test(value) ? value : `./${value.replace(/^\.\//, "")}`;
}

function fallbackThumbnail(id) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
}

function formatCompact(value) {
  return value === null || value === undefined ? "—" : numberFormat.format(numeric(value));
}

function formatFull(value) {
  return value === null || value === undefined ? "—" : fullNumberFormat.format(numeric(value));
}

function formatArchivePercentage(archived, reported) {
  const archivedCount = numeric(archived);
  const reportedCount = numeric(reported);
  if (reportedCount <= 0) return null;
  return percentFormat.format(Math.min(archivedCount / reportedCount, 1));
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatDate(value) {
  if (!value) return "date unknown";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "date unknown" : dateFormat.format(date);
}

function formatDuration(value) {
  const match = String(value).match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return value;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return [hours || null, hours ? String(minutes).padStart(2, "0") : minutes, String(seconds).padStart(2, "0")].filter((part) => part !== null).join(":");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`);
  return response.json();
}

function renderError(message, error) {
  console.error(error);
  app.innerHTML = `<div class="error-state"><div><h1>Archive unavailable</h1><p>${escapeHtml(message)}</p></div></div>`;
}
