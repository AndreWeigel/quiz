// UI pieces both play pages share (play.html, live.html): the words, flap
// tiles, answer widgets, the reveal flourishes and the final board. Untrusted
// text (questions, options, names) only ever goes in via textContent.
export const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

// The question card's height as --toph, so the reveal sheet can take exactly the room below it.
const topCard = document.querySelector('.top');
if (topCard) new ResizeObserver(() => document.documentElement.style.setProperty('--toph', `${topCard.offsetHeight}px`)).observe(topCard);

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

// A perfect answer: a quick game-show burst. The finale (`big`): a long shower in either theme.
export function confetti(n = 36, big = false) {
  if (RM || (theme !== 'gameshow' && !big)) return;
  const box = el('div', 'confetti');
  const colors = theme === 'railway' ? ['#ffb020', '#f3ead7', '#1d4ed8', '#4ade80', '#ffffff']
    : ['#ffb020', '#ffd15c', '#22d3ee', '#c026d3', '#2563eb', '#14b8a6'];
  for (let i = 0; i < n; i++) {
    const p = el('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * (big ? 300 : 160)}px`);
    p.style.setProperty('--rot', `${(Math.random() - 0.5) * 900}deg`);
    p.style.animationDelay = `${Math.random() * (big ? 0.8 : 0.25)}s`;
    if (big) p.style.animationDuration = `${1.8 + Math.random() * 1.4}s`;
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), big ? 4200 : 1900);
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
  if (round.type === 'label') return labelWidget(box, round, onChange, readOnly);
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

// The picture with its boxes, positioned in % so they track the image at any size.
function zoneBoard(image) {
  const wrap = el('div', 'lwrap'), img = el('img');
  img.src = `/uploads/${image}`; img.alt = 'Picture to label'; img.draggable = false;
  wrap.appendChild(img);
  return wrap;
}
function zoneBox(wrap, z, cls) {
  const d = el('div', cls);
  Object.assign(d.style, { left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` });
  return wrap.appendChild(d);
}

// Label the image: drag a name onto a box, or tap a name then a box. Tap (or drag off) a
// placed name to take it back; dropping on a filled box swaps. onChange(names per box | null).
function labelWidget(box, round, onChange, readOnly) {
  const n = round.zones.length, placed = Array(n).fill(null);
  const wrap = zoneBoard(round.image), tray = el('div', 'tray');
  const zones = round.zones.map((z, i) => {
    const d = zoneBox(wrap, z, 'zone');
    d.tabIndex = readOnly ? -1 : 0; d.setAttribute('role', 'button'); d.setAttribute('aria-label', `Spot ${i + 1}`);
    return d;
  });
  const chips = new Map(round.labels.map((l) => {
    const c = el('button', 'chip', l);
    c.type = 'button'; c.disabled = readOnly;
    return [l, c];
  }));
  box.append(wrap, tray);
  let held = null;
  const draw = () => {
    tray.replaceChildren(...round.labels.filter((l) => !placed.includes(l)).map((l) => chips.get(l)));
    zones.forEach((d, i) => { d.replaceChildren(...(placed[i] ? [chips.get(placed[i])] : [])); d.classList.toggle('filled', !!placed[i]); });
    for (const [l, c] of chips) c.classList.toggle('held', l === held);
    box.classList.toggle('holding', !!held);
    onChange(placed.some(Boolean) ? [...placed] : null);
  };
  // Move `label` to box `zi` (null: back to the tray). A name already there swaps into the old spot.
  const put = (label, zi) => {
    const from = placed.indexOf(label);
    if (zi != null) { if (from !== -1) placed[from] = placed[zi]; placed[zi] = label; }
    else if (from !== -1) placed[from] = null;
    held = null;
    draw();
  };
  // The box under (or within 28 px of) a point — small boxes are hard to hit with a thumb.
  const zoneAt = (x, y) => {
    let best = null, bd = 28;
    zones.forEach((d, i) => {
      const r = d.getBoundingClientRect();
      const dist = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      if (dist < bd) { bd = dist; best = i; }
    });
    return best;
  };
  const tap = (label) => {
    const at = placed.indexOf(label);
    if (held && held !== label && at !== -1) return put(held, at); // holding a name, tapped a placed one: take its spot
    if (at !== -1) return put(label, null);
    held = held === label ? null : label;
    draw();
  };
  draw();
  if (readOnly) return;
  zones.forEach((d, i) => {
    d.onclick = (e) => { if (held && !e.target.closest('.chip')) put(held, i); };
    d.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && held) { e.preventDefault(); put(held, i); } };
  });
  for (const [label, c] of chips) {
    c.onclick = (e) => { if (e.detail === 0) tap(label); }; // keyboard; pointer taps are handled below
    c.onpointerdown = (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      let ghost = null;
      c.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        if (!ghost) { ghost = document.body.appendChild(el('div', 'chip ghost', label)); c.classList.add('dragging'); }
        ghost.style.left = `${ev.clientX}px`; ghost.style.top = `${ev.clientY}px`;
        const over = zoneAt(ev.clientX, ev.clientY);
        zones.forEach((d, i) => d.classList.toggle('over', i === over));
      };
      const up = (ev) => {
        c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up);
        zones.forEach((d) => d.classList.remove('over'));
        if (!ghost) return ev.type === 'pointerup' && tap(label);
        ghost.remove(); c.classList.remove('dragging');
        put(label, ev.type === 'pointerup' ? zoneAt(ev.clientX, ev.clientY) : placed.indexOf(label) === -1 ? null : placed.indexOf(label));
      };
      c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    };
  }
}

// The reveal of a label round: every box with its right name; with `mine`, green where I got it, red where not.
export function labelReveal(truth, mine) {
  const wrap = zoneBoard(truth.image);
  truth.zones.forEach((z, i) => {
    const d = zoneBox(wrap, z, 'zone' + (mine ? (mine[i] === z.label ? ' right' : ' wrong') : ''));
    d.appendChild(el('span', 'chip', z.label));
  });
  return wrap;
}

// Round counter + progress segments in the top bar.
// The image shown with a question (round.qphoto), or none when round is null / has none.
// Tap opens it full screen (an overlay on <body>: .top is transformed, so it can't host a fixed child).
export function qImage(img, round) {
  const src = round && round.qphoto ? `/uploads/${round.qphoto}` : null;
  img.onclick = () => {
    const ov = el('div', 'qbig'), big = el('img');
    big.src = img.src; big.alt = img.alt;
    ov.append(big);
    ov.onclick = () => ov.remove();
    document.body.append(ov);
  };
  if (!src) { img.hidden = true; img.removeAttribute('src'); document.querySelector('.qbig')?.remove(); return; }
  if (img.getAttribute('src') !== src) img.src = src;
  img.hidden = false;
}

export function hud(rnoBox, barBox, ordIdx, count) {
  rnoBox.replaceChildren(ordIdx == null ? '' : flaps(`${String(ordIdx + 1).padStart(2, '0')}/${String(count).padStart(2, '0')}`));
  barBox.replaceChildren(...Array.from({ length: ordIdx == null ? 0 : count },
    (_, i) => el('i', i < ordIdx ? 'done' : i === ordIdx ? 'now' : '')));
}

// Globe as backdrop: dimmed + drifting on non-location rounds, sharp otherwise.
let spin = 0;
// Globe padding for a reveal, clear of the question card and the result sheet:
// on the right on wide screens, across the bottom on phones (always leaving a strip of globe for the pins).
export function revealPadding(sheet, left = 60) {
  const top = (topCard ? topCard.offsetHeight : 170) + 20;
  if (innerWidth >= 700) return { top, bottom: 110, left, right: 380 };
  return { top, bottom: Math.max(60, Math.min(sheet.offsetHeight + 110, innerHeight - top - 120)), left: 40, right: 40 };
}

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

// Final board: the winner up top, then a podium + list (game show) or an arrivals board (railway).
// rows: [{ name, total, me }] sorted best first. verb: 'wins' (live) or 'leads' (an open leaderboard).
const CROWN = '<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 4l4.5 8L21 8l-2 11H5z" fill="currentColor"/></svg>';
export const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
export function finalBoard(box, rows, verb = 'wins') {
  box.replaceChildren();
  if (!rows.length) return;
  const rank = [];
  rows.forEach((r, i) => rank.push(i && r.total === rows[i - 1].total ? rank[i - 1] : i + 1)); // ties share a place
  const top = rows.filter((_, i) => rank[i] === 1).map((r) => r.name);
  const champ = box.appendChild(el('div', 'champ'));
  champ.insertAdjacentHTML('beforeend', CROWN);
  const who = top.join(' & ');
  champ.appendChild(who.length <= 18 ? flaps(who, true) : el('div', 'ans', who));
  champ.appendChild(el('div', 'note', `${top.length > 1 ? (verb === 'wins' ? 'share the win' : 'share the lead') : verb} with ${rows[0].total} pts`));
  const mi = rows.findIndex((r) => r.me);
  if (mi !== -1) box.appendChild(el('div', 'you' + (rank[mi] === 1 ? ' won' : ''),
    rank[mi] === 1 ? (verb === 'wins' ? 'You won!' : 'You’re on top!') : `You came ${ordinal(rank[mi])} of ${rows.length}`));

  const podium = theme === 'gameshow' && rows.length >= 2;
  if (podium) {
    const pod = el('div', 'podium');
    for (const i of [1, 0, 2]) {
      const r = rows[i];
      const p = el('div', `p p${i + 1}${r && r.me ? ' me' : ''}`);
      if (r) {
        const sc = el('span', 'sc', '0');
        p.append(el('span', 'nm', r.name), sc, el('div', 'blk', String(rank[i])));
        setTimeout(() => countUp(sc, r.total, ''), RM ? 0 : [900, 450, 0][i]); // 3rd, 2nd, then 1st rise
      }
      pod.appendChild(p);
    }
    box.appendChild(pod);
  }
  const table = el('table', 'board');
  rows.slice(podium ? 3 : 0).forEach((r, j) => {
    const i = (podium ? 3 : 0) + j, tr = el('tr', r.me ? 'me' : '');
    tr.style.setProperty('--i', j);
    tr.append(el('td', 'r', `${rank[i]}`), el('td', null, r.name), el('td', 's', `${r.total}`));
    table.appendChild(tr);
  });
  if (table.children.length) box.appendChild(table);
  const at = podium ? 1400 : 500; // when the winner's block has landed
  setTimeout(() => confetti(120, true), at);
  setTimeout(() => confetti(80, true), at + 1100);
}
