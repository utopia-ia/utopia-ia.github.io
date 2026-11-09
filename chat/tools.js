// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The chat's tools: the same names, arguments and records as Claw's (web/js/tools/index.js), so the model calls them
// the way it does in Claw. The apps go through Claw's bridge (bridge.js); the memory is the engine's shared memory
// (memory-wire.js), whose three tools and rules come from the engine in the prompt's language.
//
//   app.create(name, html)  app.open(name)  app.list()  memory.save(fact, …)  memory.list(query?)  memory.forget(id?|query?)
//   web.search(query)  web.fetch(url)   (web.site(url, query) still runs when a model calls it, but it is not offered:
//   measured with LFM3, the model writes web.search with site: instead, and an empty site: search falls back to
//   the same search inside the site, in web-research.js)
//   image.generate  video.animate  video.generate   (media-tools.js; audio.music, audio.sfx and audio.speak while AUDIO_TOOLS is on)
//
// How a tool call comes out of the model is Claw's too: the engine returns plain text, and the agent looks in it for
// a ```tool block with {"tool", "args"} JSON, a ```html block (taken as app.create, far more reliable for a small
// model than escaping a whole page inside a JSON string), the model's native call syntax, or <function> tags. The
// parser below mirrors web/js/agent.js of Claw (parseToolCall and its helpers) rule for rule, with two additions:
// the loose JSON reader also knows the `fact` and `id` keys of the memory tools, and <function=X><parameter=k>
// calls are read (LFM3 writes them; see parseFunctionEq). When one side changes, the other must change with it.

import { mediaToolLines, mediaRule, MEDIA_ALIASES, MEDIA_KEYS, MEDIA_TOOL_NAMES, AUDIO_TOOLS } from './media-tools.js';

// ---------- Parser (mirrors Claw web/js/agent.js) ----------

// The value IS the content: never trimmed, never parsed.
const PARAM_EXACT = { 'app.create': ['html'] };
const hasParam = (map, tool, p) => Object.hasOwn(map, tool) && Array.isArray(map[tool]) && map[tool].includes(p);

// Small models' JSON: trailing commas and raw newlines/tabs inside strings.
function repairJson(raw) {
  const s = raw.replace(/,(\s*[}\]])/g, '$1');
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') {
      if (inStr && !'"\\/bfnrtu'.includes(s[i + 1] ?? '')) { out += '\\\\'; continue; }
      out += ch; esc = true; continue;
    }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && ch === '\n') { out += '\\n'; continue; }
    if (inStr && ch === '\r') { out += '\\r'; continue; }
    if (inStr && ch === '\t') { out += '\\t'; continue; }
    out += ch;
  }
  return out;
}

// Key-driven extraction for JSON that does not parse: each known key's value runs to the LAST closing quote that
// leaves the object well closed after it. A string that never closes is a truncated message: nothing is recovered.
function looseToolCall(raw) {
  const tm = raw.match(/"tool"\s*:\s*"([\w.]+)"/);
  if (!tm) return null;
  const am = raw.match(/"args"\s*:\s*\{/);
  const body = am ? raw.slice(am.index + am[0].length) : raw;
  const args = {};
  for (const key of new Set(['path', 'content', 'name', 'html', 'prompt', 'text', 'search', 'replace', 'query', 'key', 'value', 'url', 'fact', 'id', 'site', 'question', ...MEDIA_KEYS])) {
    const km = body.match(new RegExp('"' + key + '"\\s*:\\s*"'));
    if (!km) continue;
    const from = km.index + km[0].length;
    const ends = [];
    for (let i = from; i < body.length; i++) {
      const ch = body[i];
      if (ch === '\\') { i++; continue; }
      if (ch === '"' && /^\s*(,\s*"|\}\s*[}\]]|\}\s*$|$)/.test(body.slice(i + 1))) ends.push(i);
    }
    let val = null;
    for (let k = ends.length - 1; k >= 0; k--) {
      if (/^\s*(,|\})/.test(body.slice(ends[k] + 1))) { val = body.slice(from, ends[k]); break; }
    }
    if (val === null) return null;
    try { val = JSON.parse('"' + val.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"'); } catch { /* raw */ }
    args[key] = val;
  }
  return { tool: tm[1], args };
}

function tryJson(raw) {
  for (const cand of [raw, repairJson(raw)]) {
    try {
      const obj = JSON.parse(cand);
      if (obj && typeof obj.tool === 'string') return { tool: obj.tool, args: obj.args || {} };
    } catch { /* next layer */ }
  }
  return looseToolCall(raw);
}

// The native LFM syntax: <|tool_call_start|>[name(k="v")]<|tool_call_end|>, or [name(k="v")] alone on its line.
export function parseNativeCall(text) {
  const m = text.match(/<\|tool_call_start\|>\s*\[?\s*([\w.]+)\s*\(([\s\S]*?)\)\s*\]?\s*<\|tool_call_end\|>/)
    || text.match(/^\s*\[\s*([\w.]+)\s*\(([\s\S]*?)\)\s*\]\s*$/m);
  if (!m) return null;
  const args = {};
  const re = /([\w]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,)]+)/g;
  let a;
  while ((a = re.exec(m[2]))) {
    let v = a[2].trim();
    if (/^["']/.test(v)) v = v.slice(1, -1).replace(/\\(.)/g, '$1');
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    else if (v === 'true' || v === 'false') v = v === 'true';
    args[a[1]] = v;
  }
  return { tool: m[1], args };
}

// <function name="X"><param name="k">v</param></function>, which several models emit whatever they are asked.
const RE_FUNCTION = /<function\s+name=["']([\w.\-]+)["']\s*>((?:(?=(<!\[CDATA\[[\s\S]*?\]\]>(?=\s*<\/param\s*>)))\3|[\s\S])*?)<\/function\s*>/g;
export function parseFunctionTags(text) {
  const out = [];
  RE_FUNCTION.lastIndex = 0;
  let m;
  while ((m = RE_FUNCTION.exec(text))) {
    const tool = m[1];
    const args = {};
    const pre = /<param\s+name=["']([\w.\-]+)["']\s*>(?:\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/param\s*>|([\s\S]*?)<\/param\s*>)/g;
    let p;
    while ((p = pre.exec(m[2]))) {
      const name = p[1];
      const cdata = p[2] !== undefined;
      const raw = cdata ? p[2] : (p[3] || '');
      if (hasParam(PARAM_EXACT, tool, name)) args[name] = cdata ? raw : raw.replace(/^\r?\n/, '');
      else args[name] = raw.trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
    }
    out.push({ tool, args });
  }
  return out;
}

// <tool_call><function=X><parameter=k>v</parameter></function></tool_call>: what LFM3 writes in this chat, measured
// with the real model, whatever format the prompt shows it. Claw's parser does not read this form yet (it reads
// <function name="X">), so this one is an addition over the mirror, with the same value rules: the exact parameters
// keep their content (only the one line break the model puts around it is removed), the rest are trimmed and
// unquoted. A call without its </function> is not run: it was cut off.
const RE_FUNCTION_EQ = /<function=([\w.\-]+)>([\s\S]*?)<\/function>/g;
export function parseFunctionEq(text) {
  const out = [];
  RE_FUNCTION_EQ.lastIndex = 0;
  let m;
  while ((m = RE_FUNCTION_EQ.exec(text))) {
    const tool = m[1];
    const args = {};
    const pre = /<parameter=([\w.\-]+)>([\s\S]*?)<\/parameter>/g;
    let p;
    while ((p = pre.exec(m[2]))) {
      const name = p[1];
      if (hasParam(PARAM_EXACT, tool, name)) args[name] = p[2].replace(/^\r?\n/, '').replace(/\r?\n$/, '');
      else args[name] = p[2].trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
    }
    out.push({ tool, args });
  }
  return out;
}

// Other spellings a model may use for the same tools.
const ALIASES = {
  create_app: 'app.create', app_create: 'app.create', open_app: 'app.open', app_open: 'app.open', list_apps: 'app.list', app_list: 'app.list',
  remember: 'memory.save', save_memory: 'memory.save', memory_save: 'memory.save', list_memory: 'memory.list', memory_list: 'memory.list',
  forget: 'memory.forget', forget_memory: 'memory.forget', memory_forget: 'memory.forget',
  web_search: 'web.search', search: 'web.search', search_web: 'web.search', websearch: 'web.search', 'web.buscar': 'web.search', buscar: 'web.search',
  web_fetch: 'web.fetch', fetch: 'web.fetch', fetch_url: 'web.fetch', open_url: 'web.fetch', browse: 'web.fetch',
  web_site: 'web.site', site_search: 'web.site', search_site: 'web.site', 'web.site_search': 'web.site', 'web.search_site': 'web.site',
  'web.crawl': 'web.site', crawl: 'web.site', buscar_en_web: 'web.site',
  improve: 'elffuss.improve', elffuss_improve: 'elffuss.improve', improve_elffuss: 'elffuss.improve', 'elffuss.theme': 'elffuss.improve', customize: 'elffuss.improve',
  ...MEDIA_ALIASES,
};
const canonical = (call) => (call && Object.hasOwn(ALIASES, call.tool) ? { ...call, tool: ALIASES[call.tool] } : call);

export function parseToolCall(text) {
  return canonical(parseRaw(text));
}

function parseRaw(text) {
  const xml = parseFunctionTags(text);
  if (xml.length) return xml[0];
  const eq = parseFunctionEq(text);
  if (eq.length) return eq[0];
  const native = parseNativeCall(text);
  if (native) return native;

  const fences = [...text.matchAll(/```(\w*)[ \t]*\n?([\s\S]*?)```/g)]
    .map((m) => ({ lang: (m[1] || '').toLowerCase(), body: m[2].trim() }));
  // 1) Any fence with {tool, args} JSON counts: small models label the block wrongly.
  for (const f of fences) {
    if (f.lang === 'html') continue;
    const call = tryJson(f.body);
    if (call) return call;
  }
  if (text.trim().startsWith('{')) {
    const call = tryJson(text.trim());
    if (call) return call;
  }
  // 2) An ```html fence, or an answer that IS an HTML document, is app.create. An unclosed fence (the budget ran out
  //    in the middle of the app) also counts: browsers tolerate truncated HTML.
  const openFence = text.match(/```html[ \t]*\n?([\s\S]*)$/i);
  const html = fences.find((f) =>
    (f.lang === 'html' && /<\w+[\s>]/.test(f.body)) || /^(<!doctype|<html)/i.test(f.body))?.body
    || (/^(<!doctype html|<html)/i.test(text.trim()) ? text.trim() : null)
    || (!fences.length && openFence && /^(<!doctype|<html)/i.test(openFence[1].trim()) ? openFence[1].trim() : null);
  if (html) {
    const title = html.match(/<title>([^<]{1,40})<\/title>/i)?.[1]
      || html.match(/<h1[^>]*>([^<]{1,40})</i)?.[1] || 'app';
    const name = title.trim().toLowerCase().replace(/[^\wáéíóúñü -]/g, '').slice(0, 24).trim() || 'app';
    return { tool: 'app.create', args: { name, html }, fromHtml: true };
  }
  return null;
}

// While the model is still writing: has it started an app or a tool block? Then the page shows progress, not code.
export function writingTool(text) {
  const m = /```(html|tool|json)\b|<!doctype html|<html[\s>]|<\|tool_call_start\|>|<tool_call>|<function[\s=]/i.exec(text);
  if (!m) return null;
  const kind = /html|app\.create|create_app/i.test(text.slice(m.index)) ? 'app' : 'tool';
  return { kind, before: text.slice(0, m.index).trim(), lines: text.slice(m.index).split('\n').length };
}

// ---------- The prompt ----------

export const TOOL_NAMES = ['app.create', 'app.open', 'app.list', 'memory.save', 'memory.list', 'memory.forget', 'web.search', 'web.fetch', 'web.site', 'elffuss.improve', ...MEDIA_TOOL_NAMES];

const CATALOG = {
  en: [
    '- app.create(name, html): build a small web app: one complete, self-contained HTML document that runs at once in the panel next to the chat and is kept in the user\'s apps (shared with Claw)',
    '- app.open(name): open an app the user already has',
    '- app.list(): list the user\'s apps',
    '- web.search(query): search the internet (site:domain.com in the query keeps it to one site): returns links, snippets and what the first pages say',
    '- web.fetch(url): read one web page: returns its parts that answer the question',
  ],
  es: [
    '- app.create(name, html): construir una pequeña app web: un documento HTML completo y autocontenido que se ejecuta al instante en el panel junto al chat y se guarda en las apps del usuario (compartidas con Claw)',
    '- app.open(name): abrir una app que el usuario ya tiene',
    '- app.list(): listar las apps del usuario',
    '- web.search(query): buscar en internet (site:dominio.com en la búsqueda la limita a una web): devuelve enlaces, fragmentos y lo que dicen las primeras páginas',
    '- web.fetch(url): leer una página web: devuelve sus partes que responden a la pregunta',
  ],
};

// `mem` is the engine's memory for the prompt (memory-wire.js promptPieces): its tool lines and its five rules, the
// same bytes on every turn for a language. Without it (the memory modules did not load) the memory tools are not
// offered at all.
// `web: false` is the public copy (mirror.js): no search proxy there, so the web tools are not offered, rule 6 says
// so, and apps are kept in this browser rather than shared with Claw.
// `media: true` offers the media tools (media-tools.js): their lines go after the web tools, and rule 7 says what the
// media ids are for instead of «you cannot make images». The public copy has no model store, so no media tools.
// `apps: false` leaves the app tools and the rules for building an app out of the prompt (app-intent.js decides, per
// turn): measured on elffuss.com, with them always there the small model built apps nobody asked for.
// elffuss.improve is never offered here: a turn whose words ask to change Elffuss runs it at once, without the model
// (improve-intent.js, chat.js), and any other turn refuses it. Only its name and spellings are known (TOOL_NAMES).
export function systemPrompt(lang, mem = null, { web = true, media = false, apps = true } = {}) {
  const full = fullPrompt(lang, mem, media, apps);
  return web ? full : copyPrompt(full, lang);
}

function copyPrompt(full, lang) {
  const es = lang === 'es';
  const rule6 = es
    ? /\n6\) Para cualquier cosa que dependa de internet[\s\S]*?\n```\n(?=7\))/
    : /\n6\) For anything that depends on the internet[\s\S]*?\n```\n(?=7\))/;
  const no6 = es
    ? '\n6) En esta copia del chat no puedes buscar en internet. Si te piden datos actuales, dilo y sugiere https://elffuss.com, donde sí se puede.\n'
    : '\n6) On this copy of the chat you cannot search the web. When asked for current data, say so and suggest https://elffuss.com, where search works.\n';
  return full
    .split('\n').filter((l) => !/^- web\.(search|fetch|site)\(/.test(l)).join('\n')
    .replace(rule6, no6)
    .replaceAll(es ? '(compartidas con Claw)' : '(shared with Claw)', es ? '(en este navegador)' : '(kept in this browser)');
}

function fullPrompt(lang, mem, media = false, apps = true) {
  const es = lang === 'es';
  const tools = [...CATALOG[es ? 'es' : 'en'].filter((l) => apps || !/^- app\./.test(l)), ...(media ? mediaToolLines(lang) : []), ...(mem ? mem.tools : [])].join('\n');
  const rule7 = media
    ? (es ? `7) No puedes mirar el reloj: la fecha de hoy está en CONTEXTO AHORA; nunca inventes la hora ni otra fecha. ${AUDIO_TOOLS ? 'Imágenes, música, voz y vídeo' : 'Imágenes y vídeo'} los haces SOLO con sus herramientas. ${mediaRule(lang)}`
      : `7) You cannot read the clock: today's date is in CONTEXT NOW; never invent the time or any other date. You make ${AUDIO_TOOLS ? 'pictures, music, speech and video' : 'pictures and video'} ONLY with their tools. ${mediaRule(lang)}`)
    : (es ? '7) No puedes hacer imágenes ni mirar el reloj: la fecha de hoy está en CONTEXTO AHORA; nunca inventes la hora ni otra fecha.'
      : '7) You cannot make images or read the clock: today\'s date is in CONTEXT NOW; never invent the time or any other date.');
  const example = mem
    ? (es ? `\`\`\`tool\n{"tool": "${mem.save}", "args": {"fact": "Prefiere los colores oscuros"}}\n\`\`\`\n(si el usuario dice «recuerda que prefiero los colores oscuros»)`
      : `\`\`\`tool\n{"tool": "${mem.save}", "args": {"fact": "Prefers dark colours"}}\n\`\`\`\n(when the user says "remember that I prefer dark colours")`)
    : apps ? '```tool\n{"tool": "app.list", "args": {}}\n```'
      : (es ? '```tool\n{"tool": "web.search", "args": {"query": "receta de lentejas"}}\n```' : '```tool\n{"tool": "web.search", "args": {"query": "lentil soup recipe"}}\n```');
  const appRules = apps
    ? (es ? `2) Para crear una app responde SOLO con el documento HTML completo, autocontenido (CSS y JS dentro), en el idioma del usuario y con un <title> corto. La app corre en una caja sin red: nada de ficheros, fuentes, imágenes ni librerías de fuera, ni fetch. Haz el JavaScript sencillo y repásalo: que cada variable esté declarada donde se usa y que la app responda al escribir o pulsar. Cuida SIEMPRE el diseño: una escena que ocupe toda la pantalla, con un fondo suave (degradado claro, nunca un color plano fuerte), formas grandes y redondeadas con sombra suave, letra grande y amable cuyo texto cabe dentro de su caja, y emojis grandes (64 px o más) como personajes, colocados dentro de la escena. Dibuja el escenario con CSS: nunca lo escribas como texto. Los botones son grandes, redondos y muestran su texto entero. Nada flota suelto: cada elemento tiene su sitio.
\`\`\`html
<!doctype html><html>…</html>
\`\`\`
3) Para CAMBIAR la app abierta en el panel, escribe otra vez el documento HTML completo con el cambio y el mismo <title>.`
      : `2) To build an app, reply ONLY with the complete, self-contained HTML document (CSS and JS inside), in the user's language, with a short <title>. The app runs in a box with no network: no outside files, fonts, images or libraries, and no fetch. Keep the JavaScript simple and check it: every variable declared where it is used, and the app reacts when the user types or clicks. ALWAYS take care of the design: a scene that fills the screen, with a soft background (a light gradient, never a strong flat colour), big rounded shapes with a soft shadow, large friendly text that fits inside its box, and big emoji (64px or more) as characters, placed inside the scene. Draw the scenery with CSS: never write it out as text. Buttons are big, round and show their whole label. Nothing floats loose: every element has its place.
\`\`\`html
<!doctype html><html>…</html>
\`\`\`
3) To CHANGE the app open in the panel, write the whole HTML document again with the change and the same <title>.`)
    : (es ? `2) En este turno no se crean apps: si piden código o un ejemplo (también HTML), escríbelo en un bloque de código para leer.
3) Las listas, los textos, las explicaciones y las imágenes van en la respuesta, nunca dentro de una página HTML.`
      : `2) No apps are built on this turn: when asked for code or an example (HTML too), write it in a code block to read.
3) Lists, texts, explanations and pictures go in the answer, never inside an HTML page.`);
  const memRules = mem ? `\n\n${es ? 'MEMORIA' : 'MEMORY'}:\n${mem.rules}` : '';
  if (es) {
    return `Eres el asistente del chat de Elffuss. Corres entero dentro del navegador del usuario, en su propio dispositivo, con el motor de Elffuss. Responde con claridad y brevedad. Usa Markdown cuando ayude. Responde en el idioma en que te escriba el usuario.

HERRAMIENTAS (la página pide los permisos; tú solo llama):
${tools}

Cómo actuar:
1) Para usar una herramienta responde SOLO con:
${example}
${appRules}
4) Lo que recuerdas del usuario llega en el bloque <memoria> de CONTEXTO AHORA: úsalo sin volver a preguntarlo.
5) Tras un [resultado] correcto, o si no hace falta herramienta, responde con texto normal. No repitas una herramienta que ya salió bien. Nunca digas que has hecho algo si no has llamado a la herramienta en este turno.
6) Para cualquier cosa que dependa de internet o de datos actuales (noticias, precios, el tiempo, resultados, personas, empresas, «busca…») usa web.search, aunque creas saberlo; si un resultado no basta, lee la página con web.fetch. Si preguntan por algo DE una web concreta (un periódico, una tienda, una administración, una documentación), pon site: y su dominio en la búsqueda, por ejemplo «site:aemet.es olas de calor». No pongas años en la búsqueda si el usuario no los dice: para «el último…» o «el próximo…», busca esas palabras, no el año que creas. Responde con lo que digan los resultados y pon los enlaces de donde lo sacas. Nunca digas que no puedes buscar.
\`\`\`tool
{"tool": "web.search", "args": {"query": "tiempo en Madrid hoy"}}
\`\`\`
${rule7}
8) Si te piden algo que este chat no hace, dilo y ofrece la app de Elffuss que sí lo hace, con su enlace: Claw (https://claw.elffuss.com) construye apps con carpetas, tareas, imágenes de la web y más herramientas; Code (https://code.elffuss.com) edita tu proyecto contigo; Translator (https://translator.elffuss.com) traduce una conversación en voz alta; el Copiloto (https://copilot.elffuss.com) convierte una llamada en una ficha.${memRules}`;
  }
  return `You are the assistant of the Elffuss chat. You run entirely inside the user's web browser, on their own device, with the Elffuss engine. Answer clearly and briefly. Use Markdown when it helps. Reply in the language the user writes in.

TOOLS (the page asks the user for permission; you just call):
${tools}

How to act:
1) To use a tool, reply ONLY with:
${example}
${appRules}
4) What you remember about the user comes in the <memory> block of CONTEXT NOW: use it without asking again.
5) After a correct [result], or when no tool is needed, answer in plain text. Do not repeat a tool that already worked. Never say you did something unless you called the tool in this turn.
6) For anything that depends on the internet or on current data (news, prices, weather, results, people, companies, "search…") use web.search, even if you think you know; if a result is not enough, read the page with web.fetch. When asked about something ON a specific website (a newspaper, a shop, an administration, some documentation), put site: and its domain in the query, for example "site:python.org read json". Do not put years in the query unless the user says them: for "the latest…" or "the next…", search those words, not the year you think it is. Answer from what the results say and give the links you took it from. Never say you cannot search.
\`\`\`tool
{"tool": "web.search", "args": {"query": "weather in Madrid today"}}
\`\`\`
${rule7}
8) When asked for something this chat does not do, say so and offer the Elffuss app that does, with its link: Claw (https://claw.elffuss.com) builds apps with folders, tasks, images from the web and more tools; Code (https://code.elffuss.com) edits your project with you; Translator (https://translator.elffuss.com) translates a conversation aloud; Copilot (https://copilot.elffuss.com) turns a call into a customer record.${memRules}`;
}

export const CONTEXT_LABEL = { en: 'CONTEXT NOW (the real state, use it when you answer):', es: 'CONTEXTO AHORA (estado real, úsalo al responder):' };

// The live state, as Claw sends it: a message placed just before the last one, so the system prompt and the earlier
// history stay a stable prefix the engine can reuse. `memory` is the turn's memory block from the shared store (only
// what is relevant to this turn, within a budget set by the model's context), or '' when there is none. `today` is the
// user's local date with its weekday (memory-wire.js `today`); it changes once a day, so it lives here and never in
// the system prompt.
// `reply`: the language of the user's message (reply-lang.js), said in that language, so a page in English with a
// message in Spanish gets its answer in Spanish.
const REPLY = { es: 'El usuario escribe en español: responde en español.', en: 'The user writes in English: answer in English.' };
export function contextBlock(lang, { apps, open, memory = '', today = '', voice = false, reply = null }) {
  const es = lang === 'es';
  const none = es ? 'ninguna' : 'none';
  const list = apps === null ? (es ? 'no disponible ahora' : 'not available now')
    : apps.length ? apps.slice(0, 20).map((a) => a.name).join(', ') : none;
  return [
    ...(today ? [today] : []),
    ...(reply && Object.hasOwn(REPLY, reply) ? [REPLY[reply]] : []),
    (es ? 'Apps del usuario: ' : 'The user\'s apps: ') + list,
    (es ? 'App abierta en el panel: ' : 'App open in the panel: ') + (open || none),
    ...(memory ? [memory] : []),
    // The answer is read aloud (the voice mode): short, and said as speech. In the turn's context, not in the system
    // prompt, so the engine keeps reusing the system prompt it already read.
    ...(voice ? [es ? 'Modo de voz: tu respuesta se leerá en voz alta. Responde en 1 a 3 frases cortas, como hablando, sin listas, tablas, código ni enlaces, salvo que te pidan más detalle.'
      : 'Voice mode: your answer is read aloud. Answer in 1 to 3 short sentences, as speech, with no lists, tables, code or links, unless asked for more detail.'] : []),
  ].join('\n');
}

export function withContext(history, block, label) {
  const m = { role: 'user', content: `${label}\n${block}` };
  if (!history.length) return [m];
  return [...history.slice(0, -1), m, history[history.length - 1]];
}

