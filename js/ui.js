/* Tundra Defense — DOM UI: RTS-style command dock, hotkeys, menus, persistence, sound */
(function () {
  const G = (globalThis.G = globalThis.G || {});
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  // in-match currency is fish 🐟 (recruiting); pebbles 🪨 are the meta-currency
  const fmt = (n) => '🐟' + Math.round(n).toLocaleString();

  /* Hotkey rows mirror the physical keyboard; each row is one class. */
  const HOTKEY_ROWS = [
    ['1', '2', '3', '4', '5'],
    ['Q', 'W', 'E', 'R', 'T'],
    ['A', 'S', 'D', 'F', 'G'],
    ['Z', 'X', 'C', 'V', 'B'],
  ];
  const KEY_TO_TOWER = {};
  HOTKEY_ROWS.forEach((row, r) => row.forEach((k, c) => { KEY_TO_TOWER[k] = G.TOWER_ORDER[r * 5 + c]; }));
  const TOWER_KEY = {};
  Object.entries(KEY_TO_TOWER).forEach(([k, id]) => { TOWER_KEY[id] = k; });

  const ICON_SOUND_ON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.8-5 6.7v2.1c4-.9 7-4.5 7-8.8s-3-7.9-7-8.8z"/></svg>';
  const ICON_SOUND_OFF = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm18.6 3 2-2-1.4-1.4-2 2-2-2L16.7 10l2 2-2 2 1.4 1.4 2-2 2 2 1.4-1.4-2-2z"/></svg>';

  /* ---------- persistence ---------- */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
      catch (e) { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); return true; }
      catch (e) { return false; }
    },
    del(key) { try { localStorage.removeItem(key); } catch (e) {} },
  };
  const PROFILE_KEY = 'tundra_profile_v1';
  const saveKey = (li) => 'tundra_save_v1_' + li;

  function getProfile() {
    const p = store.get(PROFILE_KEY, {});
    // backfill every key a profile written by an older build might be missing
    if (!(p.unlocked > 0)) p.unlocked = 1;
    if (p.pebbles == null) p.pebbles = 0;
    if (!p.completed) p.completed = {};
    if (!p.bestWave) p.bestWave = {};
    if (!p.endlessBest) p.endlessBest = {};   // per-level record wave in Endless Tide
    if (!p.diffDone) p.diffDone = {};
    if (!p.powerInv) p.powerInv = {};
    if (!p.heroes) p.heroes = { hero_frost: true };  // the Captain serves for free
    if (p.heroSel === undefined) p.heroSel = 'hero_frost'; // null = fight heroless
    // legacy profiles: a completed level was a 50-wave campaign → credit it as Hard
    for (const id in p.completed) {
      if (p.completed[id] && !p.diffDone[id]) p.diffDone[id] = { hard: true };
    }
    return p;
  }
  function putProfile(p) { store.set(PROFILE_KEY, p); }

  /* ---------- sound (tiny synth) ---------- */
  let actx = null;
  function beep(freq, dur, type, vol, slide) {
    if (UI.profile.muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, actx.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), actx.currentTime + dur);
      g.gain.setValueAtTime(vol || 0.04, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g).connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur);
    } catch (e) { /* audio unavailable */ }
  }
  const sfx = {
    place: () => beep(300, 0.12, 'triangle', 0.06, 200),
    upgrade: () => beep(500, 0.15, 'triangle', 0.06, 300),
    sell: () => beep(400, 0.15, 'sawtooth', 0.04, -200),
    pop: () => beep(600 + Math.random() * 200, 0.05, 'square', 0.018, -300),
    leak: () => beep(180, 0.3, 'sawtooth', 0.06, -80),
    wave: () => beep(440, 0.12, 'triangle', 0.05, 120),
    boss: () => beep(110, 0.5, 'sawtooth', 0.08, -40),
    win: () => { beep(523, 0.15, 'triangle', 0.06); setTimeout(() => beep(659, 0.15, 'triangle', 0.06), 140); setTimeout(() => beep(784, 0.3, 'triangle', 0.07), 280); },
    lose: () => { beep(300, 0.25, 'sawtooth', 0.06, -100); setTimeout(() => beep(200, 0.4, 'sawtooth', 0.06, -80), 200); },
    error: () => beep(160, 0.12, 'square', 0.04),
  };

  /* ---------- UI state ---------- */
  const UI = {
    game: null,
    profile: getProfile(),
    canvas: null, ctx: null,
    lastTime: 0, rafId: 0,
    popSoundGate: 0,
    previewWave: 0,
  };
  G.UI = UI;

  /* ---------- touch helpers ---------- */
  const IS_TOUCH = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  // haptic tick — Android only; iOS ignores it, which is fine
  const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };

  // keep the screen awake during a battle (phones dim fast while you watch a wave)
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && IS_TOUCH && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
      else if (!on && wakeLock) { wakeLock.release(); wakeLock = null; }
    } catch (e) { /* not granted — harmless */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && UI.game) keepAwake(true);
  });

  /* iPhones mute WebAudio when the ring/silent switch is on silent, because a
     web page counts as "ambient" sound. Declaring a playback session — and
     keeping a silent <audio> loop alive as the fallback for older iOS — moves
     the game into the media category, which the switch does not mute. */
  function unlockMobileAudio() {
    if (!IS_TOUCH) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    try {
      const a = new Audio('data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA');
      a.loop = true;
      a.setAttribute('playsinline', '');
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* audio unavailable */ }
  }

  function syncCancelBtn() {
    const g = UI.game;
    $('#btn-cancel-place').classList.toggle('show', !!(g && g.placingType && !g.over));
  }

  /* Tray slots, touch: hold shows the penguin's description card; drag out of
     the dock and you are carrying the penguin — the card vanishes, the ghost
     follows the finger, and lifting on the map places it. A quick tap still
     arms for tap-then-drag. Vertical strokes stay with the browser (tray
     scrolling): touch-action pan-y makes those fire pointercancel here. */
  function attachTrayDrag(slot, id) {
    let timer = null, showing = false, carrying = false, swallow = false;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };

    slot.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse') return;   // mouse keeps hover + click
      /* no preventDefault here: iOS Safari would swallow the synthesized
         click that tap-to-arm depends on (Chrome keeps it, per spec).
         Selection during drags is suppressed by CSS instead —
         user-select/touch-callout on .slot and html/body */
      showing = false; carrying = false; swallow = false;
      clear();
      timer = setTimeout(() => {
        timer = null;
        const g = UI.game;
        if (g && !g.placingType) { showing = true; showTooltip(slot, id); }
      }, 200);
    });

    slot.addEventListener('pointermove', (ev) => {
      if (ev.pointerType === 'mouse') return;
      const g = UI.game;
      if (!g || g.over) return;
      const dockLeft = $('#dock').getBoundingClientRect().left;
      if (!carrying && ev.clientX < dockLeft - 4) {
        // finger left the pane: the description goes away and the penguin comes along
        clear();
        if (showing) { hideTooltip(); showing = false; }
        const cost = G.scaleCost(G.TOWERS[id].cost, g.diffId);
        if (g.cash < cost) {
          sfx.error(); buzz(30);
          toast(`Need ${fmt(cost)} for a ${G.TOWERS[id].name}.`, 'bad');
          swallow = true;
          return;
        }
        carrying = true; swallow = true;
        g.placingType = id;
        g.selected = null;
        syncCancelBtn(); renderDockSel(); updateHud();
      }
      if (carrying) g.mouse = canvasPos(ev);
    });

    /* Once the description card is up — or a penguin is being carried — the
       gesture is ours: stop the tray scroller from claiming the touch. With
       selection now disabled, iOS otherwise hands a hold-then-drag to the
       scroller and fires pointercancel, eating the drag. Quick strokes
       (no card yet) still scroll the tray natively. */
    slot.addEventListener('touchmove', (ev) => {
      if (showing || carrying) ev.preventDefault();
    }, { passive: false });

    const done = (ev) => {
      if (ev.pointerType === 'mouse') return;
      clear();
      const g = UI.game;
      if (carrying && g && g.placingType === id) {
        const pos = canvasPos(ev);
        const placed = g.placeTower(id, pos.x, pos.y);
        if (placed) { sfx.place(); buzz(12); }
        else { sfx.error(); buzz(30); }
        // carried penguins are one-shot: no sticky armed state to cancel after
        g.placingType = null;
        g.mouse = { x: -999, y: -999 };
        syncCancelBtn(); renderDockSel(); updateHud();
      } else if (showing) {
        armTooltipDismiss();
      }
      carrying = false;
    };
    slot.addEventListener('pointerup', done);
    slot.addEventListener('pointercancel', () => {   // tray scroll took the gesture
      clear();
      if (showing) { hideTooltip(); showing = false; }
      if (carrying) {
        const g = UI.game;
        if (g && g.placingType === id) { g.placingType = null; g.mouse = { x: -999, y: -999 }; syncCancelBtn(); renderDockSel(); updateHud(); }
        carrying = false;
      }
    });
    // swallow the tap that follows a long-press or a completed drag
    slot.addEventListener('click', (ev) => {
      if (showing || swallow) { ev.stopPropagation(); ev.preventDefault(); showing = false; swallow = false; }
    }, true);
  }

  /* Long-press stands in for hover: it opens the same tooltip and swallows the
     tap that would otherwise have armed the penguin. */
  function attachLongPress(el, showFn) {
    let timer = null, fired = false, sx = 0, sy = 0;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    el.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse') return;
      fired = false; sx = ev.clientX; sy = ev.clientY;
      cancel();
      timer = setTimeout(() => { fired = true; timer = null; showFn(); armTooltipDismiss(); }, 420);
    });
    el.addEventListener('pointermove', (ev) => {
      if (timer && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 12) cancel();
    });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    // capture phase: kill the click that follows a long-press
    el.addEventListener('click', (ev) => {
      if (fired) { ev.stopPropagation(); ev.preventDefault(); fired = false; }
    }, true);
  }

  function armTooltipDismiss() {
    const off = () => { hideTooltip(); document.removeEventListener('pointerdown', off, true); };
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
    setTimeout(off, 4000);
  }

  function toast(msg, kind) {
    const box = $('#toasts');
    const t = el('div', 'toast' + (kind ? ' ' + kind : ''), msg);
    box.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
  }

  function banner(msg) {
    const b = $('#banner');
    b.textContent = msg;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  /* ---------- screens ---------- */
  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.remove('active');
    if (id) $(id).classList.add('active');
    $('#overlay').style.display = id ? 'flex' : 'none';
    // every menu screen carries a pebble chip — keep them all current
    for (const b of document.querySelectorAll('.js-pebbles')) b.textContent = UI.profile.pebbles.toLocaleString();
  }

  function openPauseMenu() {
    const g = UI.game;
    if (!g || g.over) return;
    g.paused = true;
    updateHud();
    show('#screen-pause');
  }
  function closePauseMenu() {
    const g = UI.game;
    show(null);
    if (g) { g.paused = false; updateHud(); }
  }

  const ICON_FS = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 3h7v2H5v5H3V3zm11 0h7v7h-2V5h-5V3zM3 14h2v5h5v2H3v-7zm16 0h2v7h-7v-2h5v-5z"/></svg>';
  const ICON_FS_EXIT = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M10 3v7H3V8h5V3h2zm4 0h2v5h5v2h-7V3zM3 14h7v7H8v-5H3v-2zm11 0h7v2h-5v5h-2v-7z"/></svg>';

  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function toggleFullscreen() {
    const root = document.documentElement;
    const blocked = () => toast('Fullscreen was blocked by the browser.', 'bad');
    try {
      const p = isFullscreen()
        ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
        : (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
      if (p && p.catch) p.catch(blocked);
    } catch (e) { blocked(); }
  }
  function updateFsButton() { $('#btn-fs').innerHTML = isFullscreen() ? ICON_FS_EXIT : ICON_FS; }

  /* ---------- progress backup: one file the player keeps ----------
     Phones/tablets get the share sheet (Save to Files on iOS — an iCloud Drive
     folder syncs it across devices); everywhere else it downloads. Loading
     opens the file picker, which on iOS is the Files app. */
  function collectBackup() {
    const saves = {};
    for (let i = 0; i < G.LEVELS.length; i++) {
      const s = store.get(saveKey(i), null);
      if (s) saves[i] = s;
    }
    return {
      game: 'tundra-defense', kind: 'progress-backup', version: 1,
      exported: new Date().toISOString(),
      profile: UI.profile,
      saves,
    };
  }

  async function exportProgress() {
    const name = 'tundra-defense-progress-' + new Date().toISOString().slice(0, 10) + '.json';
    const blob = new Blob([JSON.stringify(collectBackup(), null, 2)], { type: 'application/json' });
    if (IS_TOUCH && navigator.canShare) {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Tundra Defense progress' });
          toast('Progress backed up 💾');
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;   // player closed the share sheet
          /* share refused — fall through to a plain download */
        }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Backup saved — check your downloads 💾');
  }

  function importProgress(file) {
    const reader = new FileReader();
    reader.onerror = () => toast('Could not read that file.', 'bad');
    reader.onload = () => {
      let data = null;
      try { data = JSON.parse(reader.result); } catch (e) { /* not JSON — caught below */ }
      if (!data || data.game !== 'tundra-defense' || data.kind !== 'progress-backup' || !data.profile) {
        toast('That file is not a Tundra Defense backup.', 'bad');
        return;
      }
      if (!confirm('Load this backup? It replaces the progress on this device.')) return;
      store.set(PROFILE_KEY, data.profile);
      for (let i = 0; i < G.LEVELS.length; i++) {
        if (data.saves && data.saves[i]) store.set(saveKey(i), data.saves[i]);
        else store.del(saveKey(i));
      }
      UI.profile = getProfile();   // re-read through the backfill, so old backups gain new fields
      show('#screen-menu');        // refreshes every pebble chip
      toast('Progress loaded ✔');
    };
    reader.readAsText(file);
  }

  function buildMainMenu() {
    $('#btn-play').onclick = () => { buildLevelSelect(); show('#screen-levels'); };
    $('#btn-shop').onclick = () => buildShop('#screen-menu');
    $('#btn-howto').onclick = () => show('#screen-howto');
    $('#btn-howto-back').onclick = () => show(UI.game ? '#screen-pause' : '#screen-menu');
    $('#btn-reset').onclick = () => {
      if (!confirm('Wipe all progress and saves?')) return;
      store.del(PROFILE_KEY);
      for (let i = 0; i < G.LEVELS.length; i++) store.del(saveKey(i));
      UI.profile = getProfile();
      show('#screen-menu');   // pebble chips back to zero
      toast('Progress reset.');
    };
    $('#btn-export').onclick = exportProgress;
    $('#btn-import').onclick = () => $('#import-file').click();
    $('#import-file').onchange = (ev) => {
      const f = ev.target.files && ev.target.files[0];
      ev.target.value = '';   // so picking the same file again still fires change
      if (f) importProgress(f);
    };
    $('#btn-resume').onclick = closePauseMenu;
    $('#btn-pause-save').onclick = () => { doSave(false); };
    $('#btn-pause-quit').onclick = () => exitToMenu(true);
  }

  function buildLevelSelect() {
    const grid = $('#level-grid');
    grid.innerHTML = '';
    const p = UI.profile;

    // one section per campaign tier, each with its own card grid
    const sections = {};
    for (const T of G.TIERS) {
      const first = G.LEVELS.findIndex((L) => L.tier === T.id);
      const count = G.LEVELS.filter((L) => L.tier === T.id).length;
      const reached = G.DIFF_ORDER.some((d) => G.tierUnlocked(p, T.id, d));
      const beaten = G.LEVELS.filter((L) => L.tier === T.id && p.completed[L.id]).length;

      // one chip per difficulty: is this whole tier open on it, and how far in?
      const diffChips = G.DIFF_ORDER.map((d) => {
        const D = G.DIFFICULTIES[d];
        const open = G.tierUnlocked(p, T.id, d);
        const cleared = G.LEVELS.filter((L) => L.tier === T.id && G.beatenAtLeast(p, L.id, d)).length;
        if (!open) {
          const prev = G.TIERS.find((x) => x.id === T.id - 1);
          const left = G.tierLevels(T.id - 1).filter((x) => !G.beatenAtLeast(p, x.id, d)).length;
          return `<span class="badge diff-lock" title="Clear ${prev.name} on ${D.name} — ${left} to go.">${D.icon} ${D.name} 🔒</span>`;
        }
        return `<span class="badge${cleared === count ? ' done' : ' diff-open'}" title="${D.name} is open on this tier.">${D.icon} ${D.name} ${cleared}/${count}</span>`;
      }).join('');

      const sec = el('div', 'lvl-section' + (reached ? '' : ' locked'));
      const head = el('div', 'lvl-sec-head');
      head.innerHTML = `
        <div class="lvl-sec-title"><span class="lvl-sec-icon">${T.icon}</span>${T.name}</div>
        <div class="lvl-sec-meta">
          <span class="badge">Battlefields ${first + 1}–${first + count}</span>
          <span class="badge${beaten === count ? ' done' : ''}">${beaten} / ${count} defended</span>
          ${diffChips}
        </div>
        <div class="lvl-sec-blurb">${T.blurb}</div>`;
      sec.appendChild(head);
      const cards = el('div', 'lvl-cards');
      sec.appendChild(cards);
      grid.appendChild(sec);
      sections[T.id] = cards;
    }

    G.LEVELS.forEach((L, i) => {
      const unlocked = G.anyDiffUnlocked(p, i);
      const save = store.get(saveKey(i), null);
      const best = p.bestWave[L.id] || 0;
      const stars = '★'.repeat(L.diff) + '<span class="dim-star">' + '★'.repeat(5 - L.diff) + '</span>';
      const card = el('div', 'level-card' + (unlocked ? '' : ' locked'));

      const thumb = document.createElement('canvas');
      thumb.className = 'lvl-thumb';
      thumb.width = 232;
      thumb.height = Math.round(232 * L.h / L.w); // keep each tier's true aspect
      G.drawLevelThumb(thumb, L);
      card.appendChild(thumb);
      if (!unlocked) card.appendChild(el('div', 'lvl-lock', '🔒'));

      const done = p.diffDone[L.id] || {};
      const diffBadges = G.DIFF_ORDER
        .filter((d) => done[d])
        .map((d) => `<span class="badge done">${G.DIFFICULTIES[d].icon} ${G.DIFFICULTIES[d].name} ✔</span>`)
        .join('');
      const body = el('div', 'lvl-body');
      body.innerHTML = `
        <div class="lvl-row"><span class="lvl-name">${i + 1}. ${L.name}</span><span class="lvl-stars">${stars}</span></div>
        <div class="lvl-tag">${unlocked ? L.tagline : G.lockReason(p, i, 'easy')}</div>
        <div class="lvl-meta">
          ${diffBadges}
          ${best && !p.completed[L.id] ? `<span class="badge">Best: wave ${best}</span>` : ''}
          ${p.endlessBest[L.id] ? `<span class="badge" title="Endless Tide record — keep going after a victory to beat it">🌊 Endless: wave ${p.endlessBest[L.id]}</span>` : ''}
          ${save ? '<span class="badge save">💾 Saved game</span>' : ''}
        </div>`;
      card.appendChild(body);

      if (unlocked) {
        const row = el('div', 'lvl-actions');
        const bNew = el('button', 'btn small', save ? 'New Game' : '▶ Play');
        bNew.onclick = (ev) => {
          ev.stopPropagation();
          if (save && !confirm('Start fresh? This overwrites the existing save for this level.')) return;
          openDiffSelect(i);
        };
        row.appendChild(bNew);
        if (save) {
          const D = G.DIFFICULTIES[save.diff || 'hard'];
          const bCont = el('button', 'btn small primary', `⏵ Continue — wave ${save.wave} · ${D.name}`);
          bCont.onclick = (ev) => { ev.stopPropagation(); startGame(i, save); };
          row.appendChild(bCont);
        }
        card.appendChild(row);
      }
      (sections[L.tier] || grid).appendChild(card);
    });
    $('#btn-levels-back').onclick = () => show('#screen-menu');
  }

  /* ---------- difficulty select ---------- */
  function openDiffSelect(levelIdx) {
    const L = G.LEVELS[levelIdx];
    $('#diff-sub').textContent = `${L.name} — how hard should the herds hit?`;
    const grid = $('#diff-grid');
    grid.innerHTML = '';
    for (const dId of G.DIFF_ORDER) {
      const D = G.DIFFICULTIES[dId];
      const done = (UI.profile.diffDone[L.id] || {})[dId];
      const locked = !G.levelUnlocked(UI.profile, levelIdx, dId);
      const priceLine = D.costMult === 1
        ? 'standard tower prices'
        : `towers ${Math.round(Math.abs(1 - D.costMult) * 100)}% ${D.costMult < 1 ? 'cheaper' : 'pricier'}`;
      const card = el('div', 'diff-card ' + dId + (locked ? ' locked' : ''));
      card.innerHTML = `
        <div class="diff-icon">${locked ? '🔒' : D.icon}</div>
        <div class="diff-name">${D.name}${done ? ' <span class="diff-done" title="Beaten on this difficulty">✔</span>' : ''}</div>
        ${locked ? `<div class="diff-locked-why">${G.lockReason(UI.profile, levelIdx, dId)}</div>` : `
        <ul class="diff-facts">
          <li><b>${D.waves}</b> waves</li>
          <li><b>${G.scaleLives(L.lives, dId)}</b> lives</li>
          <li>${priceLine}</li>
          <li class="diff-reward">win: +${D.pebbles} 🪨 · retry: ${D.retryCost} 🪨</li>
        </ul>`}`;
      if (!locked) card.onclick = () => startGame(levelIdx, null, dId);
      grid.appendChild(card);
    }
    buildHeroRow();
    $('#btn-diff-shop').onclick = () => buildShop('#screen-diff');
    $('#btn-diff-back').onclick = () => show('#screen-levels');
    show('#screen-diff');
  }

  /* ---------- hero picker (difficulty screen) ---------- */
  function buildHeroRow() {
    const row = $('#hero-row');
    row.innerHTML = '';
    const p = UI.profile;
    for (const id of G.HERO_ORDER) {
      const def = G.TOWERS[id];
      const H = G.HEROES[id];
      const owned = !!p.heroes[id];
      const sel = p.heroSel === id;
      const card = el('div', 'hero-card' + (sel ? ' sel' : '') + (owned ? '' : ' locked'));
      const cv = document.createElement('canvas');
      cv.width = 52; cv.height = 52;
      G.drawTowerIcon(cv, id);
      card.appendChild(cv);
      card.appendChild(el('div', 'hc-name', def.name));
      card.appendChild(el('div', 'hc-blurb', H.blurb));
      card.appendChild(el('div', 'hc-abil', `${H.ability.icon} ${H.ability.name} <span class="dim">· lvl ${H.ability.unlock}</span>`));
      if (owned) {
        card.appendChild(el('div', 'hc-state', sel ? '✔ fighting with you' : 'tap to choose'));
        card.onclick = () => {
          p.heroSel = sel ? null : id;   // tap the chosen one again to fight heroless
          putProfile(p);
          buildHeroRow();
        };
      } else {
        const afford = p.pebbles >= H.pebbles;
        const btn = el('button', 'btn small' + (afford ? ' primary' : ''), `Recruit · ${H.pebbles.toLocaleString()} 🪨`);
        btn.disabled = !afford;
        if (!afford) card.appendChild(el('div', 'hc-state', 'win battles to afford them'));
        btn.onclick = (ev) => {
          ev.stopPropagation();
          if (p.pebbles < H.pebbles) return;
          if (!confirm(`Recruit ${def.name} for ${H.pebbles.toLocaleString()} 🪨 pebbles? Heroes are yours forever.`)) return;
          p.pebbles -= H.pebbles;
          p.heroes[id] = true;
          p.heroSel = id;
          putProfile(p);
          sfx.win();
          toast(`⭐ ${def.name} joins the colony!`);
          show('#screen-diff');   // refresh every pebble chip on screen
          buildHeroRow();
        };
        card.appendChild(btn);
      }
      row.appendChild(card);
    }
  }

  /* ---------- game lifecycle ---------- */
  function startGame(levelIdx, save, diffId) {
    const heroSel = UI.profile.heroes[UI.profile.heroSel] ? UI.profile.heroSel : null;
    const game = save ? G.Game.deserialize(save) : new G.Game(levelIdx, diffId, heroSel);
    UI.game = game;
    game.onEvent = onGameEvent;
    sizeCanvas();   // the Game constructor set G.W/G.H for this battlefield
    show(null);
    $('#hud-stats').style.display = 'flex';
    $('#hud-sys').style.display = 'flex';
    $('#dock').style.display = 'flex';
    $('#auto-start').checked = game.autoStart;
    UI.previewWave = 0;
    syncCancelBtn();
    buildPalette();
    buildDockPowers();
    buildDockHero();
    renderDockSel();
    updateWavePreview();
    updateHud();
    keepAwake(true);
    banner(save ? `Welcome back — Wave ${game.wave}` : `${game.level.name} — ${G.DIFFICULTIES[game.diffId].name}`);
    G.music.play(G.music.trackForLevel(levelIdx));
    G.music.setTempoScale(Math.pow(1.01, game.wave - 1));
  }

  function exitToMenu(saveFirst) {
    const g = UI.game;
    if (g && saveFirst && !g.over) doSave(true);
    keepAwake(false);
    UI.game = null;
    $('#hud-stats').style.display = 'none';
    $('#hud-sys').style.display = 'none';
    $('#dock').style.display = 'none';
    hideTooltip();
    G.music.play('menu');
    buildLevelSelect();
    show('#screen-levels');
  }

  function doSave(silent) {
    const g = UI.game;
    if (!g || g.over) return;
    const ok = store.set(saveKey(g.levelIdx), g.serialize());
    if (!silent) toast(ok ? '💾 Game saved.' : 'Save failed — browser storage unavailable.', ok ? '' : 'bad');
  }

  function onGameEvent(kind, payload) {
    const g = UI.game;
    if (kind === 'waveStart') {
      sfx.wave();
      G.music.setTempoScale(Math.pow(1.01, payload - 1)); // +1% tempo per wave (capped in music.js)
      banner(g.endless ? `🌊 Wave ${payload} — the tide rises` : `Wave ${payload} / ${g.totalWaves}`);
      const spec = G.generateWave(g.levelIdx, payload);
      if (spec.groups.some((gr) => G.ENEMIES[gr.type].boss)) { sfx.boss(); banner(`⚠ Wave ${payload} — something huge is coming…`); }
      updateWavePreview();
      updateHud();
    } else if (kind === 'waveEnd') {
      doSave(true);
      if (g.endless && payload.wave > g.totalWaves) {
        const p = UI.profile;
        p.endlessBest[g.level.id] = Math.max(p.endlessBest[g.level.id] || 0, payload.wave);
        // every 10th endless wave pays a pebble bonus (one Second Chance's worth);
        // every 100th is the century jackpot — ten times the drip
        if (payload.wave % 100 === 0) {
          const D = G.DIFFICULTIES[g.diffId];
          const bonus = D.retryCost * 10;
          p.pebbles += bonus;
          banner(`🌊 Wave ${payload.wave} — the tide bows to you`);
          toast(`🏆 Century! Wave ${payload.wave} survived: +${bonus} 🪨 pebbles`);
        } else if (payload.wave % 10 === 0) {
          const D = G.DIFFICULTIES[g.diffId];
          p.pebbles += D.retryCost;
          toast(`🌊 Wave ${payload.wave} survived! +${D.retryCost} 🪨 pebbles`);
        } else {
          toast(`Wave ${payload.wave} cleared! +${fmt(payload.earned)}`);
        }
        putProfile(p);
      } else {
        toast(`Wave ${payload.wave} cleared! +${fmt(payload.earned)}`);
      }
      updateWavePreview();
      updateHud();
    } else if (kind === 'heroLevel') {
      sfx.upgrade();
      const def = G.TOWERS[g.heroType];
      const H = G.HEROES[g.heroType];
      toast(`⭐ ${def.name} reached Level ${payload}!` +
        (payload === H.ability.unlock ? ` ${H.ability.icon} ${H.ability.name} is ready.` : ''));
      if (g.selected === g.heroTower) renderDockSel();
      updateDockHero();
    } else if (kind === 'leak') {
      sfx.leak();
    } else if (kind === 'bossDown') {
      toast(`☠ ${payload} destroyed!`);
    } else if (kind === 'victory') {
      G.music.stop();
      sfx.win();
      const p = UI.profile;
      const D = G.DIFFICULTIES[g.diffId];
      p.completed[g.level.id] = true;
      p.diffDone[g.level.id] = Object.assign({}, p.diffDone[g.level.id], { [g.diffId]: true });
      p.bestWave[g.level.id] = Math.max(p.bestWave[g.level.id] || 0, g.totalWaves);
      p.pebbles += D.pebbles;
      putProfile(p);
      store.del(saveKey(g.levelIdx));

      // say what this win actually opened up on this difficulty
      const nextTier = G.TIERS.find((T) => T.id === g.level.tier + 1);
      let opened = '';
      if (nextTier && G.tierUnlocked(p, nextTier.id, g.diffId)) {
        opened = ` ${nextTier.name} is now open on ${D.name}!`;
      } else if (g.levelIdx + 1 < G.LEVELS.length && G.levelUnlocked(p, g.levelIdx + 1, g.diffId)) {
        opened = ` "${G.LEVELS[g.levelIdx + 1].name}" is now open on ${D.name}.`;
      } else if (!nextTier && G.tierLevels(g.level.tier).every((L) => G.beatenAtLeast(p, L.id, g.diffId))) {
        opened = ` You have cleared the whole campaign on ${D.name}. The sea lions have given up!`;
      }

      $('#btn-retry').style.display = 'none';
      const eb = $('#btn-endless');
      eb.style.display = 'block';
      const rec = p.endlessBest[g.level.id] || 0;
      eb.innerHTML = `🌊 Keep Going — Endless Tide${rec ? ` · record: wave ${rec}` : ''}`;
      eb.title = 'The waves keep coming, tougher every time, until the colony falls. Your victory is already banked.';
      eb.onclick = keepGoing;
      $('#end-title').textContent = '🏆 Colony Defended!';
      $('#end-sub').textContent = `${g.level.name} (${D.name}) is safe. All ${g.totalWaves} waves repelled with ${g.lives} lives to spare. ` +
        `Reward: +${D.pebbles} 🪨 pebbles — you now have ${p.pebbles.toLocaleString()}.` + opened;
      show('#screen-end');
    } else if (kind === 'defeat') {
      G.music.stop();
      sfx.lose();
      const p = UI.profile;
      p.bestWave[g.level.id] = Math.max(p.bestWave[g.level.id] || 0, g.wave - 1);
      if (g.endless) p.endlessBest[g.level.id] = Math.max(p.endlessBest[g.level.id] || 0, g.wave - 1);
      putProfile(p);
      store.del(saveKey(g.levelIdx));
      const D = G.DIFFICULTIES[g.diffId];
      const afford = p.pebbles >= D.retryCost;
      const rb = $('#btn-retry');
      rb.style.display = 'block';
      rb.disabled = !afford;
      rb.innerHTML = `🪨 Second Chance — retry wave ${g.wave} · ${D.retryCost} pebbles`;
      rb.title = afford
        ? `Restore all ${g.startLives} lives and replay wave ${g.wave}. Towers and cash are kept.`
        : `You need ${D.retryCost} 🪨 — win battles to earn more.`;
      rb.onclick = retryBattle;
      $('#btn-endless').style.display = 'none';
      if (g.endless) {
        const rec = p.endlessBest[g.level.id];
        $('#end-title').textContent = '🌊 The Endless Tide Recedes';
        $('#end-sub').textContent = `The colony held for ${g.wave - 1} waves — ` +
          `${g.wave - 1 - g.totalWaves} beyond the campaign's ${g.totalWaves}. ` +
          (g.wave - 1 >= rec ? 'A new record for this battlefield!' : `Record here: wave ${rec}.`) +
          (afford ? ' The colony can rally, for a price…' : '');
      } else {
        $('#end-title').textContent = '💔 The Colony Has Fallen';
        $('#end-sub').textContent = `The sea lions broke through on wave ${g.wave}. You survived ${g.wave - 1} full waves` +
          (afford ? ' — but the colony can rally, for a price…' : ' — regroup and try again!');
      }
      show('#screen-end');
    }
  }

  /* ---------- HUD ---------- */
  function updateHud() {
    const g = UI.game;
    if (!g) return;
    $('#hud-lives').textContent = g.lives;
    $('#hud-cash').textContent = Math.round(g.cash).toLocaleString(); // fish icon sits beside it
    $('#hud-wave').textContent = g.endless ? `Wave ${g.wave} · ∞` : `Wave ${Math.min(g.wave, g.totalWaves)} / ${g.totalWaves}`;
    $('#wave-bar i').style.width = Math.min(100, ((g.wave - 1) / g.totalWaves) * 100) + '%';
    $('#hud-level').textContent = `${g.level.name} · ${G.DIFFICULTIES[g.diffId].name}`;

    const btn = $('#send-wave');
    if (g.over) {
      btn.disabled = true;
      btn.innerHTML = g.over === 'win' ? '🏆 Victory' : '💔 Defeated';
    } else if (g.waveInProgress) {
      btn.disabled = true;
      const remaining = g.enemies.length + g.spawnQueue.length;
      btn.innerHTML = `${remaining} sea lion${remaining === 1 ? '' : 's'} left`;
    } else if (g.autoStart && g.nextWaveIn != null) {
      btn.disabled = true;
      btn.innerHTML = 'Auto-sending…';
    } else {
      btn.disabled = false;
      btn.innerHTML = 'Send Wave <kbd>space</kbd>';
    }
    $('#btn-speed').textContent = g.speed + '×';
    $('#btn-pause').textContent = g.paused ? '▶' : '⏸';
    $('#btn-pause').classList.toggle('attention', g.paused);
    $('#btn-mute').innerHTML = UI.profile.muted ? ICON_SOUND_OFF : ICON_SOUND_ON;

    // palette affordability + armed state
    for (const slot of document.querySelectorAll('#palette .slot')) {
      const def = G.TOWERS[slot.dataset.type];
      slot.classList.toggle('poor', g.cash < G.scaleCost(def.cost, g.diffId));
      slot.classList.toggle('armed', g.placingType === slot.dataset.type);
    }

    /* upgrade buttons light up the moment they become affordable — the card
       itself only re-renders on selection changes, so without this the
       poor/can state would freeze at whatever the cash was back then */
    for (const b of document.querySelectorAll('#dock-sel .btn.upg-mini[data-cost]')) {
      const can = g.cash >= +b.dataset.cost;
      if (can && !b.classList.contains('can')) {
        b.classList.add('flash');   // one pulse right as it crosses the line
        b.addEventListener('animationend', () => b.classList.remove('flash'), { once: true });
      }
      b.classList.toggle('can', can);
      b.classList.toggle('poor', !can);
    }

    // boost inventory in the dock
    for (const btn of document.querySelectorAll('#dock-powers .dp-btn')) {
      const owned = UI.profile.powerInv[btn.dataset.power] || 0;
      btn.querySelector('.dp-count').textContent = owned;
      btn.classList.toggle('empty', owned <= 0);
      btn.disabled = !!g.over;
    }

    updateDockHero();
  }

  /* ---------- wave preview ---------- */
  function updateWavePreview() {
    const g = UI.game;
    if (!g) return;
    const w = g.endless ? g.wave : Math.min(g.wave, g.totalWaves);
    const box = $('#wave-preview');
    const spec = G.generateWave(g.levelIdx, w);
    const counts = new Map();
    for (const grp of spec.groups) counts.set(grp.type, (counts.get(grp.type) || 0) + grp.count);
    let html = `<span class="wp-label">wave ${w}</span>`;
    for (const [type, n] of counts) {
      const e = G.ENEMIES[type];
      html += e.boss
        ? `<span class="wp-chip boss" title="${e.name} — boss">☠ ${e.name}${n > 1 ? ' ×' + n : ''}</span>`
        : `<span class="wp-chip" title="${e.name}"><i style="background:${e.color}"></i>${n}</span>`;
    }
    box.innerHTML = html;
  }

  /* ---------- command dock: palette ---------- */
  function buildPalette() {
    const pal = $('#palette');
    pal.innerHTML = '';
    // two rows of two class groups — mirrors a physical keyboard's rows
    for (let half = 0; half < 2; half++) {
      const rowEl = el('div', 'pal-row');
      for (let r = half * 2; r < half * 2 + 2; r++) {
        const clsKey = Object.keys(G.CLASSES)[r];
        const color = G.CLASSES[clsKey].color;
        const group = el('div', 'pal-group');
        group.style.setProperty('--cls', color);
        for (let c = 0; c < 5; c++) {
          const id = G.TOWER_ORDER[r * 5 + c];
          const def = G.TOWERS[id];
          const slot = el('div', 'slot');
          slot.dataset.type = id;
          slot.style.background = `linear-gradient(165deg, ${color}2c, ${color}10 60%, transparent)`;
          const cv = document.createElement('canvas');
          cv.width = 38; cv.height = 38;
          G.drawTowerIcon(cv, id);
          slot.appendChild(el('kbd', 'slot-key', HOTKEY_ROWS[r][c]));
          slot.appendChild(cv);
          slot.appendChild(el('span', 'slot-cost', '🐟' + G.scaleCost(def.cost, UI.game.diffId)));
          slot.addEventListener('mouseenter', () => showTooltip(slot, id));
          slot.addEventListener('mouseleave', hideTooltip);
          slot.addEventListener('click', () => armTower(id));
          attachTrayDrag(slot, id);
          group.appendChild(slot);
        }
        rowEl.appendChild(group);
      }
      pal.appendChild(rowEl);
    }
  }

  function armTower(id) {
    const g = UI.game;
    if (!g || g.over) return;
    const def = G.TOWERS[id];
    const cost = G.scaleCost(def.cost, g.diffId);
    if (g.placingType === id) { g.placingType = null; syncCancelBtn(); renderDockSel(); updateHud(); return; }
    if (g.cash < cost) { sfx.error(); toast(`Need ${fmt(cost)} for a ${def.name}.`, 'bad'); return; }
    g.placingType = id;
    g.selected = null;
    syncCancelBtn();
    renderDockSel();
    updateHud();
  }

  /* ---------- tooltip ---------- */
  function showTooltip(anchor, typeId) {
    const def = G.TOWERS[typeId];
    const cls = G.CLASSES[def.cls];
    const s = def.stats;
    const bits = [];
    if (s.damage) bits.push(['Damage', s.damage]);
    if (s.rate) bits.push(['Speed', s.rate + '/s']);
    if (s.range && s.range < 5000) bits.push(['Range', s.range]);
    if (s.range >= 5000) bits.push(['Range', '∞']);
    if (s.pierce > 1) bits.push(['Pierce', s.pierce]);
    if (s.income) bits.push(['Income', '🐟' + s.income + '/wave']);
    const cost = UI.game ? G.scaleCost(def.cost, UI.game.diffId) : def.cost;
    const tip = $('#tooltip');
    tip.innerHTML = `
      <div class="tt-head"><b>${def.name}</b><span class="tt-cost">${fmt(cost)}</span></div>
      <div class="tt-cls" style="color:${cls.color}">${cls.name}${s.water === 'only' ? ' · <span style="color:#67d4f5">water only</span>' : ''}</div>
      <div class="tt-desc">${def.desc}</div>
      ${bits.length ? `<div class="tt-stats">${bits.map(([k, v]) => `<span>${k}<b>${v}</b></span>`).join('')}</div>` : ''}
      <div class="tt-key">${IS_TOUCH
        ? 'Tap to pick up, then drag onto the map to place'
        : `Press <kbd>${def.hero ? 'H' : TOWER_KEY[typeId]}</kbd> or click, then click the map`}</div>`;
    tip.style.display = 'block';
    const r = anchor.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const dock = $('#dock').getBoundingClientRect();
    if (IS_TOUCH && r.left >= dock.left && dock.left > tr.width + 16) {
      // side-dock: the card sits beside the pane, level with the finger
      tip.style.left = Math.max(8, dock.left - tr.width - 10) + 'px';
      tip.style.top = Math.max(8, Math.min(window.innerHeight - tr.height - 8, r.top + r.height / 2 - tr.height / 2)) + 'px';
      return;
    }
    let x = r.left + r.width / 2 - tr.width / 2;
    x = Math.max(8, Math.min(window.innerWidth - tr.width - 8, x));
    tip.style.left = x + 'px';
    tip.style.top = Math.max(8, r.top - tr.height - 10) + 'px';
  }
  function hideTooltip() { $('#tooltip').style.display = 'none'; }

  /* ---------- boosts: bought in the shop, fired from the dock ---------- */
  function buildDockPowers() {
    const box = $('#dock-powers');
    box.innerHTML = '<div class="dp-label">boosts</div>';
    const grid = el('div', 'dp-grid');
    for (const id of G.POWER_ORDER) {
      const P = G.POWERS[id];
      const b = el('button', 'dp-btn');
      b.dataset.power = id;
      b.innerHTML = `<span class="dp-icon">${P.icon}</span><span class="dp-count">0</span>`;
      b.onclick = () => usePower(id);
      b.addEventListener('mouseenter', () => showPowerTip(b, id));
      b.addEventListener('mouseleave', hideTooltip);
      attachLongPress(b, () => showPowerTip(b, id));
      grid.appendChild(b);
    }
    box.appendChild(grid);
  }

  function usePower(id) {
    const g = UI.game;
    if (!g || g.over) return;
    const P = G.POWERS[id];
    const owned = UI.profile.powerInv[id] || 0;
    if (owned <= 0) {
      sfx.error();
      toast(`No ${P.name} in stock — visit the 🪨 Boost Shop on the main menu.`, 'bad');
      return;
    }
    const res = g.usePower(id);
    if (!res.ok) { sfx.error(); toast(res.msg, 'bad'); return; }
    UI.profile.powerInv[id] = owned - 1;
    putProfile(UI.profile);
    sfx.upgrade();
    toast(`${P.icon} ${P.name}! (${owned - 1} left)`);
    hideTooltip();
    updateHud();
  }

  function showPowerTip(anchor, id) {
    const P = G.POWERS[id];
    const owned = UI.profile.powerInv[id] || 0;
    const tip = $('#tooltip');
    tip.innerHTML = `
      <div class="tt-head"><b>${P.icon} ${P.name}</b><span class="tt-cost">×${owned}</span></div>
      <div class="tt-desc">${P.desc}</div>
      <div class="tt-key">${owned > 0 ? 'Click to fire it now.' : `Buy for ${P.cost} 🪨 in the Boost Shop (main menu).`}</div>`;
    tip.style.display = 'block';
    const r = anchor.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - tr.width / 2;
    x = Math.max(8, Math.min(window.innerWidth - tr.width - 8, x));
    tip.style.left = x + 'px';
    tip.style.top = (r.top - tr.height - 10) + 'px';
  }

  /* ---------- Second Chance (paid retry after defeat) ---------- */
  function retryBattle() {
    const g = UI.game;
    if (!g || g.over !== 'lose') return;
    const D = G.DIFFICULTIES[g.diffId];
    if (UI.profile.pebbles < D.retryCost) { sfx.error(); return; }
    if (!g.retry()) return;
    UI.profile.pebbles -= D.retryCost;
    putProfile(UI.profile);
    $('#auto-start').checked = false;
    show(null);
    sfx.upgrade();
    G.music.play(G.music.trackForLevel(g.levelIdx));
    G.music.setTempoScale(Math.pow(1.01, g.wave - 1));
    banner(`Second chance — Wave ${g.wave}`);
    toast(`🪨 −${D.retryCost} pebbles. Lives restored to ${g.lives} — regroup and hold the line!`);
    updateWavePreview();
    renderDockSel();
    updateHud();
  }

  /* ---------- hero panel in the dock ---------- */
  function buildDockHero() {
    const box = $('#dock-hero');
    const g = UI.game;
    if (!g || !g.heroType) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'flex';
    box.innerHTML = '<div class="dp-label">hero</div>';
    const chip = el('button', 'hero-chip');
    chip.id = 'hero-chip';
    const cv = document.createElement('canvas');
    cv.width = 40; cv.height = 40;
    G.drawTowerIcon(cv, g.heroType);
    chip.appendChild(cv);
    chip.appendChild(el('span', 'hero-lv', ''));
    chip.onclick = () => {
      const gg = UI.game;
      if (!gg || gg.over) return;
      if (gg.heroTower) { gg.selected = gg.heroTower; gg.placingType = null; syncCancelBtn(); renderDockSel(); }
      else armTower(gg.heroType);
    };
    chip.addEventListener('mouseenter', () => showTooltip(chip, g.heroType));
    chip.addEventListener('mouseleave', hideTooltip);
    attachLongPress(chip, () => showTooltip(chip, g.heroType));
    attachTrayDrag(chip, g.heroType);
    box.appendChild(chip);
    const ab = el('button', 'btn tiny hero-abil');
    ab.id = 'hero-abil';
    const H = G.HEROES[g.heroType];
    ab.title = `${H.ability.name} — ${H.ability.desc}`;
    ab.onclick = fireHeroAbility;
    box.appendChild(ab);
    updateDockHero();
  }

  function updateDockHero() {
    const g = UI.game;
    const chip = $('#hero-chip'), ab = $('#hero-abil');
    if (!g || !g.heroType || !chip) return;
    const H = G.HEROES[g.heroType];
    const placed = !!g.heroTower;
    const cost = G.scaleCost(G.TOWERS[g.heroType].cost, g.diffId);
    chip.classList.toggle('placed', placed);
    chip.classList.toggle('armed', g.placingType === g.heroType);
    chip.classList.toggle('poor', !placed && g.cash < cost);
    chip.querySelector('.hero-lv').textContent = placed ? 'Lv ' + g.heroLevel : '🐟' + cost;
    const ready = placed && g.heroLevel >= H.ability.unlock && g.time >= g.heroReadyAt && !g.over;
    if (!placed) ab.innerHTML = `${H.ability.icon} place your hero`;
    else if (g.heroLevel < H.ability.unlock) ab.innerHTML = `${H.ability.icon} unlocks at lvl ${H.ability.unlock}`;
    else if (g.time < g.heroReadyAt) ab.innerHTML = `${H.ability.icon} ${Math.ceil(g.heroReadyAt - g.time)}s`;
    else ab.innerHTML = `${H.ability.icon} <b>${H.ability.name}</b> <kbd>H</kbd>`;
    ab.disabled = !ready;
    ab.classList.toggle('ready', ready);
  }

  function fireHeroAbility() {
    const g = UI.game;
    if (!g || g.over) return;
    const res = g.useHeroAbility();
    if (!res.ok) { sfx.error(); toast(res.msg, 'bad'); return; }
    sfx.boss();
    buzz(30);
    toast(`${G.HEROES[g.heroType].ability.icon} ${res.name}!`);
    updateDockHero();
  }

  /* ---------- Endless Tide (keep playing after victory) ---------- */
  function keepGoing() {
    const g = UI.game;
    if (!g || !g.goEndless()) return;
    $('#auto-start').checked = false;
    show(null);
    sfx.wave();
    G.music.play(G.music.trackForLevel(g.levelIdx));
    G.music.setTempoScale(Math.pow(1.01, g.wave - 1));
    banner(`🌊 The Endless Tide — Wave ${g.wave}`);
    toast('Victory is banked — now hold as long as you can. Every 10th wave pays 🪨 pebbles.');
    updateWavePreview();
    renderDockSel();
    updateHud();
  }

  /* ---------- boost shop ---------- */
  function buildShop(backTo) {
    const grid = $('#shop-grid');
    grid.innerHTML = '';
    for (const id of G.POWER_ORDER) {
      const P = G.POWERS[id];
      const owned = UI.profile.powerInv[id] || 0;
      const afford = UI.profile.pebbles >= P.cost;
      const card = el('div', 'shop-card');
      card.innerHTML = `
        <div class="shop-icon">${P.icon}</div>
        <div class="shop-name">${P.name}</div>
        <div class="shop-desc">${P.desc}</div>
        <div class="shop-row">
          <span class="shop-owned" title="How many you own">×${owned}</span>
          <button class="btn small${afford ? ' primary' : ''}" ${afford ? '' : 'disabled'}>Buy · ${P.cost} 🪨</button>
        </div>`;
      card.querySelector('button').onclick = () => {
        if (UI.profile.pebbles < P.cost) { sfx.error(); return; }
        UI.profile.pebbles -= P.cost;
        UI.profile.powerInv[id] = (UI.profile.powerInv[id] || 0) + 1;
        putProfile(UI.profile);
        sfx.upgrade();
        toast(`${P.icon} ${P.name} purchased — ×${UI.profile.powerInv[id]} in stock.`);
        buildShop(backTo);
      };
      grid.appendChild(card);
    }
    $('#btn-shop-back').onclick = () => show(backTo || '#screen-menu');
    show('#screen-shop');
  }

  /* ---------- command dock: selection card ---------- */
  function renderDockSel() {
    const g = UI.game;
    const box = $('#dock-sel');
    if (!g) return;
    // on compact layouts the card only takes space when it has something to say
    box.classList.toggle('has-sel', !!(g.selected || g.placingType));

    if (g.placingType) {
      const def = G.TOWERS[g.placingType];
      const color = G.CLASSES[def.cls].color;
      box.innerHTML = '';
      box.appendChild(el('div', 'ds-placing', IS_TOUCH
        ? `<b style="color:${color}">${def.name}</b> — drag onto the map to place.<br>
           <span class="dim">Lift your finger where you want it.</span>`
        : `<b style="color:${color}">${def.name}</b> — click the map to place.<br>
           <span class="dim">Hold <kbd>Shift</kbd> for more · <kbd>Esc</kbd> cancel</span>`));
      return;
    }

    const t = g.selected;
    if (!t) {
      box.innerHTML = `
        <div class="ds-empty">
          <div class="ds-lvl">${g.level.name}</div>
          <div class="dim">Click a penguin to manage it,<br>or press a key to build.</div>
        </div>`;
      return;
    }

    const def = G.TOWERS[t.type];
    const color = def.hero ? '#ffd166' : G.CLASSES[def.cls].color;
    const c = t.calc;
    box.innerHTML = '';

    const head = el('div', 'ds-head');
    const cv = document.createElement('canvas');
    cv.width = 40; cv.height = 40;
    G.drawTowerIcon(cv, t.type, t.up);
    head.appendChild(cv);
    const stats = [];
    if (c.damage) stats.push(`⚔ ${Math.round(c.damage * t.buff.dmg * 10) / 10}`);
    if (c.rate) stats.push(`⚡ ${Math.round(c.rate * t.buff.rate * 100) / 100}/s`);
    if (c.range && c.range < 5000) stats.push(`◎ ${Math.round(c.range * t.buff.range)}`);
    if (c.income) stats.push(`+${fmt(c.income)}/w`);
    head.appendChild(el('div', '', `<div class="ds-name" style="color:${color}">${def.name}${def.hero ? ` · <span class="hero-tag">★ Lv ${g.heroLevel}</span>` : ''}</div><div class="ds-stats">${stats.join(' · ')}</div>`));
    box.appendChild(head);

    if (def.hero) {
      const H = G.HEROES[t.type];
      box.appendChild(el('div', 'ds-hero-note',
        `Levels up every 3 waves — damage grows with the herd’s strength.<br>` +
        `${H.ability.icon} <b>${H.ability.name}</b>${g.heroLevel < H.ability.unlock ? ` unlocks at level ${H.ability.unlock}` : ' — fire it from the hero panel or press <kbd>H</kbd>'}`));
      const act0 = el('div', 'ds-actions');
      const tgt0 = el('button', 'btn tiny', `<kbd>T</kbd> ${t.target}`);
      tgt0.title = 'Cycle targeting: first / last / strong / close';
      tgt0.onclick = () => cycleTarget();
      act0.appendChild(tgt0);
      const sell0 = el('button', 'btn tiny danger', `<kbd>X</kbd> sell ${fmt(t.invested * G.SELL_RATE)}`);
      sell0.onclick = () => sellSelected();
      act0.appendChild(sell0);
      box.appendChild(act0);
      return;
    }

    const upgRow = el('div', 'ds-upgs');
    for (let p = 0; p < 2; p++) {
      const path = def.paths[p];
      const tier = t.up[p];
      const key = p === 0 ? 'Q' : 'W';
      let btn;
      if (tier >= 3) {
        btn = el('button', 'btn upg-mini done', `<kbd>${key}</kbd><span class="um-name">★ ${path.name}</span><span class="um-sub">mastered</span>`);
        btn.disabled = true;
      } else if (tier === 2 && t.up[1 - p] >= 3) {
        btn = el('button', 'btn upg-mini done', `<kbd>${key}</kbd><span class="um-name">🔒 ${path.name}</span><span class="um-sub">path locked</span>`);
        btn.disabled = true;
      } else {
        const u = path.tiers[tier];
        const uCost = G.scaleCost(u.cost, g.diffId);
        btn = el('button', 'btn upg-mini' + (g.cash < uCost ? ' poor' : ' can'),
          `<kbd>${key}</kbd><span class="um-name">${u.name}</span><span class="um-desc">${u.desc}</span><span class="um-sub">${'●'.repeat(tier)}${'○'.repeat(3 - tier)} · <b>${fmt(uCost)}</b></span>`);
        btn.dataset.cost = uCost;   // updateHud re-checks this as fish come in
        btn.title = u.desc;
        btn.onclick = () => buyUpgrade(t, p);
      }
      upgRow.appendChild(btn);
    }
    box.appendChild(upgRow);

    const act = el('div', 'ds-actions');
    if (!['income', 'aura', 'spikes', 'pulse'].includes(c.kind)) {
      const tgt = el('button', 'btn tiny', `<kbd>T</kbd> ${t.target}`);
      tgt.title = 'Cycle targeting: first / last / strong / close';
      tgt.onclick = () => cycleTarget();
      act.appendChild(tgt);
    }
    const sell = el('button', 'btn tiny danger', `<kbd>X</kbd> sell ${fmt(t.invested * G.SELL_RATE)}`);
    sell.onclick = () => sellSelected();
    act.appendChild(sell);
    box.appendChild(act);
  }

  function buyUpgrade(t, p) {
    const g = UI.game;
    const res = g.buyUpgrade(t, p);
    if (res.ok) sfx.upgrade();
    else { sfx.error(); toast(res.msg, 'bad'); }
    renderDockSel(); updateHud();
  }
  function cycleTarget() {
    const t = UI.game && UI.game.selected;
    if (!t) return;
    const modes = ['first', 'last', 'strong', 'close'];
    t.target = modes[(modes.indexOf(t.target) + 1) % modes.length];
    renderDockSel();
  }
  function sellSelected() {
    const g = UI.game;
    const t = g && g.selected;
    if (!t) return;
    const refund = g.sellTower(t);
    sfx.sell();
    toast(`Sold for ${fmt(refund)}.`);
    renderDockSel(); updateHud();
  }
  function trySend() {
    const g = UI.game;
    if (g && !g.waveInProgress && !g.over) { g.startWave(); updateHud(); }
  }
  function togglePause() {
    const g = UI.game;
    if (g) { g.paused = !g.paused; updateHud(); }
  }
  function toggleMute() {
    UI.profile.muted = !UI.profile.muted;
    putProfile(UI.profile);
    G.music.setMuted(UI.profile.muted);
    updateHud();
  }
  function cycleSpeed() {
    const g = UI.game;
    if (!g) return;
    g.speed = g.speed === 1 ? 2 : g.speed === 2 ? 3 : 1;
    updateHud();
  }

  /* ---------- input ---------- */
  function canvasPos(ev) {
    const r = UI.canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * (G.W / r.width), y: (ev.clientY - r.top) * (G.H / r.height) };
  }

  function wireInput() {
    const cv = UI.canvas;

    /* One pointer path for mouse and finger alike. A mouse hovers freely; a
       finger only reports while it is down, so an armed penguin is dragged
       into position and placed on lift — you can see the ghost before
       committing, which a blind tap would never give you. */
    const hoverAt = (pos) => {
      const g = UI.game;
      if (!g) return;
      g.mouse = pos;
      let hover = null, bd = 30 * 30;
      for (const t of g.towers) {
        const d2 = (t.x - pos.x) ** 2 + (t.y - pos.y) ** 2;
        if (d2 < bd) { bd = d2; hover = t; }
      }
      g.hoverTower = hover;
      cv.style.cursor = g.placingType ? 'crosshair' : hover ? 'pointer' : 'default';
    };

    let downId = null, downPos = null, moved = false;

    cv.addEventListener('pointerdown', (ev) => {
      const g = UI.game;
      if (!g || g.over) return;
      downId = ev.pointerId;
      moved = false;
      downPos = canvasPos(ev);
      hoverAt(downPos);
      if (cv.setPointerCapture) { try { cv.setPointerCapture(ev.pointerId); } catch (e) {} }
      ev.preventDefault();
    });

    cv.addEventListener('pointermove', (ev) => {
      const g = UI.game;
      if (!g) return;
      const pos = canvasPos(ev);
      if (ev.pointerId === downId) {
        if (Math.hypot(pos.x - downPos.x, pos.y - downPos.y) > 10) moved = true;
        hoverAt(pos);
      } else if (ev.pointerType === 'mouse') {
        hoverAt(pos);           // free hover, mouse only
      }
    });

    const finish = (ev) => {
      const g = UI.game;
      if (ev.pointerId !== downId) return;
      downId = null;
      if (!g || g.over) return;
      const pos = canvasPos(ev);

      if (g.placingType) {
        const placed = g.placeTower(g.placingType, pos.x, pos.y);
        if (placed) {
          sfx.place();
          const cost = G.scaleCost(G.TOWERS[g.placingType].cost, g.diffId);
          if (!ev.shiftKey || g.cash < cost) g.placingType = null;
        } else {
          sfx.error();
        }
        syncCancelBtn();
        renderDockSel(); updateHud();
        return;
      }
      // a drag that wasn't placing anything shouldn't change the selection
      if (moved) return;
      let best = null, bd = 30 * 30;
      for (const t of g.towers) {
        const d2 = (t.x - pos.x) ** 2 + (t.y - pos.y) ** 2;
        if (d2 < bd) { bd = d2; best = t; }
      }
      g.selected = best;
      renderDockSel();
    };
    cv.addEventListener('pointerup', finish);
    cv.addEventListener('pointercancel', () => { downId = null; });

    cv.addEventListener('pointerleave', (ev) => {
      const g = UI.game;
      if (g && ev.pointerType === 'mouse') { g.mouse = { x: -999, y: -999 }; g.hoverTower = null; }
    });

    cv.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const g = UI.game;
      if (g) { g.placingType = null; g.selected = null; syncCancelBtn(); renderDockSel(); updateHud(); }
    });

    $('#btn-cancel-place').onclick = () => {
      const g = UI.game;
      if (!g) return;
      g.placingType = null;
      g.mouse = { x: -999, y: -999 };
      syncCancelBtn(); renderDockSel(); updateHud();
    };

    window.addEventListener('keydown', (ev) => {
      const g = UI.game;
      if (!g) return;
      const k = ev.key;

      if ((ev.metaKey || ev.ctrlKey) && k.toLowerCase() === 's') { ev.preventDefault(); doSave(false); return; }
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

      if (k === 'Escape') {
        if ($('#screen-pause').classList.contains('active')) { closePauseMenu(); return; }
        if ($('#overlay').style.display === 'flex') return; // other screens keep their own buttons
        if (g.placingType) { g.placingType = null; }
        else if (g.selected) { g.selected = null; }
        else { openPauseMenu(); return; }
        syncCancelBtn(); renderDockSel(); updateHud();
        return;
      }
      if ($('#overlay').style.display === 'flex') return; // don't play the game under a menu

      if (k === ' ' || k === 'Spacebar' || ev.code === 'Space') { ev.preventDefault(); trySend(); return; }
      if (k === 'Tab') { ev.preventDefault(); cycleSpeed(); return; }
      if (k === 'p' || k === 'P') { togglePause(); return; }
      if (k === 'm' || k === 'M') { toggleMute(); return; }
      if (k === 'h' || k === 'H') {   // hero: place if benched, otherwise fire the ability
        if (!g.heroType) return;
        if (g.heroTower) fireHeroAbility();
        else armTower(g.heroType);
        return;
      }

      // context keys for the selected penguin
      if (g.selected) {
        const lk = k.toLowerCase();
        if (lk === 'q') { buyUpgrade(g.selected, 0); return; }
        if (lk === 'w') { buyUpgrade(g.selected, 1); return; }
        if (lk === 't') { cycleTarget(); return; }
        if (lk === 'x') { sellSelected(); return; }
      }

      // build hotkeys
      const id = KEY_TO_TOWER[k.length === 1 ? k.toUpperCase() : k];
      if (id) armTower(id);
    });

    $('#send-wave').onclick = trySend;
    $('#btn-speed').onclick = cycleSpeed;
    $('#btn-pause').onclick = togglePause;
    $('#btn-save').onclick = () => doSave(false);
    $('#btn-menu').onclick = openPauseMenu;
    $('#btn-mute').onclick = toggleMute;
    $('#auto-start').onchange = (ev) => {
      const g = UI.game;
      if (g) { g.autoStart = ev.target.checked; if (!g.autoStart) g.nextWaveIn = null; updateHud(); }
    };
    $('#btn-end-menu').onclick = () => exitToMenu(false);
  }

  /* ---------- canvas sizing (world size varies per tier) ---------- */
  function sizeCanvas() {
    // phones push far more pixels per CSS unit; cap harder so the big
    // tier-3 maps don't ask a handset for a 3200x1840 backbuffer
    const dpr = Math.min(IS_TOUCH ? 1.5 : 2, window.devicePixelRatio || 1);
    UI.canvas.width = G.W * dpr;
    UI.canvas.height = G.H * dpr;
    UI.ctx = UI.canvas.getContext('2d');
    UI.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fitCanvas();
  }
  function fitCanvas() {
    if (!UI.canvas) return;
    const wrap = $('#stage');
    const availW = wrap.clientWidth - 16, availH = wrap.clientHeight - 16;
    const scale = Math.min(availW / G.W, availH / G.H);
    UI.canvas.style.width = G.W * scale + 'px';
    UI.canvas.style.height = G.H * scale + 'px';
  }

  /* ---------- main loop ---------- */
  let hudTick = 0, dockTick = 0, lastSelected = null, lastPlacing = null;
  function step(dt, now) {
    const g = UI.game;
    if (!g) return;

    const popsBefore = g.enemies.length;
    g.update(dt);
    if (g.enemies.length < popsBefore && now > UI.popSoundGate) {
      sfx.pop();
      UI.popSoundGate = now + 60;
    }

    G.render(UI.ctx, g, dt);

    hudTick -= dt;
    if (hudTick <= 0) { hudTick = 0.12; updateHud(); }
    dockTick -= dt;
    if (dockTick <= 0) {
      dockTick = 0.3;
      if (g.selected !== lastSelected || g.placingType !== lastPlacing) {
        lastSelected = g.selected; lastPlacing = g.placingType;
        renderDockSel();
      }
    }
  }

  function loop(now) {
    UI.rafId = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - UI.lastTime) / 1000) || 0.016;
    UI.lastTime = now;
    step(dt, now);
  }

  /* ---------- boot ---------- */
  UI.init = function () {
    if (IS_TOUCH) document.documentElement.classList.add('touch');
    UI.canvas = $('#game');
    sizeCanvas();
    // rotating the phone changes the whole layout budget
    window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 250));
    window.addEventListener('resize', fitCanvas);
    setTimeout(fitCanvas, 0);
    new ResizeObserver(fitCanvas).observe($('#stage'));

    buildMainMenu();
    wireInput();
    $('#btn-fs').onclick = toggleFullscreen;
    document.addEventListener('fullscreenchange', updateFsButton);
    document.addEventListener('webkitfullscreenchange', updateFsButton);
    updateFsButton();
    show('#screen-menu');
    UI.lastTime = performance.now();
    loop(UI.lastTime);

    // browsers unlock audio on the first gesture — start the menu tune then
    const kickAudio = () => {
      unlockMobileAudio();
      G.music.setMuted(UI.profile.muted);
      if (!UI.game) G.music.play('menu');
      window.removeEventListener('pointerdown', kickAudio);
      window.removeEventListener('keydown', kickAudio);
    };
    window.addEventListener('pointerdown', kickAudio);
    window.addEventListener('keydown', kickAudio);

    // Backstop: keep the simulation running even if the browser starves
    // requestAnimationFrame (embedded webviews, minimized panes, etc).
    setInterval(() => {
      const now = performance.now();
      if (now - UI.lastTime > 120) {
        const dt = Math.min(0.25, (now - UI.lastTime) / 1000);
        UI.lastTime = now;
        step(dt, now);
      }
    }, 66);
  };
})();
