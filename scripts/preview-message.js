#!/usr/bin/env node
/**
 * Quick preview of the generated message without opening a browser.
 * Run: node scripts/preview-message.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { fetchArticles } = require('./fetch-articles');
const { generate } = require('./ollama-client');

(async () => {
  const articles = await fetchArticles();
  if (!articles.length) { console.log('No articles today.'); return; }
  const a = articles[0];
  console.log('Article:', a.title);
  console.log('URL:', a.url);
  console.log('');

  const prompt = `Eres un dominicano gracioso compartiendo noticias en WhatsApp. Escribe UN solo mensaje corto, sin comillas, sin introducción, sin explicación.

FORMATO OBLIGATORIO (copia exacto, solo cambia el contenido entre corchetes):
*${a.title}*
[1-2 oraciones cómicas y dominicanizadas contando de qué va la nota — usa expresiones como "diache", "qué vaina", "ta' bueno eso", "se formó el despelote", "mano", "brutísimo", etc.]
${a.url || ''}

EJEMPLO del tono (NO copies este ejemplo, es solo para que veas el estilo):
*Apagón deja sin luz a medio Santo Domingo*
Diache mano, otra vez lo mismo 😂 El CDEEE diciendo que "es temporal" desde el 1965. Ta' to' el país rezando pa' que llegue la luz antes de que se dañe el pollo.
https://ecodominicano.com/ejemplo

Noticia de hoy:
Título: ${a.title}
Resumen: ${a.summary || a.title}

Escribe el mensaje ahora:`;

  const msg = await generate(prompt);
  console.log('--- GENERATED MESSAGE ---');
  console.log(msg);
  console.log('-------------------------');
})().catch(e => { console.error(e.message); process.exit(1); });
