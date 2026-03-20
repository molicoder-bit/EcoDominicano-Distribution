#!/usr/bin/env node
/**
 * One-shot helper: print Reddit authorize URL, then exchange ?code= for refresh_token.
 * Run on any machine with browser access (VM or your PC). Secrets only in config/.env.
 *
 * Prereqs in .env:
 *   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET
 *   REDDIT_REDIRECT_URI — must match the "redirect uri" in the Reddit app exactly
 *   REDDIT_USERNAME — for User-Agent (required by Reddit for API calls)
 *
 * Usage: npm run reddit:token
 */
const path = require('path');
const readline = require('readline');

require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const REDDIT_USERNAME = process.env.REDDIT_USERNAME || 'unknown';
const USER_AGENT =
  process.env.REDDIT_USER_AGENT
  || `web:EcoDominicano-Distributor:v1.0 (by /u/${REDDIT_USERNAME})`;

async function main() {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  const redirect = (process.env.REDDIT_REDIRECT_URI || 'http://localhost:8080').trim();

  if (!clientId || !secret) {
    console.error('Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in config/.env');
    process.exit(1);
  }

  const scope = 'submit read identity';
  const state = Math.random().toString(36).slice(2, 14);
  const authUrl =
    'https://www.reddit.com/api/v1/authorize?' +
    new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      state,
      redirect_uri: redirect,
      duration: 'permanent',
      scope,
    }).toString();

  console.log('\n1) Log in to Reddit as the account that will post.\n');
  console.log('2) Open this URL in a browser:\n');
  console.log(authUrl);
  console.log('\n3) After "Allow", you are redirected. Copy the full address bar URL, or only the `code=...` value.');
  console.log(`   (state should be "${state}" — if it differs, do not paste; start over.)\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const line = await new Promise((resolve) => {
    rl.question('Paste redirect URL or code: ', resolve);
  });
  rl.close();

  const raw = line.trim();
  let code = raw;
  const codeMatch = raw.match(/[?&]code=([^&]+)/);
  if (codeMatch) code = decodeURIComponent(codeMatch[1]);

  if (raw.includes('state=')) {
    const sm = raw.match(/[?&]state=([^&]+)/);
    if (sm && decodeURIComponent(sm[1]) !== state) {
      console.error('state mismatch — possible CSRF or wrong tab. Try again.');
      process.exit(1);
    }
  }

  if (!code) {
    console.error('No code found.');
    process.exit(1);
  }

  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
    }).toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    console.error('Token exchange failed:', data.error || res.status, data.message || '');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  if (data.refresh_token) {
    console.log('\n--- Add or update in config/.env ---\n');
    console.log(`REDDIT_REFRESH_TOKEN=${data.refresh_token}`);
    console.log('\n(access_token is short-lived; the distributor refreshes automatically.)\n');
  } else {
    console.log('Response had no refresh_token (unexpected for duration=permanent):');
    console.log(JSON.stringify(data, null, 2));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
