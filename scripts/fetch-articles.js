/**
 * Fetch new articles from RSS feed.
 */
const Parser = require('rss-parser');
const db = require('./db');

const FEED_URL = process.env.FEED_URL || 'https://ecodominicano.com/feed/';
const SITE_URL = process.env.SITE_URL || 'https://ecodominicano.com';

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'EcoDominicano-Distributor/1.0' },
});

async function fetchArticles() {
  const feed = await parser.parseURL(FEED_URL);
  const articles = [];
  for (const item of feed.items || []) {
    const url = item.link || item.guid;
    if (!url) continue;
    const absUrl = url.startsWith('http') ? url : new URL(url, SITE_URL).href;
    db.upsertArticle(absUrl, item.title, item.contentSnippet || item.content, item.pubDate);
    articles.push({
      url: absUrl,
      title: item.title || '',
      summary: item.contentSnippet || item.content?.slice(0, 200) || '',
      publishedAt: item.pubDate,
    });
  }
  return articles;
}

module.exports = { fetchArticles };
