import ExcelJS from 'exceljs';
import type { Platform } from '../core/types.js';
import type { ScoredPost } from './scoring.js';

const PLATFORM_SHEET_NAMES: Record<Platform, string> = {
  reddit: 'Reddit',
  twitter: 'X (Twitter)',
  hackernews: 'Hacker News',
  devto: 'Dev.to',
  medium: 'Medium',
  substack: 'Substack',
};

const COLUMNS: Array<{ header: string; key: string; width: number }> = [
  { header: 'Title', key: 'title', width: 60 },
  { header: 'URL', key: 'url', width: 50 },
  { header: 'Author', key: 'author', width: 25 },
  { header: 'Relevance', key: 'relevance', width: 11 },
  { header: 'Why', key: 'why', width: 45 },
  { header: 'Suggested Follow-up', key: 'followUp', width: 45 },
  { header: 'Score', key: 'score', width: 10 },
  { header: 'Matched Keywords', key: 'matchedKeywords', width: 35 },
  { header: 'Published At', key: 'publishedAt', width: 22 },
  { header: 'Engagement', key: 'engagement', width: 20 },
];

function summarizeEngagement(post: ScoredPost): string {
  const parts = Object.entries(post.engagement)
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => `${key}: ${value}`);
  return parts.join(', ');
}

/** Builds an .xlsx workbook with one sheet per platform, each listing that platform's scored posts. */
export async function buildXlsxReport(posts: ScoredPost[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  for (const [platform, sheetName] of Object.entries(PLATFORM_SHEET_NAMES) as Array<[Platform, string]>) {
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = COLUMNS;
    sheet.getRow(1).font = { bold: true };

    const platformPosts = posts.filter((post) => post.platform === platform);
    if (platformPosts.length === 0) {
      const row = sheet.addRow({ title: '— no results in this run —' });
      row.font = { italic: true, color: { argb: 'FF999999' } };
      continue;
    }
    for (const post of platformPosts) {
      sheet.addRow({
        title: post.title ?? '',
        url: post.url,
        author: post.author.displayName ?? post.author.username,
        relevance: post.relevance ?? '',
        why: post.reason ?? '',
        followUp: post.followUp ?? '',
        score: Math.round(post.score * 100) / 100,
        matchedKeywords: post.matchedKeywords.join(', '),
        publishedAt: post.publishedAt ?? '',
        engagement: summarizeEngagement(post),
      });
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
