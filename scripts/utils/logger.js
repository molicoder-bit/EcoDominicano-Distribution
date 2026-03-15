const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || '/opt/ecodominicano-distributor/logs';
const logFile = path.join(LOG_DIR, 'distributor.log');

function log(msg, level = 'info') {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  try {
    fs.appendFileSync(logFile, line);
  } catch (_) {}
  if (level === 'error') console.error(msg);
  else console.log(msg);
}

module.exports = { log };
