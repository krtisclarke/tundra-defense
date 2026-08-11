/* Tundra Defense — core simulation engine */
(function () {
  const G = (globalThis.G = globalThis.G || {});
  const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

  /* ---------- Path helpers ---------- */
  function buildPath(pts) {
    const segs = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
      const len = Math.hypot(dx, dy);
      segs.push({ x: pts[i].x, y: pts[i].y, dx: dx / len, dy: dy / len, len, start: total });
      total += len;
    }
    return { pts, segs, total };
  }

  function samplePath(path, d) {
    d = Math.max(0, Math.min(d, path.total - 0.001));
    let seg = path.segs[0];
    for (const s of path.segs) { if (d >= s.start) seg = s; else break; }
    const t = d - seg.start;
    return { x: seg.x + seg.dx * t, y: seg.y + seg.dy * t, ang: Math.atan2(seg.dy, seg.dx) };
  }

  function distToPath(path, x, y) {
    let best = Infinity;
    for (const s of path.segs) {
      const px = x - s.x, py = y - s.y;
      const t = Math.max(0, Math.min(s.len, px * s.dx + py * s.dy));
      best = Math.min(best, dist2(x, y, s.x + s.dx * t, s.y + s.dy * t));
    }
    return Math.sqrt(best);
  }

  /* ---------- Effective tower stats (base + upgrades) ---------- */
  function computeEffective(typeId, up) {
    const def = G.TOWERS[typeId];
    const s = Object.assign({}, def.stats);
    const fx = {};
    for (const k in (def.stats.fx || {})) fx[k] = def.stats.fx[k];
    for (let p = 0; p < 2; p++) {
      for (let t = 0; t < up[p]; t++) {
        const mods = def.paths[p].tiers[t].mods || {};
        for (const k in (mods.add || {})) s[k] = (s[k] || 0) + mods.add[k];
        for (const k in (mods.mul || {})) s[k] = (s[k] || 0) * mods.mul[k];
        for (const k in (mods.set || {})) s[k] = mods.set[k];
        for (const k in (mods.fx || {})) fx[k] = mods.fx[k];
      }
    }
    s.fx = fx;
    return s;
  }
  G.computeEffective = computeEffective;

  /* ---------- Game ---------- */
  let nextId = 1;

  class Game {
    constructor(levelIdx, diffId, heroType) {
      const L = G.LEVELS[levelIdx];
      G.setDims(L);   // world size varies by tier; everything reads G.W/G.H
      this.levelIdx = levelIdx;
      this.level = L;
      this.diffId = G.DIFFICULTIES[diffId] ? diffId : 'medium';
      /* hero: chosen before battle, placed like a tower, one per battle */
      this.heroType = G.TOWERS[heroType] && G.TOWERS[heroType].hero ? heroType : null;
      this.heroTower = null;      // the placed hero (a towers[] entry) or null
      this.heroWaves = 0;         // waves cleared while placed -> level
      this.heroLevel = 1;
      this.heroReadyAt = 0;       // game time when the ability recharges
      this.totalWaves = G.DIFFICULTIES[this.diffId].waves;
      this.startLives = G.scaleLives(L.lives, this.diffId);
      this.frenzyUntil = 0;
      this.paths = L.paths.map(buildPath);
      this.cash = L.cash + G.PERK.cash;   // Deeper Stores colony upgrade
      this.lives = this.startLives;
      this.wave = 1;              // next wave to start (1-based)
      this.waveInProgress = false;
      this.waveTime = 0;
      this.spawnQueue = [];       // [{type, t, pathIdx, hpMult}]
      this.enemies = [];
      this.projectiles = [];
      this.piles = [];            // ice-wall spikes on track
      this.towers = [];
      this.effects = [];          // transient visuals
      this.texts = [];            // floating cash/damage text
      this.time = 0;
      this.speed = 1;
      this.paused = false;
      this.autoStart = false;
      this.nextWaveIn = null;   // auto-start countdown (ticks only while unpaused)
      this.over = null;           // 'win' | 'lose'
      this.endless = false;       // set after victory if the player keeps going
      this.kills = 0;             // sea lions destroyed this battle = colony XP
      this.xpBanked = 0;          // how much of that is already on the profile
      this.selected = null;
      this.placingType = null;
      this.mouse = { x: -999, y: -999 };
      this.onEvent = null;        // ui callback: (kind, payload)
      this._altPath = 0;
    }

    emit(kind, payload) { if (this.onEvent) this.onEvent(kind, payload); }

    /* ----- placement ----- */
    inWater(x, y) {
      for (const w of this.level.water) {
        if (w.rect) {
          if (x >= w.rect.x && x <= w.rect.x + w.rect.w && y >= w.rect.y && y <= w.rect.y + w.rect.h) return true;
        } else if (dist2(x, y, w.x, w.y) <= w.r * w.r) return true;
      }
      return false;
    }

    canPlace(typeId, x, y) {
      const def = G.TOWERS[typeId];
      if (x < 20 || x > G.W - 20 || y < 46 || y > G.H - 20) return false;
      for (const p of this.paths) if (distToPath(p, x, y) < G.PATH_HALF + G.TOWER_R - 4) return false;
      for (const b of this.level.blockers) if (dist2(x, y, b.x, b.y) < (b.r + G.TOWER_R - 4) ** 2) return false;
      for (const t of this.towers) if (dist2(x, y, t.x, t.y) < (G.TOWER_R * 2 - 6) ** 2) return false;
      const water = def.stats.water || 'never';
      if (water === 'only' && !this.inWater(x, y)) return false;
      if (water === 'never' && this.inWater(x, y)) return false;
      return true;
    }

    placeTower(typeId, x, y) {
      const def = G.TOWERS[typeId];
      if (def.hero && (this.heroTower || typeId !== this.heroType)) return null; // one hero, the chosen one
      const cost = G.scaleCost(def.cost, this.diffId);
      if (this.cash < cost || !this.canPlace(typeId, x, y)) return null;
      this.cash -= cost;
      const t = {
        id: nextId++, type: typeId, x, y, up: [0, 0], target: 'first',
        invested: cost, cooldown: 0, orbitAngle: Math.random() * Math.PI * 2,
        calc: computeEffective(typeId, [0, 0]), buff: { dmg: 1, rate: 1, range: 1, stealth: false },
      };
      if (def.hero) { t.hero = true; this.heroTower = t; this.refreshHero(); }
      this.towers.push(t);
      this.recomputeBuffs();
      return t;
    }

    /* re-derive the hero's level and battle stats (called when either input
       moves: a wave cleared, the endless curve deepened, a save loaded) */
    refreshHero() {
      this.heroLevel = G.heroLevelFor(this.heroWaves);
      const t = this.heroTower;
      if (!t) return;
      t.calc = G.applyHeroScale(
        computeEffective(t.type, t.up), t.type, this.heroLevel,
        G.heroStrength(this.level, this.wave));
      this.recomputeBuffs();
    }

    /* the hero's signature ability: free, gated by level, recharges on game time */
    useHeroAbility() {
      const t = this.heroTower;
      if (this.over) return { ok: false, msg: 'The battle is over.' };
      if (!t) return { ok: false, msg: 'Place your hero first.' };
      const A = G.HEROES[t.type].ability;
      if (this.heroLevel < A.unlock) return { ok: false, msg: `${A.name} unlocks at level ${A.unlock}.` };
      if (this.time < this.heroReadyAt) return { ok: false, msg: `${A.name} is recharging.` };
      if (t.type === 'hero_frost') {
        const dmg = Math.round(30 * G.heroStrength(this.level, this.wave));
        for (const e of [...this.enemies]) {
          if (!e.dead) this.damageEnemy(e, dmg, null, { pure: true });
        }
        this.effects.push({ kind: 'boom', x: G.W / 2, y: G.H / 2, r: 420, life: 0.4, max: 0.4 });
      } else if (t.type === 'hero_beak') {
        this.frenzyUntil = Math.max(this.frenzyUntil, this.time + 8);
        this.effects.push({ kind: 'storm', x: t.x, y: t.y, r: 320, life: 0.6, max: 0.6 });
      } else if (t.type === 'hero_shiver') {
        for (const e of this.enemies) {
          if (e.dead) continue;
          e.stunUntil = Math.max(e.stunUntil, this.time + (e.boss ? 1 : 2.5));
        }
        this.effects.push({ kind: 'storm', x: G.W / 2, y: G.H / 2, r: 620, life: 0.6, max: 0.6 });
      }
      this.heroReadyAt = this.time + A.cd;
      return { ok: true, name: A.name };
    }

    buyUpgrade(tower, pathIdx) {
      const def = G.TOWERS[tower.type];
      if (def.hero) return { ok: false, msg: 'Heroes level up on their own as waves fall.' };
      const tier = tower.up[pathIdx];
      if (tier >= 3) return { ok: false, msg: 'Path maxed out.' };
      if (tier === 2 && tower.up[1 - pathIdx] >= 3) return { ok: false, msg: 'Only one path can reach Tier 3.' };
      const upg = def.paths[pathIdx].tiers[tier];
      const cost = G.scaleCost(upg.cost, this.diffId);
      if (this.cash < cost) return { ok: false, msg: 'Not enough fish.' };
      this.cash -= cost;
      tower.invested += cost;
      tower.up[pathIdx]++;
      tower.calc = computeEffective(tower.type, tower.up);
      this.recomputeBuffs();
      return { ok: true };
    }

    sellTower(tower) {
      const refund = Math.round(tower.invested * G.SELL_RATE);
      this.cash += refund;
      this.towers = this.towers.filter((t) => t !== tower);
      this.piles = this.piles.filter((p) => p.owner !== tower.id);
      if (tower.hero) this.heroTower = null; // level is kept — re-place to resume
      if (this.selected === tower) this.selected = null;
      this.recomputeBuffs();
      return refund;
    }

    towerPos(t) {
      if (t.calc.orbit) {
        return { x: t.x + Math.cos(t.orbitAngle) * t.calc.orbit, y: t.y + Math.sin(t.orbitAngle) * t.calc.orbit };
      }
      return t;
    }

    recomputeBuffs() {
      /* Fresh Catch takes the BEST vendor's rate rather than the sum — a
         per-kill bounty that stacked would just be vendor spam by another name. */
      this.bountyBonus = 0;
      for (const t of this.towers) {
        if (t.calc.bountyBonus) this.bountyBonus = Math.max(this.bountyBonus, t.calc.bountyBonus);
      }
      /* Auras used to add up flat and without limit, so the winning move was
         simply to build more of them: a real board reached x7 attack speed and
         x2.65 range on one penguin, and 44% of it was support towers. Now each
         extra source of the same buff counts for HALF the one before it (so a
         second drummer is worth 50%, a third 25%) and every channel has a hard
         ceiling. One excellent aura tower gets you most of the way; a wall of
         them gets you almost nothing more. */
      const inbox = new Map();
      for (const t of this.towers) inbox.set(t, { dmg: [], rate: [], range: [], shred: [], pierce: [], stealth: false });
      for (const s of this.towers) {
        const c = s.calc;
        // aura sources: dedicated aura towers, plus any unit carrying aura stats (heroes)
        if (c.kind !== 'aura' && !c.auraDmg && !c.auraRate && !c.auraRange && !c.auraStealth
            && !c.auraShred && !c.auraPierce) continue;
        const r2 = c.range * c.range;
        for (const t of this.towers) {
          if (t === s || t.calc.kind === 'aura' || t.calc.kind === 'income') continue;
          if (dist2(s.x, s.y, t.x, t.y) > r2) continue;
          const k = inbox.get(t);
          if (c.auraDmg) k.dmg.push(c.auraDmg);
          if (c.auraRate) k.rate.push(c.auraRate);
          if (c.auraRange) k.range.push(c.auraRange);
          if (c.auraShred) k.shred.push(c.auraShred);
          if (c.auraPierce) k.pierce.push(c.auraPierce);
          if (c.auraStealth) k.stealth = true;
        }
      }
      // strongest source in full, then halving: converges to 2x the best one
      const stack = (arr) => {
        arr.sort((a, b) => b - a);
        let f = 1, total = 0;
        for (const v of arr) { total += v * f; f *= 0.5; }
        return total;
      };
      for (const t of this.towers) {
        const k = inbox.get(t);
        t.buff = {
          dmg: Math.min(G.AURA_CAP.dmg, 1 + stack(k.dmg)),
          rate: Math.min(G.AURA_CAP.rate, 1 + stack(k.rate)),
          range: Math.min(G.AURA_CAP.range, 1 + stack(k.range)),
          shred: Math.min(G.AURA_CAP.shred, stack(k.shred)),
          pierce: Math.min(G.AURA_CAP.pierce, Math.round(stack(k.pierce))),
          stealth: k.stealth,
        };
      }
    }

    /* ----- waves ----- */
    startWave() {
      if (this.waveInProgress || this.over) return;
      this.nextWaveIn = null;
      const spec = G.generateWave(this.levelIdx, this.wave);
      this.waveReward = spec.reward;
      this.spawnQueue = [];
      let t = 0.35, firstGroup = true;
      for (const grp of spec.groups) {
        if (!firstGroup) t += grp.delay || 0; // first group marches immediately
        firstGroup = false;
        for (let i = 0; i < grp.count; i++) {
          let pathIdx = 0;
          if (this.paths.length > 1) {
            pathIdx = grp.path === 'alt' ? (this._altPath = 1 - this._altPath) : (grp.path || 0);
          }
          this.spawnQueue.push({ type: grp.type, t, pathIdx, hpMult: grp.hpMult || 1 });
          t += grp.spacing;
        }
      }
      this.waveInProgress = true;
      this.waveTime = 0;
      this.refreshHero();   // endless strength moves with the wave number
      this.emit('waveStart', this.wave);
    }

    spawnEnemy(type, pathIdx, dist, hpMult) {
      const def = G.ENEMIES[type];
      const hp = Math.ceil(def.hp * this.level.hpMult * (hpMult || 1));
      this.enemies.push({
        id: nextId++, type, pathIdx, dist,
        hp, maxHp: hp, hpMult: hpMult || 1,
        speed: def.speed * this.level.speedMult * (this.endless ? G.endlessSpeed(this.wave) : 1),
        armor: def.armor, stealth: def.stealth, regen: def.regen,
        size: def.size, rank: def.rank, boss: !!def.boss, orca: !!def.orca,
        slowF: 1, slowUntil: 0, dotDps: 0, dotUntil: 0, stunUntil: 0, revealUntil: 0,
        wob: Math.random() * Math.PI * 2,
      });
    }

    /* ----- combat helpers ----- */
    canSee(tower, e) {
      if (!e.stealth || e.revealUntil > this.time) return true;
      return !!(tower.calc.stealth || tower.buff.stealth);
    }

    pickTarget(t, pos, range) {
      const r2 = range * range;
      let best = null, bestKey = -Infinity;
      const minR2 = (t.calc.minRange || 0) ** 2;
      for (const e of this.enemies) {
        if (e.dead || !this.canSee(t, e)) continue;
        const ep = samplePath(this.paths[e.pathIdx], e.dist);
        const d2 = dist2(pos.x, pos.y, ep.x, ep.y);
        if (d2 > r2 || d2 < minR2) continue;
        let key;
        switch (t.target) {
          case 'last':   key = -e.dist; break;
          case 'strong': key = e.rank * 1e6 + e.hp; break;
          case 'close':  key = -d2; break;
          default:       key = e.dist; // first
        }
        if (key > bestKey) { bestKey = key; best = { e, ep, d2 }; }
      }
      return best;
    }

    damageEnemy(e, rawDmg, tower, opts) {
      opts = opts || {};
      const c = tower ? tower.calc : {};
      let dmg = rawDmg * (tower ? tower.buff.dmg : 1);
      if (e.boss && c.bossBonus) dmg *= c.bossBonus;
      if (!opts.pure && !c.armorPierce) {
        // Heroic Ballad and friends let nearby penguins punch through blubber
        const armor = Math.max(0, e.armor - (tower ? tower.buff.shred || 0 : 0));
        /* The 1-damage floor only applies to shots that HAVE damage. It used to
           apply unconditionally, so the Slush Thrower (damage 0, a pure slow)
           quietly dealt 1 per hit — which in turn made its "+1 damage" upgrade
           a literal no-op, since 0 and 1 both came out as 1. */
        dmg = rawDmg > 0 ? Math.max(1, dmg - armor) : Math.max(0, dmg - armor);
      }
      e.hp -= dmg;
      if (tower && c.fx) this.applyFx(e, c.fx);
      if (e.hp <= 0) this.killEnemy(e, tower);
      return dmg;
    }

    applyFx(e, fx) {
      /* Deep endless herds shrug off the chill (and the ice) — without this a
         wave-150 sea lion sits pinned at a third speed forever and the wave
         never resolves. Bosses resist on top of that, as they always did. */
      const resist = this.endless ? G.slowResist(this.wave) : 0;
      const soften = (f) => 1 - (1 - f) * (1 - resist);
      if (fx.slow) {
        const f = e.boss ? soften(1 - (1 - fx.slow.f) * 0.4) : soften(fx.slow.f);
        const dur = fx.slow.d * (e.boss ? 0.6 : 1) * (1 - resist * 0.5);
        if (f < e.slowF || e.slowUntil <= this.time) e.slowF = f;
        e.slowUntil = Math.max(e.slowUntil, this.time + dur);
      }
      if (fx.dot) {
        e.dotDps = Math.max(e.dotDps, fx.dot.dps);
        e.dotUntil = Math.max(e.dotUntil, this.time + fx.dot.d);
      }
      if (fx.shred && e.armor > 0) e.armor = Math.max(0, e.armor - fx.shred);
      if (fx.stun) {
        e.stunUntil = Math.max(e.stunUntil, this.time + fx.stun * (e.boss ? 0.25 : 1) * (1 - resist));
      }
    }

    killEnemy(e, tower) {
      if (e.dead) return;
      e.dead = true;
      this.kills++;                                     // leaks never reach here
      if (tower) tower.kills = (tower.kills || 0) + 1;
      const def = G.ENEMIES[e.type];
      const bounty = Math.max(1, Math.round(def.bounty * (this.level.bountyMult || 1) * G.PERK.bounty)
        + (this.bountyBonus || 0));   // Fresh Catch
      this.cash += bounty;
      this.texts.push({ x: 0, y: 0, e, txt: '+' + bounty + '🐟', life: 0.9, kind: 'cash' });
      // plague spread (Frost Witch T3)
      if (tower && tower.calc.plague && e.dotDps > 0) {
        const ep = samplePath(this.paths[e.pathIdx], e.dist);
        for (const o of this.enemies) {
          if (o === e || o.dead) continue;
          const op = samplePath(this.paths[o.pathIdx], o.dist);
          if (dist2(ep.x, ep.y, op.x, op.y) < 70 * 70) this.applyFx(o, { dot: { dps: e.dotDps, d: 2 } });
        }
      }
      for (let i = 0; i < def.children.length; i++) {
        this.spawnEnemy(def.children[i], e.pathIdx, Math.max(0, e.dist - 14 * (i + 1)), e.hpMult);
      }
      const ep = samplePath(this.paths[e.pathIdx], e.dist);
      this.effects.push({ kind: e.boss ? 'bossDeath' : 'pop', x: ep.x, y: ep.y, r: e.size, life: e.boss ? 0.8 : 0.3, max: e.boss ? 0.8 : 0.3, color: def.color });
      if (e.boss) this.emit('bossDown', def.name);
    }

    /* ----- Orcas devour the herds -----
       Any ordinary sea lion that drifts into an orca's jaws is swallowed
       whole. The player gets nothing for it — no bounty, no XP, no splits,
       and no life lost either; the sea lion simply ceases. The orca heals,
       but each meal is capped at a small slice of its own maximum, so a
       feeding orca is a stalling problem rather than an immortal one.
       Starving it — clearing the chaff first — is the counter-play. */
    orcaEat() {
      let fed = false;
      for (const o of this.enemies) {
        if (o.dead || !o.orca) continue;
        const maw = o.size * 0.9;
        const rate = G.ENEMIES[o.type].eat || 0.015;
        /* Total healing is capped at 60% of the orca's own maximum, however
           rich the herd is. Without it a big enough shoal could keep one
           topped up indefinitely; with it, feeding buys time and nothing more. */
        const budget = o.maxHp * 0.6 - (o.healed || 0);
        if (budget <= 0) continue;
        for (const e of this.enemies) {
          if (e.dead || e === o || e.orca || e.boss) continue;
          if (e.pathIdx !== o.pathIdx) continue;
          if (e.rank > G.EDIBLE_RANK) continue;         // too big to swallow
          if (Math.abs(e.dist - o.dist) > maw) continue;
          e.dead = true;
          e.devoured = true;                            // pays nothing, splits nothing
          /* The heal is a slice of the ORCA's bulk, not the meal's — late-game
             sea lions are crumbs beside a Great Orca, so scaling off the meal
             made this inert exactly where it mattered. Bigger prey still feeds
             better: a Brute is worth roughly twice a Pup. */
          const meal = o.maxHp * rate * (0.35 + 0.65 * (e.rank / G.EDIBLE_RANK));
          /* Only healing actually applied is charged against the budget — an
             unhurt orca still swallows the sea lion, it just banks nothing,
             so a healthy one can't be "fed empty" before the shooting starts. */
          const given = Math.max(0, Math.min(meal, o.maxHp * 0.6 - (o.healed || 0), o.maxHp - o.hp));
          o.healed = (o.healed || 0) + given;
          o.hp += given;
          const ep = samplePath(this.paths[e.pathIdx], e.dist);
          this.effects.push({ kind: 'devour', x: ep.x, y: ep.y, r: e.size, life: 0.45, max: 0.45 });
          fed = true;
        }
      }
      if (fed) this.emit('devour');
    }

    splashAt(x, y, radius, dmg, tower, maxHit, exclude) {
      const r2 = radius * radius;
      let hits = 0;
      // sort by distance so the closest are hit when capped
      const inRange = [];
      for (const e of this.enemies) {
        if (e.dead || e === exclude) continue;
        const ep = samplePath(this.paths[e.pathIdx], e.dist);
        const d2 = dist2(x, y, ep.x, ep.y);
        if (d2 <= r2) inRange.push({ e, d2 });
      }
      inRange.sort((a, b) => a.d2 - b.d2);
      for (const { e } of inRange) {
        if (hits >= maxHit) break;
        this.damageEnemy(e, dmg, tower);
        hits++;
      }
      this.effects.push({ kind: 'boom', x, y, r: radius, life: 0.35, max: 0.35 });
    }

    frenzyMult() { return this.time < this.frenzyUntil ? 1.5 : 1; }

    /* ----- Second Chance: revive after defeat (pebble cost handled by the UI).
       Clears the field and restores full lives; the fatal wave replays. ----- */
    retry() {
      if (this.over !== 'lose') return false;
      this.over = null;
      this.lives = this.startLives;
      this.enemies = [];
      this.projectiles = [];
      this.spawnQueue = [];
      this.waveInProgress = false;
      this.waveTime = 0;
      this.nextWaveIn = null;
      this.autoStart = false; // no instant re-send — let the player regroup
      return true;
    }

    /* ----- Endless Tide: keep playing past the final scripted wave.
       The victory is already banked; from here waves scale without end. ----- */
    goEndless() {
      if (this.over !== 'win') return false;
      this.over = null;
      this.endless = true;
      this.autoStart = false; // let the player take a breath first
      this.nextWaveIn = null;
      return true;
    }

    /* ----- power-ups (pebble accounting lives in the UI) ----- */
    usePower(id) {
      if (this.over) return { ok: false, msg: 'The battle is over.' };
      switch (id) {
        case 'fishfeast':
          this.cash += 600;
          return { ok: true };
        case 'icespikes':
          for (const path of this.paths) {
            const p = samplePath(path, Math.max(30, path.total - 130));
            this.piles.push({ x: p.x, y: p.y, charges: 40, damage: 10, owner: -2 });
          }
          return { ok: true };
        case 'frenzy':
          this.frenzyUntil = this.time + 15;
          return { ok: true };
        case 'freeze':
          for (const e of this.enemies) {
            if (e.dead) continue;
            e.stunUntil = Math.max(e.stunUntil, this.time + (e.boss ? 1.5 : 4));
          }
          this.effects.push({ kind: 'storm', x: G.W / 2, y: G.H / 2, r: 620, life: 0.6, max: 0.6 });
          return { ok: true };
        case 'heal':
          this.lives += 25;
          return { ok: true };
        case 'avalanche':
          for (const e of [...this.enemies]) {
            if (!e.dead) this.damageEnemy(e, 60, null, { pure: true });
          }
          this.effects.push({ kind: 'boom', x: G.W / 2, y: G.H / 2, r: 420, life: 0.4, max: 0.4 });
          return { ok: true };
      }
      return { ok: false, msg: 'Unknown power.' };
    }

    /* ----- firing ----- */
    fireTower(t, dt) {
      const c = t.calc;
      if (c.kind === 'income' || c.kind === 'aura') return;
      t.cooldown -= dt;
      if (t.cooldown > 0) return;
      const pos = this.towerPos(t);
      const range = c.range * t.buff.range;

      if (c.kind === 'spikes') {
        const mine = this.piles.filter((p) => p.owner === t.id);
        if (mine.length >= c.maxPiles) return;
        // drop a wall on a random path point within range
        const spots = [];
        for (let pi = 0; pi < this.paths.length; pi++) {
          const path = this.paths[pi];
          for (let d = 30; d < path.total - 30; d += 26) {
            const p = samplePath(path, d);
            if (dist2(pos.x, pos.y, p.x, p.y) <= range * range) spots.push(p);
          }
        }
        if (!spots.length) return;
        const p = spots[(Math.random() * spots.length) | 0];
        this.piles.push({ x: p.x, y: p.y, charges: c.charges, damage: c.spikeDmg, owner: t.id });
        t.cooldown = 1 / (c.rate * t.buff.rate * this.frenzyMult());
        return;
      }

      if (c.kind === 'pulse') {
        let any = false;
        const r2 = range * range;
        for (const e of this.enemies) {
          if (e.dead || !this.canSee(t, e)) continue;
          const ep = samplePath(this.paths[e.pathIdx], e.dist);
          if (dist2(pos.x, pos.y, ep.x, ep.y) <= r2) { any = true; break; }
        }
        if (!any) return;
        for (const e of [...this.enemies]) {
          if (e.dead || !this.canSee(t, e)) continue;
          const ep = samplePath(this.paths[e.pathIdx], e.dist);
          if (dist2(pos.x, pos.y, ep.x, ep.y) <= r2) this.damageEnemy(e, c.damage, t);
        }
        this.effects.push({ kind: 'storm', x: pos.x, y: pos.y, r: range, life: 0.5, max: 0.5 });
        t.lastShot = this.time;
        t.cooldown = 1 / (c.rate * t.buff.rate * this.frenzyMult());
        return;
      }

      const target = this.pickTarget(t, pos, range);
      if (!target) return;
      t.aim = Math.atan2(target.ep.y - pos.y, target.ep.x - pos.x);

      const shots = c.shots || 1;
      if (c.kind === 'snipe' || c.kind === 'ray') {
        for (let i = 0; i < shots; i++) {
          this.effects.push({ kind: c.kind === 'ray' ? 'ray' : 'snipeTrail', x: pos.x, y: pos.y, tx: target.ep.x, ty: target.ep.y, life: 0.12, max: 0.12 });
          this.damageEnemy(target.e, c.damage, t);
          /* chain harpoons / solar lance: bounce to extra targets. These kinds
             fire no projectile, so a pierce aura has to be added here or it
             would silently do nothing for the Harpoon Sniper and Sun Priest. */
          let extra = (c.pierce || 1) - 1 + (t.buff.pierce || 0), last = target.e;
          while (extra-- > 0) {
            const lp = samplePath(this.paths[last.pathIdx], last.dist);
            let nxt = null, nd = 130 * 130;
            for (const o of this.enemies) {
              if (o.dead || o === last || !this.canSee(t, o)) continue;
              const op = samplePath(this.paths[o.pathIdx], o.dist);
              const d2 = dist2(lp.x, lp.y, op.x, op.y);
              if (d2 < nd) { nd = d2; nxt = { o, op }; }
            }
            if (!nxt) break;
            this.effects.push({ kind: 'ray', x: lp.x, y: lp.y, tx: nxt.op.x, ty: nxt.op.y, life: 0.1, max: 0.1 });
            this.damageEnemy(nxt.o, c.damage, t);
            last = nxt.o;
          }
          if (target.e.dead) break;
        }
      } else if (c.kind === 'lob') {
        for (let i = 0; i < shots; i++) {
          const off = i === 0 ? 0 : 30;
          this.projectiles.push({
            kind: 'lob', sx: pos.x, sy: pos.y,
            tx: target.ep.x + (Math.random() - 0.5) * off, ty: target.ep.y + (Math.random() - 0.5) * off,
            t: 0, T: 0.55, splash: c.splash, damage: c.damage, pierce: c.pierce + (t.buff.pierce || 0), owner: t.id,
          });
        }
      } else if (c.kind === 'volley') {
        const n = c.volley;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + t.orbitAngle * 0.1;
          this.projectiles.push({
            kind: 'bullet', x: pos.x, y: pos.y, vx: Math.cos(a) * c.projSpeed, vy: Math.sin(a) * c.projSpeed,
            damage: c.damage, pierce: c.pierce + (t.buff.pierce || 0), splash: c.splash || 0, range, traveled: 0, owner: t.id, hit: [],
          });
        }
      } else { // bullet | homing
        for (let i = 0; i < shots; i++) {
          const spread = shots > 1 ? (i - (shots - 1) / 2) * 0.14 : 0;
          const a = t.aim + spread;
          this.projectiles.push({
            kind: c.kind, x: pos.x, y: pos.y,
            vx: Math.cos(a) * c.projSpeed, vy: Math.sin(a) * c.projSpeed,
            damage: c.damage, pierce: c.pierce + (t.buff.pierce || 0), splash: c.splash || 0,
            range: range * 1.4, traveled: 0, owner: t.id, targetId: target.e.id, hit: [],
          });
        }
      }
      this.effects.push({ kind: 'muzzle', x: pos.x, y: pos.y, a: t.aim, life: 0.14, max: 0.14 });
      t.lastShot = this.time;
      t.cooldown = 1 / (c.rate * t.buff.rate * this.frenzyMult());
    }

    /* ----- main update ----- */
    update(rawDt) {
      if (this.paused || this.over) return;
      const dt = Math.min(rawDt, 0.05) * this.speed;
      this.time += dt;

      // spawn
      if (this.waveInProgress) {
        this.waveTime += dt;
        while (this.spawnQueue.length && this.spawnQueue[0].t <= this.waveTime) {
          const s = this.spawnQueue.shift();
          this.spawnEnemy(s.type, s.pathIdx, 0, s.hpMult);
        }
      }

      // sonar decloak zones
      const decloakers = this.towers.filter((t) => t.calc.decloak);

      // enemies
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (e.stunUntil > this.time) { /* frozen */ } else {
          const slow = e.slowUntil > this.time ? e.slowF : 1;
          e.dist += e.speed * slow * dt;
        }
        if (e.slowUntil <= this.time) e.slowF = 1;
        if (e.regen && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.regen * dt);
        if (e.dotUntil > this.time) {
          e.hp -= e.dotDps * dt;
          if (e.hp <= 0) { this.killEnemy(e, null); continue; }
        }
        const path = this.paths[e.pathIdx];
        if (e.dist >= path.total) {
          e.dead = true; e.leaked = true;
          this.lives -= G.ENEMIES[e.type].lives;
          this.effects.push({ kind: 'leak', x: path.pts[path.pts.length - 1].x, y: path.pts[path.pts.length - 1].y, life: 0.5, max: 0.5 });
          this.emit('leak', e.type);
          continue;
        }
        if (e.stealth && decloakers.length) {
          const ep = samplePath(path, e.dist);
          for (const s of decloakers) {
            if (dist2(s.x, s.y, ep.x, ep.y) <= s.calc.range * s.calc.range) { e.revealUntil = this.time + 0.5; break; }
          }
        }
        // spikes
        if (this.piles.length) {
          const ep = samplePath(path, e.dist);
          for (const p of this.piles) {
            if (p.charges <= 0) continue;
            if (dist2(p.x, p.y, ep.x, ep.y) < 18 * 18) {
              p.charges--;
              this.damageEnemy(e, p.damage, null, { pure: true });
              this.effects.push({ kind: 'spikeHit', x: ep.x, y: ep.y, life: 0.2, max: 0.2 });
              if (e.dead) break;
            }
          }
        }
      }
      this.orcaEat();
      this.enemies = this.enemies.filter((e) => !e.dead);
      this.piles = this.piles.filter((p) => p.charges > 0);

      // towers
      for (const t of this.towers) {
        if (t.calc.orbit) t.orbitAngle += dt * (t.calc.orbitSpeed || 1.4);
        this.fireTower(t, dt);
      }

      // projectiles
      for (const pr of this.projectiles) {
        if (pr.kind === 'lob') {
          pr.t += dt;
          if (pr.t >= pr.T) {
            pr.dead = true;
            const owner = this.towers.find((t) => t.id === pr.owner);
            this.splashAt(pr.tx, pr.ty, pr.splash, pr.damage, owner, pr.pierce);
          }
          continue;
        }
        if (pr.kind === 'homing') {
          let tgt = this.enemies.find((e) => e.id === pr.targetId);
          if (!tgt) {
            let nd = 300 * 300;
            for (const e of this.enemies) {
              const ep = samplePath(this.paths[e.pathIdx], e.dist);
              const d2 = dist2(pr.x, pr.y, ep.x, ep.y);
              if (d2 < nd) { nd = d2; tgt = e; }
            }
            if (tgt) pr.targetId = tgt.id;
          }
          if (tgt) {
            const ep = samplePath(this.paths[tgt.pathIdx], tgt.dist);
            const a = Math.atan2(ep.y - pr.y, ep.x - pr.x);
            const sp = Math.hypot(pr.vx, pr.vy);
            const cur = Math.atan2(pr.vy, pr.vx);
            let da = a - cur;
            while (da > Math.PI) da -= 2 * Math.PI;
            while (da < -Math.PI) da += 2 * Math.PI;
            const turn = 6 * dt;
            const na = cur + Math.max(-turn, Math.min(turn, da));
            pr.vx = Math.cos(na) * sp; pr.vy = Math.sin(na) * sp;
          }
        }
        pr.x += pr.vx * dt; pr.y += pr.vy * dt;
        pr.traveled += Math.hypot(pr.vx, pr.vy) * dt;
        if (pr.traveled > (pr.range || 600) || pr.x < -60 || pr.x > G.W + 60 || pr.y < -60 || pr.y > G.H + 60) { pr.dead = true; continue; }
        // collision
        for (const e of this.enemies) {
          if (e.dead || pr.hit.includes(e.id)) continue;
          const owner = this.towers.find((t) => t.id === pr.owner);
          if (owner && !this.canSee(owner, e)) continue;
          const ep = samplePath(this.paths[e.pathIdx], e.dist);
          if (dist2(pr.x, pr.y, ep.x, ep.y) < (e.size + 6) ** 2) {
            if (pr.splash > 0) {
              pr.dead = true;
              /* the sea lion the shell actually struck always takes the hit —
                 big bodies used to shrug off blasts that burst on their rim,
                 outside the blast's own center-measured radius */
              this.damageEnemy(e, pr.damage, owner);
              this.splashAt(pr.x, pr.y, pr.splash, pr.damage, owner, Math.max(pr.pierce, 6), e);
              break;
            }
            this.damageEnemy(e, pr.damage, owner);
            pr.hit.push(e.id);
            pr.pierce--;
            this.effects.push({ kind: 'hit', x: ep.x, y: ep.y, life: 0.12, max: 0.12 });
            if (pr.pierce <= 0) { pr.dead = true; break; }
          }
        }
      }
      this.projectiles = this.projectiles.filter((p) => !p.dead);

      // effects & texts
      for (const fx of this.effects) fx.life -= dt;
      this.effects = this.effects.filter((f) => f.life > 0);
      for (const tx of this.texts) tx.life -= dt;
      this.texts = this.texts.filter((t) => t.life > 0);

      // defeat
      if (this.lives <= 0) {
        this.lives = 0;
        this.over = 'lose';
        this.emit('defeat');
        return;
      }

      // wave end
      if (this.waveInProgress && !this.spawnQueue.length && !this.enemies.length) {
        this.waveInProgress = false;
        const wr = Math.round(this.waveReward * G.PERK.reward);   // Keen Scouts
        this.cash += wr;
        let earned = wr;
        /* Vendor payouts, richest first, each extra vendor earning 70% of the
           one before it. Stacking vendors used to be a money printer with no
           ceiling; now a second is worth 0.7 of the first, a third 0.49, and
           the total converges — building more of them stops being the answer. */
        const vendors = this.towers
          .filter((t) => t.calc.kind === 'income')
          .sort((a, b) => (b.calc.income || 0) - (a.calc.income || 0));
        let share = 1;
        for (const t of vendors) {
          const c = t.calc;
          let pay = c.income || 0;
          // Trade Hub: pays per penguin standing in this vendor's circle
          if (c.tradeHub) {
            const r2 = (c.range || 0) ** 2;
            let near = 0;
            for (const o of this.towers) {
              if (o !== t && o.calc.kind !== 'income' && dist2(t.x, t.y, o.x, o.y) <= r2) near++;
            }
            pay += c.tradeHub * near;
          }
          if (c.interest) pay += Math.min(200, Math.round(this.cash * c.interest));
          const got = Math.round(pay * share);
          this.cash += got;
          earned += got;
          share *= 0.7;
        }
        // the hero grows with every wave it stood through
        if (this.heroTower) {
          this.heroWaves++;
          const was = this.heroLevel;
          this.refreshHero();
          if (this.heroLevel > was) this.emit('heroLevel', this.heroLevel);
        }
        const finished = this.wave;
        this.wave++;
        if (finished >= this.totalWaves && !this.endless) {
          this.over = 'win';
          this.emit('victory');
        } else {
          this.emit('waveEnd', { wave: finished, earned });
        }
      }

      // auto-start: lives in the sim so pausing pauses it too
      if (!this.waveInProgress && this.autoStart && !this.over) {
        this.nextWaveIn = this.nextWaveIn == null ? 1.2 : this.nextWaveIn - dt;
        if (this.nextWaveIn <= 0) this.startWave();
      } else if (!this.autoStart) {
        this.nextWaveIn = null;
      }
    }

    /* ----- serialization (mid-match saves) ----- */
    serialize() {
      return {
        v: 2, levelIdx: this.levelIdx, diff: this.diffId, cash: this.cash, lives: this.lives,
        wave: this.wave, waveInProgress: this.waveInProgress, waveTime: this.waveTime,
        waveReward: this.waveReward || 0, autoStart: this.autoStart, time: this.time,
        frenzyUntil: this.frenzyUntil || 0, endless: this.endless,
        kills: this.kills, xpBanked: this.xpBanked,
        heroType: this.heroType, heroWaves: this.heroWaves,
        heroReadyIn: Math.max(0, this.heroReadyAt - this.time),
        towers: this.towers.map((t) => ({ type: t.type, x: t.x, y: t.y, up: [...t.up], target: t.target, invested: t.invested, kills: t.kills || 0 })),
        spawnQueue: this.spawnQueue.map((s) => ({ ...s })),
        enemies: this.enemies.map((e) => ({
          type: e.type, pathIdx: e.pathIdx, dist: e.dist, hp: e.hp, maxHp: e.maxHp,
          hpMult: e.hpMult, armor: e.armor, stealth: e.stealth,
        })),
        piles: this.piles.map((p) => ({ ...p, owner: -1 })),
        savedAt: Date.now(),
      };
    }

    static deserialize(data) {
      // pre-difficulty saves were 50-wave campaigns at standard prices → closest is 'hard'
      const g = new Game(data.levelIdx, data.diff || 'hard', data.heroType);
      g.cash = data.cash; g.lives = data.lives; g.wave = data.wave;
      g.waveInProgress = data.waveInProgress; g.waveTime = data.waveTime;
      g.waveReward = data.waveReward; g.autoStart = !!data.autoStart; g.time = data.time || 0;
      g.frenzyUntil = data.frenzyUntil || 0; g.endless = !!data.endless;
      g.kills = data.kills || 0; g.xpBanked = data.xpBanked || 0;
      g.heroWaves = data.heroWaves || 0;
      g.heroReadyAt = g.time + (data.heroReadyIn || 0);
      for (const td of data.towers) {
        const t = {
          id: nextId++, type: td.type, x: td.x, y: td.y, up: [...td.up], target: td.target,
          invested: td.invested, cooldown: 0, orbitAngle: Math.random() * Math.PI * 2,
          kills: td.kills || 0,
          calc: computeEffective(td.type, td.up), buff: { dmg: 1, rate: 1, range: 1, stealth: false },
        };
        if ((G.TOWERS[td.type] || {}).hero) { t.hero = true; g.heroTower = t; }
        g.towers.push(t);
      }
      g.refreshHero();
      g.recomputeBuffs();
      g.spawnQueue = (data.spawnQueue || []).map((s) => ({ ...s }));
      for (const ed of data.enemies || []) {
        g.spawnEnemy(ed.type, ed.pathIdx, ed.dist, ed.hpMult);
        const e = g.enemies[g.enemies.length - 1];
        e.hp = ed.hp; e.maxHp = ed.maxHp; e.armor = ed.armor;
      }
      g.piles = (data.piles || []).map((p) => ({ ...p, owner: -1 }));
      return g;
    }
  }

  G.Game = Game;
  G.samplePath = samplePath;
  G.distToPath = distToPath;
})();
