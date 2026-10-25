// Hall of fame (ai/summary.md §6.4): a local top 10 with three initials, the stage reached and continues used. One entry
// per credit (a continue sets the score back to 0). Names are entered on the game over and ending screens, by
// keyboard, touch (▲ ▼ under each letter) or gamepad (d-pad or stick, A to confirm).

const SIZE = 10;
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-';

export function qualifies(list, score) {
  return score > 0 && (list.length < SIZE || score > list[list.length - 1].score);
}

/** Insert an entry, keep the best 10. Returns its rank (index), or -1 if it fell off. */
export function addEntry(list, entry) {
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  list.length = Math.min(list.length, SIZE);
  return list.indexOf(entry);
}

export function renderHof(el, list, fmt, { mark = -1, max = SIZE } = {}) {
  if (!list.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML =
    '<div class="h">HALL OF FAME</div>' +
    list
      .slice(0, max)
      .map((e, i) => `<div class="${i === mark ? 'me' : ''}"><b>${i + 1}</b><span>${e.name}</span><span>${fmt(e.score)}</span><span>${e.reached}${e.continues ? ' · ' + e.continues + 'C' : ''}</span></div>`)
      .join('');
}

/** Three letter slots. done(name) is called once, by Enter / A / confirm(). */
export class NameEntry {
  constructor(el, initial, done) {
    this.el = el;
    this.done = done;
    this.letters = (initial || 'AAA').toUpperCase().padEnd(3, 'A').slice(0, 3).split('');
    this.pos = 0;
    this.active = true;
    this.pad = { prev: [], rep: 0 };
    el.innerHTML =
      '<div class="h">NEW HIGH SCORE · YOUR INITIALS</div><div class="slots">' +
      [0, 1, 2].map((i) => `<div class="slot" data-i="${i}"><button data-d="1" aria-label="next letter">▲</button><b></b><button data-d="-1" aria-label="previous letter">▼</button></div>`).join('') +
      '<button class="ok">OK</button></div>';
    el.querySelectorAll('.slot button').forEach((b) =>
      b.addEventListener('click', (e) => {
        this.pos = +b.parentElement.dataset.i;
        this.step(+b.dataset.d);
        e.stopPropagation();
      }),
    );
    el.querySelector('.ok').addEventListener('click', () => this.confirm());
    this.onKey = (e) => this.key(e);
    addEventListener('keydown', this.onKey, true);
    this.draw();
  }

  get name() {
    return this.letters.join('');
  }

  step(d) {
    const i = ABC.indexOf(this.letters[this.pos]);
    this.letters[this.pos] = ABC[(i + d + ABC.length) % ABC.length];
    this.draw();
  }

  move(d) {
    this.pos = Math.max(0, Math.min(2, this.pos + d));
    this.draw();
  }

  key(e) {
    if (!this.active) return;
    const k = e.key;
    if (/^[a-z0-9.-]$/i.test(k)) {
      this.letters[this.pos] = k.toUpperCase();
      if (this.pos < 2) this.pos++;
      this.draw();
    } else if (k === 'Backspace' || k === 'ArrowLeft') this.move(-1);
    else if (k === 'ArrowRight') this.move(1);
    else if (k === 'ArrowUp') this.step(1);
    else if (k === 'ArrowDown') this.step(-1);
    else if (k === 'Enter') this.confirm();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  /** Gamepad: called every frame while the entry is open. */
  poll(dt) {
    if (!this.active || !navigator.getGamepads) return;
    const pad = [...navigator.getGamepads()].find((p) => p && p.connected);
    if (!pad) return;
    const P = this.pad;
    const btn = (i) => !!pad.buttons[i]?.pressed;
    const press = (i) => btn(i) && !P.prev[i];
    const ay = pad.axes[1] || 0;
    const ax = pad.axes[0] || 0;
    const v = btn(12) || ay < -0.6 ? 1 : btn(13) || ay > 0.6 ? -1 : 0;
    const h = btn(15) || ax > 0.6 ? 1 : btn(14) || ax < -0.6 ? -1 : 0;
    // held directions repeat
    if (v || h) {
      if ((P.rep -= dt) <= 0) {
        P.rep = P.held ? 0.12 : 0.35;
        P.held = true;
        if (v) this.step(v);
        else this.move(h);
      }
    } else {
      P.rep = 0;
      P.held = false;
    }
    if (press(0)) {
      if (this.pos < 2) this.move(1);
      else this.confirm();
    }
    if (press(1)) this.move(-1);
    if (press(9)) this.confirm();
    for (let i = 0; i < pad.buttons.length; i++) P.prev[i] = btn(i);
  }

  draw() {
    this.el.querySelectorAll('.slot').forEach((s, i) => {
      s.querySelector('b').textContent = this.letters[i];
      s.classList.toggle('cur', i === this.pos);
    });
  }

  confirm() {
    if (!this.active) return;
    this.close();
    this.done(this.name);
  }

  close() {
    this.active = false;
    removeEventListener('keydown', this.onKey, true);
  }
}
