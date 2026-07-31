import { config } from '../config/env.js';
import type { Platform } from '../core/types.js';
import type { ScoredPost } from '../pipeline/scoring.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('slack-notifier', config.logLevel);

const PLATFORM_EMOJI: Record<Platform, string> = {
  reddit: '🔴',
  twitter: '🐦',
  hackernews: '🟠',
  devto: '👩‍💻',
  medium: '✍️',
  substack: '📩',
};

const PLATFORM_LABEL: Record<Platform, string> = {
  reddit: 'Reddit',
  twitter: 'X/Twitter',
  hackernews: 'Hacker News',
  devto: 'Dev.to',
  medium: 'Medium',
  substack: 'Substack',
};

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export async function sendSlackNotification(posts: ScoredPost[]): Promise<void> {
  const webhookUrl = config.slack.webhookUrl;
  if (!webhookUrl) {
    logger.info('SLACK_WEBHOOK_URL not set, skipping Slack notification');
    return;
  }

  const countByPlatform = new Map<Platform, number>();
  for (const post of posts) {
    countByPlatform.set(post.platform, (countByPlatform.get(post.platform) ?? 0) + 1);
  }

  const platformSummary = [...countByPlatform.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${PLATFORM_EMOJI[p]} *${PLATFORM_LABEL[p]}:* ${n}`)
    .join('   ');

  const top10 = posts.slice(0, 10);
  const postLines = top10
    .map((post, i) => {
      const title = truncate(post.title ?? post.content ?? 'Untitled', 80);
      const keywords = post.matchedKeywords.slice(0, 3).join(', ');
      const keywordBadge = keywords ? `  _${keywords}_` : '';
      return `${i + 1}. ${PLATFORM_EMOJI[post.platform]} <${post.url}|${title}>${keywordBadge}  *(${post.score.toFixed(1)})*`;
    })
    .join('\n');

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📊 Daily Social Report — ${formatDate()}`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${posts.length} posts* collected across *${countByPlatform.size} platform${countByPlatform.size !== 1 ? 's' : ''}*\n\n${platformSummary}`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🏆 Top ${top10.length} Posts by Score*\n\n${postLines}`,
      },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'Full report attached to the daily email • sm-scraper-bot' }],
    },
  ];

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error('Slack notification failed', { status: response.status, body });
  } else {
    logger.info('Slack notification sent', { postsIncluded: top10.length, totalPosts: posts.length });
  }
}
