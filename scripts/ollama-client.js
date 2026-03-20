/**
 * Ollama API client for LLM generation.
 * Connects to host Ollama (e.g. http://10.0.2.2:11434 for VirtualBox).
 */
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://10.0.2.2:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

async function generate(prompt, options = {}) {
  const { model = OLLAMA_MODEL, system } = options;
  const url = `${OLLAMA_URL}/api/generate`;
  const body = {
    model,
    prompt,
    stream: false,
    ...(system && { system }),
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const text = data.response?.trim() || '';
    if (!text) throw new Error('Ollama returned empty response');
    // Detect safety refusals so callers can fall back gracefully
    if (/^(lo siento|i('m| am) sorry|no puedo|i can't|i cannot|no me es posible|disculpa[,\s])/i.test(text)) {
      throw new Error(`Ollama refused: ${text.slice(0, 120)}`);
    }
    return text;
  } catch (e) {
    throw new Error(`Ollama generate failed: ${e.message}`);
  }
}

module.exports = { generate };
