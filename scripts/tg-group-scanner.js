#!/usr/bin/env node
/**
 * Lists Bot API targets + GramJS groups (member-only chats).
 * Used by the GUI "Scan Groups" button on the Telegram tab.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const {
  getBotTargets,
  hasUserSession,
  openSession,
  scanGroups,
  closeSession,
} = require('./platforms/telegram');
const db = require('./db');

async function main() {
  const sentToday = new Set(db.getGroupsSentToday('telegram'));

  const botTargets = getBotTargets();
  console.log(`Bot API targets (${botTargets.length}):`);
  for (const t of botTargets) {
    const status = sentToday.has(t.name) ? '✓ sent today' : 'pending';
    console.log(`  ${t.name} (${t.id}) — ${status}`);
  }

  let gramjsNames = [];
  if (hasUserSession()) {
    let client;
    try {
      client = await openSession(console.log);
      const groups = await scanGroups(client, 20, console.log);
      gramjsNames = groups.map((g) => g.name);
      console.log(`\nGramJS groups (${groups.length}): ${gramjsNames.join(', ')}`);
    } catch (e) {
      console.error(`GramJS scan error: ${e.message}`);
    } finally {
      if (client) await closeSession(client);
    }
  } else {
    console.log('\nGramJS: no session — run "1. Login" to scan member-only groups.');
  }

  const allCount = botTargets.length + gramjsNames.length;
  console.log(`\nFound ${allCount} groups: ${[...botTargets.map((t) => t.name), ...gramjsNames].join(', ')}`);

  db.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
