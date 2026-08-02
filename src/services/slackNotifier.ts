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

function formatDateTime(): string {
  return (
    new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' IST'
  );
}

export async function sendSlackNotification(
  posts: ScoredPost[],
  platformErrors?: Map<Platform, number>,
): Promise<void> {
  const webhookUrl = config.slack.webhookUrl;
  if (!webhookUrl) {
    logger.info('SLACK_WEBHOOK_URL not set, skipping Slack notification');
    return;
  }

  const countByPlatform = new Map<Platform, number>();
  for (const post of posts) {
    countByPlatform.set(post.platform, (countByPlatform.get(post.platform) ?? 0) + 1);
  }

  const allPlatforms = new Set([...countByPlatform.keys(), ...(platformErrors?.keys() ?? [])]);
  const platformSummary = [...allPlatforms]
    .sort((a, b) => (countByPlatform.get(b) ?? 0) - (countByPlatform.get(a) ?? 0))
    .map((p) => {
      const count = countByPlatform.get(p) ?? 0;
      const errors = platformErrors?.get(p) ?? 0;
      const errSuffix = errors > 0 ? ` _(⚠️ ${errors} errors)_` : '';
      return `${PLATFORM_EMOJI[p]} *${PLATFORM_LABEL[p]}:* ${count}${errSuffix}`;
    })
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
      text: { type: 'plain_text', text: `📊 Social Report — ${formatDateTime()}`, emoji: true },
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
      elements: [{ type: 'mrkdwn', text: 'Full report attached to the email • sm-scraper-bot' }],
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

export async function uploadXlsxToSlack(xlsxBuffer: Buffer, filename: string): Promise<void> {
  const { botToken, channelId } = config.slack;
  if (!botToken || !channelId) {
    logger.info('SLACK_BOT_TOKEN or SLACK_CHANNEL_ID not set, skipping xlsx upload');
    return;
  }

  // Step 1: get an upload URL from Slack
  const urlRes = await fetch('https://slack.com/api/files.getUploadURLExternal', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filename, length: xlsxBuffer.length }),
  });
  const urlData = (await urlRes.json()) as { ok: boolean; upload_url?: string; file_id?: string; error?: string };
  if (!urlData.ok || !urlData.upload_url || !urlData.file_id) {
    logger.error('Failed to get Slack upload URL', { error: urlData.error });
    return;
  }

  // Step 2: upload the file content
  const uploadRes = await fetch(urlData.upload_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: xlsxBuffer,
  });
  if (!uploadRes.ok) {
    logger.error('Slack file upload failed', { status: uploadRes.status });
    return;
  }

  // Step 3: complete the upload and share to the channel
  const completeRes = await fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: [{ id: urlData.file_id, title: filename }],
      channel_id: channelId,
    }),
  });
  const completeData = (await completeRes.json()) as { ok: boolean; error?: string };
  if (!completeData.ok) {
    logger.error('Failed to complete Slack file upload', { error: completeData.error });
  } else {
    logger.info('Xlsx report uploaded to Slack', { filename });
  }
}
