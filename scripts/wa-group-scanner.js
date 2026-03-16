/**
 * Scan WhatsApp Web chat list and return groups with member counts.
 * Auto-detects groups by opening each chat and checking for participants.
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
  const { log = console.log } = options;
  const groups = [];

  if (!fs.existsSync(path.dirname(SESSION_PATH))) {
    fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  }

  // Remove stale singleton locks that can linger after crashes
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    const p = path.join(SESSION_PATH, f);
    if (fs.existsSync(p)) {
      log(`Removing stale ${f}`);
      fs.unlinkSync(p);
    }
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
  log('Page loaded. Waiting for chat list to appear...');

  const chatListSelector = '#pane-side, [data-testid="chat-list"]';
  const chatRowSelector = '[data-testid="cell-frame-container"]';
  const chatList = page.locator(chatListSelector).first();
  const loadTimeout = parseInt(process.env.WA_CHAT_LOAD_TIMEOUT || '600', 10) * 1000;

  // Log progress every 10s while waiting
  const progressInterval = setInterval(async () => {
    const qr = await page.locator('canvas').count().catch(() => 0);
    const rows = await page.locator(chatRowSelector).count().catch(() => 0);
    if (qr > 0) log('QR code visible — session may have expired. Run Login first.');
    else log(`Still loading... (${rows} chats visible so far)`);
  }, 10000);

  try {
    await chatList.waitFor({ state: 'visible', timeout: loadTimeout });
    await page.locator(chatRowSelector).first().waitFor({ state: 'visible', timeout: loadTimeout });
  } catch {
    clearInterval(progressInterval);
    const qr = await page.locator('canvas').count();
    await context.close();
    throw new Error(qr > 0 ? 'Session expired. Run Login to scan QR.' : `Chat list did not load in ${loadTimeout / 1000}s.`);
  }
  clearInterval(progressInterval);
  log('Chat list loaded. Reading chats...');

  await page.waitForTimeout(2000);

  const chatRows = await page.locator('[data-testid="cell-frame-container"]').all();
  const seen = new Set();
  const chatNames = [];

  for (const row of chatRows) {
    const titleSpan = row.locator('span[title]').first();
    if ((await titleSpan.count()) === 0) continue;
    const title = await titleSpan.getAttribute('title');
    if (!title || title.length > 100) continue;
    const clean = title.trim();
    if (!clean || seen.has(clean)) continue;
    if (/^[\u202A-\u202C\u200E\u200F]/.test(clean)) continue;
    seen.add(clean);
    chatNames.push(clean);
  }

  const maxToScan = Math.min(chatNames.length, 40);
  log(`Found ${chatNames.length} chats, scanning first ${maxToScan} for groups`);

  for (let i = 0; i < maxToScan; i++) {
    const name = chatNames[i];
    if (!name) continue;
    if (BLOCKLIST.length && BLOCKLIST.includes(name.toLowerCase())) {
      log(`Skipping blocklisted: ${name}`);
      continue;
    }

    try {
      const searchBox = page.locator('[data-testid="chat-list-search"], [data-testid="search"]').first();
      if (await searchBox.count() > 0) {
        await searchBox.click();
        await page.waitForTimeout(200);
        await page.keyboard.type(name, { delay: 20 });
        await page.waitForTimeout(800);
      }

      const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const chatEl = page.locator(`span[title="${escaped}"], span[title="${escaped} "]`).first();
      if ((await chatEl.count()) === 0) {
        if (await searchBox.count() > 0) {
          const first = page.locator('[data-testid="cell-frame-container"]').first();
          if ((await first.count()) > 0) await first.click();
        }
      } else {
        await chatEl.click();
      }

      await page.waitForTimeout(1200);

      const header = page.locator('header').first();
      if ((await header.count()) > 0) {
        await header.click();
        await page.waitForTimeout(800);
      }

      const pageText = await page.textContent('body');
      const match = pageText && pageText.match(/(\d+)\s*participants?/i);
      if (match) {
        const count = parseInt(match[1], 10);
        groups.push({ name, memberCount: count });
        log(`Group: ${name} (${count} participants)`);
      }

      const backBtn = page.locator('[data-testid="back"], [aria-label="Back"]').first();
      for (let b = 0; b < 2 && (await backBtn.count()) > 0; b++) {
        await backBtn.click();
        await page.waitForTimeout(500);
      }

      const searchBoxCheck = page.locator('[data-testid="chat-list-search"], [data-testid="search"]').first();
      if ((await searchBoxCheck.count()) > 0) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    } catch (e) {
      log(`Error scanning ${name}: ${e.message}`);
    }
  }

  await context.close();
  return groups;
}

if (require.main === module) {
  scanGroups({ log: console.log })
    .then((g) => {
      console.log('\nGroups:', JSON.stringify(g, null, 2));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { scanGroups };
