/**
 * WhatsApp Web posting via Playwright.
 * Uses a single persistent browser session for the full run:
 *   openSession() → scanGroups() → sendToChat() × N → sendToChannel() → close()
 *
 * Run `npm run whatsapp:login` once to save the QR session.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const SESSION_PATH = process.env.WA_SESSION_PATH ||
  path.join(__dirname, '../../state/browser-sessions/whatsapp');
const BLOCKLIST = (process.env.WA_GROUP_BLOCKLIST || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const LINK_PREVIEW_MIN = parseInt(process.env.WA_LINK_PREVIEW_MIN || '3000', 10);
const LINK_PREVIEW_MAX = parseInt(process.env.WA_LINK_PREVIEW_MAX || '5000', 10);
const LOAD_TIMEOUT = parseInt(process.env.WA_CHAT_LOAD_TIMEOUT || '120', 10) * 1000;

function previewDelay(text) {
  if (!/https?:\/\//i.test(text)) return 500;
  return LINK_PREVIEW_MIN + Math.floor(Math.random() * (LINK_PREVIEW_MAX - LINK_PREVIEW_MIN + 1));
}

// ─── Message input selectors (try in order) ───────────────────────────────────
const INPUT_SELECTORS = [
  '[data-testid="conversation-compose-box-input"]',
  'div[contenteditable="true"][data-tab="10"]',
  'footer [contenteditable="true"]',
  'div[contenteditable="true"][data-lexical-editor="true"]',
];

async function findInput(page) {
  for (const sel of INPUT_SELECTORS) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) return el;
  }
  return null;
}

// ─── Open a single shared browser session ────────────────────────────────────
async function openSession(opts = {}) {
  const { log = console.log } = opts;

  const singletonLock = path.join(SESSION_PATH, 'SingletonLock');
  if (fs.existsSync(singletonLock)) {
    throw new Error('whatsapp_browser_still_open: close the login browser window first');
  }

  if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });

  log('WA: launching browser...');
  const context = await chromium.launchPersistentContext(SESSION_PATH, {
    headless: !process.env.DISPLAY,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  log('WA: waiting for chat list...');

  try {
    await page.locator('#pane-side').waitFor({ state: 'visible', timeout: LOAD_TIMEOUT });
    await page.locator('div[tabindex="-1"] span[title]').first()
      .waitFor({ state: 'visible', timeout: LOAD_TIMEOUT });
  } catch {
    const qr = await page.locator('canvas').count().catch(() => 0);
    await context.close();
    throw new Error(qr > 0
      ? 'not_logged_in: run npm run whatsapp:login to scan QR'
      : `chat_list_timeout: WhatsApp did not load in ${LOAD_TIMEOUT / 1000}s`);
  }

  log('WA: chat list ready.');
  return { context, page };
}

// ─── Scan top N groups from the open session ──────────────────────────────────
async function scanGroups(session, limit = 5, log = console.log) {
  const { page } = session;

  // Apply Groups filter for cleaner list
  try {
    const btn = page.locator('button:has-text("Groups"), [data-testid="chat-list-filter-tab-groups"]').first();
    if (await btn.count() > 0) {
      await btn.click({ force: true, timeout: 5000 });
      await page.waitForTimeout(800);
      log('WA: Groups filter applied.');
    }
  } catch { /* non-fatal */ }

  await page.waitForTimeout(500);

  const allTitles = await page.locator('div[tabindex="-1"] span[title]').all();
  const seen = new Set();
  const groups = [];

  for (const el of allTitles) {
    if (groups.length >= limit) break;
    const title = await el.getAttribute('title').catch(() => null);
    if (!title) continue;
    const clean = title.trim();
    if (!clean || clean.length > 100 || seen.has(clean)) continue;
    if (BLOCKLIST.includes(clean.toLowerCase())) { log(`WA: skipping blocklisted: ${clean}`); continue; }
    seen.add(clean);
    groups.push(clean);
  }

  log(`WA: top ${groups.length} groups: ${groups.join(', ')}`);
  return groups;
}

// ─── Send a message to a chat (group or DM) in the open session ───────────────
async function sendToChat(session, chatName, message, log = console.log) {
  const { page } = session;

  // Navigate back to main chat list (click home icon or press Escape to dismiss any open panel)
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);

  // Search for the chat
  const searchSels = [
    '[data-testid="chat-list-search"]',
    '[data-testid="search"]',
    'div[contenteditable="true"][data-tab="3"]',
    '[aria-label="Search input textbox"]',
  ];
  let searchBox = null;
  for (const sel of searchSels) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) { searchBox = el; break; }
  }

  if (searchBox) {
    await searchBox.click();
    await page.waitForTimeout(400);
    // Clear existing text
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    await page.keyboard.type(chatName, { delay: 40 });
    await page.waitForTimeout(2000);
  }

  // Click the chat
  const escaped = chatName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const chatEl = page.locator(`span[title="${escaped}"], span[title="${escaped} "]`).first();

  if (await chatEl.count() > 0) {
    await chatEl.click();
  } else {
    log(`WA: chat not found: ${chatName}`);
    return { success: false, error: 'chat_not_found', detail: chatName };
  }

  await page.waitForTimeout(1500);

  // Type and send
  const input = await findInput(page);
  if (!input) return { success: false, error: 'input_not_found', detail: chatName };

  await input.click();
  await page.waitForTimeout(300);
  await page.keyboard.type(message, { delay: 30 });
  await page.waitForTimeout(previewDelay(message));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);

  log(`WA: sent to ${chatName}`);
  return { success: true };
}

// ─── Send a message to the WhatsApp Channel in the open session ───────────────
async function sendToChannel(session, channelName, message, log = console.log) {
  const { page } = session;

  // Navigate to Channels tab
  const channelTabSels = [
    '[data-testid="channels"]',
    '[data-icon="newsletter"]',
    '[aria-label="Channels"]',
    '[title="Channels"]',
  ];
  let clickedTab = false;
  for (const sel of channelTabSels) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.click();
      await page.waitForTimeout(1500);
      clickedTab = true;
      log('WA: opened Channels tab');
      break;
    }
  }
  if (!clickedTab) {
    log('WA: could not find Channels tab — trying to search for channel directly');
  }

  // Find channel by title
  const escaped = channelName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const chanEl = page.locator(`span[title="${escaped}"], span[title="${escaped} "]`).first();

  if (await chanEl.count() === 0) {
    log(`WA: channel "${channelName}" not found`);
    return { success: false, error: 'channel_not_found', detail: channelName };
  }

  await chanEl.click();
  await page.waitForTimeout(1500);

  const input = await findInput(page);
  if (!input) return { success: false, error: 'channel_input_not_found' };

  await input.click();
  await page.waitForTimeout(300);
  await page.keyboard.type(message, { delay: 30 });
  await page.waitForTimeout(previewDelay(message));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);

  log(`WA: sent to channel "${channelName}"`);
  return { success: true };
}

// ─── Legacy single-post API (kept for standalone use) ─────────────────────────
async function post(article, opts = {}) {
  const { log: logger = console.log, groupName, messageOverride } = opts;
  const target = groupName || process.env.WA_TARGET_CHAT || '';
  if (!target) return { success: false, error: 'groupName or WA_TARGET_CHAT required' };

  const message = messageOverride ??
    (article.url ? `${article.title || ''}\n\n${article.url}` : (article.title || ''));

  let session;
  try {
    session = await openSession({ log: logger });
    const result = await sendToChat(session, target, message, logger);
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    if (session) await session.context.close().catch(() => {});
  }
}

module.exports = { openSession, scanGroups, sendToChat, sendToChannel, post };
