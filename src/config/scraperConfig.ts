import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigError } from '../core/errors.js';
import type { Platform, SortOrder } from '../core/types.js';

export interface ScraperConfig {
  lookbackHours: number;
  platforms: Partial<Record<Platform, boolean>>;
  keywords: string[];
  search: {
    maxItemsPerKeyword: number;
    sort: SortOrder;
  };
  scoring: {
    keywordMatchWeight: number;
    titleMatchBonus: number;
    engagementWeight: number;
    recencyWeight: number;
  };
}

function loadScraperConfig(): ScraperConfig {
  const configPath = resolve(process.env.SCRAPER_CONFIG_PATH || 'config/scraper.config.json');

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (error) {
    throw new ConfigError(`Could not read scraper config at "${configPath}": ${(error as Error).message}`);
  }

  let parsed: ScraperConfig;
  try {
    parsed = JSON.parse(raw) as ScraperConfig;
  } catch (error) {
    throw new ConfigError(`Scraper config at "${configPath}" is not valid JSON: ${(error as Error).message}`);
  }

  if (!Array.isArray(parsed.keywords) || parsed.keywords.length === 0) {
    throw new ConfigError(`Scraper config at "${configPath}" must define a non-empty "keywords" array`);
  }
  if (!parsed.platforms || typeof parsed.platforms !== 'object') {
    throw new ConfigError(`Scraper config at "${configPath}" must define a "platforms" object`);
  }
  if (!parsed.search || !Number.isFinite(parsed.search.maxItemsPerKeyword)) {
    throw new ConfigError(`Scraper config at "${configPath}" must define "search.maxItemsPerKeyword"`);
  }
  if (!parsed.scoring) {
    throw new ConfigError(`Scraper config at "${configPath}" must define a "scoring" object`);
  }
  if (!Number.isFinite(parsed.lookbackHours) || parsed.lookbackHours <= 0) {
    throw new ConfigError(`Scraper config at "${configPath}" must define a positive "lookbackHours"`);
  }

  return parsed;
}

export const scraperConfig: ScraperConfig = loadScraperConfig();
