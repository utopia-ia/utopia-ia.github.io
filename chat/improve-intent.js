// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// Does the user ask to change Elffuss ITSELF (its colours, shape, letters, its look), so that this turn offers the
// elffuss.improve tool? Decided once per turn from the user's own words, without the model, like app-intent.js. A
// web page or a tool result can never ask for it: the tool is offered only when this says yes, and it only runs as
// the turn's first call (chat.js).
//
// Yes when:
//   · the chat is spoken to about itself: «cámbiate», «mejórate», «personalízate», «ponte en verde», «ponte más claro»,
//     «quiero que tengas un color más claro» (and «…tenas…», as typed on elffuss.com), «change yourself»;
//   · a change names Elffuss, the chat or the page: «personaliza Elffuss», «cambia el color del chat», «pon la web en
//     modo oscuro», «make the chat green», «change your colours»;
//   · with no app open in the panel, a change of the look with nothing else named: «cambia el color», «cambia la
//     letra», «cambia el tema a oscuro», «modo oscuro», «tema claro», «letra más grande», «quiero otro color», «change the
//     theme», «change the font to serif».
// No for the app open in the panel («cámbiale el color al botón»), a picture («cambia el color de la foto»), someone
// else's page («cambia el color de mi web»), a subject («cambia de tema», «cambia el tema, háblame de…»), lyrics («la
// letra de la canción»), a question about CSS, and an app asked for («hazme una app para cambiar colores»).
import { normalize } from './media-intent.js';
import { needsAppTools } from './app-intent.js';

const COLOUR = '(?:(?:oscur|clar)[oa]s?|rojo|roja|verde|azul|amarillo|amarilla|naranja|morado|morada|violeta|lila|rosa|rosado|negro|negra|blanco|blanca|gris|marron|turquesa|dorado|dorada|plateado|beige|crema|pastel|oscuro|oscura|claro|clara|red|green|blue|yellow|orange|purple|violet|pink|black|white|grey|gray|brown|teal|gold|golden|silver|dark|light)';
const SELF = new RegExp('\\b(?:cambiate|mejorate|personalizate|transformate|renuevate|redisenate|vistete|change yourself|improve yourself|customi[sz]e yourself|restyle yourself|redesign yourself|ponte (?:en |de |mas |muy |en modo )?' + COLOUR + '|ponte (?:mas )?(?:bonito|guapo|elegante|redondo|moderno|serio)|vuelvete ' + COLOUR + ')\\b');
const TARGET = '(?:elffuss|el chat|este chat|del chat|al chat|la web|esta web|esta pagina|la pagina|la interfaz|tu aspecto|tu color|tus colores|tu tema|tu letra|tu fuente|tu tipografia|tu diseno|tu estilo|tu interfaz|tu look|your look|your colou?rs?|your theme|your font|your design|your style|the chat|this chat|this site|this page|the interface)';
const CHANGE = '(?:cambia|cambiale|cambiar|cambiame|modifica|modificar|personaliza|personalizar|mejora|mejorar|pon|ponle|poner|haz|hacer|quiero|quisiera|me gustaria|puedes cambiar|podrias cambiar|change|customi[sz]e|make|set|turn|put|improve|redesign|restyle|i want|i d like|can you change|could you change)';
const LOOK = '(?:color(?:es)?|colou?rs?|tema visual|theme|aspecto|look|letra|fuente|tipografia|font|typeface|diseno|design|estilo visual|fondo|background|modo oscuro|dark mode|modo claro|light mode|bordes|esquinas|corners)';
const NAMES_SELF = new RegExp(`\\b${CHANGE}\\b.{0,40}\\b${TARGET}\\b|\\b${TARGET}\\b.{0,30}\\b(?:en|a|de|mas|to|into|more)?\\s*${COLOUR}\\b`);
const NAMES_SELF_LOOK = new RegExp(`\\b${CHANGE}\\b.{0,30}\\b${LOOK}\\b.{0,20}\\b${TARGET}\\b|\\b${CHANGE}\\b.{0,30}\\b${TARGET}\\b`);
// A change of the look and then nothing, or only what it should become.
const BARE = new RegExp(`\\b${CHANGE}\\b (?:el |la |los |las |the |its |a )?(${LOOK}|tema)( .*)? $`);
const AFTER_OK = new RegExp(`^ (?:(?:a|al|en|por|to|into|for)\\s+)?(?:(?:un|una|uno|a|an|mas|more|muy)\\s+)?(?:${COLOUR}|serif|mono|monospace|redond[oa]s?|rounded|round|cuadrad[oa]s?|square|grande|bigger|pequena|smaller|elegante|moderna?|seria?|bonit[oa]|que se lea mejor|please|por favor)\\b`);
// A picture, an app, someone's page, a song: «de la foto», «del botón», «de mi web», «of my site», «de la canción».
const OTHER = /\b(?:imagen|foto|fotografia|dibujo|picture|image|photo|video|app|aplicacion|juego|game|boton|button|cancion|song|letra de|lyrics|mi web|mi pagina|mi blog|my site|my website|my page|un div|css|html|word|excel|documento|document|correo|email|texto|text|cv|curriculum)\b/;
const SUBJECT = /\b(?:cambia(?:mos)? de tema|cambiemos de tema|change the subject|otro tema|de que tema)\b/;
const HOW = /^ (?:como|que|cual|por que|how|what|which|why)\b/;
// «Quiero que tengas un color más claro» (also as Kiko typed it: «quiero que tenas…»), «quiero que te pongas en verde».
const WISH = new RegExp(`\\bquiero que (?:te pongas|tengas|tenas|tegas|tenga|seas|estes|uses|lleves|cambies)\\b.{0,30}\\b(?:${LOOK}|${COLOUR})\\b`);
// The look and what it should become, with no verb: «letra más grande», «un color más claro», «quiero otro color».
const LOOK_ONLY = new RegExp(`^ (?:(?:pon|ponme|quiero|quisiera|usa)\\s+)?(?:un |una |otro |otra |el |la |los |las )?${LOOK}(?: (?:mas |muy )?(?:${COLOUR}|grande|grandes|pequena|pequenas|redond[oa]s?|bonit[oa]s?|distint[oa]s?|diferentes?))?(?: por favor| please)? $`);
const MODE = /\b(?:modo oscuro|modo claro|dark mode|light mode|tema oscuro|tema claro|dark theme|light theme)\b/;

/**
 * @param {string} text the user's message, as typed
 * @param {{ open?: string|null }} [state] `open`: the app open in the panel, if any
 * @returns {boolean}
 */
export function needsImprove(text, { open = null } = {}) {
  const t = normalize(text);
  if (t.trim().length < 3 || t.length > 400) return false;
  if (SUBJECT.test(t)) return false;
  if (needsAppTools(text, { open }).apps && !SELF.test(t) && !new RegExp(`\\b${TARGET}\\b`).test(t)) return false;
  if (SELF.test(t) || WISH.test(t)) return true;
  if (NAMES_SELF_LOOK.test(t) || NAMES_SELF.test(t)) return !OTHER.test(t.replace(new RegExp(`\\b${TARGET}\\b`, 'g'), ' '));
  if (open || OTHER.test(t)) return false;
  if (MODE.test(t) && !HOW.test(t)) return true;
  if (LOOK_ONLY.test(t)) return true;
  const m = BARE.exec(t);
  if (!m) return false;
  if (HOW.test(t)) return false;
  const after = m[2] ? m[2] + ' ' : '';
  // «tema» alone is a subject; it is the look only with what it becomes («el tema a oscuro»).
  if (m[1] === 'tema' && !after.trim()) return false;
  return !after.trim() || AFTER_OK.test(after);
}
