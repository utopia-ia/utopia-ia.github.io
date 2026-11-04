// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The chat's web tools, as Claw's (web/js/tools/web.js): web.search asks DuckDuckGo and web.fetch reads one page.
// The browser cannot read other sites directly (CORS), so both go through the shared Elffuss proxy at /proxy on this
// same origin, the one Claw and Code use. This is the only thing the chat sends off the device: the search words, or
// the address of the page, and the card in the thread says which.

const MAX = 8000;                    // characters of a page handed back to the model
const BLOCKED = /anomaly|unusual traffic|are you a human|bots use duckduckgo/i;

const words = (es) => es ? {
  noQuery: 'Falta qué buscar',
  badUrl: 'La dirección tiene que empezar por http:// o https://',
  failed: (q) => `No se pudo buscar «${q}». Vuelve a intentarlo en un momento.`,
  blocked: (q) => `DuckDuckGo no ha dejado buscar «${q}» ahora mismo. Vuelve a intentarlo en un momento.`,
  none: (q) => `Sin resultados para «${q}».`,
  results: (q) => `Resultados de la web para «${q}»:`,
  site: (h, s) => `${h} respondió con el código ${s}.`,
  cut: '[… cortado]',
} : {
  noQuery: 'Missing what to search for',
  badUrl: 'The address must start with http:// or https://',
  failed: (q) => `Could not search for “${q}”. Try again in a moment.`,
  blocked: (q) => `DuckDuckGo would not search for “${q}” right now. Try again in a moment.`,
  none: (q) => `No results for “${q}”.`,
  results: (q) => `Web results for “${q}”:`,
  site: (h, s) => `${h} answered with code ${s}.`,
  cut: '[… cut]',
};

const host = (url) => { try { return new URL(url).host; } catch { return url; } };

async function get(url, signal) {
  const r = await fetch('/proxy?url=' + encodeURIComponent(url), { signal });
  const upstream = Number(r.headers.get('X-Proxy-Upstream-Status')) || r.status;
  return { ok: r.ok, status: upstream, text: r.ok ? await r.text() : '' };
}

function toText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,svg,iframe').forEach((n) => n.remove());
  return (doc.body?.innerText || doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

// Returns { text: what the model reads, items: [{ title, url }] for the card }.
export async function search(query, { es, signal } = {}) {
  const w = words(es);
  query = String(query || '').trim();
  if (!query) throw new Error(w.noQuery);
  let html = '', blocked = false, lastError = null;
  for (const ep of ['https://html.duckduckgo.com/html/?q=', 'https://lite.duckduckgo.com/lite/?q=']) {
    try {
      const r = await get(ep + encodeURIComponent(query), signal);
      if (!r.text.includes('uddg=') && (r.status === 202 || BLOCKED.test(r.text))) { blocked = true; continue; }
      if (r.text.includes('uddg=')) { html = r.text; break; }
    } catch (e) {
      if (signal?.aborted) throw e;
      lastError = e;
    }
  }
  if (!html) throw new Error(blocked ? w.blocked(query) : (lastError ? w.failed(query) : w.none(query)));
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const seen = new Set(), items = [], lines = [];
  for (const a of doc.querySelectorAll('a[href*="uddg="]')) {
    const m = a.getAttribute('href').match(/uddg=([^&]+)/);
    if (!m) continue;
    const url = decodeURIComponent(m[1]);
    const title = a.textContent.trim();
    if (!title || title.length < 3 || seen.has(url) || !/^https?:/.test(url)) continue;
    seen.add(url);
    const block = a.closest('tr, div, article') || a.parentElement;
    // In the lite page the snippet is the next row of the table, not the link's own block.
    const row = a.closest('tr');
    const snipFrom = row?.nextElementSibling?.textContent || block?.textContent || '';
    const snip = snipFrom.replace(title, '').replace(/\s+/g, ' ').trim().slice(0, 200);
    items.push({ title, url });
    lines.push(`• ${title}\n  ${url}${snip ? '\n  ' + snip : ''}`);
    if (items.length >= 8) break;
  }
  if (!items.length) return { text: w.none(query), items };
  return { text: w.results(query) + '\n\n' + lines.join('\n\n'), items };
}

export async function fetchPage(url, { es, signal } = {}) {
  const w = words(es);
  url = String(url || '').trim();
  if (!/^https?:\/\//.test(url)) throw new Error(w.badUrl);
  const r = await get(url, signal);
  if (!r.ok) throw new Error(w.site(host(url), r.status));
  const text = toText(r.text) || r.text.slice(0, MAX);
  return { text: `[${url}]\n` + (text.length > MAX ? text.slice(0, MAX) + '\n' + w.cut : text), title: host(url) };
}
