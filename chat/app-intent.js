// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// Does this turn need the app tools (app.create, app.open, app.list) and the rules for building an app in its prompt?
// Decided once per turn, without the model, like media-intent.js. Measured on elffuss.com: with the app tools always
// in the prompt the small model built an app for questions that asked for none (an HTML example, a shopping list, a
// picture wrapped in a page).
//
// Yes when:
//   · the user asks to make one: a creation verb and, within a few words, something that is an app (app, juego,
//     calculadora, herramienta, página web, widget, temporizador…), es or en, accents and case aside;
//   · an app is open in the panel and the user asks to change or fix it («arréglala», «cámbiale el color», the
//     «Pedir que la arregle» message), or points at it;
//   · the user names one of their saved apps, or asks about their apps («qué apps tengo», «abre mis apps»).
// No for questions about apps («¿qué app me recomiendas?», «la app de mi banco no va», «explícame cómo funciona una
// app», «¿cómo creo una app?»).
import { normalize } from './media-intent.js';

const NOUNS = [
  'apps?', 'aplicacion(?:es)?', 'aplicacioncita', 'web ?apps?', 'webapps?', 'applications?', 'juegos?', 'jueguitos?', 'games?', 'minijuegos?',
  'calculadoras?', 'calculators?', 'herramientas?', 'tools?', 'paginas? web', 'pagina interactiva', 'web interactiva', 'websites?', 'web pages?',
  'landing(?: pages?)?', 'widgets?', 'temporizador(?:es)?', 'timers?', 'cronometros?', 'stopwatch(?:es)?', 'contador(?:es)?', 'counters?',
  'relojes', 'reloj', 'clocks?', 'formularios?', 'forms?', 'dashboards?', 'panel(?:es)? de control', 'conversor(?:es)?', 'converters?',
  'convertidor(?:es)?', 'quiz(?:zes)?', 'trivial(?:es)?', 'generador(?:es)?', 'generators?', 'simulador(?:es)?', 'simulators?', 'pizarras?',
  'whiteboards?', 'tableros?', 'boards?', 'to ?do(?: list)?(?: app)?', 'gestor(?:es)? de tareas', 'task managers?', 'agendas?', 'planificador(?:es)?',
  'planners?', 'tracker', 'trackers', 'rastreador(?:es)?', 'editor(?:es)?', 'editors?', 'visor(?:es)?', 'viewers?', 'reproductor(?:es)?',
  'players?', 'calendarios?', 'calendars?', 'tetris', 'snake', 'pong', 'sudoku', 'tres en raya', 'tic ?tac ?toe', 'ahorcado', 'hangman',
  'memory', 'piano', 'metronomos?', 'metronomes?', 'animacion interactiva', 'programas?', 'programs?', 'utilidad(?:es)?', 'utility', 'utilities',
];
const NOUN = new RegExp(`^(?:${NOUNS.join('|')})\\b`);

// Creation verbs and requests, es and en (imperative, infinitive with a pronoun, «me haces», «quiero», «can you make»).
const VERB = new RegExp('\\b(?:' + [
  'haz', 'hazme', 'haznos', 'hacer', 'hacerme', 'hagas', 'hagamos', 'crea', 'creame', 'crear', 'crearme', 'creas',
  'genera', 'generame', 'generar', 'programa', 'programame', 'programar', 'programarme', 'codifica', 'codificame', 'construye', 'construyeme',
  'construir', 'construirme', 'monta', 'montame', 'montar', 'desarrolla', 'desarrollame', 'desarrollar', 'disena', 'disename', 'disenar',
  'escribe', 'escribeme', 'preparame', 'prepara', 'dame', 'ponme', 'quiero', 'quisiera', 'necesito', 'me haces', 'me hagas', 'me creas', 'me programas',
  'make', 'build', 'create', 'code', 'program', 'develop', 'write', 'design', 'generate', 'give me', 'i want', 'i need', 'i d like', 'id like',
].join('|') + ')\\b', 'g');
const NEAR = 5;   // the app noun within this many words after the verb
// What is made when one of these comes between the verb and the noun: a text, a list, a picture… not an app.
const NOT_APP = /^(?:lista|list|email|correo|carta|letter|mensaje|message|resumen|summary|receta|recipe|poema|poem|cuento|story|historia|texto|text|articulo|article|ensayo|essay|imagen|image|foto|photo|picture|dibujo|drawing|video|cancion|song|tabla|table|ejemplo|example|explicacion|explanation|plan|guion|script|post|tuit|tweet|presupuesto|budget|informe|report|traduccion|translation|pregunta|question|respuesta|answer|frase|sentence|chiste|joke|nombre|name|eslogan|slogan|idea|ideas|codigo|code|funcion|function|consulta|query)\b/;
// A question about how to do it, not a request to do it: a question word before the verb.
const HOW = /^ (?:como|que|cual|cuales|por que|para que|donde|cuando|cuanto|how|what|which|why|where|when|explica|explicame|explain|dime como|tell me how)\b/;
// A request that is a question too: «¿me haces…?», «¿puedes hacer…?», «can you make…?».
const ASK = /\b(?:puedes|podrias|me haces|me puedes|can you|could you|would you|will you)\b/;

// Changing or fixing the app open in the panel.
const EDIT = /\b(?:arregla(?:la|lo|me)?|corrige(?:la|lo)?|repara(?:la|lo)?|cambia(?:la|lo|le)?|cambiale|ponle|ponla|ponlo|anade(?:le)?|agrega(?:le)?|quita(?:le)?|elimina|borra|mueve|haz ?la|haz ?lo|haz que|hazla|hazlo|mejora(?:la|lo)?|actualiza(?:la|lo)?|modifica(?:la|lo)?|amplia(?:la|lo)?|agranda|achica|mas grande|mas pequen[ao]|mas rapid[ao]|mas lent[ao]|color(?:es)?|fondo|boton(?:es)?|tamano|fuente|letra|que funcione|no funciona|no va|falla|da (?:un )?error|fix|change|add|remove|delete|move|make it|make the|update|improve|edit|tweak|rename|bigger|smaller|faster|slower|colou?rs?|background|button|font|doesn t work|does not work|broken|error)\b/;
// Pointing at the app on the panel.
const POINTS = /\b(?:la app|esta app|esa app|el juego|este juego|la calculadora|la aplicacion|esta aplicacion|la pagina|the app|this app|that app|the game|this game)\b/;
// The «Pedir que la arregle» message (chat.js t('fixAsk')).
const FIX_ASK = /\b(?:la app .{1,80} da este error|the app .{1,80} shows this error)\b/;
// The user's apps as a whole.
const MINE = /\b(?:mis apps|mis aplicaciones|my apps|my applications|apps guardadas|saved apps|que apps tengo|cuantas apps tengo|what apps do i have|list(?:a|ame)? (?:de |mis )?apps|abre (?:una de )?mis apps)\b/;
const OPEN = /\b(?:abre|abreme|abrir|ensename|muestrame|carga|cargame|lanza|open|show me|load|launch|run)\b/;

/**
 * @param {string} text the user's message, as typed
 * @param {{ open?: string|null, names?: string[] }} [state] `open`: the app open in the panel, if any;
 *   `names`: the names of the user's saved apps
 * @returns {{ apps: boolean, why: 'request'|'open-app'|'fix'|'named'|'mine'|null }}
 */
export function needsAppTools(text, { open = null, names = [] } = {}) {
  const raw = String(text || '');
  const t = normalize(raw);
  if (FIX_ASK.test(t)) return { apps: true, why: 'fix' };
  if (open && (EDIT.test(t) || (POINTS.test(t) && t.trim().split(' ').length <= 6))) return { apps: true, why: 'open-app' };
  if (MINE.test(t)) return { apps: true, why: 'mine' };
  for (const n of names) {
    const k = normalize(n).trim();
    if (k.length >= 3 && t.includes(` ${k} `) && (OPEN.test(t) || t.trim() === k)) return { apps: true, why: 'named' };
  }
  if (HOW.test(t) && !ASK.test(t)) return { apps: false, why: null };
  VERB.lastIndex = 0;
  for (let m; (m = VERB.exec(t));) {
    const after = t.slice(m.index + m[0].length).trim().split(' ');
    for (let i = 0; i < Math.min(NEAR, after.length); i++) {
      if (NOT_APP.test(after[i])) break;
      if (NOUN.test(after.slice(i).join(' '))) return { apps: true, why: 'request' };
    }
  }
  return { apps: false, why: null };
}

/** HTML that is only a frame for media ids (<img src="img-…">, a title, a heading): a picture, not an app. */
export function wrapsOnlyMedia(html) {
  const h = String(html || '');
  if (!/\b(?:img|aud|vid)-[a-z2-9]{4}\b/.test(h)) return false;
  if (/<(script|input|button|select|textarea|canvas|form|iframe)\b|\son\w+\s*=/i.test(h)) return false;
  const text = h.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length < 200;
}
