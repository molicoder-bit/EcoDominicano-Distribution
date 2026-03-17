/**
 * Standalone group scanner — used by `npm run whatsapp:scan` (GUI Scan Groups button).
 * Delegates entirely to the shared openSession/scanGroups in whatsapp.js so
 * there is only one scanner implementation.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const { openSession, scanGroups } = require('./platforms/whatsapp');

async function main() {
  let session;
  try {
    session = await openSession({ log: console.log });
    const groups = await scanGroups(session, 20, console.log);
    console.log(`\nFound ${groups.length} groups: ${groups.join(', ')}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  } finally {
    if (session) await session.context.close().catch(() => {});
  }
}

main();

module.exports = { scanGroups };
