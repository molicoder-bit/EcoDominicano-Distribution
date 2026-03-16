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
  log('Page loaded. Waiting for chat list...');

  const loadTimeout = parseInt(process.env.WA_CHAT_LOAD_TIMEOUT || '600', 10) * 1000;

  // Log progress every 10s while waiting
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
    const qr = await page.locator('canvas').count();
    await context.close();
    throw new Error(qr > 0 ? 'Session expired. Run Login to scan QR.' : `Chat list did not load in ${loadTimeout / 1000}s.`);
  }
  clearInterval(progressInterval);
  log('Chat list loaded.');

  // Try clicking "Groups" filter — non-fatal if it fails
  try {
    const groupsFilter = page.locator('button:has-text("Groups"), [data-testid="chat-list-filter-tab-groups"]').first();
    if (await groupsFilter.count() > 0) {
      await groupsFilter.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await groupsFilter.click({ force: true, timeout: 5000 });
      await page.waitForTimeout(1000);
      log('Groups filter applied — showing groups only.');
    } else {
      log('No Groups filter found — scanning all chats.');
    }
  } catch {
    log('Groups filter click failed — scanning all chats.');
  }

  await page.waitForTimeout(1500);

  // Read all visible chat titles
  const titleElements = await page.locator('div[tabindex="-1"] span[title]').all();
  const seen = new Set();
  const chatNames = [];

  for (const el of titleElements) {
    const title = await el.getAttribute('title').catch(() => null);
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
      // Click the group row directly (no search needed — Groups filter is active)
      const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const row = page.locator(`div[tabindex="-1"]:has(span[title="${escaped}"])`).first();
      if (await row.count() === 0) {
        log(`Row not found for: ${name}`);
        continue;
      }
      await row.click();
      await page.waitForTimeout(1000);

      // Click the chat header to open group info panel
      const header = page.locator('header[data-testid="conversation-header"], header').first();
      if (await header.count() > 0) {
        await header.click();
        await page.waitForTimeout(1200);
      }

      // Check body text for member count with locale variants
      const pageText = await page.textContent('body').catch(() => '');
      const normalized = pageText.replace(/\u00A0/g, ' ');
      const countWords = '(participants?|participantes?|members?|miembros?|integrantes?)';
      let match = normalized.match(new RegExp(`(\\d[\\d.,\\s]*)\\s*${countWords}`, 'i'));
      if (!match) {
        // Some UIs render "members 123" instead of "123 members"
        match = normalized.match(new RegExp(`${countWords}\\s*(\\d[\\d.,\\s]*)`, 'i'));
      }
      if (match) {
        const rawNumber = match[1] && /\d/.test(match[1]) ? match[1] : match[2];
        const digits = (rawNumber || '').replace(/[^\d]/g, '');
        const count = parseInt(digits, 10);
        groups.push({ name, memberCount: count });
        log(`Group: ${name} (${count} participants)`);
      } else {
        log(`No member count found for: ${name}`);
      }

      // Press Escape to close info panel and go back to list
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const backBtn = page.locator('[data-testid="back"], [aria-label="Back"]').first();
      if (await backBtn.count() > 0) {
        await backBtn.click();
        await page.waitForTimeout(400);
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
