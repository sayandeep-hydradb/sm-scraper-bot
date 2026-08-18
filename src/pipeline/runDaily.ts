#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ScraperError } from '../core/errors.js';
import { sendSlackNotification, uploadXlsxToSlack } from '../services/slackNotifier.js';
import { buildXlsxReport } from './exportXlsx.js';
import { runDailyScraper } from './runDailyScraper.js';

const OUTPUT_PATH = resolve('output/daily-scraper-result.json');
const XLSX_OUTPUT_PATH = resolve('output/daily-scraper-result.xlsx');

async function main(): Promise<void> {
  const { posts, platformErrors, platformStats } = await runDailyScraper();
  const json = JSON.stringify(posts, null, 2);

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, json);

  const xlsx = await buildXlsxReport(posts);
  writeFileSync(XLSX_OUTPUT_PATH, xlsx);

  const xlsxFilename = `social-report-${new Date().toISOString().slice(0, 10)}.xlsx`;

  await sendSlackNotification(posts, platformErrors, platformStats).catch((err) => {
    console.error('Slack notification error (non-fatal):', err instanceof Error ? err.message : err);
  });

  await uploadXlsxToSlack(xlsx, xlsxFilename).catch((err) => {
    console.error('Slack xlsx upload error (non-fatal):', err instanceof Error ? err.message : err);
  });

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
