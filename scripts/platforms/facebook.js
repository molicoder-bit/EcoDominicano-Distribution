/**
 * Facebook Page/Groups posting via Playwright (browser automation).
 * Requires FB_EMAIL, FB_PASSWORD, and Playwright. Run: npm install playwright && npx playwright install chromium
 */
async function post(article, logger) {
  const email = process.env.FB_EMAIL;
  const password = process.env.FB_PASSWORD;
  if (!email || !password) {
    return { success: false, error: 'FB_EMAIL/FB_PASSWORD not configured' };
  }
  try {
    const { chromium } = require('playwright');
    const path = require('path');
    const userDataDir = process.env.FB_SESSION_PATH || path.join(__dirname, '../../state/browser-sessions/facebook');
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      args: ['--no-sandbox'],
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const loggedIn = await page.locator('[data-pagelet="LeftRail"]').count() > 0 || await page.locator('textarea[aria-label*="Write"]').count() > 0;
    if (!loggedIn) {
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="pass"]', password);
      await page.click('button[name="login"]');
      await page.waitForTimeout(5000);
    }
    const text = `${article.title || 'Sin título'}\n\n${article.url}`;
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    const createPost = page.locator('[aria-label="Create a post"]').first();
    if (await createPost.count() > 0) {
      await createPost.click();
      await page.waitForTimeout(2000);
      const textarea = page.locator('div[contenteditable="true"][role="textbox"]').first();
      await textarea.fill(text);
      await page.waitForTimeout(1000);
      const postBtn = page.locator('div[aria-label="Post"]').first();
      await postBtn.click();
      await page.waitForTimeout(3000);
    } else {
      await context.close();
      return { success: false, error: 'Could not find create post button' };
    }
    await context.close();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { post };
