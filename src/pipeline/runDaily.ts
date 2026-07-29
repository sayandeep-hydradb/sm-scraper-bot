#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ScraperError } from '../core/errors.js';
import { buildXlsxReport } from './exportXlsx.js';
import { runDailyScraper } from './runDailyScraper.js';

const OUTPUT_PATH = resolve('output/daily-scraper-result.json');
const XLSX_OUTPUT_PATH = resolve('output/daily-scraper-result.xlsx');

async function main(): Promise<void> {
  const posts = await runDailyScraper();
  const json = JSON.stringify(posts, null, 2);

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, json);

  const xlsx = await buildXlsxReport(posts);
  writeFileSync(XLSX_OUTPUT_PATH, xlsx);

  console.log(json);
}

main().catch((error) => {
  if (error instanceof ScraperError) {
    console.error(`[${error.platform ?? 'sm-scraper'}] ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
