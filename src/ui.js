import { LEVELS } from './levels.js';

const $ = (id) => document.getElementById(id);

/**
 * UI — owns the DOM overlay (menu / level-select / HUD / win / sandbox / fatal) and a
 * transient "tip" toast. The Game/main wires behaviour through `bind(controller)`.
 */
export class UI {
  constructor() {
    this.el = {
      hud: $('hud'), level: $('hud-level'), ducklings: $('hud-ducklings'),
      strokes: $('hud-strokes'), time: $('hud-time'),
      menu: $('menu'), levels: $('levels'), levelGrid: $('level-grid'),
      win: $('win'), winTitle: $('win-title'), winStars: $('win-stars'), winStats: $('win-stats'),
      sandbox: $('sandbox-bar'), fatal: $('fatal'), fatalMsg: $('fatal-msg'),
      huntBar: $('hunt-bar'), huntCaught: $('hunt-caught'), huntTime: $('hunt-time'),
      huntWin: $('hunt-win'), huntWinStats: $('hunt-win-stats'),
    };

    // Transient tip toast.
    this.tip = document.createElement('div');
    this.tip.id = 'tip';
    Object.assign(this.tip.style, {
      position: 'fixed', left: '50%', bottom: '6%', transform: 'translateX(-50%)',
      background: 'rgba(255,255,255,.85)', color: '#0a2a3a', padding: '10px 16px',
      borderRadius: '999px', fontWeight: '700', fontSize: '14px', pointerEvents: 'none',
      boxShadow: '0 10px 30px rgba(8,50,80,.25)', opacity: '0', transition: 'opacity .3s ease',
      zIndex: '20', maxWidth: '90vw', textAlign: 'center',
    });
    document.body.appendChild(this.tip);
    this._tipTimer = null;
  }

  bind(c) {
    this.c = c;
    $('btn-play').onclick = () => this.showLevels();   // "Duck-herding levels →" opens level select
    $('btn-sandbox').onclick = () => c.startSandbox();
    $('btn-hunt').onclick = () => c.startHunt();
    $('btn-hunt-menu').onclick = () => c.toMenu();
    $('btn-hunt-new').onclick = () => c.startHunt();
    $('btn-hunt-again').onclick = () => c.startHunt();
    $('btn-hunt-win-menu').onclick = () => c.toMenu();
    $('btn-levels-back').onclick = () => this.showMenu();
    $('btn-menu').onclick = () => c.toMenu();
    $('btn-restart').onclick = () => c.restart();
    $('btn-next').onclick = () => c.nextLevel();
    $('btn-replay').onclick = () => c.restart();
    $('btn-win-menu').onclick = () => c.toMenu();
    $('btn-sb-menu').onclick = () => c.toMenu();
    $('btn-add-duck').onclick = () => c.addSandboxDuck();
    $('btn-calm').onclick = () => c.calm();
  }

  _hideAll() {
    for (const k of ['hud', 'menu', 'levels', 'win', 'sandbox', 'fatal', 'huntBar', 'huntWin']) {
      this.el[k].classList.add('hidden');
    }
  }

  showHunt(total) {
    this._hideAll();
    this.el.huntBar.classList.remove('hidden');
    this.updateHuntHUD(0, total);
    this.flashTip('Tap the water to spot fish, then grab &amp; fling the duck to catch them!', 3200);
  }
  updateHuntHUD(caught, total, time) {
    this.el.huntCaught.textContent = `🐟 ${caught}/${total}`;
    if (time != null) this.el.huntTime.textContent = `⏱ ${time.toFixed(1)}s`;
  }
  showHuntWin(total, seconds, best) {
    this._hideAll();
    this.el.huntWin.classList.remove('hidden');
    const bestTxt = best != null ? ` · best ${best.toFixed(1)}s` : '';
    this.el.huntWinStats.textContent = `All ${total} fish in ${seconds.toFixed(1)}s${bestTxt}`;
  }

  showMenu() { this._hideAll(); this.el.menu.classList.remove('hidden'); }

  showLevels() {
    this._hideAll();
    this.el.levels.classList.remove('hidden');
    const prog = this.c.getProgress();
    const grid = this.el.levelGrid;
    grid.innerHTML = '';
    LEVELS.forEach((L, i) => {
      const locked = i + 1 > prog.unlocked;
      const cell = document.createElement('button');
      cell.className = 'level-cell' + (locked ? ' locked' : '');
      const stars = prog.stars[i] || 0;
      cell.innerHTML = `${i + 1}<span class="mini-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>`;
      cell.title = L.name;
      if (!locked) cell.onclick = () => this.c.playLevel(i);
      grid.appendChild(cell);
    });
  }

  showHUD(levelIndex, L, total) {
    this._hideAll();
    this.el.hud.classList.remove('hidden');
    this.updateHUD({ level: levelIndex, ducklings: `0/${total}`, strokes: 0, time: 0 });
  }

  showSandbox() { this._hideAll(); this.el.sandbox.classList.remove('hidden'); }

  updateHUD({ level, ducklings, strokes, time }) {
    this.el.level.textContent = `Lvl ${level + 1} · ${LEVELS[level].name}`;
    this.el.ducklings.textContent = `🐤 ${ducklings}`;
    this.el.strokes.textContent = `💧 ${strokes}`;
    this.el.time.textContent = `⏱ ${time.toFixed(1)}s`;
  }

  showWin({ levelIndex, stars, strokes, time, par, isLast }) {
    this._hideAll();
    this.el.win.classList.remove('hidden');
    this.el.winTitle.textContent = isLast && stars > 0 ? '🏆 Pond Complete!' : `Level ${levelIndex + 1} Complete!`;
    this.el.winStars.innerHTML =
      Array.from({ length: 3 }, (_, i) => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('');
    this.el.winStats.innerHTML =
      `💧 ${strokes} ripples <span style="opacity:.6">(par ${par.parStrokes})</span> · ` +
      `⏱ ${time.toFixed(1)}s <span style="opacity:.6">(par ${par.parTime}s)</span>`;
    $('btn-next').textContent = isLast ? 'Menu' : 'Next ▶';
  }

  flashTip(text, ms = 2600) {
    if (!text) return;
    this.tip.textContent = text;
    this.tip.style.opacity = '1';
    clearTimeout(this._tipTimer);
    this._tipTimer = setTimeout(() => { this.tip.style.opacity = '0'; }, ms);
  }

  fatal(msg) {
    this._hideAll();
    this.el.fatal.classList.remove('hidden');
    this.el.fatalMsg.textContent = msg;
  }
}
