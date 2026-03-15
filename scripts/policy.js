/**
 * Platform eligibility policy engine.
 */
const db = require('./db');

function daysBetween(isoA, isoB) {
  if (!isoA || !isoB) return Infinity;
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  return Math.floor(Math.abs(b - a) / (24 * 60 * 60 * 1000));
}

function isEligible(platform, platformConfig, articleUrl) {
  const { enabled, minDaysBetweenPosts, maxPostsPer7Days } = platformConfig;
  if (!enabled) return { eligible: false, reason: 'disabled' };

  const cooldown = db.getCooldown(platform);
  if (cooldown) return { eligible: false, reason: 'paused_platform', detail: cooldown.reason };

  if (db.hasDelivered(articleUrl, platform)) return { eligible: false, reason: 'skipped_already_posted' };

  const lastSuccess = db.getLastSuccess(platform);
  const daysSince = daysBetween(lastSuccess, new Date().toISOString());
  if (lastSuccess && daysSince < minDaysBetweenPosts) {
    return { eligible: false, reason: 'skipped_by_policy', detail: `min ${minDaysBetweenPosts}d between posts` };
  }

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const count7d = db.getSuccessCountSince(platform, weekAgo.toISOString());
  if (count7d >= maxPostsPer7Days) {
    return { eligible: false, reason: 'skipped_by_policy', detail: `max ${maxPostsPer7Days} posts per 7d` };
  }

  return { eligible: true };
}

function randomDelay(config) {
  const [min, max] = config.randomDelaySeconds || [60, 120];
  return Math.floor(Math.random() * (max - min + 1) + min) * 1000;
}

module.exports = { isEligible, randomDelay };
