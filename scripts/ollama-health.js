#!/usr/bin/env node
/**
 * Outputs {"ok": true/false, "reason": "..."} for Ollama connectivity.
 * Used by the GUI to show a real-time status badge.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://10.0.2.2:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

async function main() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.log(JSON.stringify({ ok: false, reason: `HTTP ${res.status}` }));
      return;
    }
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    const hasModel = models.some((m) => m === OLLAMA_MODEL || m.startsWith(OLLAMA_MODEL.split(':')[0]));
    if (!hasModel) {
      console.log(JSON.stringify({
        ok: false,
        reason: `up but model "${OLLAMA_MODEL}" not found`,
      }));
      return;
    }
    console.log(JSON.stringify({ ok: true, reason: `OK (${OLLAMA_MODEL})` }));
  } catch (e) {
    const msg = e.name === 'TimeoutError' ? 'timeout (5s)' : e.message;
    console.log(JSON.stringify({ ok: false, reason: msg }));
  }
}

main();
