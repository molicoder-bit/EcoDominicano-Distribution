#!/usr/bin/env node
/**
 * One-time Telegram login via GramJS (MTProto).
 * Run this once — saves the session to state/telegram-session.txt.
 * After that, distribute.js uses the saved session automatically.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const path     = require('path');
const fs       = require('fs');
const readline = require('readline');

const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');

const API_ID      = parseInt(process.env.TELEGRAM_API_ID  || '0', 10);
const API_HASH    = process.env.TELEGRAM_API_HASH || '';
const PHONE       = process.env.TELEGRAM_PHONE   || '';
const SESSION_PATH = process.env.TG_SESSION_PATH
  || path.join(__dirname, '../state/telegram-session.txt');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  if (!API_ID || !API_HASH) {
    console.error('❌  TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in config/.env');
    process.exit(1);
  }

  const existingSession = fs.existsSync(SESSION_PATH)
    ? fs.readFileSync(SESSION_PATH, 'utf8').trim()
    : '';
  const session = new StringSession(existingSession);

  const client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5 });
  client.setLogLevel('none');

  console.log('\nConnecting to Telegram...');

  await client.start({
    phoneNumber:  async () => PHONE || await ask('Phone number (with country code, e.g. +13476150920): '),
    phoneCode:    async () => await ask('Enter the code Telegram sent you: '),
    password:     async () => await ask('2FA password (press Enter if none): '),
    onError: (err) => console.error('Login error:', err.message),
  });

  const me = await client.getMe();
  console.log(`\n✅  Logged in as: ${me.firstName || ''} ${me.lastName || ''} (${me.username ? '@' + me.username : me.phone})`);

  const sessionString = client.session.save();
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  fs.writeFileSync(SESSION_PATH, sessionString, 'utf8');
  console.log(`✅  Session saved to: ${SESSION_PATH}`);
  console.log('    You can now close this window — login is complete.');

  await client.disconnect();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
