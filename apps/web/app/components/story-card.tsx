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

  return (
    <article className={`story-card${detail ? " story-card-detail" : ""}`}>
      <div className="card-topline">
        <span>{story.sourceDomain ?? "news.ycombinator.com"}</span>
        <span>{story.publishedFreshness ?? story.freshness}</span>
      </div>

      <div className="story-heading">
        <div>
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
      </div>

      <p className="story-summary">{summaryText}</p>

      <div className="badge-row">
        {story.badges.length > 0 ? (
          story.badges.map((badge) => (
            <span className="badge" key={badge}>
              {badge}
            </span>
          ))
        ) : (
          <span className="badge">ready</span>
        )}
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
