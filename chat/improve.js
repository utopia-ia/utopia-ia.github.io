// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// elffuss.improve: «cámbiate», «ponte en verde», «personaliza Elffuss». The chat does not change itself: it hands the
// request to the app that builds «tu versión» (a theme, as data: theme.js), and asks once which one fits:
//   · «¿Programas?» No → Claw, opened inside the chat's apps panel at #/mejora?pide=<the request>;
//   · Yes → Code, at the same address in a tab (Code is never framed: appview.js); with CODE_READY off, Claw too, with a
//     line that Code comes soon.
// The answer is kept in this browser; from then on the card goes straight to «Abrir Claw» (or Code), with a way to
// change it. The app always opens from a click: opened from a running turn, without the user's activation, its
// history entry is one the browser skips, and «back» would not return to the chat. The request travels in the hash
// (never to a server, never to a log) and is the user's own words of that turn; the model never runs this tool. The
// app shows the request and does nothing until the user presses «Empezar».
//
// The words of the card are this file's own (not chat.js's dictionary), so a theme cannot relabel them.

// Code at code.elffuss.com takes #/mejora since its build a8bf00f. Off, both answers go to Claw and «Sí» says Code comes
// soon: the switch for a Code that is down.
export const CODE_READY = true;
const CLAW = 'https://claw.elffuss.com';
const CODE = 'https://code.elffuss.com';
const PREF = 'elffuss.improve.codes';      // 'yes' | 'no'
const MAX_PIDE = 500;

const lang = () => (document.documentElement.lang === 'es' ? 'es' : 'en');
const WORDS = {
  en: {
    kicker: 'Change Elffuss', ask: 'Do you write code?', yes: 'Yes', no: 'No',
    why: 'Claw makes the change with you in plain words; Code shows you every line.',
    claw: 'Your version is made in Claw, here beside the chat.', code: 'Your version is made in Code, in a tab.',
    openClaw: 'Open Claw', openCode: 'Open Code', other: (code) => (code ? 'I do not write code' : 'I write code'),
    soon: 'The version for programmers (Code) is coming soon; meanwhile we do it in Claw.',
  },
  es: {
    kicker: 'Cambiar Elffuss', ask: '¿Programas?', yes: 'Sí', no: 'No',
    why: 'Claw lo hace contigo en palabras sencillas; Code te enseña cada línea.',
    claw: 'Tu versión se hace en Claw, aquí al lado del chat.', code: 'Tu versión se hace en Code, en una pestaña.',
    openClaw: 'Abrir Claw', openCode: 'Abrir Code', other: (code) => (code ? 'No programo' : 'Sí programo'),
    soon: 'La versión para programadores (Code) llega pronto; mientras, lo hacemos en Claw.',
  },
};
const w = () => WORDS[lang()];

export const codes = () => { try { const v = localStorage.getItem(PREF); return v === 'yes' ? true : v === 'no' ? false : null; } catch { return null; } };
const keep = (yes) => { try { localStorage.setItem(PREF, yes ? 'yes' : 'no'); } catch { /* private mode */ } };

// The request as it goes in the address: the user's words, one line, capped.
export const request = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_PIDE);
// Where an answer leads: Code only once it is on line.
const targetFor = (codes) => (codes && CODE_READY ? 'code' : 'claw');
export const improveUrl = (target, pide) => `${target === 'code' ? CODE : CLAW}/#/mejora?pide=${encodeURIComponent(request(pide))}`;

// The tool. `ctx.allowed`: a turn whose words asked to change Elffuss, run by the chat (chat.js). Returns the chat's
// tool result.
export function run(ctx) {
  const es = lang() === 'es';
  if (!ctx.allowed) {
    const msg = es ? 'Esta herramienta solo se usa cuando el usuario pide cambiar Elffuss, y como primer paso.' : 'This tool is only for when the user asks to change Elffuss, as the first step.';
    return { text: 'ERROR: ' + msg, result: { error: msg } };
  }
  const pide = request(ctx.userText);
  const pref = codes();
  const target = pref === null ? null : targetFor(pref);
  const text = target === null
    ? (es ? 'La tarjeta pregunta al usuario si programa para abrir Claw o Code con su petición. No escribas nada más.' : 'The card asks the user whether they code, to open Claw or Code with the request. Write nothing else.')
    : (es ? `La tarjeta ofrece abrir ${target === 'code' ? 'Code' : 'Claw'} con la petición, que la enseña y espera a que el usuario empiece.` : `The card offers to open ${target === 'code' ? 'Code' : 'Claw'} with the request, which shows it and waits for the user to start.`);
  return { text, result: { pide, target, ...(pref === null ? {} : { codes: pref }) }, end: true };
}

// The card in the conversation, painted from what is stored with the message: { pide, target, codes }.
// `onChoose(target, codes)` keeps the choice in the message.
export function paint(card, body, m, { open, onChoose }) {
  const r = m.result || {};
  card.classList.add('card-improve');
  const words = w();
  // The decision is the title; the request, already in the bubble above, is a quoted line under it.
  const kicker = document.createElement('span'); kicker.className = 'tc-kicker'; kicker.textContent = words.kicker;
  const title = document.createElement('b'); title.className = 'tc-title';
  const pide = document.createElement('span'); pide.className = 'tc-line improve-pide'; pide.textContent = `«${r.pide || ''}»`;
  body.append(kicker, title, pide);
  card.append(body);
  const acts = document.createElement('div'); acts.className = 'tc-actions';
  const choose = (codes, e) => {
    if (e && !e.isTrusted) return;
    keep(codes);
    const target = targetFor(codes);
    onChoose(target, codes);
    go(target);
  };
  // Claw opens beside the chat; Code in a tab, from the click itself (a window opened later would be blocked).
  const go = (target) => {
    const url = improveUrl(target, r.pide || '');
    if (target === 'claw') open(url); else window.open(url, '_blank', 'noopener');
  };
  if (!r.target) {
    title.textContent = words.ask;
    const why = document.createElement('span'); why.className = 'tc-line improve-why'; why.textContent = words.why;
    body.append(why);
    for (const [label, codes] of [[words.yes, true], [words.no, false]]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'mini-btn improve-chip'; b.dataset.improve = codes ? 'code' : 'claw'; b.textContent = label;
      b.addEventListener('click', (e) => choose(codes, e));
      acts.append(b);
    }
  } else {
    title.textContent = r.target === 'code' ? words.code : words.claw;
    if (r.codes && r.target !== 'code') { const soon = document.createElement('span'); soon.className = 'tc-line improve-soon'; soon.textContent = words.soon; body.append(soon); }
    const openBtn = document.createElement('a');
    openBtn.className = 'btn tc-open improve-open';
    openBtn.href = improveUrl(r.target, r.pide || '');
    openBtn.textContent = r.target === 'code' ? words.openCode : words.openClaw;
    if (r.target === 'code') { openBtn.target = '_blank'; openBtn.rel = 'noopener'; openBtn.dataset.outside = ''; }
    else openBtn.addEventListener('click', (e) => { e.preventDefault(); if (e.isTrusted) open(openBtn.href); });
    const other = document.createElement('button');
    const codes = r.codes ?? r.target === 'code';
    other.type = 'button'; other.className = 'mini-btn improve-other'; other.textContent = words.other(codes);
    other.addEventListener('click', (e) => choose(!codes, e));
    acts.append(openBtn, other);
  }
  card.append(acts);
}
