// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The shared memory in the elffuss.com chat.
//
// One memory for every Elffuss app, kept only in this browser. It is owned by the store page on Claw's host
// (cfg.storeUrl), which has its own database; this page never opens it. The engine's client (js/engine/memory.js)
// talks to that page through a hidden frame, and the engine's cards (js/engine/memory-cards.js) show what the user
// has to see or decide. Elffuss's values (brand, origins, store URL, colours) come from memory/memory.config.js,
// a byte copy of Claw's pinned in PIN.json; nothing here names them again.
//
// What this module adds for the chat, and nothing more:
//   - the turn: the memory block for this turn (asked once, reused on every step, rebuilt only after a save), the
//     evidence of what the user TYPED, the taint flag (any tool other than memory taints the turn), the tool runs;
//   - the grant: the first save asks «Let Chat use your shared memory?» before anything is written;
//   - the sidebar count, the memory drawer (the store page itself in a visible frame), the «No memory» switch;
//   - the conversation id (opaque, random) for «forget what I learnt in this chat».
//
// If the memory modules do not load, load() resolves null and the chat runs without memory: no block, and the memory
// tools answer that memory is not available. It never falls back to another store.
//
// The public copy (mirror.js) is the one exception, decided before anything loads: there the store page on Claw's
// host is never framed (it allows https://elffuss.com only, the copy is another site whose frames are partitioned
// anyway, and it exists for networks where elffuss.com is blocked). The copy runs the engine's store IN THE PAGE
// (`direct`, as Claw does on its own origin) over this origin's IndexedDB, with a config that lists only this
// origin; the panel is mounted in the page too. Nothing waits for a frame, and the memory stays in this browser,
// not shared with Claw or Code.
//
// Stated residual risk: the store allows origins, not paths. The chat is allowed as https://elffuss.com, the origin
// that also serves the home page and the blog, so any script running on any page of that origin can read the shared
// memory and ask for the chat's grant. Closing it needs the chat on an origin of its own (a subdomain) listed in the
// config instead; until then no page of elffuss.com may run third-party or generated script.

import { mirror } from './mirror.js';

const APP = 'chat';
// What the chat reads: what every app shares and what is only the chat's.
export const SCOPES = Object.freeze(['all', `app:${APP}`]);
// The chat is light: cards and the panel take the light palette of the config.
const SCHEME = 'light';
// The memory grant the chat asked for itself before the shared memory (localStorage 'elffuss.grants'), carried over
// once into the store, as Claw does with its own.
const OLD_GRANTS = 'elffuss.grants';
const CARRIED = 'elffuss-home.memory.grantCarried';

let loading = null;
let M = null;               // { cfg, memory, cards, core, text }
let mem = null;             // the engine client, for the current language
let lang = 'en';
const changeFns = new Set();
let grantHere = null;       // the grant as this page last set it (the client's hello is from when it connected)

export function load() {
  if (!loading) {
    loading = open().catch((e) => {
      console.warn('[chat] no shared memory:', e?.name || 'error');
      loading = null;          // a passing failure does not keep memory off until a reload
      return null;
    });
  }
  return loading;
}
export const loaded = () => M;

// Today's local date for the live state of every turn, in the engine's words (memory-text.js `todayLine`): «Hoy es
// 2026-11-04, miércoles.» / "Today is 2026-11-04, Wednesday.", the form the memory block uses for events, so «¿qué
// tengo mañana?» can be answered. Without the engine loaded, the same sentence made here.
const WEEKDAYS = { es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
export function today(l = 'es', now = Date.now()) {
  if (M?.text?.todayLine) return M.text.todayLine(l, { now, strings: M.cfg?.strings });
  const d = new Date(now), p = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}, ${(WEEKDAYS[l] || WEEKDAYS.en)[d.getDay()]}`;
  return l === 'es' ? `Hoy es ${day}.` : `Today is ${day}.`;
}

async function open() {
  const [{ default: base }, memory, cards, core, text] = await Promise.all([
    import('./memory/memory.config.js'),
    import('./js/engine/memory.js'),
    import('./js/engine/memory-cards.js'),
    import('./js/engine/memory-core.js'),
    import('./js/engine/memory-text.js'),
  ]);
  let cfg = base, direct = null, ui = null;
  if (mirror) ({ cfg, direct, ui } = await openHere(base));
  M = { cfg, memory, cards, core, text, direct, ui };
  carryGrant().catch(() => {});
  return M;
}

// The copy's memory: Elffuss's brand, namespace and colours, this origin as the only app and as the store.
async function openHere(base) {
  const [{ defineMemoryConfig }, { openStore }, ui] = await Promise.all([
    import('./js/engine/memory-config.js'),
    import('./js/engine/memory-store.js'),
    import('./js/engine/memory-ui.js'),
  ]);
  const here = location.origin;
  const cfg = defineMemoryConfig({
    brand: { name: base.brand.name },
    namespace: base.namespace,
    storeUrl: here + '/memory/',          // required by the config; nothing is served there, the store runs in the page
    apps: [{ id: APP, origin: here, label: { es: 'Chat', en: 'Chat' } }],
    theme: { light: base.theme.light, dark: base.theme.dark },
    features: { proposals: !!base.features?.proposals, incognito: !!base.features?.incognito },
    // The engine's words say the memory is shared with the other apps; here it is not.
    strings: {
      en: {
        'card.grant': 'Let {app} keep a memory in this browser? On this copy it is not shared with your other {brand} apps.',
        'panel.header': 'Remembers {n} things · only on this copy, in this browser',
        'panel.header.one': 'Remembers 1 thing · only on this copy, in this browser',
      },
      es: {
        'card.grant': '¿Dejo que {app} guarde una memoria en este navegador? En esta copia no se comparte con tus otras apps {brand}.',
        'panel.header': 'Recuerda {n} cosas · solo en esta copia, en este navegador',
        'panel.header.one': 'Recuerda 1 cosa · solo en esta copia, en este navegador',
      },
    },
  });
  return { cfg, direct: await openStore(cfg), ui };
}

// The client is made for one language (the block and the tool results are written in it). A language switch closes
// it; the next call opens a new one.
export function client() {
  if (!M) return null;
  if (!mem) {
    mem = M.memory.createMemory(M.cfg, { app: APP, lang, direct: M.direct, slowNetwork: /(^|-)(2g|3g)$/.test(navigator.connection?.effectiveType || '') });
    mem.onChange((ev) => { for (const f of changeFns) { try { f(ev); } catch { /* listener */ } } });
  }
  return mem;
}
// The old client is closed only once nothing can still be waiting on it: a call in flight when the language changes
// (a save, a context) finishes on it, while everything after uses the new one (turns and cards ask for client() on
// every call, they never keep a client).
const RETIRE_MS = 30000;
export function setLang(l) {
  if (l === lang) return;
  lang = l;
  if (mem) { const old = mem; mem = null; setTimeout(() => old.close(), RETIRE_MS); }
}
export function onChange(fn) { changeFns.add(fn); return () => changeFns.delete(fn); }

const S = (k, v) => M.text.t(M.cfg.strings, lang, k, v);

async function carryGrant() {
  try { if (localStorage.getItem(CARRIED) === '1') return; } catch { return; }
  let old = [];
  try { old = JSON.parse(localStorage.getItem(OLD_GRANTS) || '[]'); } catch { /* no storage */ }
  if (!Array.isArray(old) || !old.includes('memory')) { try { localStorage.setItem(CARRIED, '1'); } catch { /* — */ } return; }
  const c = client();
  const r = await c.ready();
  if (r.mode === 'off') return;                      // tried again on the next load
  if (!r.grant) { await c.setGrant('granted'); grantHere = 'granted'; }
  try { localStorage.setItem(CARRIED, '1'); } catch { /* — */ }
}

// ---------- The prompt ----------

// The memory lines for the system prompt, in the prompt's language. Stable bytes for a language, no facts.
export function promptPieces(promptLang) {
  if (!M) return null;
  const tools = M.memory.memoryTools(M.cfg, promptLang, { app: APP });
  const lines = Object.values(tools).map((d) => {
    const params = Object.keys(d.params || {}).map((p, i) => (i === 0 && d.name.endsWith('save') ? p : p + '?'));
    return `- ${d.name}(${params.join(', ')}): ${d.desc}`;
  });
  return { tools: lines, rules: M.memory.memoryPromptRules(M.cfg, promptLang), save: M.cfg.tools.prefix + 'save' };
}

// ---------- The sidebar count ----------
export async function count() {
  if (!M) return null;
  const c = client();
  const r = await c.ready();
  if (r.mode === 'off' || r.enabled?.read === false) return null;
  const s = await c.search('', 1, SCOPES);
  return s && s.ok !== false ? s.total || 0 : null;
}

// ---------- A turn ----------
// Called once when a turn starts, with the user's message already in the chat. `messages` are the chat's own records:
// user messages typed in the box carry `typed: true`. Returns null without memory (the turn runs as before).
//
//   block                { text, tokens, facts }: the block for this turn; the same bytes on every step
//   tool(name)           a tool ran: any tool that is not memory taints the turn (fails closed)
//   run(name, args, ui)  runs a memory tool; ui = { ask(card) -> Promise<bool> } shows the grant card before the first save
//   finish()             after the final answer: the facts that were in context, and at most one proposal
// After a turn found the store unreachable, later turns wait at most this long for it before the model starts (the
// connection goes on in the background); offline they do not wait at all.
const DOWN_WAIT_MS = 1500;
let lastDown = false;
const UNAVAILABLE = () => ({ text: '', tokens: 0, facts: [], unavailable: true });

export async function beginTurn({ messages, model, conv, incognito }) {
  const m = await load();
  if (!m) return null;
  // Always the current client: a language switch during the turn replaces it.
  const cur = () => client();
  const c = new Proxy({}, { get: (_, k) => { const x = cur(); const v = x[k]; return typeof v === 'function' ? v.bind(x) : v; } });
  const last = [...messages].reverse().find((x) => x.role === 'user' && x.meta !== 'result');
  const typed = last?.typed === true;
  const query = typed ? last.content : '';
  const typedOnes = messages.filter((x) => x.role === 'user' && x.typed === true);
  const prevQuery = typed && typedOnes.length > 1 ? typedOnes[typedOnes.length - 2].content : '';
  const turn = { evidence: m.memory.typedEvidence(messages.filter((x) => x.meta !== 'result')), tainted: false, conv, incognito, scopes: [...SCOPES], forgetCards: 0 };
  const ask = async () => {
    // A turn with nothing typed (the «fix it» button) has no query: only the core («About you») goes in.
    const r = await c.context({ query, prevQuery, model: model || {}, scopes: [...SCOPES], conv, incognito });
    return { text: r.text || '', tokens: r.tokens || 0, facts: r.facts || [], unavailable: !!r.unavailable };
  };
  const first = async () => {
    if (incognito) return ask();
    if (globalThis.navigator?.onLine === false) { lastDown = true; return UNAVAILABLE(); }
    const p = ask().catch(UNAVAILABLE);
    const r = lastDown ? await Promise.race([p, new Promise((ok) => setTimeout(() => ok(UNAVAILABLE()), DOWN_WAIT_MS))]) : await p;
    lastDown = !!r.unavailable;
    return r;
  };
  let block = await first().catch(UNAVAILABLE);
  // The grant card, answered by the user. `allowed` is true only when the store took it.
  const askGrant = async (ui) => {
    const allowed = await ui.ask({ type: 'grant' });
    grantHere = allowed ? 'granted' : 'denied';
    return allowed;
  };
  const api = {
    turn,
    get block() { return block; },
    tool(name) { if (m.memory.taints(m.cfg, name)) turn.tainted = true; },
    async run(name, args, ui = {}) {
      const op = String(name).slice(m.cfg.tools.prefix.length);
      if (op === 'save' && !incognito) {
        // The grant is asked at the first write, before the store sees the fact.
        // Asked again after an earlier «No»: saying it is the user asking to save.
        const h = await c.ready();
        if (h.mode !== 'off' && (grantHere ?? h.grant) !== 'granted' && ui.ask) {
          if (!(await askGrant(ui))) return { text: S('res.no_grant'), card: null };
        }
      }
      let r = await m.memory.runMemoryTool(c, name, args, turn);
      // The store has no grant for the chat although this page thought it had (revoked in the manager, from another
      // tab): ask again, and save the same fact once allowed, instead of leaving a bare card and an unsaved fact.
      if (op === 'save' && r.card?.type === 'grant') {
        grantHere = null;
        if (ui.ask) {
          if (!(await askGrant(ui))) return { text: S('res.no_grant'), card: null };
          r = await m.memory.runMemoryTool(c, name, args, turn);
        }
      }
      const t = r.card?.type;
      if (t === 'saved' || t === 'updated' || t === 'similar' || t === 'negated') block = await ask().catch(() => block);
      return r;
    },
    async finish({ propose = true, state = {} } = {}) {
      if (!typed || incognito) return { used: null, proposal: null };
      const used = block.facts?.length ? { facts: block.facts } : null;
      let proposal = null;
      if (propose) proposal = await m.memory.maybePropose(c, query, { lang, conv, model, state, incognito }).catch(() => null);
      return { used, proposal };
    },
  };
  return api;
}

// Whether a «Yes» on a proposal would be refused for want of the chat's grant (then the grant card goes first).
export async function needsGrant() {
  if (!M) return false;
  const h = await client().ready();
  return h.mode !== 'off' && (grantHere ?? h.grant) !== 'granted';
}
export function noteGrant(allowed) { grantHere = allowed ? 'granted' : 'denied'; }

// Proposals made in a conversation (the engine caps them per turn and per conversation by the model's tuning). The
// count lives in the chat's own record (`chat.memProposed`), so a reload or a second tab does not start it again:
// `stored` is that record as last saved, read just before, and the higher count wins.
export function proposalState(chat, stored = null) {
  const n = Math.max(chat.memProposed | 0, stored?.memProposed | 0);
  return { proposed: n };
}
export function keepProposalState(chat, state) { chat.memProposed = Math.max(chat.memProposed | 0, state.proposed | 0); }

// Saves queued while the store was down wait for the chat's grant when the chat never had one: the client says so
// (`needGrant`) when it tries them. `ask` shows the grant card; it is asked once per page, and an «Allow» the store
// took sends the queued saves on (the engine's setGrant flushes).
let askingQueued = null;
export function watchQueued(ask) {
  return onChange((ev) => {
    if (!ev || !ev.needGrant || askingQueued || grantHere === 'denied') return;
    askingQueued = Promise.resolve(ask({ type: 'grant' })).then((ok) => { if (ok != null) grantHere = ok ? 'granted' : 'denied'; })
      .catch(() => {}).finally(() => { askingQueued = null; });
  });
}

export const newConv = () => (M ? M.core.newConv() : 'c' + Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => (b % 36).toString(36)).join(''));

// ---------- What the user sees ----------

// A card from the engine (saved, proposal, grant, forget, unavailable...) into `el`. `opts`: onSee, onDone, onGranted.
//   onGranted(ok)  the grant card was answered; ok is true only if the store took the grant (a timeout is not a yes)
//   onSettle(next) what the card now stands for, after a click the engine's onDone does not report: an Undo
//                  ({type:'forgotten'} or a note), or a card the user closed with «No» (null)
// The card always talks to the current client, so a language switch does not leave it on a closed one.
export function card(el, c, opts = {}) {
  if (!M || !c) { el.replaceChildren(); return null; }
  let granted = null;
  const { onGranted, onSettle, ...rest } = opts;
  const settle = (next) => { try { onSettle?.(next); } catch { /* listener */ } };
  const own = {
    async setGrant(state) {
      const r = await client().setGrant(state);
      granted = r && r.ok !== false ? r.grant || null : null;
      if (granted === 'granted' || granted === 'denied') grantHere = granted;
      return r;
    },
    async forget(id) {
      const r = await client().forget(id);
      if (r?.pending) settle({ type: 'forgotten', id });
      return r;
    },
    async restore(id) {
      const r = await client().restore(id);
      if (r && r.ok !== false) settle({ type: 'note', text: S('act.undo') + ' ✓' });
      return r;
    },
  };
  const mem = new Proxy({}, {
    get: (_, k) => {
      if (Object.hasOwn(own, k)) return own[k];
      const x = client(); const v = x[k];
      return typeof v === 'function' ? v.bind(x) : v;
    },
  });
  if (onSettle && !el.__memSettle) {
    // A click that leaves the card empty closed it (the engine's «No» on a choice between similar facts).
    el.__memSettle = true;
    el.addEventListener('click', (e) => {
      if (!e.target.closest?.('button')) return;
      setTimeout(() => { if (!el.childNodes.length) el.__memOnSettle?.(null); }, 0);
    });
  }
  el.__memOnSettle = onSettle ? settle : null;
  const o = { lang, scheme: SCHEME, ...rest };
  if (onGranted) o.onGranted = (ok) => onGranted(!!ok && granted === 'granted');
  return M.cards.renderCard(el, c, mem, o);
}
// A card that only shows what happened, with no buttons: what a reloaded chat paints for a settled card.
export function settledCard(el, c) {
  if (!M || !c) { el.replaceChildren(); return null; }
  const line = settledLine(c);
  if (!line) { el.replaceChildren(); return null; }
  return M.cards.renderCard(el, { type: 'note', text: line }, client(), { lang, scheme: SCHEME });
}
function settledLine(c) {
  switch (c.type) {
    case 'saved': return S('card.saved', { fact: c.fact });
    case 'similar': return S('card.similar', { prev: c.prev });
    case 'duplicate': return S('card.duplicate', { fact: c.fact });
    case 'updated': return S('card.updated', { prev: c.prev });
    case 'negated': return S('card.negated', { fact: c.fact });
    case 'forgotten': return S('card.forgotten');
    case 'queued': return S('card.queued', { n: c.n });
    case 'unavailable': return S('card.unavailable');
    case 'error': case 'note': return c.text;
    default: return null;
  }
}
export function used(el, u) {
  if (!M) return null;
  return M.cards.renderUsed(el, u, { cfg: M.cfg, lang, scheme: SCHEME });
}
export function composerToggle(el, { checked, onChange: f }) {
  if (!M) { el.replaceChildren(); return null; }
  return M.cards.renderComposerToggle(el, { cfg: M.cfg, lang, checked, onChange: f });
}
// The panel: the store page in a visible frame. Edits, pins and forgets happen there, by the user's own clicks.
export function panelFrame(el, { height } = {}) {
  if (!M) return null;
  if (M.direct) {                         // the copy: the same panel, in the page, on the in-page store
    el.replaceChildren();
    const box = el.ownerDocument.createElement('div');
    box.style.cssText = `max-height:${height || '32rem'};overflow:auto`;
    el.append(box);
    return M.ui.mountPanel(box, M.direct, { cfg: M.cfg, lang, scheme: SCHEME });
  }
  return M.cards.mountPanelFrame(el, client(), { lang, scheme: SCHEME, height });
}
export const frameTitle = () => (M ? S('frameTitle') : '');

// ---------- A deleted conversation ----------
export async function learntIn(conv) {
  if (!M || !conv) return null;
  const r = await client().byConversation(conv);
  return r && r.ok !== false ? { count: r.count || 0, items: (r.items || []).map((x) => x.fact) } : null;
}
export async function forgetLearntIn(conv) {
  if (!M || !conv) return null;
  return client().forgetConversation(conv);
}
