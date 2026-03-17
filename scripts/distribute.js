#!/usr/bin/env node
/**
 * EcoDominicano Distributor — main orchestrator.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const fs = require('fs');
const path = require('path');
const db = require('./db');
const { fetchArticles } = require('./fetch-articles');
const { isEligible, randomDelay } = require('./policy');
const { log } = require('./utils/logger');
const { generate: ollamaGenerate } = require('./ollama-client');

const platforms = {
  telegram: require('./platforms/telegram'),
  reddit: require('./platforms/reddit'),
  facebookPage: require('./platforms/facebook'),
  facebookGroups: require('./platforms/facebook'),
  whatsappWeb: require('./platforms/whatsapp'),
};
const wa = require('./platforms/whatsapp');

const args = process.argv.slice(2);
const mode = args.includes('--mode=scheduled') ? 'scheduled' : 'manual';
const platformFilter = args.find((a) => a.startsWith('--platform='))?.split('=')[1];
const isTest = args.includes('--test');

const LOCK_FILE = path.join(__dirname, '../state/run.lock');

// Manual runs use short delays (30-60s); scheduled cron runs use long anti-ban delays (300-600s)
const WA_INTER_DELAY_MIN = parseInt(process.env.WA_INTER_MESSAGE_DELAY_MIN || (mode === 'manual' ? '30' : '300'), 10) * 1000;
const WA_INTER_DELAY_MAX = parseInt(process.env.WA_INTER_MESSAGE_DELAY_MAX || (mode === 'manual' ? '60' : '600'), 10) * 1000;
const WA_CHANNEL_NAME = process.env.WA_CHANNEL_NAME || 'EcoDominicano | Noticias RD';
const WA_TEST_PHONE = process.env.WA_TEST_PHONE || '';
const WA_DAILY_LIMIT = parseInt(process.env.WA_DAILY_LIMIT || '25', 10);
const WA_DAILY_YELLOW = parseInt(process.env.WA_DAILY_YELLOW || '20', 10);

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function buildNewsPrompt(article) {
  return `Eres un dominicano gracioso compartiendo noticias en WhatsApp. Escribe UN solo mensaje corto, sin comillas, sin introducción, sin explicación.

FORMATO OBLIGATORIO (copia exacto, solo cambia el contenido entre corchetes):
*${article.title}*
[1-2 oraciones cómicas y dominicanizadas contando de qué va la nota — usa expresiones como "diache", "qué vaina", "ta' bueno eso", "se formó el despelote", "mano", "brutísimo", etc.]
${article.url || ''}

EJEMPLO del tono (NO copies este ejemplo, es solo para que veas el estilo):
*Apagón deja sin luz a medio Santo Domingo*
Diache mano, otra vez lo mismo 😂 El CDEEE diciendo que "es temporal" desde el 1965. Ta' to' el país rezando pa' que llegue la luz antes de que se dañe el pollo.
https://ecodominicano.com/ejemplo

Noticia de hoy:
Título: ${article.title}
Resumen: ${article.summary || article.title}

Escribe el mensaje ahora:`;
}

function acquireLock() {
  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // Check if the PID in the lock is still running — if not, it's stale
    try {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
      process.kill(pid, 0); // throws if process doesn't exist
      return false; // process is alive, real lock
    } catch {
      // Process is dead — stale lock, clear it and acquire
      fs.unlinkSync(LOCK_FILE);
      fs.writeFileSync(LOCK_FILE, String(process.pid));
      return true;
    }
  }
}

function releaseLock() {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch (_) {}
}

function loadSettings() {
  const p = path.join(__dirname, '../config/settings.json');
  if (!fs.existsSync(p)) return { platforms: {} };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function runWhatsAppMultiGroup(article, _poster, runId, _settings, log, isTest = false) {
  // Build message (same for both test and live — real article, real LLM output)
  let message;
  try {
    const prompt = buildNewsPrompt(article);
    message = await ollamaGenerate(prompt);
    if (article.url && !message.includes(article.url)) {
      message = `${message.trim()}\n\n${article.url}`;
    }
  } catch (e) {
    log(`whatsappWeb ollama failed: ${e.message} — using fallback`);
    message = article.url
      ? `${article.title || 'Sin título'}\n\n${article.url}`
      : (article.title || 'Sin título');
  }

  // TEST MODE: send the real message to the owner's own number only — never to real groups
  if (isTest) {
    const testPhone = WA_TEST_PHONE;
    if (!testPhone) {
      log('whatsappWeb test: WA_TEST_PHONE not set — skipping');
      return;
    }
    let session;
    try {
      session = await wa.openSession({ log });
      log(`whatsappWeb test: sending to ${testPhone}`);
      const result = await wa.sendToPhone(session, testPhone, message, log);
      if (result.success) {
        log(`whatsappWeb test: delivered to ${testPhone} ✓`);
      } else {
        log(`whatsappWeb test: failed — ${result.error}`);
      }
    } catch (e) {
      log(`whatsappWeb test: error — ${e.message}`);
    } finally {
      if (session) await session.context.close().catch(() => {});
      log('whatsappWeb: browser closed.');
    }
    return;
  }

    // Check daily cap before opening the browser
    const dailyStatus = db.getPlatformDailyStatus('whatsappWeb', { dailyLimit: WA_DAILY_LIMIT, yellowAt: WA_DAILY_YELLOW });
    log(`whatsappWeb: daily status — ${dailyStatus.reason}`);
    if (dailyStatus.status === 'red') {
      log('whatsappWeb: daily cap reached — skipping');
      db.recordRunPlatform(runId, 'whatsappWeb', 'skipped_by_policy', article.url, dailyStatus.reason);
      return;
    }

    // Open ONE browser session for the entire WhatsApp run
  let session;
  try {
    session = await wa.openSession({ log });
  } catch (e) {
    log(`whatsappWeb: failed to open session: ${e.message}`, 'error');
    db.recordRunPlatform(runId, 'whatsappWeb', 'failed_permanent', article.url, e.message);
    return;
  }

  try {
    // Scan top 20 groups (same browser, already loaded)
    const groups = await wa.scanGroups(session, 20, log);
    if (groups.length === 0) {
      log('whatsappWeb: no groups found');
      db.recordRunPlatform(runId, 'whatsappWeb', 'skipped_by_policy', null, 'no groups');
      return;
    }

    log(`whatsappWeb: posting to ${groups.length} groups`);

    // Post to each group in the same session
    let sentCount = 0;
    for (let i = 0; i < groups.length; i++) {
      const name = groups[i];

      // Double-check: never send to same group twice today
      if (db.wasGroupSentToday('whatsappWeb', name)) {
        log(`whatsappWeb: skip ${name} — already sent today`);
        continue;
      }

      // Hard stop if daily cap hit mid-run
      const currentCount = db.getGroupSendCountToday('whatsappWeb');
      if (currentCount >= WA_DAILY_LIMIT) {
        log(`whatsappWeb: daily cap of ${WA_DAILY_LIMIT} reached mid-run — stopping`);
        break;
      }

      const result = await wa.sendToChat(session, name, message, log);

      if (result.success) {
        db.recordGroupDelivery('whatsappWeb', name, article.url, runId);
        if (article.url) db.recordDelivery(article.url, 'whatsappWeb', 'success', runId);
        sentCount++;
      } else {
        log(`whatsappWeb: failed for ${name}: ${result.error}`);
      }
      db.recordRunPlatform(runId, 'whatsappWeb',
        result.success ? 'success' : 'failed_permanent', article.url, result.error);

      if (i < groups.length - 1) {
        const delay = randomBetween(WA_INTER_DELAY_MIN, WA_INTER_DELAY_MAX);
        log(`whatsappWeb: waiting ${Math.round(delay / 1000)}s before next group`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    log(`whatsappWeb: sent to ${sentCount} groups today (total today: ${db.getGroupSendCountToday('whatsappWeb')}/${WA_DAILY_LIMIT})`);

    // Post to the official channel in the same session
    if (!isTest && WA_CHANNEL_NAME) {
      log(`whatsappWeb: posting to channel "${WA_CHANNEL_NAME}"...`);
      const cr = await wa.sendToChannel(session, WA_CHANNEL_NAME, message, log);
      if (cr.success) {
        log('whatsappWeb: channel post successful');
      } else {
        log(`whatsappWeb: channel post failed: ${cr.error}`);
      }
    }
  } finally {
    await session.context.close().catch(() => {});
    log('whatsappWeb: browser closed.');
  }
}

let runId;

async function run() {
  if (!acquireLock()) {
    log('another run in progress, exiting');
    process.exit(0);
  }
  try {
    const settings = loadSettings();
    const runRecord = db.createRun(mode);
    runId = runRecord.id;

    log(`distribute started (mode=${mode}, run_id=${runId}${isTest ? ', TEST' : ''})`);

    let article;
    {
      let articles;
      try {
        articles = await fetchArticles();
      } catch (e) {
        log(`feed fetch failed: ${e.message}`, 'error');
        db.finishRun(runId, 'finished');
        return;
      }
      if (!articles.length) {
        log('no articles from feed');
        db.finishRun(runId, 'finished');
        return;
      }
      article = articles[0];
    }

    const platformConfigs = settings.platforms || {};
    const toRun = platformFilter ? [platformFilter] : Object.keys(platformConfigs);

    for (const platform of toRun) {
      const config = platformConfigs[platform];
      if (!config) continue;

      // manual mode bypasses time-based cooldowns (user explicitly triggered it)
      const check = (isTest || mode === 'manual') ? { eligible: true } : isEligible(platform, config, article.url);
      if (!check.eligible) {
        log(`platform=${platform} skipped: ${check.reason} ${check.detail || ''}`);
        db.recordRunPlatform(runId, platform, check.reason, null, check.detail);
        continue;
      }

      const delay = (isTest || mode === 'manual') ? 0 : randomDelay(config);
      if (delay > 0) {
        log(`platform=${platform} eligible, waiting ${delay / 1000}s`);
        await new Promise((r) => setTimeout(r, delay));
      }

      const poster = platforms[platform];
      if (!poster) {
        db.recordRunPlatform(runId, platform, 'skipped_no_impl', null, 'no module');
        continue;
      }

      if (platform === 'whatsappWeb') {
        await runWhatsAppMultiGroup(article, poster, runId, settings, log, isTest);
        continue;
      }

      const result = await poster.post(article, { log });
      const status = result.success ? 'success' : (result.retryAfter ? 'failed_retryable' : 'failed_permanent');
      const postedAt = result.success ? new Date().toISOString() : null;

      if (result.success) {
        db.recordDelivery(article.url, platform, 'success', runId);
        log(`platform=${platform} posted: ${article.url}`);
      } else {
        log(`platform=${platform} failed: ${result.error}`);
        if (result.retryAfter && result.retryAfter > 3600) {
          const until = new Date(Date.now() + result.retryAfter * 1000).toISOString();
          db.setCooldown(platform, until, 'rate_limited');
        }
      }

      db.recordRunPlatform(runId, platform, status, article.url, result.error, postedAt);
    }

    db.finishRun(runId, 'finished');
    log('distribute finished');
  } catch (err) {
    log(`distribute error: ${err.message}`, 'error');
    if (runId) db.finishRun(runId, 'failed');
    db.close();
    releaseLock();
    process.exit(1);
  } finally {
    releaseLock();
  }
}

run();
