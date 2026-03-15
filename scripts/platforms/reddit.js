/**
 * Reddit posting via OAuth2 API.
 */
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const REDDIT_REFRESH_TOKEN = process.env.REDDIT_REFRESH_TOKEN;
const REDDIT_SUBREDDIT = process.env.REDDIT_SUBREDDIT;

let accessToken = null;

async function getAccessToken() {
  if (accessToken) return accessToken;
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET || !REDDIT_REFRESH_TOKEN) return null;
  const auth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`,
    },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(REDDIT_REFRESH_TOKEN),
  });
  const data = await res.json();
  if (data.access_token) accessToken = data.access_token;
  return accessToken;
}

async function post(article, logger) {
  const token = await getAccessToken();
  if (!token) return { success: false, error: 'Reddit credentials not configured' };
  if (!REDDIT_SUBREDDIT) return { success: false, error: 'REDDIT_SUBREDDIT not set' };

  const sub = REDDIT_SUBREDDIT.replace(/^r\//, '');
  const title = (article.title || 'Sin título').slice(0, 300);
  const res = await fetch('https://oauth.reddit.com/api/submit', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'EcoDominicano-Distributor/1.0',
    },
    body: new URLSearchParams({
      kind: 'link',
      sr: sub,
      title,
      url: article.url,
    }),
  });
  const data = await res.json();
  if (data.errors?.length) {
    const err = data.errors[0];
    if (err[0] === 'RATELIMIT') return { success: false, error: 'rate_limited' };
    return { success: false, error: err.join(': ') };
  }
  if (!data.data?.url) return { success: false, error: data.message || 'unknown' };
  return { success: true };
}

module.exports = { post };
