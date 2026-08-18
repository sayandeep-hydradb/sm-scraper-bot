import { XMLParser } from 'fast-xml-parser';

/** One normalized entry from an RSS 2.0 or Atom feed. */
export interface RssItem {
  id: string;
  title: string;
  link: string;
  /** ISO 8601, or undefined if the feed had no parseable date. */
  publishedAt?: string;
  author?: string;
  categories: string[];
  /** Raw HTML body/summary as provided by the feed. */
  contentHtml?: string;
}

/** A browser-like UA — some feed hosts (Medium, Substack) 403 a bare fetch UA. */
export const RSS_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (compatible; sm-scraper-bot/1.0; +rss)',
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

/* eslint-disable @typescript-eslint/no-explicit-any -- feed nodes are dynamically shaped XML */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: any): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && '#text' in value) return String((value as Record<string, unknown>)['#text']);
  return undefined;
}

function toIso(raw?: string): string | undefined {
  if (!raw) return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/** Parses an RSS 2.0 or Atom feed document into normalized items. Returns [] on unrecognized/invalid XML. */
export function parseFeed(xml: string): RssItem[] {
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }

  const channel = doc?.rss?.channel;
  if (channel) {
    return asArray(channel.item).map((item: any): RssItem => {
      const link = text(item.link) ?? text(item.guid) ?? '';
      return {
        id: text(item.guid) ?? link,
        title: (text(item.title) ?? '').trim(),
        link,
        publishedAt: toIso(text(item.pubDate) ?? text(item['dc:date'])),
        author: text(item['dc:creator']) ?? text(item.author),
        categories: asArray(item.category).map(text).filter((c): c is string => Boolean(c)),
        contentHtml: text(item['content:encoded']) ?? text(item.description),
      };
    });
  }

  const feed = doc?.feed;
  if (feed) {
    return asArray(feed.entry).map((entry: any): RssItem => {
      const links = asArray<any>(entry.link);
      const alt = links.find((l) => l?.['@_rel'] === 'alternate') ?? links[0];
      const link = (alt && (alt['@_href'] ?? text(alt))) ?? '';
      return {
        id: text(entry.id) ?? link,
        title: (text(entry.title) ?? '').trim(),
        link,
        publishedAt: toIso(text(entry.published) ?? text(entry.updated)),
        author: text(entry.author?.name) ?? text(entry.author),
        categories: asArray<any>(entry.category)
          .map((c) => (c?.['@_term'] as string | undefined) ?? text(c))
          .filter((c): c is string => Boolean(c)),
        contentHtml: text(entry.content) ?? text(entry.summary),
      };
    });
  }

  return [];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Strips HTML tags to plain text (for keyword scoring / LLM input). */
export function stripHtml(html?: string): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}
