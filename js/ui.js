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
  const num = (n) => Math.round(n).toLocaleString();   // a count, not a fish price
  /* Compact form for the selection card's stat line, which is one line by
     decree and has no room to grow. Deep endless drives hero damage into five
     and six figures and a long run's kill count with it — spelled out, those
     pushed the line past the card and the tail was silently ellipsed away.
     "36.2k" is both shorter and easier to read at a glance than "36,191". */
  const short = (n) => {
    n = Math.round(n);
    if (Math.abs(n) < 10000) return n.toLocaleString();
    if (Math.abs(n) < 1e6) return (n / 1000).toFixed(n < 1e5 ? 1 : 0).replace(/\.0$/, '') + 'k';
    return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  };

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
    // audio levels, 0..1. Music sits under the effects by default: it is a bed,
    // and the effects are the ones carrying information.
    if (p.musicVol == null) p.musicVol = 0.7;
    if (p.sfxVol == null) p.sfxVol = 1;
    if (p.heroSel === undefined) p.heroSel = 'hero_frost'; // null = fight heroless
    if (!p.colony) p.colony = {};                    // permanent Colony Upgrades tiers
    /* Colony rank. Profiles from the battlefields-defended era are seeded with
       the XP for the rank their wins had already earned (that drip gave five
       starters + two per battlefield), so nobody loses a penguin they had. */
    if (p.xp == null) {
      const grandfathered = Math.min(G.MAX_RANK, 1 + G.defendedCount(p) * 2);
      p.xp = G.xpForRank(grandfathered);
    }
    G.applyColony(p.colony);                         // perks live in G.PERK from here on
    // legacy profiles: a completed level was a 50-wave campaign → credit it as Hard
    for (const id in p.completed) {
      if (p.completed[id] && !p.diffDone[id]) p.diffDone[id] = { hard: true };
    }
    return p;
  }
  function putProfile(p) { store.set(PROFILE_KEY, p); }

  /* ---------- sound (tiny synth) ----------
     Every effect runs through one master gain rather than straight to the
     speakers, so a single slider can ride the whole set. Each beep still picks
     its own level; that is balance between the effects, this is how loud the
     effects are as a group. */
  let actx = null, sfxMaster = null, sfxVol = 1;
  function sfxCtx() {
    if (!actx) {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      sfxMaster = actx.createGain();
      sfxMaster.gain.value = sfxVol;
      sfxMaster.connect(actx.destination);
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function setSfxVolume(v) {
    sfxVol = Math.max(0, Math.min(1, Number(v) || 0));
    if (sfxMaster) sfxMaster.gain.value = sfxVol;
  }
  function beep(freq, dur, type, vol, slide) {
    if (UI.profile.muted || sfxVol <= 0) return;
    try {
      const ac = sfxCtx();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, ac.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ac.currentTime + dur);
      g.gain.setValueAtTime(vol || 0.04, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.connect(g).connect(sfxMaster);
      o.start(); o.stop(ac.currentTime + dur);
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
        const lock = towerLockMsg(id);
        if (lock) {
          sfx.error(); buzz(30);
          toast('🔒 ' + lock, 'bad');
          swallow = true;
          return;
        }
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
    syncRankChips();
  }

  function openPauseMenu() {
    const g = UI.game;
    if (!g || g.over) return;
    setPaused(true);
    show('#screen-pause');
  }
  function closePauseMenu() {
    show(null);
    setPaused(false);
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
    $('#btn-colony').onclick = () => buildColony('#screen-menu');
    $('#btn-heroes').onclick = () => { buildHeroRow($('#hero-row-menu')); show('#screen-heroes'); };
    $('#btn-heroes-back').onclick = () => show('#screen-menu');
    $('#btn-guide').onclick = () => buildGuide('#screen-menu');
    $('#btn-pause-guide').onclick = () => buildGuide('#screen-pause');
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
          <li class="diff-reward">win: +${D.pebbles} 🪨 · retry: ${G.scaleRetry(D.retryCost)} 🪨</li>
        </ul>`}`;
      if (!locked) card.onclick = () => startGame(levelIdx, null, dId);
      grid.appendChild(card);
    }
    buildHeroRow($('#hero-row'));
    $('#btn-diff-shop').onclick = () => buildShop('#screen-diff');
    $('#btn-diff-colony').onclick = () => buildColony('#screen-diff');
    $('#btn-diff-back').onclick = () => show('#screen-levels');
    show('#screen-diff');
  }

  /* ---------- hero picker (difficulty screen + heroes screen) ---------- */
  function buildHeroRow(row) {
    row = row || $('#hero-row');
    row.innerHTML = '';
    const p = UI.profile;
    const rescreen = () => {           // refresh pebble chips on whichever screen we're on
      const sc = row.closest('.screen');
      if (sc && sc.classList.contains('active')) show('#' + sc.id);
    };
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
          buildHeroRow(row);
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
          rescreen();               // pebble chips update wherever we are
          buildHeroRow(row);
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
    /* a class, not an inline display — the wide layout needs #dock to be
       display:contents so its panels can be placed into the page grid, and an
       inline style would win over that */
    $('#dock').classList.add('playing');
    fitCanvas();          // the dock's arrival changes what the map has to fill
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
    G.music.setTempoScale(G.tempoForWave(game.wave));
  }

  function exitToMenu(saveFirst) {
    const g = UI.game;
    if (g && saveFirst && !g.over) doSave(true);
    keepAwake(false);
    UI.game = null;
    $('#hud-stats').style.display = 'none';
    $('#hud-sys').style.display = 'none';
    $('#dock').classList.remove('playing');
    fitCanvas();          // and its departure gives the whole window back
    hideTooltip();
    G.music.play('menu');
    buildLevelSelect();
    show('#screen-levels');
  }

  function doSave(silent) {
    const g = UI.game;
    if (!g || g.over) return;
    bankXp();   // no-op if nothing new was felled; keeps quitting from losing XP
    const ok = store.set(saveKey(g.levelIdx), g.serialize());
    if (!silent) toast(ok ? '💾 Game saved.' : 'Save failed — browser storage unavailable.', ok ? '' : 'bad');
  }

  function onGameEvent(kind, payload) {
    const g = UI.game;
    if (kind === 'waveStart') {
      sfx.wave();
      // +1% tempo per wave, but the march stops getting faster at wave 75
      G.music.setTempoScale(G.tempoForWave(payload));
      if (g.endless && payload === G.ORCA_WAVE) {
        sfx.boss();
        banner('🌊 THE TIDE COMES IN — the orcas have found you');
        toast('The trails have flooded. Orcas hunt the herds and the colony alike — and every sea lion they swallow heals them.', 'bad');
      } else {
        banner(g.endless ? `🌊 Wave ${payload} — the tide rises` : `Wave ${payload} / ${g.totalWaves}`);
      }
      const spec = G.generateWave(g.levelIdx, payload);
      if (spec.groups.some((gr) => G.ENEMIES[gr.type].boss)) { sfx.boss(); banner(`⚠ Wave ${payload} — something huge is coming…`); }
      updateWavePreview();
      updateHud();
    } else if (kind === 'waveEnd') {
      bankXp();
      doSave(true);
      if (g.endless && payload.wave > g.totalWaves) {
        const p = UI.profile;
        p.endlessBest[g.level.id] = Math.max(p.endlessBest[g.level.id] || 0, payload.wave);
        // every 10th endless wave pays the drip; every 100th pays ten drips.
        // D.drip, not D.retryCost — rewards don't move when retry pricing does.
        if (payload.wave % 100 === 0) {
          const D = G.DIFFICULTIES[g.diffId];
          const bonus = D.drip * 10;
          p.pebbles += bonus;
          banner(`🌊 Wave ${payload.wave} — the tide bows to you`);
          toast(`🏆 Century! Wave ${payload.wave} survived: +${bonus} 🪨 pebbles`);
        } else if (payload.wave % 10 === 0) {
          const D = G.DIFFICULTIES[g.diffId];
          p.pebbles += D.drip;
          toast(`🌊 Wave ${payload.wave} survived! +${D.drip} 🪨 pebbles`);
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
      bankXp();          // the final wave's sea lions count too
      sfx.win();
      const p = UI.profile;
      const D = G.DIFFICULTIES[g.diffId];
      p.completed[g.level.id] = true;
      p.diffDone[g.level.id] = Object.assign({}, p.diffDone[g.level.id], { [g.diffId]: true });
      p.bestWave[g.level.id] = Math.max(p.bestWave[g.level.id] || 0, g.totalWaves);
      p.pebbles += D.pebbles;
      putProfile(p);
      store.del(saveKey(g.levelIdx));

      // who earned their fish this battle?
      const top = [...g.towers].sort((a, b) => (b.kills || 0) - (a.kills || 0))[0];
      const topLine = top && top.kills ? ` Top defender: ${G.TOWERS[top.type].name} — ${top.kills.toLocaleString()} sea lions.` : '';

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
      $('#end-sub').textContent = `${g.level.name} (${D.name}) is safe. All ${g.totalWaves} waves repelled with ${g.lives} lives to spare.` + topLine +
        ` Reward: +${D.pebbles} 🪨 pebbles — you now have ${p.pebbles.toLocaleString()}. ` +
        `${g.kills.toLocaleString()} sea lions destroyed — ${rankChipText()}.` + opened;
      show('#screen-end');
    } else if (kind === 'defeat') {
      G.music.stop();
      bankXp();          // a lost battle still earned every sea lion it felled
      sfx.lose();
      const p = UI.profile;
      p.bestWave[g.level.id] = Math.max(p.bestWave[g.level.id] || 0, g.wave - 1);
      if (g.endless) p.endlessBest[g.level.id] = Math.max(p.endlessBest[g.level.id] || 0, g.wave - 1);
      putProfile(p);
      store.del(saveKey(g.levelIdx));
      const D = G.DIFFICULTIES[g.diffId];
      const price = G.scaleRetry(D.retryCost);
      const afford = p.pebbles >= price;
      const rb = $('#btn-retry');
      rb.style.display = 'block';
      rb.disabled = !afford;
      rb.innerHTML = `🪨 Second Chance — retry wave ${g.wave} · ${price} pebbles`;
      rb.title = afford
        ? `Restore all ${g.startLives} lives and replay wave ${g.wave}. Towers and cash are kept.`
        : `You need ${price} 🪨 — win battles to earn more.`;
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
        $('#end-sub').textContent = `The sea lions broke through on wave ${g.wave}. You survived ${g.wave - 1} full waves ` +
          `and felled ${g.kills.toLocaleString()} sea lions — ${rankChipText()}.` +
          (afford ? ' The colony can rally, for a price…' : ' Regroup and try again!');
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

    // palette affordability + armed state (locked slots keep their look)
    for (const slot of document.querySelectorAll('#palette .slot')) {
      if (slot.classList.contains('locked')) continue;
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

    // kill counter on the open card ticks live while the wave runs — same
    // compact form the card was built with, or a long run would widen the
    // stat line out from under itself mid-wave
    const kEl = document.querySelector('.ds-kills');
    if (kEl && g.selected) kEl.textContent = short(g.selected.kills || 0);

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
    /* Bosses first. The strip is two rows tall and late waves field more enemy
       types than fit, so something has to be dropped — and the one chip you
       must not lose is the one naming the boss. It used to sort last and got
       sliced in half by the strip's clip. The wave number lives in the HUD at
       the top of the screen, so it is not repeated here. */
    const ordered = [...counts].sort((a, b) => (G.ENEMIES[b[0]].boss ? 1 : 0) - (G.ENEMIES[a[0]].boss ? 1 : 0));
    let html = '';
    for (const [type, n] of ordered) {
      const e = G.ENEMIES[type];
      html += e.boss
        ? `<span class="wp-chip boss" title="${e.name} — boss">☠ ${e.name}${n > 1 ? ' ×' + n : ''}</span>`
        : `<span class="wp-chip" title="${e.name}"><i style="background:${e.color}"></i>${n}</span>`;
    }
    box.innerHTML = html;
    /* Hide any chip that fell past the visible rows rather than letting the
       clip cut one through the middle — a half-height chip reads as a
       rendering fault, an absent one reads as "and some others". */
    const top = box.getBoundingClientRect().top;
    const limit = box.clientHeight + 1;
    let hidden = 0;
    for (const chip of box.children) {
      chip.style.visibility = '';
      if (chip.getBoundingClientRect().bottom - top > limit) { chip.style.visibility = 'hidden'; hidden++; }
    }
    if (hidden) box.title = `${hidden} more enemy type${hidden === 1 ? '' : 's'} in this wave`;
    else box.removeAttribute('title');
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
          /* No 🐟 on the tray price. A four-figure cost plus the emoji cannot
             fit a slot at the width the dock can spare, and the gold number
             already reads as a price — the tooltip and guide still spell it
             out with the icon. */
          slot.appendChild(el('span', 'slot-cost', String(G.scaleCost(def.cost, UI.game.diffId))));
          if (G.towerNeed(UI.profile, id)) {   // tower drip: not recruited yet
            slot.classList.add('locked');
            slot.appendChild(el('span', 'slot-lock', '🔒'));
          }
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

  // why this penguin can't be built yet (colony rank) — null when usable
  function towerLockMsg(id) {
    const need = G.towerNeed(UI.profile, id);
    if (!need) return null;
    const short = Math.max(0, G.xpForRank(need) - (UI.profile.xp || 0));
    return `${G.TOWERS[id].name} joins the colony at rank ${need} — ${short.toLocaleString()} more sea lions.`;
  }

  /* ---------- colony rank: XP banked from the battle, one penguin per rank ---------- */
  function bankXp() {
    const g = UI.game;
    if (!g) return;
    const gained = g.kills - g.xpBanked;
    if (gained <= 0) return;
    g.xpBanked = g.kills;
    const p = UI.profile;
    const before = G.rankFromXp(p.xp);
    p.xp = (p.xp || 0) + gained;
    const after = G.rankFromXp(p.xp);
    putProfile(p);
    for (let r = before + 1; r <= after; r++) {
      const id = G.unlockAtRank(r);
      sfx.win();
      banner(`⬆ Colony Rank ${r}`);
      toast(id
        ? `⬆ Rank ${r}! 🐧 ${G.TOWERS[id].name} joins the colony — build it right now.`
        : `⬆ Rank ${r}!`);
      if (id) buildPalette();   // the new penguin appears in the tray mid-battle
    }
    updateHud();
  }

  // "Rank 4 · 812 / 1,450" for the menu chips
  function rankChipText() {
    const pr = G.rankProgress(UI.profile.xp);
    return pr.maxed
      ? `Rank ${pr.rank} · every penguin recruited`
      : `Rank ${pr.rank} · ${(UI.profile.xp || 0).toLocaleString()} / ${pr.next.toLocaleString()} 🦭`;
  }
  function syncRankChips() {
    const pr = G.rankProgress(UI.profile.xp);
    for (const c of document.querySelectorAll('.js-rank')) c.textContent = rankChipText();
    for (const b of document.querySelectorAll('.js-rank-bar i')) {
      b.style.width = (pr.maxed ? 100 : Math.round((pr.into / pr.span) * 100)) + '%';
    }
  }

  function armTower(id) {
    const g = UI.game;
    if (!g || g.over) return;
    const lock = towerLockMsg(id);
    if (lock) { sfx.error(); toast('🔒 ' + lock, 'bad'); return; }
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
  /* The numbers a player is shown BEFORE building anything.
     G.TOWERS[id].stats holds the design-time figures; the global nerf is
     applied inside computeEffective, so any surface quoting stats has to go
     through it or it advertises a penguin that does not exist. This bit the
     guide and this tooltip once already — both were promising 1.2/s and 150
     range for a penguin that builds at 1.02/s and 128. */
  function shopStats(typeId) {
    const s = G.computeEffective(typeId, [0, 0]);
    if (s.damage) s.damage = Math.round(s.damage * 100) / 100;
    if (s.rate) s.rate = Math.round(s.rate * 100) / 100;
    if (s.range && s.range < 5000) s.range = Math.round(s.range);
    return s;
  }

  function showTooltip(anchor, typeId) {
    const def = G.TOWERS[typeId];
    const cls = G.CLASSES[def.cls];
    const s = shopStats(typeId);
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
      <div class="tt-key">${towerLockMsg(typeId)
        ? `🔒 ${towerLockMsg(typeId)}`
        : IS_TOUCH
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

  /* Floating card for an upgrade — the whole path laid out, with the tier you
     are about to buy highlighted, so the compact buttons lose no information. */
  function showUpgradeTip(anchor, typeId, pathIdx, tier) {
    const g = UI.game;
    const def = G.TOWERS[typeId];
    const path = def.paths[pathIdx];
    const u = path.tiers[tier];
    const cost = G.scaleCost(u.cost, g ? g.diffId : 'medium');
    const afford = g && g.cash >= cost;
    const rows = path.tiers.map((x, i) => {
      const state = i < tier ? 'own' : i === tier ? 'next' : 'later';
      return `<div class="tt-tier ${state}">
        <span class="tt-tier-dot">${i < tier ? '●' : i === tier ? '▸' : '○'}</span>
        <span><b>${x.name}</b> <span class="tt-cost">${fmt(G.scaleCost(x.cost, g ? g.diffId : 'medium'))}</span><br>
        <span class="tt-tier-desc">${x.desc}</span></span></div>`;
    }).join('');
    const tip = $('#tooltip');
    tip.innerHTML = `
      <div class="tt-head"><b>${path.name}</b><span class="tt-cost">${fmt(cost)}</span></div>
      <div class="tt-cls" style="color:${def.hero ? 'var(--gold)' : G.CLASSES[def.cls].color}">${def.name} — upgrade path ${pathIdx + 1}</div>
      <div class="tt-tiers">${rows}</div>
      <div class="tt-key">${afford ? `Press <kbd>${pathIdx === 0 ? 'Q' : 'W'}</kbd> or click to buy <b>${u.name}</b>` : `Need ${fmt(cost - (g ? g.cash : 0))} more`}</div>`;
    tip.style.display = 'block';
    const r = anchor.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - tr.width / 2;
    x = Math.max(8, Math.min(window.innerWidth - tr.width - 8, x));
    tip.style.left = x + 'px';
    tip.style.top = Math.max(8, r.top - tr.height - 10) + 'px';
  }

  /* ---------- Second Chance (paid retry after defeat) ---------- */
  function retryBattle() {
    const g = UI.game;
    if (!g || g.over !== 'lose') return;
    const D = G.DIFFICULTIES[g.diffId];
    const price = G.scaleRetry(D.retryCost);   // Rally Flags discount
    if (UI.profile.pebbles < price) { sfx.error(); return; }
    if (!g.retry()) return;
    UI.profile.pebbles -= price;
    putProfile(UI.profile);
    $('#auto-start').checked = false;
    show(null);
    sfx.upgrade();
    G.music.play(G.music.trackForLevel(g.levelIdx));
    G.music.setTempoScale(G.tempoForWave(g.wave));
    banner(`Second chance — Wave ${g.wave}`);
    toast(`🪨 −${price} pebbles. Lives restored to ${g.lives} — regroup and hold the line!`);
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

  /* ---------- Penguin Guide: the colony's field manual ---------- */
  function buildGuide(backTo) {
    const body = $('#guide-body');
    body.innerHTML = '';
    const p = UI.profile;

    // where the colony stands, and who joins next
    const pr = G.rankProgress(p.xp);
    const nextId = pr.maxed ? null : G.unlockAtRank(pr.rank + 1);
    body.appendChild(el('div', 'gd-rank', pr.maxed
      ? `<b>Colony Rank ${pr.rank}</b> — every penguin has been recruited.`
      : `<b>Colony Rank ${pr.rank}</b> · ${(p.xp || 0).toLocaleString()} / ${pr.next.toLocaleString()} sea lions` +
        (nextId ? ` — <b>${G.TOWERS[nextId].name}</b> joins at rank ${pr.rank + 1}, ${(pr.next - (p.xp || 0)).toLocaleString()} to go.` : '')));

    // one section per class, every tower with both full upgrade paths
    for (const clsKey of Object.keys(G.CLASSES)) {
      const cls = G.CLASSES[clsKey];
      const sec = el('div', 'gd-sec');
      sec.appendChild(el('div', 'gd-sec-head',
        `<span class="gd-sec-name" style="color:${cls.color}">${cls.name}</span><span class="gd-sec-desc">${cls.desc}</span>`));
      for (const id of G.TOWER_ORDER.filter((t) => G.TOWERS[t].cls === clsKey)) {
        const def = G.TOWERS[id];
        const s = shopStats(id);
        const need = G.towerNeed(p, id);
        const card = el('div', 'gd-card');
        const cv = document.createElement('canvas');
        cv.width = 44; cv.height = 44;
        G.drawTowerIcon(cv, id);
        const bits = [];
        if (s.damage) bits.push(`⚔ ${s.damage}`);
        if (s.rate) bits.push(`⚡ ${s.rate}/s`);
        if (s.range) bits.push(`◎ ${s.range >= 5000 ? '∞' : s.range}`);
        if (s.pierce > 1) bits.push(`pierce ${s.pierce}`);
        if (s.splash) bits.push(`splash ${s.splash}`);
        if (s.income) bits.push(`+🐟${s.income}/wave`);
        if (s.stealth) bits.push('sees stealth');
        if (s.water === 'only') bits.push('water only');
        const head = el('div', 'gd-head');
        head.appendChild(cv);
        head.appendChild(el('div', '', `
          <div class="gd-name" style="color:${cls.color}">${def.name}
            <span class="gd-cost">🐟${def.cost}</span>
            ${need ? `<span class="gd-lock">🔒 recruited at rank ${need}</span>` : ''}</div>
          <div class="gd-stats">${bits.join(' · ')}</div>
          <div class="gd-desc">${def.desc}</div>`));
        card.appendChild(head);
        const paths = el('div', 'gd-paths');
        for (const path of def.paths) {
          const col = el('div', 'gd-path');
          col.appendChild(el('div', 'gd-path-name', path.name));
          for (const t of path.tiers) {
            col.appendChild(el('div', 'gd-tier', `<b>${t.name}</b> <span class="gd-cost">🐟${t.cost}</span><br><span class="gd-tier-desc">${t.desc}</span>`));
          }
          paths.appendChild(col);
        }
        card.appendChild(paths);
        sec.appendChild(card);
      }
      body.appendChild(sec);
    }

    // heroes
    const hsec = el('div', 'gd-sec');
    hsec.appendChild(el('div', 'gd-sec-head',
      `<span class="gd-sec-name" style="color:var(--gold)">⭐ Heroes</span><span class="gd-sec-desc">One per battle. They level up on sea lions felled while they stand on the field — to level ${G.HERO_MAX_LEVEL} — and hit as hard as the herd is tough.</span>`));
    for (const id of G.HERO_ORDER) {
      const def = G.TOWERS[id];
      const H = G.HEROES[id];
      const card = el('div', 'gd-card');
      const cv = document.createElement('canvas');
      cv.width = 44; cv.height = 44;
      G.drawTowerIcon(cv, id);
      const head = el('div', 'gd-head');
      head.appendChild(cv);
      head.appendChild(el('div', '', `
        <div class="gd-name" style="color:var(--gold)">${def.name}
          <span class="gd-cost">${H.pebbles ? H.pebbles.toLocaleString() + ' 🪨 to recruit' : 'free'} · 🐟${def.cost} to place</span></div>
        <div class="gd-stats">${H.blurb}</div>
        <div class="gd-desc">${H.ability.icon} <b>${H.ability.name}</b> (level ${H.ability.unlock}, recharges ${H.ability.cd}s) — ${H.ability.desc}</div>`));
      card.appendChild(head);
      hsec.appendChild(card);
    }
    body.appendChild(hsec);

    // the enemy roster
    const esec = el('div', 'gd-sec');
    esec.appendChild(el('div', 'gd-sec-head',
      `<span class="gd-sec-name">🦭 The Sea Lions</span><span class="gd-sec-desc">Bigger ones break apart into smaller ones — a wave isn't over until the last pup is down.</span>`));
    const egrid = el('div', 'gd-enemies');
    for (const id of G.ENEMY_ORDER.filter((x) => !G.ENEMIES[x].orca)) {
      const e = G.ENEMIES[id];
      const traits = [];
      if (e.speed >= 120) traits.push('fast');
      if (e.stealth) traits.push('stealth — needs detection');
      if (e.armor) traits.push(`armor ${e.armor}`);
      if (e.regen) traits.push(`regenerates ${e.regen}/s`);
      if (e.boss) traits.push('BOSS');
      egrid.appendChild(el('div', 'gd-enemy' + (e.boss ? ' boss' : ''), `
        <span class="gd-dot" style="background:${e.color}"></span>
        <div><div class="gd-ename">${e.name} <span class="gd-cost">${e.hp} hp · ${e.lives} ♥ if it leaks · 🐟${e.bounty}</span></div>
        <div class="gd-etraits">${traits.length ? traits.join(' · ') + ' · ' : ''}${e.children.length ? 'splits into ' + e.children.map((c) => G.ENEMIES[c].name).join(' + ') : 'the smallest — just pops'}</div></div>`));
    }
    esec.appendChild(egrid);
    body.appendChild(esec);

    // the orcas — deep endless only
    const osec = el('div', 'gd-sec');
    osec.appendChild(el('div', 'gd-sec-head',
      `<span class="gd-sec-name" style="color:#7fd4f0">🐋 The Orcas</span>` +
      `<span class="gd-sec-desc">From Endless wave ${G.ORCA_WAVE} the trails flood and the hunters arrive. They never split — and any ordinary sea lion that swims into one is swallowed, healing it. Clear the herd fast or you are feeding them.</span>`));
    const ogrid = el('div', 'gd-enemies');
    for (const id of G.ORCA_ORDER) {
      const e = G.ENEMIES[id];
      const traits = [`armor ${e.armor}`, `heals ${Math.round(e.eat * 100)}% per sea lion eaten`];
      if (e.boss) traits.push('SUPER BOSS — Endless wave 100');
      ogrid.appendChild(el('div', 'gd-enemy' + (e.boss ? ' boss' : ''), `
        <span class="gd-dot" style="background:${e.color}"></span>
        <div><div class="gd-ename">${e.name} <span class="gd-cost">${e.hp.toLocaleString()} hp · ${e.lives} ♥ if it leaks · 🐟${e.bounty.toLocaleString()}</span></div>
        <div class="gd-etraits">${traits.join(' · ')}</div></div>`));
    }
    osec.appendChild(ogrid);
    body.appendChild(osec);

    $('#btn-guide-back').onclick = () => show(backTo);
    show('#screen-guide');
  }

  /* ---------- Colony Upgrades: permanent pebble-bought perks ---------- */
  function buildColony(backTo) {
    const grid = $('#colony-grid');
    grid.innerHTML = '';
    for (const id of G.COLONY_ORDER) {
      const C = G.COLONY[id];
      const tier = UI.profile.colony[id] || 0;
      const maxed = tier >= C.tiers.length;
      const next = maxed ? null : C.tiers[tier];
      const afford = next && UI.profile.pebbles >= next.cost;
      const pips = C.tiers.map((t, i) =>
        `<span class="cu-pip${i < tier ? ' on' : ''}" title="Tier ${i + 1}: ${C.fmt(t.v)}"></span>`).join('');
      const card = el('div', 'shop-card');
      card.innerHTML = `
        <div class="shop-icon">${C.icon}</div>
        <div class="shop-name">${C.name} <span class="cu-pips">${pips}</span></div>
        <div class="shop-desc">${C.desc}</div>
        <div class="cu-now">${tier ? '✓ now: ' + C.fmt(C.tiers[tier - 1].v) : ' '}</div>
        <div class="shop-row">
          <span class="shop-owned">${maxed ? '★ fully upgraded' : 'next: ' + C.fmt(next.v)}</span>
          ${maxed ? '' : `<button class="btn small${afford ? ' primary' : ''}" ${afford ? '' : 'disabled'}>Buy · ${next.cost.toLocaleString()} 🪨</button>`}
        </div>`;
      if (!maxed) {
        card.querySelector('button').onclick = () => {
          if (UI.profile.pebbles < next.cost) { sfx.error(); return; }
          UI.profile.pebbles -= next.cost;
          UI.profile.colony[id] = tier + 1;
          G.applyColony(UI.profile.colony);
          putProfile(UI.profile);
          sfx.upgrade();
          toast(`${C.icon} ${C.name} — ${C.fmt(next.v)}, in every battle from now on.`);
          buildColony(backTo);
        };
      }
      grid.appendChild(card);
    }
    $('#btn-colony-back').onclick = () => show(backTo);
    show('#screen-colony');
  }

  /* ---------- Endless Tide (keep playing after victory) ---------- */
  function keepGoing() {
    const g = UI.game;
    if (!g || !g.goEndless()) return;
    $('#auto-start').checked = false;
    show(null);
    sfx.wave();
    G.music.play(G.music.trackForLevel(g.levelIdx));
    G.music.setTempoScale(G.tempoForWave(g.wave));
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
    if (c.damage) {
      const d = c.damage * t.buff.dmg;
      stats.push(`⚔ ${d < 10000 ? Math.round(d * 10) / 10 : short(d)}`);
    }
    if (c.rate) stats.push(`⚡ ${Math.round(c.rate * t.buff.rate * 100) / 100}/s`);
    // ∞ rather than nothing for the map-wide reaches (Harpoon Sniper, Bosun
    // Rook) — an absent range chip read as "this one has no range at all"
    if (c.range) stats.push(`◎ ${c.range >= 5000 ? '∞' : Math.round(c.range * t.buff.range)}`);
    /* A vendor's headline number is what it will ACTUALLY pay next wave, not
       its sticker income — with other vendors on the map those differ, and the
       gap is the whole thing a player needs to see before buying another. */
    const vpay = c.income ? g.vendorPayouts().find((p) => p.tower === t) : null;
    if (vpay) {
      const all = g.vendorPayouts();
      stats.push(`+${fmt(vpay.got)}/w`);
      /* The falloff rides on the stat line, right beside the number it
         explains, rather than as a row of its own. The card's height is fixed
         and a vendor already spends it on a head, two upgrade buttons and an
         action row — a fourth row pushed the sell button out of the card. */
      if (all.length > 1) stats.push(`<span class="ds-rank">stall ${vpay.rank}/${all.length} · ${Math.round(vpay.share * 100)}%</span>`);
    }
    // ☠ only where it can ever be non-zero — vendors and aura towers never shoot
    if (!['income', 'aura'].includes(c.kind))
      stats.push(`<span title="Sea lions destroyed by this penguin">☠ <b class="ds-kills">${short(t.kills || 0)}</b></span>`);
    head.appendChild(el('div', '', `<div class="ds-name" style="color:${color}">${def.name}${def.hero ? ` · <span class="hero-tag">★ Lv ${g.heroLevel}</span>` : ''}</div><div class="ds-stats">${stats.join(' · ')}</div>`));
    box.appendChild(head);

    /* The falloff has to be explained somewhere, and the stat line has room
       only for the headline. The long version hangs off the whole stat line as
       a tooltip — you buy a second stall, the wave payout barely moves, and
       this is what connects the two. */
    if (vpay) {
      const all = g.vendorPayouts();
      const statsEl = head.querySelector('.ds-stats');
      if (all.length > 1) {
        statsEl.title = vpay.rank === 1
          ? `The richest stall sells at full price. Every further vendor earns ${Math.round((1 - G.VENDOR_FALLOFF) * 100)}% less than the one above it — a second is worth 70% of this one, a third 49%.`
          : `Vendors undercut each other. This is stall ${vpay.rank} of ${all.length}, so it earns ${Math.round(vpay.share * 100)}% of full price: ${fmt(vpay.full)} becomes ${fmt(vpay.got)} each wave.`;
      } else {
        statsEl.title = `Pays ${fmt(vpay.got)} at the end of every wave. Build a second vendor and it earns only ${Math.round(G.VENDOR_FALLOFF * 100)}% of what this one does — the market only bears so many stalls.`;
      }
    }

    if (def.hero) {
      const H = G.HEROES[t.type];
      /* Show the actual count and what it is counting toward. A level that
         arrives on a hidden threshold feels arbitrary; a number you watch
         climb is the whole appeal of levelling on kills.

         Two single lines and a bar, and no more: the card is a fixed height
         and the action row still has to fit beneath this. Written long, this
         note ran to 89px in the ~50px it actually has and pushed the sell
         button out through the bottom of the card. The wordy version lives in
         the tooltip. */
      const prog = G.heroProgress(g.heroKills);
      const xpLine = prog
        ? `<b>${num(prog.into)}</b> / ${num(prog.need)} sea lions to Lv ${prog.next}` +
          `<span class="hero-xp"><i style="width:${Math.round((prog.into / prog.need) * 100)}%"></i></span>`
        : `<b>Level ${G.HERO_MAX_LEVEL}</b> — fully grown`;
      const abil = g.heroLevel < H.ability.unlock
        ? `${H.ability.icon} ${H.ability.name} · <b>Lv ${H.ability.unlock}</b>`
        : `${H.ability.icon} <b>${H.ability.name}</b> · <kbd>H</kbd>`;
      const note = el('div', 'ds-hero-note', `<span class="hn-line">${xpLine}</span><span class="hn-line">${abil}</span>`);
      note.title = (prog
        ? `${num(prog.into)} of ${num(prog.need)} sea lions toward Level ${prog.next}. Heroes level on sea lions felled while they stand on the field, and each level costs more than the last.`
        : `Level ${G.HERO_MAX_LEVEL} is the ceiling. Damage still rises with the herd's strength on deeper waves.`) +
        (g.heroLevel < H.ability.unlock
          ? ` ${H.ability.name} unlocks at level ${H.ability.unlock}.`
          : ` ${H.ability.name}: fire it from the hero panel or press H.`);
      box.appendChild(note);
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
        /* No description inside the button — it lives in a floating card on
           hover, exactly like the build tray. That keeps every selection card
           the same height, which is what stops the dock (and the map with it)
           from jumping when you click a penguin. */
        btn = el('button', 'btn upg-mini' + (g.cash < uCost ? ' poor' : ' can'),
          `<kbd>${key}</kbd><span class="um-name">${u.name}</span><span class="um-sub">${'●'.repeat(tier)}${'○'.repeat(3 - tier)} · <b>${fmt(uCost)}</b></span>`);
        btn.dataset.cost = uCost;   // updateHud re-checks this as fish come in
        btn.onclick = () => buyUpgrade(t, p);
        btn.addEventListener('mouseenter', () => showUpgradeTip(btn, t.type, p, tier));
        btn.addEventListener('mouseleave', hideTooltip);
        attachLongPress(btn, () => showUpgradeTip(btn, t.type, p, tier));
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
  /* Single door for pausing, so the music can never disagree with the game.
     There are three ways to pause — the dock button, the P key, and the Esc
     menu — and the bed has to stop for all of them. */
  function setPaused(paused) {
    const g = UI.game;
    if (!g) return;
    g.paused = !!paused;
    G.music.setPaused(g.paused);
    updateHud();
  }
  function togglePause() {
    const g = UI.game;
    if (g) setPaused(!g.paused);
  }
  function toggleMute() {
    UI.profile.muted = !UI.profile.muted;
    putProfile(UI.profile);
    G.music.setMuted(UI.profile.muted);
    syncAudioControls();
    updateHud();
  }

  /* ---------- audio levels ----------
     Push the saved levels into the two engines. Called on boot, and whenever a
     slider moves, so the sliders and what you hear can't drift apart. */
  function applyAudioSettings() {
    G.music.setVolume(UI.profile.musicVol);
    setSfxVolume(UI.profile.sfxVol);
    G.music.setMuted(UI.profile.muted);
  }
  /* Two mount points (the pause screen and the main menu) show the same
     settings, so moving one has to redraw the other. */
  function syncAudioControls() {
    for (const box of document.querySelectorAll('.audio-panel')) {
      const m = box.querySelector('.au-music'), s = box.querySelector('.au-sfx');
      const mute = box.querySelector('.au-mute');
      if (m) { m.value = Math.round(UI.profile.musicVol * 100); m.nextElementSibling.textContent = m.value + '%'; }
      if (s) { s.value = Math.round(UI.profile.sfxVol * 100); s.nextElementSibling.textContent = s.value + '%'; }
      if (mute) {
        mute.textContent = UI.profile.muted ? '🔇 Sound is off' : '🔊 Sound is on';
        mute.classList.toggle('muted', !!UI.profile.muted);
      }
      box.classList.toggle('is-muted', !!UI.profile.muted);
    }
  }
  function buildAudioPanel(mount) {
    if (!mount || mount.querySelector('.audio-panel')) return;
    const box = el('div', 'audio-panel');
    box.innerHTML = `
      <div class="au-title">Audio</div>
      <label class="au-row"><span>Music</span>
        <input class="au-music" type="range" min="0" max="100" step="1" /><b>70%</b></label>
      <label class="au-row"><span>Effects</span>
        <input class="au-sfx" type="range" min="0" max="100" step="1" /><b>100%</b></label>
      <button class="btn tiny au-mute" type="button">🔊 Sound is on</button>`;
    const wire = (sel, key) => {
      const input = box.querySelector(sel);
      const readout = input.nextElementSibling;
      input.addEventListener('input', () => {
        UI.profile[key] = input.value / 100;
        readout.textContent = input.value + '%';
        /* Un-mute the moment someone reaches for a slider: leaving the toggle
           off would make a dragged slider do nothing at all, which reads as a
           broken control rather than a mute. */
        if (UI.profile.muted && UI.profile[key] > 0) UI.profile.muted = false;
        applyAudioSettings();
        putProfile(UI.profile);
        syncAudioControls();
        updateHud();
      });
    };
    wire('.au-music', 'musicVol');
    wire('.au-sfx', 'sfxVol');
    box.querySelector('.au-mute').addEventListener('click', toggleMute);
    mount.appendChild(box);
    syncAudioControls();
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
  /* ---- wide layout geometry ----
     The map keeps a fixed aspect, so a centred map always left dead bars either
     side. Here it is pinned top-left and the two leftovers are handed to real
     panels: the width the map does not use becomes the sidebar, the height it
     does not use becomes the build tray.

     Both are solved in one pass rather than by CSS auto-sizing, because letting
     the tray size itself from its content makes the three quantities circular —
     tray height sets map height sets map width sets sidebar width. Starting
     from the SMALLEST the tray can be gives the map its largest possible
     height, and everything else follows from that with no feedback. */
  /* Both floors were measured, not guessed: each was narrowed until something
     in it actually broke, swept against the worst content the game produces —
     a maxed Sun Priest's 15,295 sell price, a deep-endless stat line, and
     "Commander Beak · ★ Lv 20", which is the longest string the card can hold.
     The rail is clean at 200 and starts clipping the hero's ability line at
     195; the tray band is clean at 62 and drops a row at 58. Both sit one
     notch off the cliff. Every pixel saved here is a pixel of battlefield.
     ("🔒 Attunement" held the rail at 262 until the upgrade buttons stopped
     sharing a row — see the stacking rule in the wide-layout CSS.) */
  const SIDEBAR_MIN = 200, SIDEBAR_MAX = 460;
  /* When the tray moves into the column the column has a second job, and 200
     does not do it: five penguins across leaves a 27px slot for a 40px icon
     and clips the price under it. Measured the same way — clean at 240, the
     price overflows at 230. */
  const RAIL_TRAY_MIN = 240;
  const TRAY_MIN = 66;
  const PAD = 12;
  /* what the card, hero, boosts and wave controls stack to in the column, and
     the least tray worth putting above them — two class groups showing.
     The card is no longer a fixed 172px: with the upgrade buttons stacked it
     runs to 251 on its worst tower, and this figure has to assume that one is
     selected or the tray goes to a sliver exactly when you are using it. */
  const RAIL_PANELS_H = 650, TRAY_RAIL_MIN = 150;
  const wideLayout = () => matchMedia('(min-width: 1100px) and (min-height: 620px)').matches;

  function fitCanvas() {
    if (!UI.canvas) return;
    const wrap = $('#stage');
    const root = document.documentElement;

    if (wideLayout()) {
      const W = root.clientWidth, H = root.clientHeight, aspect = G.W / G.H;
      /* Between battles there is no dock, so the sidebar column collapses and
         the menu's backdrop gets the whole window. */
      const playing = $('#dock').classList.contains('playing');
      /* Two arrangements of the same three pieces, and geometry picks between
         them: size the map under each and keep the bigger one. The two are not
         symmetric, because a column holding the tray as well needs 40px more
         width than one holding only the four panels — so this has to be
         measured rather than reasoned about from the window's aspect alone.

         Band: the tray runs under the map, the column is as narrow as it goes,
         and the map takes whatever height the tray leaves. Always available.
         Rail-only: no band, the map takes the full height and the tray goes up
         the column beside it — worth it on a 16:9 desktop or a phone, where the
         map is height-limited and the strip under it would be 0-39px of nothing
         a tray could use. Only available when the column can still hold a tray
         once the four panels have taken their share; on a short wide window it
         could not, and the tray was squeezed to a 29px sliver. */
      const railFor = (h, floor) => Math.max(floor, Math.min(SIDEBAR_MAX, W - h * aspect - PAD));
      const fit = (floor, trayBand) => {
        const maxH = H - (trayBand ? TRAY_MIN + PAD : PAD);
        const side = railFor(maxH, floor);
        const w = Math.min(W - side - PAD, maxH * aspect);
        return { side, w, h: w / aspect, area: w * (w / aspect) };
      };
      const band = fit(SIDEBAR_MIN, true);
      const rail = fit(RAIL_TRAY_MIN, false);
      /* Ties go to the band: where the two produce the same map — a 16:10
         laptop, where the map is width-limited either way — only the band
         spends the height left under it. */
      const railOnly = playing && H - RAIL_PANELS_H >= TRAY_RAIL_MIN && rail.area > band.area;

      /* Between battles there is no column and no tray, so the map simply takes
         the window. */
      const pick = !playing ? { side: 0, w: Math.min(W - PAD, (H - PAD) * aspect) }
        : railOnly ? rail : band;
      const side = pick.side, mapW = pick.w, mapH = mapW / aspect;

      $('#app').classList.toggle('rail-only', railOnly);
      root.style.setProperty('--sidew', Math.round(side) + 'px');
      root.style.setProperty('--trayh', playing && !railOnly ? Math.round(H - mapH - PAD) + 'px' : '0px');
      /* In the band, four class groups across one row when it is shallow and
         the usual two-by-two when the map left it height to spare. In the
         column they always stack. The two-by-two needs 137px — a 64px row
         twice, plus the gap and the band's own padding — and 140 keeps it a
         notch clear; the rows are a fixed height, so this does not drift with
         the window's width. */
      $('#palette').classList.toggle('one-row', !railOnly && H - mapH - PAD < 140);
      UI.canvas.style.width = Math.round(mapW) + 'px';
      UI.canvas.style.height = Math.round(mapH) + 'px';
      return;
    }

    root.style.removeProperty('--sidew');
    root.style.removeProperty('--trayh');
    $('#palette').classList.remove('one-row');
    $('#app').classList.remove('rail-only');
    const availW = wrap.clientWidth - PAD, availH = wrap.clientHeight - PAD;
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
    buildAudioPanel($('#menu-audio'));
    buildAudioPanel($('#pause-audio'));
    applyAudioSettings();
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
      applyAudioSettings();
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
