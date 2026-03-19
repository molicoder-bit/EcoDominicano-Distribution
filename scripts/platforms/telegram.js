/**
 * Telegram distribution:
 *  - Channel  → Bot API  (sendMessage via HTTP)
 *  - Groups   → GramJS   (MTProto user account)
 */
const path = require('path');
const fs   = require('fs');

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const API_ID      = parseInt(process.env.TELEGRAM_API_ID  || '0', 10);
const API_HASH    = process.env.TELEGRAM_API_HASH || '';
const SESSION_PATH = process.env.TG_SESSION_PATH
  || path.join(__dirname, '../../state/telegram-session.txt');

const TG_FETCH_OG_IMAGE = process.env.TELEGRAM_FETCH_OG_IMAGE !== '0';

// ─── Open Graph / preview helpers ───────────────────────────────────────────

/**
 * Fetch article HTML and extract og:image or twitter:image (HTTPS URL).
 */
async function fetchOgImage(pageUrl) {
  if (!pageUrl || !TG_FETCH_OG_IMAGE) return null;
  try {
    const res = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EcoDominicanoDistributor/1.0)' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    const html = await res.text();
    const patterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) {
        let u = m[1].replace(/&amp;/g, '&').trim();
        if (u.startsWith('//')) u = `https:${u}`;
        if (/^https:\/\//i.test(u)) return u;
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** Caption max 1024 for sendPhoto; avoid splitting HTML mid-tag. */
function captionForPhoto(htmlMessage, maxLen = 1024) {
  if (htmlMessage.length <= maxLen) return htmlMessage;
  const plain = htmlMessage.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, maxLen - 3)}...`;
}

// ─── Bot API ──────────────────────────────────────────────────────────────────

/**
 * Post to a chat. opts.articleUrl enables forced link preview + OG image fetch.
 */
async function postToChannel(channelId, message, log = console.log, opts = {}) {
  if (!BOT_TOKEN || !channelId) {
    return { success: false, error: 'TELEGRAM_BOT_TOKEN or channelId not set' };
  }
  const articleUrl = opts.articleUrl || null;
  let imageUrl = opts.imageUrl || null;

  try {
    if (!imageUrl && articleUrl) {
      imageUrl = await fetchOgImage(articleUrl);
      if (imageUrl) log(`TG: using og:image preview`);
    }

    // 1) Photo + caption — shows image reliably (like WhatsApp)
    if (imageUrl) {
      const caption = captionForPhoto(message);
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: channelId,
          photo: imageUrl,
          caption,
          parse_mode: 'HTML',
        }),
      });
      const data = await res.json();
      if (data.ok) {
        log(`TG: sendPhoto OK (msg_id=${data.result.message_id})`);
        return { success: true };
      }
      log(`TG: sendPhoto failed (${data.description}) — falling back to text + link preview`);
    }

    // 2) Text message — force preview for article URL (Bot API 7.0+)
    const body = {
      chat_id: channelId,
      text: message,
      parse_mode: 'HTML',
    };
    if (articleUrl) {
      body.link_preview_options = {
        is_disabled: false,
        url: articleUrl,
        prefer_large_media: true,
        show_above_text: true,
      };
    } else {
      body.disable_web_page_preview = false;
    }

    let res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = await res.json();

    // Older Bot API: link_preview_options not supported
    if (!data.ok && articleUrl && /link_preview|not found|bad request/i.test(String(data.description))) {
      delete body.link_preview_options;
      body.disable_web_page_preview = false;
      res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      data = await res.json();
    }

    if (!data.ok) {
      if (data.error_code === 429) {
        return { success: false, error: 'rate_limited', retryAfter: data.parameters?.retry_after };
      }
      return { success: false, error: data.description || 'unknown' };
    }
    log(`TG: sendMessage OK (msg_id=${data.result.message_id})`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── Bot API: post to multiple targets (groups/channels) ─────────────────────

/**
 * Returns configured Bot API targets: channel + any extra group IDs from env.
 * Format: comma-separated list in TELEGRAM_GROUP_IDS, plus TELEGRAM_CHANNEL_ID.
 */
function getBotTargets() {
  const targets = [];
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (channelId) targets.push({ id: channelId, name: 'Channel (@Ecodominicano)' });

  const groupIds = (process.env.TELEGRAM_GROUP_IDS || process.env.TELEGRAM_GROUP_ID || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  for (const id of groupIds) {
    targets.push({ id, name: `Group (${id})` });
  }
  return targets;
}

// ─── GramJS stubs (kept for future use with non-admin groups) ─────────────────

async function openSession(log = console.log) {
  throw new Error('GramJS session not needed — use Bot API targets (TELEGRAM_CHANNEL_ID / TELEGRAM_GROUP_IDS)');
}
async function scanGroups(client, limit = 20, log = console.log) { return []; }
async function sendToGroup(client, group, message, log = console.log) {
  return postToChannel(group.id, message, log);
}
async function closeSession(client) { /* no-op */ }

// ─── Legacy single-post for generic platform loop ────────────────────────────

async function post(article, opts = {}) {
  const log = opts.log || console.log;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const title = (article.title || 'Sin título').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const message = `<b>${title}</b>\n\n${article.url || ''}`;
  return postToChannel(channelId, message, log, { articleUrl: article.url });
}

module.exports = {
  post,
  openSession,
  scanGroups,
  sendToGroup,
  postToChannel,
  closeSession,
  getBotTargets,
  fetchOgImage,
};
