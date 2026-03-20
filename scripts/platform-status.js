#!/usr/bin/env node
/**
 * Outputs JSON with today's distribution status per platform.
 * Used by the GUI to show green/yellow/red indicators.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const db = require('./db');
const { getGramjsDailyLimit, getGramjsYellowAt } = require('./platforms/telegram');

const PLATFORM_LIMITS = {
  whatsappWeb: {
    dailyLimit: parseInt(process.env.WA_DAILY_LIMIT || '25', 10),
    yellowAt: parseInt(process.env.WA_DAILY_YELLOW || '20', 10),
    label: 'WhatsApp',
  },
  telegram: {
    dailyLimit: getGramjsDailyLimit(),
    yellowAt: getGramjsYellowAt(),
    label: 'Telegram (GramJS groups)',
    gramjsOnly: true,
  },
  reddit: {
    dailyLimit: parseInt(process.env.REDDIT_DAILY_LIMIT || '5', 10),
    yellowAt: parseInt(process.env.REDDIT_DAILY_YELLOW || '4', 10),
    label: 'Reddit',
    fromDeliveries: true,
  },
  facebookPage: {
    dailyLimit: 10,
    yellowAt: 8,
    label: 'Facebook',
  },
};

const result = {};
for (const [platform, limits] of Object.entries(PLATFORM_LIMITS)) {
  const gramjsOnly = !!limits.gramjsOnly;
  const fromDeliveries = !!limits.fromDeliveries;
  const { gramjsOnly: _g, fromDeliveries: _fd, label: _lbl, ...restLimits } = limits;
  const count = fromDeliveries
    ? db.getSuccessCountToday(platform)
    : db.getGroupSendCountToday(platform, gramjsOnly ? { gramjsOnly: true } : {});
  const s = db.getPlatformDailyStatus(platform, {
    ...restLimits,
    countOverride: count,
  });
  const groupsSent = platform === 'whatsappWeb'
    ? db.getGroupsSentToday(platform)
    : platform === 'telegram'
      ? db.getGroupsSentToday(platform, { gramjsOnly: true })
      : [];
  result[platform] = {
    label: limits.label,
    ...s,
    groupsSentToday: groupsSent,
  };
}

db.close();
console.log(JSON.stringify(result, null, 2));
