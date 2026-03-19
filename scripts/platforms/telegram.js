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

/** Set of chat_id strings from Bot API targets (for skipping duplicate GramJS sends). */
function getBotTargetIdSet() {
  return new Set(getBotTargets().map((t) => String(t.id).replace(/\s/g, '')));
}

function entityMatchesBotTarget(entity, botIds) {
  if (!entity || !entity.className) return false;
  if (entity.className === 'Chat') {
    return botIds.has(`-${entity.id}`);
  }
  if (entity.className === 'Channel' && entity.megagroup) {
    if (botIds.has(`-100${entity.id}`)) return true;
    if (botIds.has(`-${entity.id}`)) return true;
  }
  return false;
}

function hasUserSession() {
  if (!API_ID || !API_HASH) return false;
  if (!fs.existsSync(SESSION_PATH)) return false;
  return fs.readFileSync(SESSION_PATH, 'utf8').trim().length > 0;
}

// ─── GramJS (user account — groups where bot is not admin) ───────────────────

async function openSession(log = console.log) {
  if (!hasUserSession()) {
    throw new Error('TG: no GramJS session — run npm run telegram:login on the VM');
  }
  const { TelegramClient } = require('telegram');
  const { StringSession } = require('telegram/sessions');
  const sessionStr = fs.readFileSync(SESSION_PATH, 'utf8').trim();
  const client = new TelegramClient(new StringSession(sessionStr), API_ID, API_HASH, {
    connectionRetries: 5,
  });
  client.setLogLevel('error');
  await client.connect();
  if (!(await client.isUserAuthorized())) {
    throw new Error('TG: GramJS session expired — run telegram:login again');
  }
  log('TG(GramJS): connected as user');
  return client;
}

/**
 * Megagroups + legacy groups; skips broadcast channels, Bot API targets, already-sent-today.
 */
async function scanGroups(client, limit = 20, log = console.log) {
  const botIds = getBotTargetIdSet();
  let sentToday = new Set();
  try {
    const db = require('../db');
    sentToday = new Set(db.getGroupsSentToday('telegram'));
    if (sentToday.size > 0) log(`TG(GramJS): already sent today: ${[...sentToday].join(', ')}`);
  } catch { /* ignore */ }

  const dialogs = await client.getDialogs({ limit: 400 });
  const groups = [];

  for (const dialog of dialogs) {
    if (groups.length >= limit) break;
    const e = dialog.entity;
    const isLegacy = e.className === 'Chat';
    const isMega = e.className === 'Channel' && e.megagroup === true;
    if (!isLegacy && !isMega) continue;

    if (entityMatchesBotTarget(e, botIds)) {
      log(`TG(GramJS): skip "${dialog.title}" — same chat as Bot API target`);
      continue;
    }

    const name = dialog.title || String(e.id);
    if (sentToday.has(name)) {
      log(`TG(GramJS): skip "${name}" — already sent today`);
      continue;
    }
    groups.push({ name, entity: e });
    log(`TG(GramJS): candidate "${name}"`);
  }

  log(`TG(GramJS): ${groups.length} group(s) via user session`);
  return groups;
}

/**
 * Send as logged-in user (HTML). Uses og:image + sendFile when possible.
 */
async function sendToGroup(client, group, message, log = console.log, opts = {}) {
  const articleUrl = opts.articleUrl || null;
  let imageUrl = opts.imageUrl || null;
  if (!imageUrl && articleUrl) {
    imageUrl = await fetchOgImage(articleUrl);
    if (imageUrl) log(`TG(GramJS): og:image for "${group.name}"`);
  }

  try {
    if (imageUrl) {
      await client.sendFile(group.entity, {
        file: imageUrl,
        caption: captionForPhoto(message),
        parseMode: 'html',
      });
    } else {
      await client.sendMessage(group.entity, { message, parseMode: 'html' });
    }
    log(`TG(GramJS): sent to "${group.name}"`);
    return { success: true };
  } catch (e) {
    const retryAfter = typeof e.seconds === 'number' ? e.seconds : null;
    log(`TG(GramJS): failed "${group.name}": ${e.message}`);
    return { success: false, error: e.message, retryAfter };
  }
}

async function closeSession(client) {
  if (!client) return;
  try { await client.disconnect(); } catch { /* ignore */ }
}

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
  hasUserSession,
  fetchOgImage,
};
