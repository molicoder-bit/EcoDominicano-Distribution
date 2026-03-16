/**
 * Scan WhatsApp Web and return the top N groups by recent activity.
 * WhatsApp already sorts chats by most recent activity, so we just take the first N.
 * No member count needed — no clicking into each chat.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const SESSION_PATH = process.env.WA_SESSION_PATH || path.join(__dirname, '../state/browser-sessions/whatsapp');
const BLOCKLIST = (process.env.WA_GROUP_BLOCKLIST || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

async function scanGroups(options = {}) {
  const { log = console.log, limit = 5 } = options;

  if (!fs.existsSync(path.dirname(SESSION_PATH))) {
    fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  }

  const singletonLock = path.join(SESSION_PATH, 'SingletonLock');
  if (fs.existsSync(singletonLock)) {
    throw new Error('whatsapp_browser_still_open: close WhatsApp browser window before scanning');
  }

  const hasDisplay = !!process.env.DISPLAY;
  log('Launching browser...');
  const context = await chromium.launchPersistentContext(SESSION_PATH, {
    headless: !hasDisplay,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  log('Browser launched. Navigating to WhatsApp Web...');
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  log('Page loaded. Waiting for chat list...');

  const loadTimeout = parseInt(process.env.WA_CHAT_LOAD_TIMEOUT || '120', 10) * 1000;

  const progressInterval = setInterval(async () => {
    const qr = await page.locator('canvas').count().catch(() => 0);
    const rows = await page.locator('div[tabindex="-1"] span[title]').count().catch(() => 0);
    if (qr > 0) log('QR code visible — session expired. Run Login first.');
    else log(`Still loading... (${rows} chats visible so far)`);
  }, 10000);

  try {
    await page.locator('#pane-side').waitFor({ state: 'visible', timeout: loadTimeout });
    await page.locator('div[tabindex="-1"] span[title]').first().waitFor({ state: 'visible', timeout: loadTimeout });
  } catch {
    clearInterval(progressInterval);
    const qr = await page.locator('canvas').count().catch(() => 0);
    await context.close();
    throw new Error(qr > 0 ? 'Session expired. Run Login to scan QR.' : `Chat list did not load in ${loadTimeout / 1000}s.`);
  }
  clearInterval(progressInterval);
  log('Chat list loaded.');

  // Click the "Groups" filter so we only see groups (already sorted by recent activity)
  try {
    const groupsFilter = page.locator('button:has-text("Groups"), [data-testid="chat-list-filter-tab-groups"]').first();
    if (await groupsFilter.count() > 0) {
      await groupsFilter.click({ force: true, timeout: 5000 });
      await page.waitForTimeout(800);
      log('Groups filter applied.');
    }
  } catch {
    log('Groups filter unavailable — reading from all chats.');
  }

  await page.waitForTimeout(1000);

  // Read group titles — already ordered by most recent activity
  const titleElements = await page.locator('div[tabindex="-1"] span[title]').all();
  const seen = new Set();
  const groups = [];

  for (const el of titleElements) {
    if (groups.length >= limit) break;
    const title = await el.getAttribute('title').catch(() => null);
    if (!title || title.length > 100) continue;
    const clean = title.trim();
    if (!clean || seen.has(clean)) continue;
    if (/^[\u202A-\u202C\u200E\u200F]/.test(clean)) continue;
    if (BLOCKLIST.includes(clean.toLowerCase())) {
      log(`Skipping blocklisted: ${clean}`);
      continue;
    }
    seen.add(clean);
    groups.push({ name: clean });
  }

  log(`Found ${groups.length} groups: ${groups.map(g => g.name).join(', ')}`);

  await context.close();
  return groups;
}

if (require.main === module) {
  scanGroups({ log: console.log, limit: 5 })
    .then((g) => {
      console.log('\nGroups:', JSON.stringify(g, null, 2));
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}

module.exports = { scanGroups };
