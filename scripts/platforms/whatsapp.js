/**
 * WhatsApp Web posting via Playwright.
 * Uses persistent session. Run `npm run whatsapp:login` once to scan QR.
 */
const path = require('path');

const SESSION_PATH = process.env.WA_SESSION_PATH || path.join(__dirname, '../../state/browser-sessions/whatsapp');
const TARGET_CHAT = process.env.WA_TARGET_CHAT || '';

const LINK_PREVIEW_MIN = parseInt(process.env.WA_LINK_PREVIEW_MIN || '3000', 10);
const LINK_PREVIEW_MAX = parseInt(process.env.WA_LINK_PREVIEW_MAX || '5000', 10);

function getPreviewDelay(hasLink) {
  if (!hasLink) return 500;
  const range = LINK_PREVIEW_MAX - LINK_PREVIEW_MIN;
  return LINK_PREVIEW_MIN + Math.floor(Math.random() * (range + 1));
}

async function post(article, opts = {}) {
  const { log: logger, groupName, messageOverride } = opts;
  const target = groupName || TARGET_CHAT;
  if (!target) return { success: false, error: 'groupName or WA_TARGET_CHAT required' };
  try {
    const { chromium } = require('playwright');
    const fs = require('fs');
    if (!fs.existsSync(path.dirname(SESSION_PATH))) {
      fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
    }
    for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      const p = path.join(SESSION_PATH, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    const context = await chromium.launchPersistentContext(SESSION_PATH, {
      headless: !process.env.DISPLAY,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US',
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const loadTimeout = parseInt(process.env.WA_CHAT_LOAD_TIMEOUT || '600', 10) * 1000;
    try {
      await page.locator('#pane-side').waitFor({ state: 'visible', timeout: loadTimeout });
      await page.locator('div[tabindex="-1"] span[title]').first().waitFor({ state: 'visible', timeout: loadTimeout });
    } catch {
      const qr = await page.locator('canvas').count();
      await context.close();
      return { success: false, error: qr > 0 ? 'not_logged_in' : 'chat_list_timeout', detail: qr > 0 ? 'Run npm run whatsapp:login to scan QR' : 'Chat list did not load in time' };
    }

    await page.waitForTimeout(5000);

    const targetStr = String(target).trim();
    const escapedTitle = targetStr.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const titleSelector = `span[title="${escapedTitle}"], span[title="${escapedTitle} "]`;

    const searchSelectors = [
      '[data-testid="chat-list-search"]',
      '[data-testid="search"]',
      '[aria-label="Search"]',
      'div[contenteditable="true"][data-tab="3"]',
    ];
    let searchBox = null;
    for (const sel of searchSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        searchBox = el;
        break;
      }
    }

    if (searchBox) {
      await searchBox.click();
      await page.waitForTimeout(500);
      await page.keyboard.type(targetStr, { delay: 50 });
      await page.waitForTimeout(3000);
    }

    const chatByTitle = page.locator(titleSelector).first();
    if (await chatByTitle.count() > 0) {
      await chatByTitle.click();
    } else if (searchBox) {
      const firstResult = page.locator('[data-testid="cell-frame-container"]').first();
      if (await firstResult.count() > 0) {
        await firstResult.click();
      } else {
        await context.close();
        return { success: false, error: 'chat_not_found', detail: `Chat "${targetStr}" not found in search` };
      }
    } else {
      await context.close();
      return { success: false, error: 'chat_not_found', detail: `Chat "${targetStr}" not found` };
    }

    await page.waitForTimeout(3000);

    const text = messageOverride ?? (article.url ? `${article.title || 'Sin título'}\n\n${article.url}` : (article.title || 'Sin título'));
    const inputSelectors = [
      '[data-testid="conversation-compose-box-input"]',
      'div[contenteditable="true"][data-tab="10"]',
      'footer [contenteditable="true"]',
      '[contenteditable="true"][data-tab="10"]',
      'div[contenteditable="true"][data-lexical-editor="true"]',
      'p[class*="selectable-text"][data-lexical-editor="true"]',
    ];
    let input = null;
    for (const sel of inputSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        input = el;
        break;
      }
    }

    if (!input) {
      await context.close();
      return { success: false, error: 'input_not_found' };
    }

    await input.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(text, { delay: 30 });
    const hasLink = /https?:\/\//i.test(text);
    const linkPreviewDelay = getPreviewDelay(hasLink);
    await page.waitForTimeout(linkPreviewDelay);
    await page.keyboard.press('Enter');

    await page.waitForTimeout(2000);
    await context.close();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { post };
