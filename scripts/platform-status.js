#!/usr/bin/env node
/**
 * Outputs JSON with today's distribution status per platform.
 * Used by the GUI to show green/yellow/red indicators.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const db = require('./db');

const PLATFORM_LIMITS = {
  whatsappWeb: {
    dailyLimit: parseInt(process.env.WA_DAILY_LIMIT || '25', 10),
    yellowAt:   parseInt(process.env.WA_DAILY_YELLOW || '20', 10),
    label: 'WhatsApp',
  },
  telegram: {
    dailyLimit: 50,
    yellowAt: 40,
    label: 'Telegram',
  },
  facebookPage: {
    dailyLimit: 10,
    yellowAt: 8,
    label: 'Facebook',
  },
};

const result = {};
for (const [platform, limits] of Object.entries(PLATFORM_LIMITS)) {
  const s = db.getPlatformDailyStatus(platform, limits);
  const groupsSent = platform === 'whatsappWeb' ? db.getGroupsSentToday(platform) : [];
  result[platform] = {
    label: limits.label,
    ...s,
    groupsSentToday: groupsSent,
  };
}

db.close();
console.log(JSON.stringify(result, null, 2));
