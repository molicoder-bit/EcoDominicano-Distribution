#!/usr/bin/env node
/**
 * One-time WhatsApp Web login. For QR scan when no display (e.g. SSH):
 * Run with xvfb-run, then SCP the screenshot to view the QR.
 *   xvfb-run -a npm run whatsapp:login
 *   scp ubuntu-vm:/opt/ecodominicano-distributor/logs/qr-whatsapp.png .
 *
 * Monitor: tail -f logs/whatsapp-login.log
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const SESSION_PATH = process.env.WA_SESSION_PATH || path.join(__dirname, '../state/browser-sessions/whatsapp');
const QR_SCREENSHOT = path.join(__dirname, '../logs/qr-whatsapp.png');
const LOG_FILE = path.join(__dirname, '../logs/whatsapp-login.log');
const hasDisplay = process.env.DISPLAY && process.env.DISPLAY.length > 0;

function log(step, msg, data = null) {
  const ts = new Date().toISOString();
  const line = data != null ? `${ts} [${step}] ${msg} ${JSON.stringify(data)}` : `${ts} [${step}] ${msg}`;
  fs.appendFileSync(LOG_FILE, line + '\n');
  console.log(line);
}

async function main() {
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(QR_SCREENSHOT), { recursive: true });
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, ''); // ensure exists for tail -f

  log('INIT', 'whatsapp-login started', {
    DISPLAY: process.env.DISPLAY || '(not set)',
    headless: !hasDisplay,
    SESSION_PATH,
    QR_SCREENSHOT,
  });

  if (!hasDisplay) {
    log('INIT', 'No display. Use: xvfb-run -a npm run whatsapp:login');
  }

  log('BROWSER', 'Launching Chromium persistent context...');
  let context;
  try {
    context = await chromium.launchPersistentContext(SESSION_PATH, {
      headless: !hasDisplay,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      viewport: { width: 400, height: 600 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US',
    });
    log('BROWSER', 'Context launched OK');
  } catch (e) {
    log('BROWSER', 'FAILED to launch', { error: e.message });
    throw e;
  }

  const page = context.pages()[0] || await context.newPage();
  log('NAV', 'Navigating to web.whatsapp.com...');
  try {
    await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    log('NAV', 'Page loaded');
  } catch (e) {
    log('NAV', 'FAILED to load page', { error: e.message });
    throw e;
  }

  log('WAIT', 'Waiting 5s for QR/login UI...');
  await page.waitForTimeout(5000);

  const canvasCount = await page.locator('canvas').count();
  const qrVisible = canvasCount > 0;
  log('QR_CHECK', qrVisible ? 'Canvas (QR) found' : 'No canvas found', { canvasCount });

  if (qrVisible) {
    try {
      await page.screenshot({ path: QR_SCREENSHOT });
      log('SCREENSHOT', 'Saved', { path: QR_SCREENSHOT });
    } catch (e) {
      log('SCREENSHOT', 'FAILED to save', { error: e.message });
    }
  } else {
    log('QR_CHECK', 'No QR visible. Page might show chat list (already logged in) or loading.');
  }

  log('AUTH', 'Waiting for login indicators (up to 5 min for QR scan)...');
  const loggedIn = await page.waitForSelector('#pane-side', { timeout: 300000 }).catch(() => null);

  if (loggedIn) {
    log('AUTH', 'Logged in successfully. Waiting for chats to sync...');
    // WhatsApp UI changed; title spans in the sidebar are the most stable signal now.
    await page.waitForSelector('div[tabindex="-1"] span[title]', { timeout: 120000 })
      .catch(() => log('AUTH', 'Chat rows did not appear in 2 min - may still be syncing.'));
    const chatCount = await page.locator('div[tabindex="-1"] span[title]').count().catch(() => 0);
    log('AUTH', `Chats visible in sidebar: ${chatCount}. You can now close this window.`);
    log('AUTH', 'Keep the window open longer if you want more chats to sync before scanning.');
  } else {
    log('AUTH', 'Login not detected after 5 minutes. Closing.');
    await context.close();
    return;
  }

  // Keep open until user closes the window or presses Ctrl+C
  await context.waitForEvent('close', { timeout: 0 }).catch(() => {});
  log('DONE', 'Browser closed. Session saved.');
}

main().catch((e) => {
  log('FATAL', 'Unhandled error', { error: e.message, stack: e.stack });
  console.error(e);
  process.exit(1);
});
