#!/usr/bin/env node
/**
 * Debug: dump chat list structure and titles from WhatsApp Web.
 * Run: xvfb-run -a node scripts/whatsapp-debug.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const SESSION_PATH = process.env.WA_SESSION_PATH || path.join(__dirname, '../state/browser-sessions/whatsapp');
const OUT_DIR = path.join(__dirname, '../logs');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(SESSION_PATH, {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(20000); // wait for "Loading your chats" to finish

  const titles = await page.evaluate(() => {
    const spans = document.querySelectorAll('span[title]');
    return Array.from(spans).map((s) => s.getAttribute('title')).filter(Boolean);
  });

  const searchBoxCount = await page.locator('[data-testid="chat-list-search"]').count();
  const searchCount = await page.locator('[data-testid="search"]').count();

  await page.screenshot({ path: path.join(OUT_DIR, 'whatsapp-debug.png') });

  const report = {
    timestamp: new Date().toISOString(),
    searchBox_chat_list_search: searchBoxCount,
    searchBox_search: searchCount,
    chatTitles: titles.slice(0, 50),
    totalTitles: titles.length,
  };

  fs.writeFileSync(path.join(OUT_DIR, 'whatsapp-debug.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('\nScreenshot: logs/whatsapp-debug.png');
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
