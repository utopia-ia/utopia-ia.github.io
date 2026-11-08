// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The message box's history, as in a terminal: ↑ brings back the last message sent, ↑ again the one before, ↓ goes
// forward and, past the newest, back to the draft that was being written; Escape goes back to the draft at once.
//
//   · ↑ acts only with the caret on the box's first line (an empty box is one), ↓ only on its last line and only
//     while going through the history: inside a message of several lines the arrows move the caret as always, and
//     Shift+Enter keeps making new lines
//   · never during an IME composition, with a modifier key, or while `skip()` says so (the voice conversation, a
//     voice note being recorded)
//   · the history is what the visitor sent: this chat's messages first, newest first, then those of the other chats
//     kept in this browser, most recent chat first; no tool results, no repeats, at most LIMIT
//   · typing in a message brought back makes it the draft (the history is left)
//   · a phone has no arrow keys: nothing here shows or changes there
//
// It only reads the chats (`chats()`, `current()`); nothing is stored apart from them.
const LIMIT = 200;

const sentBy = (m) => m?.role === 'user' && m.meta !== 'result' && typeof m.content === 'string' && m.content.trim() && !/^\[result /.test(m.content);

/** The messages sent, newest first: `current` (a chat) first, then `others` (chats, most recent first). */
export function historyOf(current, others = []) {
  const out = [], seen = new Set();
  const add = (c) => {
    for (const m of [...(c?.messages || [])].reverse()) {
      if (!sentBy(m)) continue;
      const text = m.content.trim();
      if (seen.has(text)) continue;
      seen.add(text); out.push(text);
      if (out.length >= LIMIT) return true;
    }
    return false;
  };
  if (add(current)) return out;
  for (const c of others) if (c && c.id !== current?.id && add(c)) break;
  return out;
}

const onFirstLine = (el) => el.selectionStart === el.selectionEnd && !el.value.slice(0, el.selectionStart).includes('\n');
const onLastLine = (el) => el.selectionStart === el.selectionEnd && !el.value.slice(el.selectionEnd).includes('\n');

/**
 * @param {HTMLTextAreaElement} input
 * @param {{ chats: () => Promise<object[]>, current: () => object|null, skip?: () => boolean, onSet?: (text: string) => void }} o
 */
export function inputHistory(input, { chats, current, skip = () => false, onSet = () => {} }) {
  let list = [];        // the history, newest first
  let at = -1;          // -1: the draft; 0…: list[at] is in the box
  let draft = '';
  let setting = false;

  async function refresh() {
    let all = [];
    try { all = await chats(); } catch { /* the store is down: this chat only */ }
    list = historyOf(current(), all);
  }
  const put = (text, caretAtEnd = true) => {
    setting = true;
    input.value = text;
    const n = caretAtEnd ? text.length : 0;
    input.setSelectionRange(n, n);
    setting = false;
    onSet(text);
  };

  // Read when the box gets the focus (the open chat may have changed), and once now (it may have it already).
  input.addEventListener('focus', () => { refresh(); });
  refresh();
  input.addEventListener('input', () => { if (!setting) at = -1; });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229 || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || skip()) return;
    if (e.key === 'ArrowUp') {
      if (!onFirstLine(input) || at + 1 >= list.length) return;
      e.preventDefault();
      if (at === -1) draft = input.value;
      at += 1;
      put(list[at]);
    } else if (e.key === 'ArrowDown') {
      if (at < 0 || !onLastLine(input)) return;
      e.preventDefault();
      at -= 1;
      put(at < 0 ? draft : list[at]);
    } else if (e.key === 'Escape') {
      if (at < 0) return;
      e.preventDefault();
      at = -1;
      put(draft);
    }
  });
  return {
    /** A message was sent: it heads the history, which starts again from there with an empty draft. */
    sent(text) {
      at = -1; draft = '';
      const t = String(text || '').trim();
      if (t) list = [t, ...list.filter((x) => x !== t)].slice(0, LIMIT);
    },
    refresh,
  };
}
