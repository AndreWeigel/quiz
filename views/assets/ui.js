// UI pieces both play pages share (play.html, live.html): the words, flap
// tiles, answer widgets, the reveal flourishes and the final board. Untrusted
// text (questions, options, names) only ever goes in via textContent.
export const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// Same words in every theme: a theme changes the look, not the language.
const WORDS = { lock: 'Lock in', next: 'Next round', results: 'See results', join: 'Join', play: 'Play',
  perfect: 'Perfect', close: 'Close', wrong: 'Not quite', final: 'Final', bye: 'Final scoreboard', allin: 'Everyone’s in!',
  hint: { location: 'Tap the map', text: 'Type it', choice: 'Pick one', number: 'Best guess' } };
let theme = 'gameshow';
export const w = () => WORDS;
export function applyTheme(t) {
  theme = ['gameshow', 'railway'].includes(t) ? t : 'gameshow';
  document.documentElement.dataset.theme = theme;
}

// 100 → perfect, a decent near-miss → close, the rest → wrong.
export const verdictOf = (points) => (points >= 100 ? 'perfect' : points >= 40 ? 'close' : 'wrong');
export function verdictChip(points) {
  const v = verdictOf(points);
  return el('span', `verdict ${v}`, WORDS[v]);
}

// Split-flap tiles; `flip` animates them in one after another.
export function flaps(text, flip = false) {
  const box = el('span', 'flaps' + (flip ? ' flip' : ''));
  let i = 0;
  for (const word of String(text).toUpperCase().split(/\s+/).filter(Boolean)) { // wrap only between words
    const wd = el('span', 'wd');
    for (const c of word) {
      const s = el('span', null, c);
      if (flip) s.style.animationDelay = `${i++ * 35}ms`;
      wd.appendChild(s);
    }
    box.appendChild(wd);
  }
  box.setAttribute('aria-label', text);
  return box;
}

export function countUp(node, to, prefix = '+') {
  if (RM || to <= 0) { node.textContent = `${prefix}${to}`; return; }
  const t0 = performance.now(), dur = 700;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    node.textContent = `${prefix}${Math.round(to * (1 - (1 - k) ** 3))}`;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function confetti() {
  if (RM || theme !== 'gameshow') return;
  const box = el('div', 'confetti');
  const colors = ['#ffb020', '#ffd15c', '#22d3ee', '#c026d3', '#2563eb', '#14b8a6'];
  for (let i = 0; i < 36; i++) {
    const p = el('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
    p.style.setProperty('--rot', `${(Math.random() - 0.5) * 900}deg`);
    p.style.animationDelay = `${Math.random() * 0.25}s`;
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 1900);
}

// The player's pin: drops in with a bounce and keeps a pulse ring (anchor: bottom).
export function pinElement() {
  const d = el('div', 'drop');
  d.innerHTML = '<svg viewBox="0 0 44 58" width="44" height="58" aria-hidden="true">'
    + '<path d="M22 2C11 2 3 10.4 3 21c0 14 19 34 19 34s19-20 19-34C41 10.4 33 2 22 2z" fill="#ffb020" stroke="#1a1205" stroke-width="2"/>'
    + '<circle cx="22" cy="21" r="7" fill="#1a1205"/></svg>';
  return d;
}

const TICK = '<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';
const LETTERS = 'ABCDEF';

// "57,5" → 57.5, "9,289" / "9 289" → 9289; null if it isn't a number.
export const parseNum = (raw) => {
  let v = raw.replace(/[\s'_]/g, '');
  v = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(v) ? v.replace(/,/g, '') : v.replace(',', '.');
  return v && Number.isFinite(Number(v)) ? Number(v) : null;
};
export const fmtNum = (n) => n.toLocaleString('en', { maximumFractionDigits: 3 });

// Fill `box` with the round's answer widget. onChange(value|null) on every
// change, onEnter() on Enter in a text field. readOnly: the host's view.
export function answerWidget(box, round, { onChange = () => {}, onEnter = () => {}, readOnly = false } = {}) {
  box.replaceChildren();
  box.className = round.type;
  box.classList.remove('picked');
  if (round.type === 'choice') {
    round.options.forEach((o, i) => {
      const b = el('button', `opt c${i % 6}`);
      b.type = 'button'; b.disabled = readOnly;
      b.append(el('span', 'k', theme === 'railway' ? String(i + 1) : LETTERS[i]), el('span', 'lbl', o));
      b.insertAdjacentHTML('beforeend', TICK);
      b.onclick = () => {
        for (const x of box.children) x.classList.toggle('sel', x === b);
        box.classList.add('picked');
        onChange(i);
      };
      box.appendChild(b);
    });
    return;
  }
  if (readOnly) return;
  const f = el('label', 'field'), inp = el('input');
  inp.autocomplete = 'off';
  inp.placeholder = round.type === 'number' ? 'Your estimate' : 'Type your answer';
  if (round.type === 'number') inp.inputMode = 'decimal'; else inp.maxLength = 100;
  inp.setAttribute('aria-label', inp.placeholder);
  inp.oninput = () => onChange(round.type === 'number' ? parseNum(inp.value) : (inp.value.trim() || null));
  inp.onkeydown = (e) => { if (e.key === 'Enter') onEnter(); };
  f.appendChild(inp);
  if (round.unit) f.appendChild(el('span', 'unit', round.unit));
  box.appendChild(f);
  setTimeout(() => inp.focus({ preventScroll: true }), 50);
}

// Round counter + progress segments in the top bar.
export function hud(rnoBox, barBox, ordIdx, count) {
  rnoBox.replaceChildren(ordIdx == null ? '' : flaps(`${String(ordIdx + 1).padStart(2, '0')}/${String(count).padStart(2, '0')}`));
  barBox.replaceChildren(...Array.from({ length: ordIdx == null ? 0 : count },
    (_, i) => el('i', i < ordIdx ? 'done' : i === ordIdx ? 'now' : '')));
}

// Globe as backdrop: dimmed + drifting on non-location rounds, sharp otherwise.
let spin = 0;
export function stage(map, on) {
  document.body.classList.toggle('stage', on);
  document.body.classList.toggle('loc', !on);
  cancelAnimationFrame(spin);
  if (!on || RM) return;
  let last = performance.now();
  const tick = (t) => {
    // Never during a camera move (the ease out of the last reveal, a drag): jumpTo would cancel it mid-zoom.
    if (map.isMoving()) last = t;
    else if (t - last > 80) { // ~12 redraws a second: smooth enough under the blur, a fifth of the GPU work on phones
      const c = map.getCenter();
      map.jumpTo({ center: [c.lng + (t - last) * 0.004, c.lat] }); // ~4°/s
      last = t;
    }
    spin = requestAnimationFrame(tick);
  };
  spin = requestAnimationFrame(tick);
}

// Final board: podium + list (game show) or an arrivals board (railway).
// rows: [{ name, total, me }] sorted best first.
export function finalBoard(box, rows) {
  box.replaceChildren();
  if (theme === 'gameshow' && rows.length >= 2) {
    const pod = el('div', 'podium');
    for (const i of [1, 0, 2]) {
      const r = rows[i];
      const p = el('div', `p p${i + 1}`);
      if (r) p.append(el('span', 'nm', r.name), el('span', 'sc', `${r.total}`), el('div', 'blk', String(i + 1)));
      pod.appendChild(p);
    }
    box.appendChild(pod);
  }
  const table = el('table', 'board');
  const from = theme === 'gameshow' && rows.length >= 2 ? 3 : 0;
  rows.slice(from).forEach((r, j) => {
    const i = from + j, tr = el('tr', r.me ? 'me' : '');
    tr.appendChild(el('td', 'r', `${i + 1}`));
    tr.appendChild(el('td', null, r.name));
    tr.appendChild(el('td', 's', `${r.total}`));
    table.appendChild(tr);
  });
  if (table.children.length) box.appendChild(table);
}
