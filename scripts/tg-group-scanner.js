#!/usr/bin/env node
/**
 * Discovers all Telegram groups the user account is a member of.
 * Used by the GUI "Scan Groups" button on the Telegram tab.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { openSession, scanGroups, closeSession } = require('./platforms/telegram');

async function main() {
  let client;
  try {
    client = await openSession(console.log);
    const groups = await scanGroups(client, 20, console.log);
    console.log(`\nFound ${groups.length} groups: ${groups.map(g => g.name).join(', ')}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  } finally {
    if (client) await closeSession(client);
  }
}

main();
