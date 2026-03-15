/**
 * Telegram channel posting via Bot API.
 */
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

async function post(article, logger) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
    return { success: false, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID not set' };
  }
  const text = formatMessage(article);
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHANNEL_ID,
      text,
      disable_web_page_preview: false,
      parse_mode: 'HTML',
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    if (data.error_code === 429) {
      return { success: false, error: 'rate_limited', retryAfter: data.parameters?.retry_after };
    }
    return { success: false, error: data.description || 'unknown' };
  }
  return { success: true };
}

function formatMessage(article) {
  const title = (article.title || 'Sin título').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<b>${title}</b>\n\n${article.url}`;
}

module.exports = { post };
