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
const { scanGroups } = require('./wa-group-scanner');
const { generate: ollamaGenerate } = require('./ollama-client');

const platforms = {
  telegram: require('./platforms/telegram'),
  reddit: require('./platforms/reddit'),
  facebookPage: require('./platforms/facebook'),
  facebookGroups: require('./platforms/facebook'),
  whatsappWeb: require('./platforms/whatsapp'),
};

const args = process.argv.slice(2);
const mode = args.includes('--mode=scheduled') ? 'scheduled' : 'manual';
const platformFilter = args.find((a) => a.startsWith('--platform='))?.split('=')[1];
const isTest = args.includes('--test');

const LOCK_FILE = path.join(__dirname, '../state/run.lock');

const WA_INTER_DELAY_MIN = parseInt(process.env.WA_INTER_MESSAGE_DELAY_MIN || '300', 10) * 1000;
const WA_INTER_DELAY_MAX = parseInt(process.env.WA_INTER_MESSAGE_DELAY_MAX || '600', 10) * 1000;
const WA_OFFICIAL_CHANNEL = process.env.WA_OFFICIAL_CHANNEL || '';

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function buildCtaPrompt(article) {
  return `Rewrite this news headline in a Dominicanized style (Dominican Spanish, local expressions, engaging tone). Make it highly persuasive and optimized for follower generation. Include a strong call-to-action inviting readers to join our official WhatsApp channel for more news. Output ONLY the message text, no explanations.

Headline: ${article.title}
Summary: ${article.summary || ''}

The message should end with something like "Únete a nuestro canal oficial" and include the placeholder [CHANNEL_LINK] where the channel link will be inserted.`;
}

function buildNewsPrompt(article) {
  return `Rewrite this news in a Dominicanized style (Dominican Spanish, local expressions) for WhatsApp group engagement. Format as:
- One catchy headline
- 3 bullet points (key facts)
- The link at the end

Output ONLY the formatted message, no explanations. Optimize for readability in a group chat.

Title: ${article.title}
Summary: ${article.summary || ''}
Link: ${article.url || '[LINK]'}`;
}

function acquireLock() {
  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
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

async function runWhatsAppMultiGroup(article, poster, runId, settings, log, isTest = false) {
  let groups;
  try {
    groups = await scanGroups({ log });
  } catch (e) {
    log(`whatsappWeb scan failed: ${e.message}`, 'error');
    db.recordRunPlatform(runId, 'whatsappWeb', 'failed_permanent', article.url, e.message);
    return;
  }

  if (groups.length === 0) {
    log('whatsappWeb: no groups found');
    db.recordRunPlatform(runId, 'whatsappWeb', 'skipped_by_policy', null, 'no groups');
    return;
  }

  const pickCount = Math.min(5, groups.length);
  const shuffled = [...groups].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, pickCount).sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));

  log(`whatsappWeb: posting to ${selected.length} groups (largest first)`);

  for (let i = 0; i < selected.length; i++) {
    const group = selected[i];
    const isLargest = i === 0;
    let message;

    if (isTest) {
      message = article.title || 'Probando...';
    } else try {
      if (isLargest && WA_OFFICIAL_CHANNEL) {
        const prompt = buildCtaPrompt(article);
        message = await ollamaGenerate(prompt);
        message = message.replace(/\[CHANNEL_LINK\]/g, WA_OFFICIAL_CHANNEL).trim();
        if (!message) throw new Error('Empty CTA response');
      } else {
        const prompt = buildNewsPrompt(article);
        message = await ollamaGenerate(prompt);
        if (article.url && !message.includes(article.url)) {
          message = `${message.trim()}\n\n${article.url}`;
        }
      }
    } catch (e) {
      log(`whatsappWeb ollama failed for ${group.name}: ${e.message}`);
      message = article.url ? `${article.title || 'Sin título'}\n\n${article.url}` : (article.title || 'Sin título');
    }

    const result = await poster.post(article, { log, groupName: group.name, messageOverride: message });

    if (result.success) {
      db.recordDelivery(article.url, 'whatsappWeb', 'success', runId);
      log(`whatsappWeb posted to ${group.name}`);
    } else {
      log(`whatsappWeb failed for ${group.name}: ${result.error}`);
    }

    db.recordRunPlatform(runId, 'whatsappWeb', result.success ? 'success' : 'failed_permanent', article.url, result.error);

    if (i < selected.length - 1) {
      const delay = randomBetween(WA_INTER_DELAY_MIN, WA_INTER_DELAY_MAX);
      log(`whatsappWeb: waiting ${Math.round(delay / 1000)}s before next group`);
      await new Promise((r) => setTimeout(r, delay));
    }
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

    log(`distribute started (mode=${mode}, run_id=${runId}${isTest ? ', test=Probando...' : ''})`);

    let article;
    if (isTest) {
      article = { title: 'Probando...', url: '' };
      log('test mode: using static message "Probando..."');
    } else {
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

      const check = isTest ? { eligible: true } : isEligible(platform, config, article.url);
      if (!check.eligible) {
        log(`platform=${platform} skipped: ${check.reason} ${check.detail || ''}`);
        db.recordRunPlatform(runId, platform, check.reason, null, check.detail);
        continue;
      }

      const delay = isTest ? 1000 : randomDelay(config);
      log(`platform=${platform} eligible, waiting ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));

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
