// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The language to answer in: the one the user's MESSAGE is written in, not the page's. Kiko, on elffuss.com with the
// page in English, wrote in Spanish and got an answer in English: the whole prompt was English. The page's language
// only breaks a tie (a message too short or too mixed to tell: «ok», «gracias!», a link).
//
// Told to the model in the turn's live state (tools.js contextBlock), never in the system prompt, which stays the same
// bytes from turn to turn so the engine reuses it.

const ES = new Set(('que de el la los las un una unos unas y o en es son por para con sin pero porque como cuando donde quien cual cuales '
  + 'del al lo le les se me te mi mis tu tus su sus nos muy mas tambien ya hay hola gracias quiero puedes podrias necesito tengo tienes '
  + 'hazme dime dame busca buscame explica explicame cuanto cuanta cuantos esto esta este eso esa ese aqui ahi algo nada todo bien '
  + 'si no vale claro sobre hasta desde entre hoy ayer manana ahora siempre nunca otra otro estoy esta estan soy eres fue era ser').split(' '));
const EN = new Set(('the a an and or of to in is are was were be been for with without but because how when where who which what '
  + 'this that these those it its i you he she we they me my your our their him her them do does did can could would should will '
  + 'please thanks thank hello hi want need have has make give tell show find search explain about from up out into over just not '
  + 'yes no okay today tomorrow yesterday now always never some any all there here').split(' '));

/**
 * @param {string} text the user's message
 * @param {'es'|'en'} ui the page's language, the tie-breaker
 * @returns {'es'|'en'}
 */
export function replyLang(text, ui = 'en') {
  const raw = String(text || '').replace(/\bhttps?:\/\/\S+/g, ' ');
  let es = (raw.match(/[ñ¿¡]/gi) || []).length * 2 + (raw.match(/[áéíóú]/gi) || []).length;
  let en = (raw.match(/\b(?:i'm|don't|can't|it's|what's|isn't|won't|you're|i've|let's)\b/gi) || []).length * 2;
  const words = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-zñ']+/g) || [];
  for (const w of words) { if (ES.has(w)) es++; if (EN.has(w)) en++; }
  if (es === en || Math.max(es, en) < 2) return ui === 'es' ? 'es' : 'en';
  return es > en ? 'es' : 'en';
}
