/**
 * Fetch today's top article from EcoDominicano distribution API.
 * API returns: { title, link }
 */
const db = require('./db');

const TODAY_TOP_URL = process.env.TODAY_TOP_URL || 'https://ecodominicano.com/api/distribution/today-top';

async function fetchArticles() {
  const res = await fetch(TODAY_TOP_URL, {
    headers: { 'User-Agent': 'EcoDominicano-Distributor/1.0' },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`today-top API ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  const url = data?.link || data?.url;
  const title = data?.title || '';

  if (!url || !title) {
    return [];
  }

  db.upsertArticle(url, title, '', new Date().toISOString());

  return [
    {
      url,
      title,
      summary: '',
      publishedAt: new Date().toISOString(),
    },
  ];
}

module.exports = { fetchArticles };
