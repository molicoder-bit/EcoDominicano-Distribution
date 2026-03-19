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

// ─── Bot API ──────────────────────────────────────────────────────────────────

async function postToChannel(channelId, message, log = console.log) {
  if (!BOT_TOKEN || !channelId) {
    return { success: false, error: 'TELEGRAM_BOT_TOKEN or channelId not set' };
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: channelId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      },
    );
    const data = await res.json();
    if (!data.ok) {
      if (data.error_code === 429) {
        return { success: false, error: 'rate_limited', retryAfter: data.parameters?.retry_after };
      }
      return { success: false, error: data.description || 'unknown' };
    }
    log(`TG: channel post OK (msg_id=${data.result.message_id})`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── GramJS user session ──────────────────────────────────────────────────────

async function openSession(log = console.log) {
  const { TelegramClient }  = require('telegram');
  const { StringSession }   = require('telegram/sessions');

  const sessionStr = fs.existsSync(SESSION_PATH)
    ? fs.readFileSync(SESSION_PATH, 'utf8').trim()
    : '';

  if (!sessionStr) throw new Error('TG: no session found — run scripts/telegram-login.js first');
  if (!API_ID || !API_HASH) throw new Error('TG: TELEGRAM_API_ID / TELEGRAM_API_HASH not set');

  const client = new TelegramClient(new StringSession(sessionStr), API_ID, API_HASH, {
    connectionRetries: 5,
  });
  client.setLogLevel('none');

  await client.connect();
  if (!(await client.isUserAuthorized())) {
    throw new Error('TG: session expired — run scripts/telegram-login.js again');
  }
  log('TG: GramJS session connected');
  return client;
}

async function scanGroups(client, limit = 20, log = console.log) {
  let sentToday = new Set();
  try {
    const db = require('../db');
    sentToday = new Set(db.getGroupsSentToday('telegram'));
    if (sentToday.size > 0) log(`TG: already sent today: ${[...sentToday].join(', ')}`);
  } catch { /* db optional */ }

  const dialogs = await client.getDialogs({ limit: 300 });
  const groups = [];

  for (const dialog of dialogs) {
    if (groups.length >= limit) break;
    const e = dialog.entity;
    // Supergroups (Channel + megagroup=true) and legacy groups (Chat)
    const isGroup =
      e.className === 'Chat' ||
      (e.className === 'Channel' && e.megagroup === true);
    if (!isGroup) continue;

    const name = dialog.title || String(e.id);
    if (sentToday.has(name)) {
      log(`TG: skip "${name}" — already sent today`);
      continue;
    }
    groups.push({ name, entity: e });
    log(`TG: found group "${name}"`);
  }

  log(`TG: ${groups.length} writable groups found`);
  return groups;
}

async function sendToGroup(client, group, message, log = console.log) {
  try {
    await client.sendMessage(group.entity, { message, parseMode: 'html' });
    log(`TG: sent to "${group.name}"`);
    return { success: true };
  } catch (e) {
    const retryAfter = e.seconds || null; // FloodWaitError
    log(`TG: failed to send to "${group.name}": ${e.message}`);
    return { success: false, error: e.message, retryAfter };
  }
}

async function closeSession(client) {
  try { await client.disconnect(); } catch { /* ignore */ }
}

// ─── Legacy single-post for generic platform loop ────────────────────────────

async function post(article, opts = {}) {
  const log = opts.log || console.log;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const title = (article.title || 'Sin título').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const message = `<b>${title}</b>\n\n${article.url || ''}`;
  return postToChannel(channelId, message, log);
}

module.exports = { post, openSession, scanGroups, sendToGroup, postToChannel, closeSession };
