// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The chat's web tools, on the shared research module (web-research.js, the same file Claw and Code copy):
//
//   web.search(query)      Elffuss's own search (/websearch, a SearXNG on this origin that asks several engines;
//                          site: passes through), DuckDuckGo lite through the proxy when it fails, says 429 or
//                          finds nothing; and the first two results read by themselves: the model gets the links,
//                          the snippets and the passages that answer
//   web.fetch(url)         one page, as its passages most relevant to what the user asked
//   web.site(url, query)   a search INSIDE one site: its own search, its sitemap, DuckDuckGo site:, a short crawl
//
// The browser cannot read other sites directly (CORS), so every request goes through the shared Elffuss proxy at
// /proxy on this same origin, the one Claw and Code use. Those requests are the only thing the chat sends off the
// device: the search words and the addresses read, and the card in the thread lists every one of them (`sent`).
// What the user asked never leaves: it only ranks, here, the passages of the pages that came back.
import { terms, buildBM25 } from './js/acer-core.js';
import { createResearch, decodeBody, parseSearx, WORDS, renderSearch, renderPage, renderSite } from './web-research.js';

const TIMEOUT_MS = 25000;   // per request; the proxy gives up on its own after 30 s

let Readability = null;
const readability = () => (Readability ??= import('./vendor/readability.js').then((m) => m.default, () => null));

// A Document whose relative links resolve against the page's address, not elffuss.com.
export function parseWithBase(html, url) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  if (!doc.querySelector('base[href]') && doc.head) {
    const b = doc.createElement('base');
    b.setAttribute('href', url);
    doc.head.prepend(b);
  }
  return doc;
}

// One GET through the proxy. The body is read as bytes and decoded with the page's own charset. The proxy says in
// headers what happened: X-Proxy-Error (it did not fetch it: destination, limits, TLS, DNS…), X-Proxy-Upstream-Status
// (the site's own status), X-Proxy-Truncated (cut at its 2 MB) and, with the patch in _propuestas, X-Proxy-Final-Url
// (where the redirects ended, so relative links resolve right).
async function get(url, { signal } = {}) {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, TIMEOUT_MS);
  try {
    const r = await fetch('/proxy?url=' + encodeURIComponent(url), { signal: ctl.signal });
    const code = r.headers.get('X-Proxy-Error') || '';
    const type = r.headers.get('Content-Type') || '';
    const upstream = Number(r.headers.get('X-Proxy-Upstream-Status')) || 0;
    const bytes = await r.arrayBuffer();
    return {
      ok: r.ok && !code, status: code ? r.status : (upstream || r.status), code, type,
      url: r.headers.get('X-Proxy-Final-Url') || url,
      text: code ? '' : decodeBody(bytes, type),
      truncated: r.headers.get('X-Proxy-Truncated') === '1',
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

// /websearch: same origin, so no proxy hop. nginx answers 429 past 30 a minute per visitor; anything but a JSON
// answer counts as a failure and the module falls back to DuckDuckGo.
let searchLang = 'es';
const websearchUrl = (q) => `/websearch?q=${encodeURIComponent(q)}&format=json&language=${searchLang}`;
const searchEngine = {
  url: (q) => new URL(websearchUrl(q), location.origin).href,
  async run(q, { signal } = {}) {
    const ctl = new AbortController();
    const stop = () => ctl.abort();
    signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, TIMEOUT_MS);
    try {
      const r = await fetch(websearchUrl(q), { signal: ctl.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) throw Object.assign(new Error('websearch ' + r.status), { code: r.status === 429 ? 'rate-limited' : 'down', status: r.status });
      if (!/json/i.test(r.headers.get('Content-Type') || '')) throw Object.assign(new Error('websearch not json'), { code: 'down' });
      return parseSearx(await r.text());
    } catch (e) {
      if (signal?.aborted) throw e;
      if (e.code) throw e;
      throw Object.assign(new Error(String(e?.message || e)), { code: ctl.signal.aborted ? 'timeout' : 'down' });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    }
  },
};

let research = null;
async function lab(es) {
  searchLang = es ? 'es' : 'en';
  if (research) return research;
  research = createResearch({ get, parseHTML: parseWithBase, terms, buildBM25, Readability: await readability(), searchEngine });
  return research;
}

const cap = (text, n, w) => (text.length > n ? text.slice(0, n) + '\n' + w.cut : text);
const words = (es) => WORDS[es ? 'es' : 'en'];
const errors = (es) => es
  ? { noQuery: 'Falta qué buscar', badUrl: 'La dirección tiene que empezar por http:// o https://', noSite: 'Falta la web en la que buscar' }
  : { noQuery: 'Missing what to search for', badUrl: 'The address must start with http:// or https://', noSite: 'Missing the site to search in' };

// Each returns { text: what the model reads, items: [{ title, url }] for the card, sent: every address requested }.
export async function search(query, { es, signal, question = '', read = 2 } = {}) {
  const e = errors(es), w = words(es);
  query = String(query || '').trim();
  if (!query) throw new Error(e.noQuery);
  const r = await (await lab(es)).search(query, { question, read, signal });
  if (!r.items.length && r.blocked) throw new Error(w.blocked(query));
  const L = research.limits;
  return { text: cap(renderSearch(r, w), L.searchChars + 1200, w), items: r.items, sent: r.sent, via: r.via, read: [...new Set(r.passages.map((p) => p.url))] };
}

export async function fetchPage(url, { es, signal, question = '' } = {}) {
  const e = errors(es), w = words(es);
  url = String(url || '').trim();
  if (!/^https?:\/\//.test(url)) throw new Error(e.badUrl);
  const r = await (await lab(es)).fetch(url, { question, signal });
  if (r.error) throw new Error(renderPage(r, w, question));
  return { text: cap(renderPage(r, w, question), research.limits.fetchChars + 600, w), title: r.title || hostOf(url), sent: r.sent };
}

export async function siteSearch(site, query, { es, signal, question = '' } = {}) {
  const e = errors(es), w = words(es);
  site = String(site || '').trim();
  query = String(query || '').trim();
  if (!site) throw new Error(e.noSite);
  if (!query) throw new Error(e.noQuery);
  const r = await (await lab(es)).site(site, query, { question, signal });
  if (r.error?.code === 'bad-url') throw new Error(e.badUrl);
  return { text: cap(renderSite(r, w), research.limits.siteChars + 900, w), items: r.items || [], sent: r.sent, via: r.via || '', site: r.site || site };
}

const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };
