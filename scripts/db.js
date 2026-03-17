/**
 * SQLite state store for runs, articles, deliveries, and cooldowns.
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.STATE_DB_PATH || path.join(__dirname, '../data/distributor.db');

let db = null;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema(db);
  }
  return db;
}

function initSchema(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT
    );
    CREATE TABLE IF NOT EXISTS run_platforms (
      run_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL,
      article_url TEXT,
      reason TEXT,
      posted_at TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      title TEXT,
      summary TEXT,
      published_at TEXT,
      discovered_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_url TEXT NOT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL,
      posted_at TEXT NOT NULL,
      run_id INTEGER,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );
    CREATE TABLE IF NOT EXISTS platform_cooldowns (
      platform TEXT PRIMARY KEY,
      cooldown_until TEXT NOT NULL,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_deliveries_platform ON deliveries(platform);
    CREATE INDEX IF NOT EXISTS idx_deliveries_posted ON deliveries(posted_at);
    CREATE INDEX IF NOT EXISTS idx_deliveries_article_platform ON deliveries(article_url, platform);

    CREATE TABLE IF NOT EXISTS group_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      group_name TEXT NOT NULL,
      article_url TEXT,
      sent_at TEXT NOT NULL,
      run_id INTEGER,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_gd_platform_date ON group_deliveries(platform, sent_at);
    CREATE INDEX IF NOT EXISTS idx_gd_group ON group_deliveries(platform, group_name, sent_at);
  `);
}

function createRun(triggerType) {
  const d = getDb();
  const now = new Date().toISOString();
  const r = d.prepare('INSERT INTO runs (trigger_type, started_at, status) VALUES (?, ?, ?)').run(triggerType, now, 'running');
  return { id: r.lastInsertRowid, startedAt: now };
}

function finishRun(runId, status = 'finished') {
  getDb().prepare('UPDATE runs SET finished_at = ?, status = ? WHERE id = ?').run(new Date().toISOString(), status, runId);
}

function recordRunPlatform(runId, platform, status, articleUrl, reason, postedAt) {
  getDb().prepare(
    'INSERT INTO run_platforms (run_id, platform, status, article_url, reason, posted_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(runId, platform, status, articleUrl || null, reason || null, postedAt || null);
}

function upsertArticle(url, title, summary, publishedAt) {
  const d = getDb();
  const now = new Date().toISOString();
  d.prepare(
    `INSERT INTO articles (url, title, summary, published_at, discovered_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET title=excluded.title, summary=excluded.summary, published_at=excluded.published_at`
  ).run(url, title || '', summary || '', publishedAt || null, now);
}

function recordDelivery(articleUrl, platform, status, runId) {
  getDb().prepare(
    'INSERT INTO deliveries (article_url, platform, status, posted_at, run_id) VALUES (?, ?, ?, ?, ?)'
  ).run(articleUrl, platform, status, new Date().toISOString(), runId);
}

function getLastSuccess(platform) {
  const row = getDb().prepare(
    'SELECT posted_at FROM deliveries WHERE platform = ? AND status = ? ORDER BY posted_at DESC LIMIT 1'
  ).get(platform, 'success');
  return row ? row.posted_at : null;
}

function getSuccessCountSince(platform, sinceIso) {
  const row = getDb().prepare(
    'SELECT COUNT(*) as c FROM deliveries WHERE platform = ? AND status = ? AND posted_at >= ?'
  ).get(platform, 'success', sinceIso);
  return row ? row.c : 0;
}

function hasDelivered(articleUrl, platform) {
  const row = getDb().prepare(
    'SELECT 1 FROM deliveries WHERE article_url = ? AND platform = ? AND status = ? LIMIT 1'
  ).get(articleUrl, platform, 'success');
  return !!row;
}

function getCooldown(platform) {
  const row = getDb().prepare(
    'SELECT cooldown_until, reason FROM platform_cooldowns WHERE platform = ? AND cooldown_until > ?'
  ).get(platform, new Date().toISOString());
  return row;
}

function setCooldown(platform, untilIso, reason) {
  getDb().prepare(
    'INSERT OR REPLACE INTO platform_cooldowns (platform, cooldown_until, reason) VALUES (?, ?, ?)'
  ).run(platform, untilIso, reason);
}

// ─── Group delivery tracking ───────────────────────────────────────────────────

function recordGroupDelivery(platform, groupName, articleUrl, runId) {
  getDb().prepare(
    'INSERT INTO group_deliveries (platform, group_name, article_url, sent_at, run_id) VALUES (?, ?, ?, ?, ?)'
  ).run(platform, groupName, articleUrl || null, new Date().toISOString(), runId || null);
}

/** Returns all group names sent to on this platform today (local date). */
function getGroupsSentToday(platform) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const rows = getDb().prepare(
    'SELECT DISTINCT group_name FROM group_deliveries WHERE platform = ? AND sent_at >= ?'
  ).all(platform, todayStart.toISOString());
  return rows.map(r => r.group_name);
}

/** Returns total individual group sends today for a platform. */
function getGroupSendCountToday(platform) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const row = getDb().prepare(
    'SELECT COUNT(*) as c FROM group_deliveries WHERE platform = ? AND sent_at >= ?'
  ).get(platform, todayStart.toISOString());
  return row ? row.c : 0;
}

/** True if this specific group already received a message today. */
function wasGroupSentToday(platform, groupName) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const row = getDb().prepare(
    'SELECT 1 FROM group_deliveries WHERE platform = ? AND group_name = ? AND sent_at >= ? LIMIT 1'
  ).get(platform, groupName, todayStart.toISOString());
  return !!row;
}

// ─── Platform daily status (for GUI indicators) ────────────────────────────────

/**
 * Returns { count, limit, status, reason } for a platform.
 * status: 'green' | 'yellow' | 'red'
 */
function getPlatformDailyStatus(platform, limits) {
  const count = getGroupSendCountToday(platform);
  const { dailyLimit = 25, yellowAt = 20 } = limits || {};
  let status, reason;
  if (count >= dailyLimit) {
    status = 'red';
    reason = `Daily cap of ${dailyLimit} reached — no more sends today`;
  } else if (count >= yellowAt) {
    status = 'yellow';
    reason = `${count}/${dailyLimit} sent today — approaching daily limit`;
  } else {
    status = 'green';
    reason = `${count}/${dailyLimit} sent today — OK`;
  }
  return { count, limit: dailyLimit, status, reason };
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  createRun,
  finishRun,
  recordRunPlatform,
  upsertArticle,
  recordDelivery,
  getLastSuccess,
  getSuccessCountSince,
  hasDelivered,
  getCooldown,
  setCooldown,
  recordGroupDelivery,
  getGroupsSentToday,
  getGroupSendCountToday,
  wasGroupSentToday,
  getPlatformDailyStatus,
  close,
};
