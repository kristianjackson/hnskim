import { Form, Link } from "react-router";

import type { FeedStory } from "../lib/feed.server";

type StoryCardProps = {
  story: FeedStory;
  nextPath: string;
  detail?: boolean;
};

export function StoryCard({ story, nextPath, detail = false }: StoryCardProps) {
  const saveIntent = story.saved ? "clear" : "save";
  const dismissIntent = story.dismissed ? "clear" : "dismiss";
  const summaryText = buildSummaryText(story);
  const tone = getStoryTone(story);

  return (
    <article
      className={`story-card story-card--${tone}${detail ? " story-card-detail" : ""}`}
    >
      <div className="card-topline">
        <span>{story.sourceDomain ?? "news.ycombinator.com"}</span>
        <span>{story.publishedFreshness ?? story.freshness}</span>
      </div>

      <div className="story-heading">
        <h2 className="card-title">
          {detail ? (
            story.title
          ) : (
            <Link className="story-title-link" to={`/story/${story.id}`}>
              {story.title}
            </Link>
          )}
        </h2>
        <p className="card-metadata">
          {story.score} points · {story.comments} comments · HN {story.freshness}
        </p>
      </div>

      <p className="story-summary">{summaryText}</p>

      <div className="badge-row">
        {story.badges.length > 0 ? (
          story.badges.map((badge) => (
            <span className={`badge ${getBadgeClassName(badge)}`} key={badge}>
              {badge}
            </span>
          ))
        ) : (
          <span className={`badge ${getBadgeClassName("ready")}`}>ready</span>
        )}
      </div>

      <div className="story-footer">
        <dl className="story-stats" aria-label="Story metrics">
          <div className="story-stat">
            <dt>Score</dt>
            <dd>{story.score}</dd>
          </div>
          <div className="story-stat">
            <dt>Comments</dt>
            <dd>{story.comments}</dd>
          </div>
          <div className="story-stat">
            <dt>Age</dt>
            <dd>{story.freshness}</dd>
          </div>
        </dl>

        <div className="story-utility">
          <div className="story-links">
            {story.articleUrl ? (
              <a
                className="story-link-button"
                href={story.articleUrl}
                target="_blank"
                rel="noreferrer"
              >
                Article
              </a>
            ) : null}
            <a
              className="story-link-button"
              href={story.discussionUrl}
              target="_blank"
              rel="noreferrer"
            >
              HN
            </a>
          </div>

          <div className="story-actions">
            <Form method="post" className="inline-form">
              <input type="hidden" name="hnItemId" value={story.id} />
              <input type="hidden" name="intent" value={saveIntent} />
              <input type="hidden" name="next" value={nextPath} />
              <button className="action-button action-button-primary" type="submit">
                {story.saved ? "Unsave" : "Save"}
              </button>
            </Form>

            <Form method="post" className="inline-form">
              <input type="hidden" name="hnItemId" value={story.id} />
              <input type="hidden" name="intent" value={dismissIntent} />
              <input type="hidden" name="next" value={nextPath} />
              <button className="action-button" type="submit">
                {story.dismissed ? "Restore" : "Dismiss"}
              </button>
            </Form>
          </div>
        </div>
      </div>
    </article>
  );
}

function buildSummaryText(story: FeedStory) {
  const fallbackWhy =
    "Summary generation is still in progress, so use the current status badges as the triage signal.";
  const sourceParts = [...story.summaryBullets];

  if (story.whyItMatters) {
    sourceParts.push(story.whyItMatters);
  } else if (sourceParts.length === 0) {
    sourceParts.push(fallbackWhy);
  }

  const sentences = sourceParts
    .flatMap((part) => splitSentences(part))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const compact = sentences.slice(0, 4).join(" ");

  if (compact.length <= 420) {
    return compact;
  }

  const truncated = compact.slice(0, 417).trimEnd();
  return truncated.endsWith(".") ? truncated : `${truncated}...`;
}

function splitSentences(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/);
}

function getStoryTone(story: FeedStory) {
  if (
    story.badges.includes("blocked") ||
    story.badges.includes("extract_failed") ||
    story.badges.includes("non_html")
  ) {
    return "blocked";
  }

  if (story.badges.includes("paywalled")) {
    return "paywalled";
  }

  if (
    story.badges.includes("summary_pending") ||
    story.badges.includes("low_confidence") ||
    story.badges.includes("extraction_quality_partial")
  ) {
    return "caution";
  }

  if (story.badges.includes("hn_discussion_only")) {
    return "discussion";
  }

  return "ready";
}

function getBadgeClassName(badge: string) {
  if (badge === "ready") {
    return "badge--ready";
  }

  if (badge === "summary_pending") {
    return "badge--pending";
  }

  if (
    badge === "blocked" ||
    badge === "extract_failed" ||
    badge === "non_html"
  ) {
    return "badge--blocked";
  }

  if (badge === "paywalled") {
    return "badge--paywalled";
  }

  if (badge === "low_confidence" || badge === "extraction_quality_partial") {
    return "badge--caution";
  }

  if (badge === "hn_discussion_only") {
    return "badge--discussion";
  }

  return "badge--neutral";
}
