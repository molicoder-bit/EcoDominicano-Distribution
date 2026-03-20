/**
 * Reddit posting via OAuth2 (refresh token).
 * https://github.com/reddit-archive/reddit/wiki/OAuth2
 */
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const REDDIT_REFRESH_TOKEN = process.env.REDDIT_REFRESH_TOKEN;
const REDDIT_SUBREDDIT = process.env.REDDIT_SUBREDDIT || '';

const REDDIT_USERNAME = process.env.REDDIT_USERNAME || 'EcoDominicano';
const USER_AGENT =
  process.env.REDDIT_USER_AGENT
  || `web:EcoDominicano-Distributor:v1.0 (by /u/${REDDIT_USERNAME})`;

let accessToken = null;

async function getAccessToken(forceRefresh = false) {
  if (accessToken && !forceRefresh) return accessToken;
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET || !REDDIT_REFRESH_TOKEN) return null;
  const auth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`,
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(REDDIT_REFRESH_TOKEN),
  });
  const data = await res.json();
  if (data.access_token) {
    accessToken = data.access_token;
    return accessToken;
  }
  accessToken = null;
  return null;
}

function parseSubmitPayload(body) {
  if (!body || typeof body !== 'object') return { errors: ['empty response'], data: null };
  // api_type=json → { json: { errors, data } }
  if (body.json) {
    return {
      errors: body.json.errors || [],
      data: body.json.data || null,
    };
  }
  if (body.errors) {
    return { errors: body.errors, data: body.data || null };
  }
  return { errors: [], data: body.data || null };
}

/**
 * Submit a link post. opts: { subreddit?, title?, log }
 */
async function post(article, opts = {}) {
  const log = opts.log || (() => {});
  const sub = String(opts.subreddit || REDDIT_SUBREDDIT).replace(/^r\//, '').trim();
  if (!sub) return { success: false, error: 'REDDIT_SUBREDDIT (or opts.subreddit) not set' };

  const token = await getAccessToken();
  if (!token) return { success: false, error: 'Reddit credentials not configured' };

  const title = String(opts.title || article.title || 'Sin título').slice(0, 300);
  const url = article.url || '';
  if (!url) return { success: false, error: 'article.url required for link post' };

  const params = new URLSearchParams({
    api_type: 'json',
    kind: 'link',
    sr: sub,
    title,
    url,
  });

  const doSubmit = async (tok) =>
    fetch('https://oauth.reddit.com/api/submit', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: params,
    });

  let res = await doSubmit(token);
  if (res.status === 401) {
    log('reddit: token expired, refreshing...');
    const t2 = await getAccessToken(true);
    if (t2) res = await doSubmit(t2);
  }

  const body = await res.json().catch(() => ({}));
  const { errors, data } = parseSubmitPayload(body);

  if (errors && errors.length) {
    const first = errors[0];
    const msg = Array.isArray(first) ? first.join(': ') : String(first);
    if (/RATELIMIT|rate limit/i.test(msg)) {
      return { success: false, error: 'rate_limited', retryAfter: 600 };
    }
    return { success: false, error: msg || 'reddit submit error' };
  }

  if (data?.url) {
    log(`reddit: posted ${data.url}`);
    return { success: true, postUrl: data.url };
  }

  const msg = body.message || body.error || body.reason || res.statusText || 'unknown';
  return { success: false, error: String(msg) };
}

module.exports = { post, getAccessToken, USER_AGENT };
