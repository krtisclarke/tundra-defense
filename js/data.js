/* Tundra Defense — game data: classes, towers, upgrades, enemies, levels */
(function () {
  const G = (globalThis.G = globalThis.G || {});

  G.W = 1280;
  G.H = 800;
  G.PATH_HALF = 26;      // half-width of the track
  G.TOWER_R = 20;        // tower footprint radius
  G.SELL_RATE = 0.7;

  /* ---------------- Difficulty modes ----------------
     costMult scales every tower and upgrade price (rounded to $5).
     livesMult scales each level's starting lives (rounded to 5).
     waves is the campaign length — each ends on a boss wave.
     pebbles is the victory reward (persistent meta-currency);
     retryCost is the pebble price of a Second Chance after defeat;
     drip is the endless-wave payout basis (every 10th wave; ×10 each century)
     — kept separate so retry pricing can move without touching rewards. */
  G.DIFFICULTIES = {
    easy:   { name: 'Easy',   icon: '🐣', waves: 30, costMult: 0.85, livesMult: 1.25, pebbles: 100, retryCost: 40,  drip: 25 },
    medium: { name: 'Medium', icon: '🐧', waves: 40, costMult: 1.0,  livesMult: 1.0,  pebbles: 250, retryCost: 75,  drip: 50 },
    hard:   { name: 'Hard',   icon: '🦭', waves: 50, costMult: 1.15, livesMult: 0.8,  pebbles: 500, retryCost: 150, drip: 100 },
  };
  G.DIFF_ORDER = ['easy', 'medium', 'hard'];
  G.scaleCost = (raw, diffId) => {
    const D = G.DIFFICULTIES[diffId] || G.DIFFICULTIES.medium;
    return Math.max(5, Math.round((raw * D.costMult * G.PERK.cost) / 5) * 5);
  };
  G.scaleLives = (raw, diffId) => {
    const D = G.DIFFICULTIES[diffId] || G.DIFFICULTIES.medium;
    return Math.max(10, Math.round((raw * D.livesMult) / 5) * 5) + G.PERK.lives;
  };
  G.scaleRetry = (raw) => Math.max(5, Math.round((raw * G.PERK.retry) / 5) * 5);

  /* ---------------- Colony Upgrades ----------------
     Small forever-bonuses bought with pebbles — the permanent half of the
     meta-economy (boosts are the consumable half, heroes the trophies).
     Three tiers each; `v` is the value the perk system reads. */
  G.COLONY = {
    stores:    { name: 'Deeper Stores',   icon: '🐟', desc: 'The colony stockpiles herring: start every battle with extra fish.',
                 fmt: (v) => `+${v} starting 🐟`,            tiers: [{ cost: 300, v: 75 }, { cost: 800, v: 150 }, { cost: 1800, v: 250 }] },
    walls:     { name: 'Thicker Walls',   icon: '💖', desc: 'Reinforced nests: start every battle with extra lives.',
                 fmt: (v) => `+${v} starting lives`,         tiers: [{ cost: 300, v: 10 }, { cost: 800, v: 20 }, { cost: 1800, v: 35 }] },
    hooks:     { name: 'Sharper Hooks',   icon: '🪝', desc: 'Every sea lion popped pays more fish.',
                 fmt: (v) => `+${v}% bounties`,              tiers: [{ cost: 400, v: 4 }, { cost: 1000, v: 8 }, { cost: 2200, v: 12 }] },
    contracts: { name: 'Cheap Contracts', icon: '📜', desc: 'Penguins enlist for less: towers and upgrades cost less fish.',
                 fmt: (v) => `−${v}% tower prices`,          tiers: [{ cost: 500, v: 3 }, { cost: 1200, v: 6 }, { cost: 2600, v: 9 }] },
    flags:     { name: 'Rally Flags',     icon: '🚩', desc: 'The colony rallies for less: Second Chance costs fewer pebbles.',
                 fmt: (v) => `−${v}% retry price`,           tiers: [{ cost: 400, v: 20 }, { cost: 900, v: 35 }, { cost: 2000, v: 50 }] },
    scouts:    { name: 'Keen Scouts',     icon: '🔭', desc: 'Scouts salvage the beach: bigger fish rewards for every wave cleared.',
                 fmt: (v) => `+${v}% wave rewards`,          tiers: [{ cost: 400, v: 5 }, { cost: 1000, v: 10 }, { cost: 2200, v: 15 }] },
  };
  G.COLONY_ORDER = ['stores', 'walls', 'hooks', 'contracts', 'flags', 'scouts'];

  /* live perk values — neutral until a profile is applied (headless stays neutral) */
  G.PERK = { cash: 0, lives: 0, bounty: 1, cost: 1, retry: 1, reward: 1 };
  G.applyColony = function (colony) {
    colony = colony || {};
    const v = (id) => {
      const C = G.COLONY[id];
      const t = Math.min(colony[id] || 0, C.tiers.length);
      return t ? C.tiers[t - 1].v : 0;
    };
    G.PERK = {
      cash: v('stores'), lives: v('walls'),
      bounty: 1 + v('hooks') / 100, cost: 1 - v('contracts') / 100,
      retry: 1 - v('flags') / 100, reward: 1 + v('scouts') / 100,
    };
  };

  /* ---------------- Colony rank (XP levels) ----------------
     Every sea lion destroyed is 1 XP — splits included, so a Beachmaster is
     worth 17 and a Colossus 52. Each rank gained recruits exactly one new
     penguin. A brand-new colony fields five (one or two per class); the other
     fifteen arrive at ranks 2-16, weakest first, the Sun Priest last.

     The curve is measured, not guessed: a first Easy campaign yields ~2,140
     sea lions and all ten Frostlands battlefields ~30,900, so rank 16 lands
     just as the first campaign tier is finished. Harder difficulties field
     more sea lions per battle and so rank up faster — which is only fair. */
  G.MAX_RANK = 16;
  G.RANK_XP = [
    0,      // rank 1 — where everyone starts
    60, 300, 750, 1450, 2450,
    3700, 5250, 7150, 9400, 12000,
    14900, 18200, 21900, 26000, 30500,
  ];
  G.STARTERS = ['pebble', 'snowball', 'harpoon', 'aurora', 'vendor'];
  /* recruited one per rank, from rank 2 — cheap utility first, the heavy
     hitters and the big aura pieces last. The water pair (Torpedo Sub, Depth
     Charge Boat) lands at ranks 4 and 6, comfortably before Frozen River. */
  G.RANK_UNLOCKS = [
    'slush', 'shards', 'torpedo', 'glacier', 'depth',
    'sonar', 'shadow', 'witch', 'icewall', 'drummer',
    'jetpack', 'blizzard', 'artillery', 'igloo', 'sunpriest',
  ];

  G.xpForRank = (rank) => G.RANK_XP[Math.max(0, Math.min(G.MAX_RANK, rank) - 1)] || 0;
  G.rankFromXp = function (xp) {
    let r = 1;
    for (let i = 1; i < G.RANK_XP.length; i++) if ((xp || 0) >= G.RANK_XP[i]) r = i + 1;
    return r;
  };
  // XP into the current rank / XP that rank spans — for the progress bar
  G.rankProgress = function (xp) {
    xp = xp || 0;
    const rank = G.rankFromXp(xp);
    if (rank >= G.MAX_RANK) return { rank, into: 0, span: 0, next: null, maxed: true };
    const base = G.xpForRank(rank), next = G.xpForRank(rank + 1);
    return { rank, into: xp - base, span: next - base, next, maxed: false };
  };
  // the penguin a given rank recruits (null for rank 1)
  G.unlockAtRank = (rank) => G.RANK_UNLOCKS[rank - 2] || null;
  // 0 = usable now; otherwise the rank still needed
  G.towerNeed = function (profile, typeId) {
    if ((G.TOWERS[typeId] || {}).hero) return 0;
    if (G.STARTERS.includes(typeId)) return 0;
    const idx = G.RANK_UNLOCKS.indexOf(typeId);
    if (idx < 0) return 0;
    const need = idx + 2;
    return G.rankFromXp((profile || {}).xp) >= need ? 0 : need;
  };

  G.defendedCount = (profile) =>
    G.LEVELS.filter((L) => {
      const d = ((profile || {}).diffDone || {})[L.id];
      return d && (d.easy || d.medium || d.hard);
    }).length;

  /* ---------------- Campaign tiers ----------------
     Ten battlefields each. Later tiers use a physically larger map, tougher
     herds and richer bounties — even their Easy mode outbites the tier below. */
  G.TIERS = [
    { id: 1, name: 'The Frostlands', icon: '❄',
      blurb: 'The home shores. Open ground, gentle curves — where every penguin learns to throw.' },
    { id: 2, name: 'The Deep Tundra', icon: '🌨',
      blurb: 'Beyond the colony: wider country, thicker herds. Even the easy road here bites harder than the Frostlands ever did.' },
    { id: 3, name: 'The Frozen Abyss', icon: '🌑',
      blurb: 'The far ice, where the old leviathans wake. Sprawling, tangled battlefields and sea lions that shrug off everything you knew.' },
  ];
  // per-tier map size and bounty scaling (levels inherit these by position)
  const TIER_DIMS = { 1: { w: 1280, h: 800 }, 2: { w: 1440, h: 860 }, 3: { w: 1600, h: 920 } };
  const TIER_BOUNTY = { 1: 1, 2: 1.5, 3: 2.3 };

  /* The canvas world size changes per battlefield; everything that draws or
     places in world coordinates reads G.W/G.H, so we swap them per level. */
  G.setDims = function (L) { G.W = L.w || 1280; G.H = L.h || 800; };

  /* ---------------- Campaign progression ----------------
     Each difficulty runs its own chain through the campaign: you work along a
     tier battlefield by battlefield, and clearing a whole tier opens the next
     tier on that difficulty. A win also counts for every easier difficulty —
     if you cleared it on Hard you have plainly earned the Easy unlock too. */
  G.DIFF_RANK = { easy: 0, medium: 1, hard: 2 };

  function done(profile, levelId) { return (profile && profile.diffDone && profile.diffDone[levelId]) || {}; }

  // has this battlefield been beaten on `diffId` or anything harder?
  G.beatenAtLeast = function (profile, levelId, diffId) {
    const need = G.DIFF_RANK[diffId];
    const d = done(profile, levelId);
    return G.DIFF_ORDER.some((o) => G.DIFF_RANK[o] >= need && d[o]);
  };

  G.tierLevels = (tier) => G.LEVELS.filter((L) => L.tier === tier);

  G.tierUnlocked = function (profile, tier, diffId) {
    if (tier <= 1) return true;
    return G.tierLevels(tier - 1).every((L) => G.beatenAtLeast(profile, L.id, diffId));
  };

  G.levelUnlocked = function (profile, levelIdx, diffId) {
    const L = G.LEVELS[levelIdx];
    if (!L) return false;
    // grandfather clause: levels reached under the old single-track unlock stay open
    if (levelIdx < ((profile && profile.unlocked) || 1)) return true;
    if (!G.tierUnlocked(profile, L.tier, diffId)) return false;
    if (L.slot === 0) return true;
    return G.beatenAtLeast(profile, G.LEVELS[levelIdx - 1].id, diffId);
  };

  G.anyDiffUnlocked = (profile, levelIdx) =>
    G.DIFF_ORDER.some((d) => G.levelUnlocked(profile, levelIdx, d));

  // plain-English explanation of what stands between the player and this run
  G.lockReason = function (profile, levelIdx, diffId) {
    const L = G.LEVELS[levelIdx];
    if (!L || G.levelUnlocked(profile, levelIdx, diffId)) return null;
    const D = G.DIFFICULTIES[diffId];
    if (!G.tierUnlocked(profile, L.tier, diffId)) {
      const prev = G.TIERS.find((T) => T.id === L.tier - 1);
      const left = G.tierLevels(L.tier - 1).filter((x) => !G.beatenAtLeast(profile, x.id, diffId)).length;
      return `Clear ${prev.name} on ${D.name} first — ${left} battlefield${left === 1 ? '' : 's'} to go.`;
    }
    return `Beat ${G.LEVELS[levelIdx - 1].name} on ${D.name} first.`;
  };

  /* ---------------- Power-ups ----------------
     Bought with pebbles mid-match; priced in proportion to their impact. */
  G.POWERS = {
    fishfeast: { name: 'Fish Feast',  icon: '🐟', cost: 15, desc: 'The vendors donate their stock: +600 🐟, instantly.' },
    icespikes: { name: 'Ice Spikes',  icon: '🧊', cost: 20, desc: 'A wall of spikes (40 spikes × 10 dmg) rises near the exit of every trail.' },
    frenzy:    { name: 'War Frenzy',  icon: '🥁', cost: 25, desc: 'Every penguin attacks 50% faster for 15 seconds.' },
    freeze:    { name: 'Big Freeze',  icon: '❄️', cost: 30, desc: 'Every sea lion on the field freezes solid for 4s (bosses 1.5s).' },
    heal:      { name: 'Second Wind', icon: '💖', cost: 40, desc: 'The colony rallies: +25 lives.' },
    avalanche: { name: 'Avalanche',   icon: '🏔️', cost: 50, desc: '60 damage to every sea lion on the field, ignoring armor.' },
  };
  G.POWER_ORDER = ['fishfeast', 'icespikes', 'frenzy', 'freeze', 'heal', 'avalanche'];

  G.CLASSES = {
    frost:   { name: 'Frostline', color: '#e05252', desc: 'Reliable frontline damage — pebbles, snowballs and ice.' },
    navy:    { name: 'Navy',      color: '#3f7fd4', desc: 'Military hardware — snipers, subs, boats and artillery.' },
    mystic:  { name: 'Mystic',    color: '#9b59d0', desc: 'Aurora magic — piercing bolts, curses and storms.' },
    support: { name: 'Support',   color: '#3fae6a', desc: 'Economy, buffs, detection and track hazards.' },
  };

  /* ---------------- Towers ----------------
     stats keys the engine understands:
       range, rate (shots/s), damage, pierce, projSpeed, splash,
       kind: bullet | homing | lob | snipe | ray | volley | pulse | spikes | income | aura
       volley (count), shots (multishot), minRange, orbit (radius),
       income ($/wave), charges/spikeDmg/maxPiles (spikes),
       auraDmg/auraRate/auraRange/auraStealth (aura), stealth (detect), water: 'only'|'never'|'any',
       bossBonus (damage mult vs boss ranks), armorPierce
     fx applied to hit enemies: slow {f,d}, dot {dps,d}, shred (armor), stun (s)
     Upgrade mods: { add:{}, mul:{}, set:{}, fx:{} }                                    */
  G.TOWERS = {
    /* ---- FROSTLINE ---- */
    pebble: {
      cls: 'frost', name: 'Pebble Flinger', cost: 170,
      desc: 'A plucky penguin who hurls beach pebbles at sea lions.',
      stats: { range: 150, rate: 1.2, damage: 1, pierce: 1, projSpeed: 460, splash: 0, kind: 'bullet', water: 'never' },
      paths: [
        { name: 'Power', tiers: [
          { name: 'Sharp Pebbles',  cost: 110, desc: '+1 damage.',                        mods: { add: { damage: 1 } } },
          { name: 'Flipper Fury',   cost: 260, desc: 'Throws 60% faster.',                mods: { mul: { rate: 1.6 } } },
          { name: 'Boulder Toss',   cost: 850, desc: '+3 damage, small splash.',          mods: { add: { damage: 3, splash: 34, pierce: 3 } } },
        ]},
        { name: 'Reach', tiers: [
          { name: 'Keen Eyes',      cost: 90,  desc: '+30% range, sees stealth.',         mods: { mul: { range: 1.3 }, set: { stealth: true } } },
          { name: 'Piercing Throw', cost: 210, desc: 'Pebbles pierce 2 extra sea lions.', mods: { add: { pierce: 2 } } },
          { name: 'Twin Throw',     cost: 700, desc: 'Throws two pebbles at once.',       mods: { set: { shots: 2 } } },
        ]},
      ],
    },
    snowball: {
      cls: 'frost', name: 'Snowball Roller', cost: 300,
      desc: 'Rolls heavy snowballs that plow straight through the pack.',
      stats: { range: 135, rate: 0.75, damage: 2, pierce: 5, projSpeed: 330, splash: 0, kind: 'bullet', water: 'never' },
      paths: [
        { name: 'Mass', tiers: [
          { name: 'Packed Ice',     cost: 180, desc: '+1 damage.',                        mods: { add: { damage: 1 } } },
          { name: 'Giant Snowball', cost: 420, desc: '+2 damage, +4 pierce.',             mods: { add: { damage: 2, pierce: 4 } } },
          { name: 'Avalanche',      cost: 1300, desc: 'Massive snowballs crush 20 sea lions each.', mods: { add: { damage: 4, pierce: 14 }, mul: { projSpeed: 1.2 } } },
        ]},
        { name: 'Chill', tiers: [
          { name: 'Slush Coating',  cost: 200, desc: 'Snowballs slow targets 30%.',       mods: { fx: { slow: { f: 0.7, d: 1.6 } } } },
          { name: 'Rapid Rolling',  cost: 380, desc: 'Rolls 50% faster.',                 mods: { mul: { rate: 1.5 } } },
          { name: 'Deep Freeze',    cost: 1100, desc: 'Snowballs briefly freeze sea lions solid.', mods: { fx: { stun: 0.6, slow: { f: 0.5, d: 2 } } } },
        ]},
      ],
    },
    shards: {
      cls: 'frost', name: 'Ice Shard Gunner', cost: 260,
      desc: 'Blasts a ring of ice shards in all directions. Loves choke points.',
      stats: { range: 115, rate: 1.0, damage: 1, pierce: 1, projSpeed: 400, splash: 0, kind: 'volley', volley: 8, water: 'never' },
      paths: [
        { name: 'Barrage', tiers: [
          { name: 'Faster Firing',  cost: 150, desc: '+50% attack speed.',                mods: { mul: { rate: 1.5 } } },
          { name: 'Shard Storm',    cost: 400, desc: 'Fires 12 shards per volley.',       mods: { set: { volley: 12 } } },
          { name: 'Crystal Nova',   cost: 1200, desc: '16 shards, +1 damage, +1 pierce.', mods: { set: { volley: 16 }, add: { damage: 1, pierce: 1 } } },
        ]},
        { name: 'Edge', tiers: [
          { name: 'Razor Shards',   cost: 170, desc: '+1 damage.',                        mods: { add: { damage: 1 } } },
          { name: 'Long Splinters', cost: 330, desc: '+35% range, faster shards.',        mods: { mul: { range: 1.35, projSpeed: 1.3 } } },
          { name: 'Glacial Spikes', cost: 950, desc: 'Shards pierce 3 and chill targets.', mods: { add: { pierce: 3 }, fx: { slow: { f: 0.75, d: 1.2 } } } },
        ]},
      ],
    },
    glacier: {
      cls: 'frost', name: 'Glacier Cannon', cost: 490,
      desc: 'Lobs exploding chunks of glacier. Great against clumps.',
      stats: { range: 150, rate: 0.55, damage: 3, pierce: 14, projSpeed: 300, splash: 60, kind: 'bullet', water: 'never' },
      paths: [
        { name: 'Payload', tiers: [
          { name: 'Bigger Chunks',  cost: 300, desc: '+2 damage.',                        mods: { add: { damage: 2 } } },
          { name: 'Shattering Ice', cost: 650, desc: '+30 blast radius, +8 blast targets.', mods: { add: { splash: 30, pierce: 8 } } },
          { name: 'Calving Event',  cost: 1800, desc: 'Huge blasts that stun for 0.5s.',  mods: { add: { damage: 3 }, fx: { stun: 0.5 } } },
        ]},
        { name: 'Artillery', tiers: [
          { name: 'Spotter Chick',  cost: 250, desc: '+25% range, sees stealth.',         mods: { mul: { range: 1.25 }, set: { stealth: true } } },
          { name: 'Rapid Reload',   cost: 550, desc: '+55% attack speed.',                mods: { mul: { rate: 1.55 } } },
          { name: 'Cluster Ice',    cost: 1500, desc: 'Fires two chunks per shot.',       mods: { set: { shots: 2 } } },
        ]},
      ],
    },
    slush: {
      cls: 'frost', name: 'Slush Thrower', cost: 280,
      desc: 'Sprays sticky slush that drastically slows sea lions.',
      stats: { range: 125, rate: 1.1, damage: 0, pierce: 1, projSpeed: 360, splash: 26, kind: 'bullet', water: 'never', fx: { slow: { f: 0.5, d: 2.4 } } },
      paths: [
        { name: 'Sticky', tiers: [
          { name: 'Thicker Slush',  cost: 160, desc: 'Slow strengthened to 65%.',         mods: { fx: { slow: { f: 0.35, d: 2.4 } } } },
          { name: 'Wide Spray',     cost: 340, desc: 'Bigger splash, +25% range.',        mods: { add: { splash: 22 }, mul: { range: 1.25 } } },
          { name: 'Permafrost',     cost: 1000, desc: 'Slowed sea lions take 2 dmg/s corrosion.', mods: { fx: { dot: { dps: 2, d: 2.5 }, slow: { f: 0.3, d: 3 } } } },
        ]},
        { name: 'Volume', tiers: [
          { name: 'Faster Pumping', cost: 180, desc: '+50% attack speed.',                mods: { mul: { rate: 1.5 } } },
          { name: 'Chilling Bite',  cost: 300, desc: 'Slush now deals 1 damage.',         mods: { add: { damage: 1 } } },
          { name: 'Brain Freeze',   cost: 900, desc: 'Slush can briefly stun (0.4s).',    mods: { fx: { stun: 0.4 }, add: { damage: 1 } } },
        ]},
      ],
    },

    /* ---- NAVY ---- */
    harpoon: {
      cls: 'navy', name: 'Harpoon Sniper', cost: 380,
      desc: 'Unlimited range. One penguin, one harpoon, one very sorry sea lion.',
      stats: { range: 9999, rate: 0.45, damage: 7, pierce: 1, kind: 'snipe', water: 'never', armorPierce: true },
      paths: [
        { name: 'Caliber', tiers: [
          { name: 'Barbed Tips',    cost: 320, desc: '+6 damage.',                        mods: { add: { damage: 6 } } },
          { name: 'Whale Piercer',  cost: 900, desc: '+12 damage.',                       mods: { add: { damage: 12 } } },
          { name: 'Leviathan Lance', cost: 2600, desc: '+2x damage to boss sea lions.',   mods: { add: { damage: 15 }, set: { bossBonus: 3 } } },
        ]},
        { name: 'Marksman', tiers: [
          { name: 'Night Scope',    cost: 260, desc: 'Sees stealth sea lions.',           mods: { set: { stealth: true } } },
          { name: 'Quick Loader',   cost: 600, desc: '+80% attack speed.',                mods: { mul: { rate: 1.8 } } },
          { name: 'Chain Harpoons', cost: 1900, desc: 'Harpoons bounce to 3 extra targets.', mods: { add: { pierce: 3 } } },
        ]},
      ],
    },
    torpedo: {
      cls: 'navy', name: 'Torpedo Sub', cost: 360,
      desc: 'WATER ONLY. Fires homing torpedoes that never miss.',
      stats: { range: 175, rate: 0.9, damage: 3, pierce: 1, projSpeed: 300, splash: 0, kind: 'homing', water: 'only' },
      paths: [
        { name: 'Warhead', tiers: [
          { name: 'Heavy Torpedoes', cost: 280, desc: '+3 damage.',                       mods: { add: { damage: 3 } } },
          { name: 'Blast Charges',  cost: 620, desc: 'Torpedoes explode (45 radius).',    mods: { add: { splash: 45, pierce: 6 } } },
          { name: 'Torpedo Swarm',  cost: 1700, desc: 'Fires 3 torpedoes per volley.',    mods: { set: { shots: 3 } } },
        ]},
        { name: 'Sonar', tiers: [
          { name: 'Periscope',      cost: 220, desc: '+30% range, sees stealth.',         mods: { mul: { range: 1.3 }, set: { stealth: true } } },
          { name: 'Twin Tubes',     cost: 520, desc: '+70% attack speed.',                mods: { mul: { rate: 1.7 } } },
          { name: 'Hunter-Killer',  cost: 1400, desc: '+6 damage, +50% vs bosses.',       mods: { add: { damage: 6 }, set: { bossBonus: 1.5 } } },
        ]},
      ],
    },
    depth: {
      cls: 'navy', name: 'Depth Charge Boat', cost: 520,
      desc: 'WATER ONLY. Lobs depth charges that blast wide areas.',
      stats: { range: 165, rate: 0.5, damage: 4, pierce: 10, splash: 75, kind: 'lob', water: 'only' },
      paths: [
        { name: 'Ordnance', tiers: [
          { name: 'Bigger Barrels', cost: 350, desc: '+3 damage.',                        mods: { add: { damage: 3 } } },
          { name: 'Shockwave',      cost: 700, desc: '+30 blast radius, slows survivors.', mods: { add: { splash: 30 }, fx: { slow: { f: 0.65, d: 1.5 } } } },
          { name: 'Tsunami Charge', cost: 2000, desc: 'Enormous blasts, +5 damage.',      mods: { add: { damage: 5, splash: 30, pierce: 10 } } },
        ]},
        { name: 'Crew', tiers: [
          { name: 'Extra Hands',    cost: 300, desc: '+50% attack speed.',                mods: { mul: { rate: 1.5 } } },
          { name: 'Lookout Post',   cost: 480, desc: '+30% range, sees stealth.',         mods: { mul: { range: 1.3 }, set: { stealth: true } } },
          { name: 'Double Launcher', cost: 1500, desc: 'Lobs two charges per attack.',    mods: { set: { shots: 2 } } },
        ]},
      ],
    },
    jetpack: {
      cls: 'navy', name: 'Jetpack Penguin', cost: 750,
      desc: 'Finally, a penguin that flies. Orbits its post, strafing rapidly. Place anywhere.',
      stats: { range: 150, rate: 3.2, damage: 1, pierce: 1, projSpeed: 540, kind: 'bullet', orbit: 55, water: 'any' },
      paths: [
        { name: 'Gunnery', tiers: [
          { name: 'Heavy Rounds',   cost: 400, desc: '+1 damage.',                        mods: { add: { damage: 1 } } },
          { name: 'Dual Cannons',   cost: 900, desc: 'Fires two shots at once.',          mods: { set: { shots: 2 } } },
          { name: 'Gunship',        cost: 2400, desc: '+2 damage, +60% attack speed.',    mods: { add: { damage: 2 }, mul: { rate: 1.6 } } },
        ]},
        { name: 'Avionics', tiers: [
          { name: 'Thermal Visor',  cost: 350, desc: 'Sees stealth sea lions.',           mods: { set: { stealth: true } } },
          { name: 'Afterburners',   cost: 650, desc: '+30% range, faster orbit.',         mods: { mul: { range: 1.3 }, set: { orbitSpeed: 2.2 } } },
          { name: 'Missile Pods',   cost: 1800, desc: 'Shots explode on impact.',         mods: { add: { splash: 40, pierce: 5, damage: 1 } } },
        ]},
      ],
    },
    artillery: {
      cls: 'navy', name: 'Artillery Emperor', cost: 850,
      desc: 'An emperor penguin with a howitzer. Massive range, massive shells, blind up close.',
      stats: { range: 420, rate: 0.33, damage: 6, pierce: 16, splash: 85, kind: 'lob', minRange: 110, water: 'never' },
      paths: [
        { name: 'Shells', tiers: [
          { name: 'HE Shells',      cost: 500, desc: '+4 damage.',                        mods: { add: { damage: 4 } } },
          { name: 'Concussive Blast', cost: 1000, desc: 'Blasts stun for 0.4s.',          mods: { fx: { stun: 0.4 } } },
          { name: 'The Big One',    cost: 2800, desc: '+8 damage, +40 blast radius.',     mods: { add: { damage: 8, splash: 40, pierce: 12 } } },
        ]},
        { name: 'Logistics', tiers: [
          { name: 'Loader Team',    cost: 450, desc: '+50% attack speed.',                mods: { mul: { rate: 1.5 } } },
          { name: 'Forward Observer', cost: 700, desc: 'Sees stealth; smaller blind zone.', mods: { set: { stealth: true, minRange: 60 } } },
          { name: 'Firebase',       cost: 2200, desc: 'Shells burn the ground (3 dmg/s).', mods: { fx: { dot: { dps: 3, d: 3 } }, mul: { rate: 1.3 } } },
        ]},
      ],
    },

    /* ---- MYSTIC ---- */
    aurora: {
      cls: 'mystic', name: 'Aurora Mage', cost: 420,
      desc: 'Channels the southern lights into piercing bolts of aurora energy.',
      stats: { range: 145, rate: 0.9, damage: 2, pierce: 6, projSpeed: 380, kind: 'bullet', water: 'never' },
      paths: [
        { name: 'Radiance', tiers: [
          { name: 'Brighter Bolts', cost: 250, desc: '+2 damage.',                        mods: { add: { damage: 2 } } },
          { name: 'Arc Lightning',  cost: 600, desc: '+6 pierce, faster bolts.',          mods: { add: { pierce: 6 }, mul: { projSpeed: 1.35 } } },
          { name: 'Solar Flare',    cost: 1700, desc: 'Bolts explode at the end of their flight.', mods: { add: { damage: 3, splash: 55, pierce: 8 } } },
        ]},
        { name: 'Attunement', tiers: [
          { name: 'Third Eye',      cost: 220, desc: 'Sees stealth, +20% range.',         mods: { set: { stealth: true }, mul: { range: 1.2 } } },
          { name: 'Quick Casting',  cost: 500, desc: '+60% attack speed.',                mods: { mul: { rate: 1.6 } } },
          { name: 'Twin Auroras',   cost: 1400, desc: 'Casts two bolts per attack.',      mods: { set: { shots: 2 } } },
        ]},
      ],
    },
    witch: {
      cls: 'mystic', name: 'Frost Witch', cost: 560,
      desc: 'Curses sea lions — strips armor and rots their strength over time.',
      stats: { range: 135, rate: 0.8, damage: 1, pierce: 2, projSpeed: 330, kind: 'bullet', water: 'never', fx: { shred: 1, dot: { dps: 2, d: 3 } } },
      paths: [
        { name: 'Hex', tiers: [
          { name: 'Deeper Curse',   cost: 300, desc: 'Rot deals 4 dmg/s.',                mods: { fx: { dot: { dps: 4, d: 3 } } } },
          { name: 'Armor Rust',     cost: 550, desc: 'Strips 2 armor per hit.',           mods: { fx: { shred: 2 } } },
          { name: 'Plague of Brine', cost: 1600, desc: 'Rot deals 8 dmg/s for 4s and spreads on death.', mods: { fx: { dot: { dps: 8, d: 4 } }, set: { plague: true } } },
        ]},
        { name: 'Coven', tiers: [
          { name: 'Cursed Sight',   cost: 240, desc: 'Sees stealth, +20% range.',         mods: { set: { stealth: true }, mul: { range: 1.2 } } },
          { name: 'Double Hex',     cost: 520, desc: '+2 pierce, +40% speed.',            mods: { add: { pierce: 2 }, mul: { rate: 1.4 } } },
          { name: 'Winter’s Grasp', cost: 1300, desc: 'Cursed sea lions are slowed 35%.', mods: { fx: { slow: { f: 0.65, d: 2.5 } } } },
        ]},
      ],
    },
    blizzard: {
      cls: 'mystic', name: 'Blizzard Caller', cost: 800,
      desc: 'Summons howling storms that batter and slow everything nearby.',
      stats: { range: 135, rate: 0.5, damage: 2, kind: 'pulse', water: 'never', fx: { slow: { f: 0.6, d: 1.5 } } },
      paths: [
        { name: 'Tempest', tiers: [
          { name: 'Biting Winds',   cost: 400, desc: '+2 storm damage.',                  mods: { add: { damage: 2 } } },
          { name: 'Widening Gyre',  cost: 800, desc: '+35% storm radius.',                mods: { mul: { range: 1.35 } } },
          { name: 'Whiteout',       cost: 2200, desc: 'Storms freeze sea lions for 0.8s.', mods: { fx: { stun: 0.8 }, add: { damage: 2 } } },
        ]},
        { name: 'Frequency', tiers: [
          { name: 'Restless Sky',   cost: 380, desc: '+50% storm frequency.',             mods: { mul: { rate: 1.5 } } },
          { name: 'Hailstones',     cost: 750, desc: '+3 damage.',                        mods: { add: { damage: 3 } } },
          { name: 'Endless Winter', cost: 1900, desc: 'Storms nearly constantly (+80% frequency), stronger slow.', mods: { mul: { rate: 1.8 }, fx: { slow: { f: 0.45, d: 2 } } } },
        ]},
      ],
    },
    shadow: {
      cls: 'mystic', name: 'Shadow Diver', cost: 470,
      desc: 'A ninja penguin. Flings icicle shuriken fast, and always sees stealth.',
      stats: { range: 140, rate: 2.2, damage: 1, pierce: 2, projSpeed: 560, kind: 'bullet', stealth: true, water: 'never' },
      paths: [
        { name: 'Assassin', tiers: [
          { name: 'Honed Icicles',  cost: 280, desc: '+1 damage.',                        mods: { add: { damage: 1 } } },
          { name: 'Flurry',         cost: 620, desc: 'Throws 3 shuriken per attack.',     mods: { set: { shots: 3 } } },
          { name: 'Silent Blizzard', cost: 1800, desc: '+2 damage, +2 pierce, +40% speed.', mods: { add: { damage: 2, pierce: 2 }, mul: { rate: 1.4 } } },
        ]},
        { name: 'Sabotage', tiers: [
          { name: 'Numbing Strikes', cost: 260, desc: 'Hits slow sea lions 25%.',         mods: { fx: { slow: { f: 0.75, d: 1.4 } } } },
          { name: 'Deep Reach',     cost: 480, desc: '+35% range.',                       mods: { mul: { range: 1.35 } } },
          { name: 'Boss Hunter',    cost: 1500, desc: '+100% damage to boss sea lions.',  mods: { set: { bossBonus: 2 }, add: { damage: 1 } } },
        ]},
      ],
    },
    sunpriest: {
      cls: 'mystic', name: 'Sun Priest', cost: 2400,
      desc: 'The legendary penguin who bottled the midnight sun. Melts everything.',
      stats: { range: 165, rate: 4.0, damage: 3, pierce: 1, kind: 'ray', water: 'never', armorPierce: true },
      paths: [
        { name: 'Corona', tiers: [
          { name: 'Focused Beam',   cost: 1400, desc: '+3 damage.',                       mods: { add: { damage: 3 } } },
          { name: 'Solar Lance',    cost: 3200, desc: 'Beam burns through 4 sea lions.',  mods: { add: { pierce: 4, damage: 2 } } },
          { name: 'Supernova',      cost: 8000, desc: '+10 damage, +50% attack speed.',   mods: { add: { damage: 10 }, mul: { rate: 1.5 } } },
        ]},
        { name: 'Zenith', tiers: [
          { name: 'All-Seeing Light', cost: 1200, desc: 'Sees stealth, +25% range.',      mods: { set: { stealth: true }, mul: { range: 1.25 } } },
          { name: 'Searing Heat',   cost: 2800, desc: 'Targets burn for 6 dmg/s.',        mods: { fx: { dot: { dps: 6, d: 2.5 } } } },
          { name: 'Eclipse Engine', cost: 7000, desc: '+150% damage vs bosses.',          mods: { set: { bossBonus: 2.5 }, add: { damage: 4 } } },
        ]},
      ],
    },

    /* ---- SUPPORT ---- */
    /* Income halved Aug 2026: a measured audit had the maxed vendor printing
       1010 🐟/wave against wave rewards of ~150-220, paying itself back in
       ~5 waves — building vendors was simply the correct opening. */
    vendor: {
      cls: 'support', name: 'Fish Vendor', cost: 900,
      desc: 'Sells premium herring. Nets extra fish at the end of every wave.',
      stats: { kind: 'income', income: 65, range: 0, water: 'never' },
      paths: [
        { name: 'Business', tiers: [
          { name: 'Bigger Stall',   cost: 500, desc: '+55 🐟 per wave.',                  mods: { add: { income: 55 } } },
          { name: 'Fish Market',    cost: 1100, desc: '+110 🐟 per wave.',                mods: { add: { income: 110 } } },
          { name: 'Krill Konglomerate', cost: 2800, desc: '+275 🐟 per wave.',            mods: { add: { income: 275 } } },
        ]},
        { name: 'Finance', tiers: [
          { name: 'Loyal Customers', cost: 400, desc: '+40 🐟 per wave.',                 mods: { add: { income: 40 } } },
          { name: 'Pop-up Stands',  cost: 900, desc: '+85 🐟 per wave.',                  mods: { add: { income: 85 } } },
          { name: 'Penguin Bank',   cost: 2400, desc: 'Also pays 5% interest on saved fish each wave (max 200 🐟).', mods: { set: { interest: 0.05 } } },
        ]},
      ],
    },
    igloo: {
      cls: 'support', name: 'Igloo Fortress', cost: 1000,
      desc: 'HQ that inspires nearby penguins: +20% damage.',
      stats: { kind: 'aura', range: 170, auraDmg: 0.2, water: 'never' },
      paths: [
        { name: 'Command', tiers: [
          { name: 'War Room',       cost: 600, desc: 'Damage aura +35%.',                 mods: { add: { auraDmg: 0.15 } } },
          { name: 'Elite Training', cost: 1300, desc: 'Damage aura +55%, +20% aura range.', mods: { add: { auraDmg: 0.2 }, mul: { range: 1.2 } } },
          { name: 'High Command',   cost: 3200, desc: 'Damage aura +85% total.',          mods: { add: { auraDmg: 0.3 } } },
        ]},
        { name: 'Garrison', tiers: [
          { name: 'Watchtower',     cost: 500, desc: 'Nearby penguins see stealth.',      mods: { set: { auraStealth: true } } },
          { name: 'Drill Sergeant', cost: 1100, desc: 'Nearby penguins attack 15% faster.', mods: { add: { auraRate: 0.15 } } },
          { name: 'Fortress Walls', cost: 2600, desc: '+30% aura range, +15% more attack speed.', mods: { mul: { range: 1.3 }, add: { auraRate: 0.15 } } },
        ]},
      ],
    },
    sonar: {
      cls: 'support', name: 'Sonar Station', cost: 550,
      desc: 'Pings the ice: nearby penguins gain +15% range and stealth vision.',
      stats: { kind: 'aura', range: 190, auraRange: 0.15, auraStealth: true, water: 'never' },
      paths: [
        { name: 'Amplify', tiers: [
          { name: 'Big Dish',       cost: 350, desc: 'Range aura +25% total.',            mods: { add: { auraRange: 0.1 } } },
          { name: 'Deep Ping',      cost: 700, desc: '+30% aura radius.',                 mods: { mul: { range: 1.3 } } },
          { name: 'Grand Array',    cost: 1800, desc: 'Range aura +40% total.',           mods: { add: { auraRange: 0.15 } } },
        ]},
        { name: 'Decrypt', tiers: [
          { name: 'Signal Boost',   cost: 300, desc: 'Nearby penguins attack 10% faster.', mods: { add: { auraRate: 0.1 } } },
          { name: 'Echo Location',  cost: 650, desc: '+25% aura radius.',                 mods: { mul: { range: 1.25 } } },
          { name: 'Full Decloak',   cost: 1600, desc: 'Stealth sea lions in radius are revealed to ALL penguins.', mods: { set: { decloak: true } } },
        ]},
      ],
    },
    drummer: {
      cls: 'support', name: 'War Drummer', cost: 700,
      desc: 'Pounds a walrus-hide drum: nearby penguins attack 20% faster.',
      stats: { kind: 'aura', range: 160, auraRate: 0.2, water: 'never' },
      paths: [
        { name: 'Rhythm', tiers: [
          { name: 'Double Time',    cost: 450, desc: 'Speed aura +35% total.',            mods: { add: { auraRate: 0.15 } } },
          { name: 'Battle Anthem',  cost: 950, desc: 'Speed aura +55% total.',            mods: { add: { auraRate: 0.2 } } },
          { name: 'Thunder Drums',  cost: 2400, desc: 'Speed aura +80% total, +20% radius.', mods: { add: { auraRate: 0.25 }, mul: { range: 1.2 } } },
        ]},
        { name: 'Morale', tiers: [
          { name: 'Rallying Beat',  cost: 400, desc: 'Nearby penguins +10% damage.',      mods: { add: { auraDmg: 0.1 } } },
          { name: 'Marching Orders', cost: 850, desc: '+25% aura radius.',                mods: { mul: { range: 1.25 } } },
          { name: 'Heroic Ballad',  cost: 2000, desc: 'Nearby penguins +20% damage total.', mods: { add: { auraDmg: 0.1 } } },
        ]},
      ],
    },
    icewall: {
      cls: 'support', name: 'Ice Wall Builder', cost: 650,
      desc: 'Builds jagged ice spikes on the track that shred passing sea lions.',
      stats: { kind: 'spikes', range: 120, rate: 0.45, charges: 6, spikeDmg: 2, maxPiles: 4, water: 'never' },
      paths: [
        { name: 'Jagged', tiers: [
          { name: 'Sharper Spikes', cost: 350, desc: 'Spikes deal 4 damage.',             mods: { add: { spikeDmg: 2 } } },
          { name: 'Dense Walls',    cost: 750, desc: '10 spikes per wall.',               mods: { add: { charges: 4 } } },
          { name: 'Glacier Teeth',  cost: 2000, desc: 'Spikes deal 9 damage, 14 per wall.', mods: { add: { spikeDmg: 5, charges: 4 } } },
        ]},
        { name: 'Industry', tiers: [
          { name: 'Fast Builder',   cost: 300, desc: '+55% build speed.',                 mods: { mul: { rate: 1.55 } } },
          { name: 'Wide Operation', cost: 650, desc: '+35% range, 6 walls at once.',      mods: { mul: { range: 1.35 }, add: { maxPiles: 2 } } },
          { name: 'Frozen Frontier', cost: 1700, desc: '9 walls at once, +45% build speed.', mods: { add: { maxPiles: 3 }, mul: { rate: 1.45 } } },
        ]},
      ],
    },
  };

  G.TOWER_ORDER = [
    'pebble', 'snowball', 'shards', 'glacier', 'slush',
    'harpoon', 'torpedo', 'depth', 'jetpack', 'artillery',
    'aurora', 'witch', 'blizzard', 'shadow', 'sunpriest',
    'vendor', 'igloo', 'sonar', 'drummer', 'icewall',
  ];

  /* ---------------- Heroes ----------------
     One per battle, placed like a tower (cost = fish). They level up on their
     own — +1 level every 3 waves cleared while placed, to level 10 — and their
     damage scales with the herd's toughness (the battlefield's hpMult, plus the
     endless curve past wave 50), so a hero hits as hard as the sea lions are
     tough, on every map. At level `ability.unlock` a signature ability opens:
     free to fire, recharges on the battle clock.
     Registered in G.TOWERS (hero: true, paths: []) so placement, targeting,
     drawing and saves all reuse the tower pipeline; G.HEROES holds what makes
     them heroes: the pebble price to own one, per-level growth, the ability. */
  G.TOWERS.hero_frost = {
    cls: 'frost', hero: true, name: 'Captain Frost', cost: 450,
    desc: 'The colony’s champion. Fights harder on every battlefield, and grows with every wave.',
    stats: { range: 165, rate: 1.3, damage: 5, pierce: 2, projSpeed: 540, kind: 'bullet', stealth: true, water: 'never' },
    paths: [],
  };
  G.TOWERS.hero_beak = {
    cls: 'support', hero: true, name: 'Commander Beak', cost: 500,
    desc: 'A living rallying cry: every penguin near him fights harder and faster.',
    stats: { range: 155, rate: 1.0, damage: 2, pierce: 2, projSpeed: 480, kind: 'bullet', auraDmg: 0.15, auraRate: 0.1, water: 'never' },
    paths: [],
  };
  G.TOWERS.hero_shiver = {
    cls: 'mystic', hero: true, name: 'Elder Shiver', cost: 500,
    desc: 'The oldest penguin on the ice. Everything she touches slows, then stops.',
    stats: { range: 150, rate: 0.9, damage: 3, pierce: 3, projSpeed: 420, splash: 30, kind: 'bullet', stealth: true, water: 'never', fx: { slow: { f: 0.65, d: 1.8 } } },
    paths: [],
  };

  G.HEROES = {
    hero_frost: {
      pebbles: 0,
      blurb: 'Heavy single-target damage. Grows into a boss-killer.',
      perLevel: { damage: 0.20, rate: 0.04 },       // per level above 1
      ability: { name: 'Avalanche Charge', icon: '🏔️', cd: 45, unlock: 3,
                 desc: 'Smashes every sea lion on the field, ignoring armor. Scales with the herd.' },
    },
    hero_beak: {
      pebbles: 5000,
      blurb: 'Weak alone, mighty together — his aura grows with every level.',
      perLevel: { damage: 0.12, auraDmg: 0.02, auraRate: 0.015, range: 0.02 },
      ability: { name: 'War Cry', icon: '📯', cd: 60, unlock: 3,
                 desc: 'The whole colony attacks 50% faster for 8 seconds.' },
    },
    hero_shiver: {
      pebbles: 7500,
      blurb: 'Chills whole packs; her slow deepens as she levels.',
      perLevel: { damage: 0.15, slow: 0.025, range: 0.015 },
      ability: { name: 'Cold Snap', icon: '❄️', cd: 50, unlock: 3,
                 desc: 'Freezes every sea lion solid for 2.5s (bosses 1s).' },
    },
  };
  G.HERO_ORDER = ['hero_frost', 'hero_beak', 'hero_shiver'];

  // level from waves cleared while placed; strength from the herd itself
  G.heroLevelFor = (heroWaves) => Math.min(10, 1 + Math.floor((heroWaves || 0) / 3));
  G.heroStrength = (L, wave) =>
    ((L && L.hpMult) || 1) * (wave > 50 ? Math.pow(1.05, wave - 50) : 1);
  G.applyHeroScale = function (calc, heroId, level, strength) {
    const pl = (G.HEROES[heroId] || {}).perLevel || {};
    const lv = Math.max(0, level - 1);
    if (calc.damage) calc.damage = Math.max(1, Math.round(calc.damage * (1 + (pl.damage || 0) * lv) * strength));
    if (pl.rate) calc.rate *= 1 + pl.rate * lv;
    if (pl.range) calc.range = Math.round(calc.range * (1 + pl.range * lv));
    if (pl.auraDmg) calc.auraDmg = (calc.auraDmg || 0) + pl.auraDmg * lv;
    if (pl.auraRate) calc.auraRate = (calc.auraRate || 0) + pl.auraRate * lv;
    if (pl.slow && calc.fx && calc.fx.slow) {
      calc.fx = Object.assign({}, calc.fx, {
        slow: { f: Math.max(0.35, calc.fx.slow.f - pl.slow * lv), d: calc.fx.slow.d + 0.06 * lv },
      });
    }
    return calc;
  };

  /* Per-tower visual identity: body tint, hat, hand prop, scale.
     hat:  scarf captain helmet goggles earmuffs souwester aviator officer wizard
           hood crown headband halo straw beanie headset hardhat mohawk
     prop: sling snowball cannon hose harpoongun periscope jetpack howitzer
           staff crookstaff icering shuriken orb fish drumsticks pickaxe flag   */
  G.LOOKS = {
    pebble:    { hat: 'scarf',    hatColor: '#e05252', prop: 'sling' },
    snowball:  { hat: 'earmuffs', hatColor: '#5b9bd4', prop: 'snowball' },
    shards:    { hat: 'goggles',  hatColor: '#67d4f5', prop: 'icering' },
    glacier:   { hat: 'helmet',   hatColor: '#8b98a5', prop: 'cannon',    propColor: '#3b4a58' },
    slush:     { hat: 'beanie',   hatColor: '#37b5ce', prop: 'hose',      propColor: '#2e8fa3' },
    harpoon:   { hat: 'captain',  hatColor: '#3f7fd4', prop: 'harpoongun', propColor: '#4a5a6a' },
    torpedo:   { hat: 'sailor',   hatColor: '#eef2f6', prop: 'periscope' },
    depth:     { hat: 'souwester', hatColor: '#f2c14e', prop: 'fish' },
    jetpack:   { hat: 'aviator',  hatColor: '#8a6d4a', prop: 'jetpack',   propColor: '#e07b39' },
    artillery: { hat: 'officer',  hatColor: '#2f4858', prop: 'howitzer',  propColor: '#2f3b47', scale: 1.22, cheeks: '#f2b04e' },
    aurora:    { hat: 'wizard',   hatColor: '#3fae8c', prop: 'staff',     propColor: '#5ee8a8' },
    witch:     { hat: 'hood',     hatColor: '#7a4fc0', prop: 'crookstaff', propColor: '#b07ce8', tint: '#322b3d' },
    blizzard:  { hat: 'crown',    hatColor: '#bfe8ff', prop: 'orb',       propColor: '#8fd4f0' },
    shadow:    { hat: 'headband', hatColor: '#c0392b', prop: 'shuriken',  tint: '#23262b', belly: '#6e7681' },
    sunpriest: { hat: 'halo',     hatColor: '#ffd166', prop: 'orb',       propColor: '#ffd166', tint: '#4a4438', belly: '#f6ecd8', scale: 1.12 },
    vendor:    { hat: 'straw',    hatColor: '#d8b46a', prop: 'fish' },
    igloo:     { hat: 'beanie',   hatColor: '#3fae6a', prop: 'flag',      propColor: '#3fae6a' },
    sonar:     { hat: 'headset',  hatColor: '#3fae6a' },
    drummer:   { hat: 'mohawk',   hatColor: '#e0653f', prop: 'drumsticks', propColor: '#8a5a33' },
    icewall:   { hat: 'hardhat',  hatColor: '#f2c14e', prop: 'pickaxe',   propColor: '#8a5a33' },
    /* heroes — bigger, bolder, unmistakable */
    hero_frost:  { hat: 'captain',  hatColor: '#d4af37', prop: 'harpoongun', propColor: '#5a6a7a', scale: 1.28, cheeks: '#f2b04e' },
    hero_beak:   { hat: 'officer',  hatColor: '#d4af37', prop: 'flag',       propColor: '#d4af37', scale: 1.24 },
    hero_shiver: { hat: 'hood',     hatColor: '#9fd8ef', prop: 'orb',        propColor: '#bfeaff', tint: '#2e4a66', scale: 1.24 },
  };

  /* ---------------- Sea lions ----------------
     hp/speed are base values; levels multiply them.
     children spawn on death. rank drives 'Strong' targeting. boss ranks >= 10. */
  G.ENEMIES = {
    pup:        { name: 'Pup',              hp: 1,    speed: 62,  size: 10, armor: 0, stealth: false, regen: 0,   bounty: 2,   lives: 1,   children: [],                              rank: 1,  color: '#c9a27e' },
    juvenile:   { name: 'Juvenile',         hp: 2,    speed: 74,  size: 11, armor: 0, stealth: false, regen: 0,   bounty: 3,   lives: 2,   children: ['pup'],                         rank: 2,  color: '#b3854f' },
    adult:      { name: 'Adult',            hp: 4,    speed: 80,  size: 13, armor: 0, stealth: false, regen: 0,   bounty: 5,   lives: 3,   children: ['juvenile'],                    rank: 3,  color: '#96682f' },
    speedster:  { name: 'Speedster',        hp: 3,    speed: 152, size: 11, armor: 0, stealth: false, regen: 0,   bounty: 6,   lives: 3,   children: ['juvenile'],                    rank: 4,  color: '#8fa8b8' },
    bull:       { name: 'Bull',             hp: 8,    speed: 90,  size: 15, armor: 0, stealth: false, regen: 0,   bounty: 8,   lives: 5,   children: ['adult'],                       rank: 5,  color: '#6e4a1e' },
    stealth:    { name: 'Stealth',          hp: 4,    speed: 88,  size: 12, armor: 0, stealth: true,  regen: 0,   bounty: 7,   lives: 3,   children: ['juvenile'],                    rank: 6,  color: '#3d5a80' },
    armored:    { name: 'Armored',          hp: 9,    speed: 58,  size: 14, armor: 2, stealth: false, regen: 0,   bounty: 9,   lives: 5,   children: ['adult'],                       rank: 7,  color: '#7d8a96' },
    regen:      { name: 'Regenerator',      hp: 8,    speed: 68,  size: 13, armor: 0, stealth: false, regen: 1.5, bounty: 9,   lives: 5,   children: ['adult'],                       rank: 8,  color: '#5f9e6e' },
    brute:      { name: 'Brute',            hp: 28,   speed: 48,  size: 18, armor: 1, stealth: false, regen: 0,   bounty: 16,  lives: 10,  children: ['bull', 'bull'],                rank: 9,  color: '#4a3category-620' },
    beachmaster: { name: 'Beachmaster',     hp: 280,  speed: 33,  size: 30, armor: 2, stealth: false, regen: 0,   bounty: 130, lives: 30,  children: ['bull', 'bull', 'bull', 'bull'], rank: 10, color: '#8a4b2f', boss: true },
    colossus:   { name: 'Colossus',         hp: 1000, speed: 26,  size: 38, armor: 3, stealth: false, regen: 0,   bounty: 400, lives: 60,  children: ['beachmaster', 'beachmaster', 'beachmaster'], rank: 11, color: '#5d3a5e', boss: true },
    emperor:    { name: 'Emperor Sea Lion', hp: 3400, speed: 19,  size: 46, armor: 4, stealth: false, regen: 0,   bounty: 1000, lives: 120, children: ['colossus', 'colossus'],       rank: 12, color: '#2f4858', boss: true },
    leviathan:  { name: 'Ancient Leviathan', hp: 9500, speed: 15, size: 54, armor: 5, stealth: false, regen: 5,   bounty: 2600, lives: 250, children: ['emperor', 'colossus'],        rank: 13, color: '#1d2d44', boss: true },
  };
  // fix accidental bad color string above
  G.ENEMIES.brute.color = '#4a3620';

  // vibrant sea lion palette (richer, more saturated than the base browns)
  const SEAL_COLORS = {
    pup: '#dcae7e', juvenile: '#c08c50', adult: '#a06c2e', speedster: '#8fb9d9',
    bull: '#7c5120', stealth: '#36517c', armored: '#8b98a6', regen: '#63a877',
    brute: '#503c22', beachmaster: '#98512c', colossus: '#6d4470', emperor: '#34557c',
    leviathan: '#20364f',
  };
  for (const id in SEAL_COLORS) G.ENEMIES[id].color = SEAL_COLORS[id];

  G.ENEMY_ORDER = ['pup', 'juvenile', 'adult', 'speedster', 'bull', 'stealth', 'armored', 'regen', 'brute', 'beachmaster', 'colossus', 'emperor', 'leviathan'];

  /* ---------------- Levels ----------------
     paths: one or more waypoint lists (enemies are assigned a path).
     water: circles {x,y,r} and rects {x,y,w,h} — water towers go here, land towers can't.
     blockers: no-build decorations {x,y,r,kind: rock|crystal|igloo|wreck}.               */
  G.LEVELS = [
    {
      id: 'shores', name: 'Icy Shores', diff: 1,
      tagline: 'A gentle S-curve along the beach. Learn the ropes.',
      lives: 150, cash: 650, hpMult: 1.0, speedMult: 1.0,
      theme: { snow: '#eef4f8', ice: '#dce9f2', pathColor: '#cfd9d3' },
      paths: [[{ x: -40, y: 180 }, { x: 300, y: 180 }, { x: 300, y: 430 }, { x: 700, y: 430 }, { x: 700, y: 180 }, { x: 1050, y: 180 }, { x: 1050, y: 560 }, { x: 1320, y: 560 }]],
      water: [{ x: 200, y: 660, r: 120 }, { x: 1130, y: 110, r: 80 }],
      blockers: [{ x: 500, y: 640, r: 30, kind: 'rock' }, { x: 880, y: 300, r: 26, kind: 'rock' }],
    },
    {
      id: 'pass', name: 'Glacier Pass', diff: 1,
      tagline: 'Long switchbacks through the mountains. Lots of time to shoot.',
      lives: 140, cash: 650, hpMult: 1.12, speedMult: 1.0,
      theme: { snow: '#e9eff6', ice: '#d5e3ef', pathColor: '#ccd6d2' },
      paths: [[{ x: -40, y: 110 }, { x: 1090, y: 110 }, { x: 1090, y: 300 }, { x: 190, y: 300 }, { x: 190, y: 490 }, { x: 1090, y: 490 }, { x: 1090, y: 670 }, { x: -40, y: 670 }]],
      water: [{ x: 1190, y: 720, r: 95 }],
      blockers: [{ x: 640, y: 205, r: 24, kind: 'rock' }, { x: 640, y: 395, r: 24, kind: 'crystal' }, { x: 640, y: 580, r: 24, kind: 'rock' }],
    },
    {
      id: 'river', name: 'Frozen River', diff: 2,
      tagline: 'The trail crosses a half-frozen river twice. Subs and boats shine here.',
      lives: 130, cash: 700, hpMult: 1.25, speedMult: 1.0,
      theme: { snow: '#e7eef4', ice: '#d2e2ee', pathColor: '#ccd5d5' },
      paths: [[{ x: 150, y: -40 }, { x: 150, y: 300 }, { x: 500, y: 300 }, { x: 500, y: 520 }, { x: 850, y: 520 }, { x: 850, y: 300 }, { x: 1150, y: 300 }, { x: 1150, y: 840 }]],
      water: [{ rect: { x: 0, y: 350, w: 1280, h: 130 } }],
      blockers: [{ x: 320, y: 150, r: 26, kind: 'rock' }, { x: 1000, y: 640, r: 28, kind: 'crystal' }],
    },
    {
      id: 'alley', name: 'Iceberg Alley', diff: 2,
      tagline: 'Two herds pour in from two entrances and merge mid-map.',
      lives: 120, cash: 720, hpMult: 1.4, speedMult: 1.02,
      theme: { snow: '#e6edf5', ice: '#d0dfee', pathColor: '#c9d4d4' },
      paths: [
        [{ x: -40, y: 150 }, { x: 400, y: 150 }, { x: 640, y: 400 }, { x: 1000, y: 400 }, { x: 1000, y: 620 }, { x: 1320, y: 620 }],
        [{ x: -40, y: 650 }, { x: 400, y: 650 }, { x: 640, y: 400 }, { x: 1000, y: 400 }, { x: 1000, y: 620 }, { x: 1320, y: 620 }],
      ],
      water: [{ x: 910, y: 150, r: 95 }, { x: 190, y: 400, r: 85 }, { x: 1160, y: 210, r: 75 }],
      blockers: [{ x: 640, y: 640, r: 26, kind: 'rock' }],
    },
    {
      id: 'village', name: 'Penguin Village', diff: 3,
      tagline: 'The trail wraps around the village itself. Protect the igloos!',
      lives: 110, cash: 750, hpMult: 1.55, speedMult: 1.04,
      theme: { snow: '#eaf0f6', ice: '#d8e5f0', pathColor: '#cdd7d3' },
      paths: [[{ x: -40, y: 200 }, { x: 1000, y: 200 }, { x: 1000, y: 620 }, { x: 300, y: 620 }, { x: 300, y: 380 }, { x: 1320, y: 380 }]],
      water: [{ x: 140, y: 720, r: 100 }],
      blockers: [{ x: 620, y: 490, r: 30, kind: 'igloo' }, { x: 720, y: 510, r: 26, kind: 'igloo' }, { x: 550, y: 520, r: 24, kind: 'igloo' }, { x: 160, y: 90, r: 26, kind: 'rock' }],
    },
    {
      id: 'caves', name: 'Crystal Caves', diff: 3,
      tagline: 'A tight serpentine gauntlet underground. NO WATER — no subs or boats.',
      lives: 100, cash: 800, hpMult: 1.7, speedMult: 1.05,
      theme: { snow: '#e2e6f0', ice: '#cdd6ea', pathColor: '#c5cdd6', dark: true },
      paths: [[{ x: -40, y: 120 }, { x: 1160, y: 120 }, { x: 1160, y: 270 }, { x: 120, y: 270 }, { x: 120, y: 420 }, { x: 1160, y: 420 }, { x: 1160, y: 570 }, { x: 120, y: 570 }, { x: 120, y: 700 }, { x: 1320, y: 700 }]],
      water: [],
      blockers: [{ x: 400, y: 195, r: 22, kind: 'crystal' }, { x: 880, y: 345, r: 22, kind: 'crystal' }, { x: 400, y: 495, r: 22, kind: 'crystal' }, { x: 880, y: 640, r: 22, kind: 'crystal' }],
    },
    {
      id: 'ridge', name: 'Aurora Ridge', diff: 4,
      tagline: 'The trail splits around a mountain lake — herds take either branch.',
      lives: 100, cash: 800, hpMult: 1.9, speedMult: 1.06,
      theme: { snow: '#e7ebf4', ice: '#d3ddee', pathColor: '#cbd4d6', aurora: true },
      paths: [
        [{ x: -40, y: 400 }, { x: 250, y: 400 }, { x: 450, y: 180 }, { x: 830, y: 180 }, { x: 1030, y: 400 }, { x: 1320, y: 400 }],
        [{ x: -40, y: 400 }, { x: 250, y: 400 }, { x: 450, y: 620 }, { x: 830, y: 620 }, { x: 1030, y: 400 }, { x: 1320, y: 400 }],
      ],
      water: [{ x: 640, y: 400, r: 105 }],
      blockers: [{ x: 150, y: 150, r: 28, kind: 'rock' }, { x: 1140, y: 660, r: 28, kind: 'crystal' }],
    },
    {
      id: 'bay', name: 'Shipwreck Bay', diff: 4,
      tagline: 'A drowned coastline. The navy owns this map — if you can afford it.',
      lives: 90, cash: 850, hpMult: 2.1, speedMult: 1.08,
      theme: { snow: '#e4ecf3', ice: '#cfe0ee', pathColor: '#c8d3d5' },
      paths: [[{ x: -40, y: 700 }, { x: 300, y: 700 }, { x: 300, y: 250 }, { x: 700, y: 250 }, { x: 700, y: 600 }, { x: 1050, y: 600 }, { x: 1050, y: 150 }, { x: 1320, y: 150 }]],
      water: [{ x: 500, y: 450, r: 135 }, { x: 900, y: 400, r: 110 }, { x: 130, y: 300, r: 105 }, { x: 1200, y: 700, r: 120 }, { x: 880, y: 110, r: 85 }],
      blockers: [{ x: 500, y: 700, r: 34, kind: 'wreck' }, { x: 1180, y: 420, r: 26, kind: 'rock' }],
    },
    {
      id: 'peak', name: 'Blizzard Peak', diff: 5,
      tagline: 'A brutally short climb to the summit. Every shot counts.',
      lives: 80, cash: 900, hpMult: 2.35, speedMult: 1.1,
      theme: { snow: '#eef2f7', ice: '#dde8f2', pathColor: '#d2dad8', storm: true },
      paths: [[{ x: -40, y: 620 }, { x: 420, y: 620 }, { x: 640, y: 420 }, { x: 860, y: 620 }, { x: 1320, y: 620 }]],
      water: [{ x: 200, y: 200, r: 80 }],
      blockers: [{ x: 640, y: 200, r: 40, kind: 'rock' }, { x: 950, y: 300, r: 30, kind: 'rock' }, { x: 330, y: 380, r: 28, kind: 'crystal' }, { x: 1100, y: 450, r: 26, kind: 'rock' }],
    },
    {
      id: 'colony', name: 'The Last Colony', diff: 5,
      tagline: 'Two independent trails converge on the colony. The final stand.',
      lives: 80, cash: 950, hpMult: 2.6, speedMult: 1.12,
      theme: { snow: '#e9eef5', ice: '#d6e2ef', pathColor: '#ccd6d4', aurora: true },
      paths: [
        [{ x: -40, y: 150 }, { x: 500, y: 150 }, { x: 500, y: 400 }, { x: 900, y: 400 }, { x: 900, y: 650 }, { x: 1320, y: 650 }],
        [{ x: 640, y: -40 }, { x: 640, y: 300 }, { x: 250, y: 300 }, { x: 250, y: 650 }, { x: 1320, y: 650 }],
      ],
      water: [{ x: 1100, y: 250, r: 105 }, { x: 110, y: 120, r: 70 }],
      blockers: [{ x: 1150, y: 500, r: 26, kind: 'igloo' }, { x: 1060, y: 530, r: 24, kind: 'igloo' }, { x: 80, y: 500, r: 28, kind: 'rock' }],
    },

    /* ============ TIER 2 — THE DEEP TUNDRA (1440 × 860) ============ */
    {
      id: 'flats', name: 'Windswept Flats', diff: 1,
      tagline: 'A long switchback across an open plain. Room to build — and time to use it.',
      lives: 95, cash: 720, hpMult: 2.8, speedMult: 1.0,
      theme: { snow: '#e4ecf6', ice: '#cddff0', pathColor: '#cbd5dd' },
      paths: [[{ x: -40, y: 200 }, { x: 1150, y: 200 }, { x: 1150, y: 470 }, { x: 350, y: 470 }, { x: 350, y: 900 }]],
      water: [{ x: 1350, y: 420, r: 100 }],
      blockers: [{ x: 700, y: 340, r: 26, kind: 'rock' }, { x: 700, y: 640, r: 26, kind: 'crystal' }, { x: 120, y: 430, r: 30, kind: 'rock' }],
    },
    {
      id: 'fjord', name: 'Hollow Fjord', diff: 1,
      tagline: 'The trail hugs a drowned inlet. Deep water everywhere — bring the navy.',
      lives: 92, cash: 730, hpMult: 3.0, speedMult: 1.0,
      theme: { snow: '#e2edf4', ice: '#c8dced', pathColor: '#c9d4d6' },
      paths: [[{ x: -40, y: 300 }, { x: 420, y: 300 }, { x: 420, y: 720 }, { x: 860, y: 720 }, { x: 860, y: 300 }, { x: 1180, y: 300 }, { x: 1180, y: 700 }, { x: 1480, y: 700 }]],
      water: [{ rect: { x: 920, y: 360, w: 220, h: 300 } }, { x: 200, y: 520, r: 110 }],
      blockers: [{ x: 640, y: 400, r: 34, kind: 'wreck' }, { x: 1300, y: 400, r: 28, kind: 'rock' }],
    },
    {
      id: 'cataracts', name: 'Twin Cataracts', diff: 2,
      tagline: 'Two half-frozen rivers cut the tundra in bands. The herd fords both.',
      lives: 90, cash: 740, hpMult: 3.2, speedMult: 1.02,
      theme: { snow: '#e6f2f2', ice: '#cbe4e6', pathColor: '#d6c8a8' },
      paths: [[{ x: 200, y: -40 }, { x: 200, y: 300 }, { x: 620, y: 300 }, { x: 620, y: 620 }, { x: 1040, y: 620 }, { x: 1040, y: 300 }, { x: 1400, y: 300 }, { x: 1400, y: 900 }]],
      water: [{ rect: { x: 0, y: 120, w: 1440, h: 110 } }, { rect: { x: 0, y: 700, w: 1440, h: 110 } }],
      blockers: [{ x: 400, y: 480, r: 28, kind: 'rock' }, { x: 820, y: 420, r: 26, kind: 'crystal' }],
    },
    {
      id: 'shelf', name: 'Splintered Shelf', diff: 3,
      tagline: 'Two herds pour onto the shelf, braid together, then split for opposite exits.',
      lives: 88, cash: 750, hpMult: 3.4, speedMult: 1.02,
      theme: { snow: '#e7edf7', ice: '#cbdcf0', pathColor: '#c8d2d8' },
      paths: [
        [{ x: -40, y: 180 }, { x: 380, y: 180 }, { x: 640, y: 400 }, { x: 1100, y: 400 }, { x: 1100, y: 700 }, { x: 420, y: 700 }, { x: 420, y: 900 }],
        [{ x: -40, y: 700 }, { x: 380, y: 700 }, { x: 640, y: 400 }, { x: 1100, y: 400 }, { x: 1100, y: 180 }, { x: 1480, y: 180 }],
      ],
      water: [{ x: 840, y: 130, r: 105 }, { x: 150, y: 420, r: 95 }, { x: 830, y: 820, r: 95 }],
      blockers: [{ x: 1330, y: 480, r: 30, kind: 'rock' }, { x: 200, y: 90, r: 26, kind: 'crystal' }],
    },
    {
      id: 'rookery', name: 'The Rookery', diff: 2,
      tagline: 'The west road coils around the nesting grounds — and a second herd comes down the south shore.',
      lives: 85, cash: 760, hpMult: 3.6, speedMult: 1.03,
      theme: { snow: '#f0f4fa', ice: '#d6e4f2', pathColor: '#e0d0af' },
      paths: [
        [{ x: -40, y: 180 }, { x: 900, y: 180 }, { x: 900, y: 560 }, { x: 420, y: 560 }, { x: 420, y: 380 }, { x: 1480, y: 380 }],
        [{ x: -40, y: 740 }, { x: 1150, y: 740 }, { x: 1150, y: 520 }, { x: 1480, y: 520 }],
      ],
      water: [{ x: 1390, y: 220, r: 100 }, { x: 110, y: 320, r: 85 }],
      blockers: [{ x: 600, y: 280, r: 28, kind: 'igloo' }, { x: 700, y: 290, r: 24, kind: 'igloo' }, { x: 505, y: 275, r: 24, kind: 'igloo' }],
    },
    {
      id: 'basin', name: 'Nightfall Basin', diff: 3,
      tagline: 'A sunless bowl with two ways in — one along the floor, one down the eastern wall.',
      lives: 82, cash: 780, hpMult: 3.8, speedMult: 1.04,
      theme: { snow: '#b9c4dc', ice: '#8e9cc0', pathColor: '#7a86a8', dark: true },
      paths: [
        [{ x: -40, y: 340 }, { x: 850, y: 340 }, { x: 850, y: 560 }, { x: 450, y: 560 }, { x: 450, y: 760 }, { x: 1480, y: 760 }],
        [{ x: 560, y: -40 }, { x: 560, y: 140 }, { x: 1300, y: 140 }, { x: 1300, y: 900 }],
      ],
      water: [{ x: 700, y: 880, r: 85 }, { x: 120, y: 620, r: 90 }],
      blockers: [{ x: 700, y: 400, r: 24, kind: 'crystal' }, { x: 220, y: 400, r: 22, kind: 'crystal' }, { x: 1080, y: 640, r: 22, kind: 'crystal' }],
    },
    {
      id: 'sable', name: 'Sable Glacier', diff: 4,
      tagline: 'Deep crevasses and pockets of meltwater — with a second herd running the high ridge.',
      lives: 78, cash: 800, hpMult: 4.0, speedMult: 1.05,
      theme: { snow: '#dfe6f0', ice: '#c2d0e4', pathColor: '#bcc6d2' },
      paths: [
        [{ x: -40, y: 700 }, { x: 400, y: 700 }, { x: 400, y: 300 }, { x: 900, y: 300 }, { x: 900, y: 700 }, { x: 1480, y: 700 }],
        [{ x: -40, y: 150 }, { x: 1180, y: 150 }, { x: 1180, y: 480 }, { x: 1480, y: 480 }],
      ],
      water: [{ x: 620, y: 560, r: 120 }, { x: 180, y: 420, r: 100 }, { x: 1320, y: 300, r: 110 }],
      blockers: [{ x: 700, y: 420, r: 30, kind: 'crystal' }, { x: 1350, y: 620, r: 28, kind: 'rock' }],
    },
    {
      id: 'floes', name: 'Drifting Floes', diff: 4,
      tagline: 'More sea than ice. Two herds swim the gaps — subs and boats rule here.',
      lives: 75, cash: 820, hpMult: 4.2, speedMult: 1.06,
      theme: { snow: '#e3eff8', ice: '#c3dcf0', pathColor: '#ccd6dc' },
      paths: [
        [{ x: -40, y: 260 }, { x: 400, y: 260 }, { x: 400, y: 460 }, { x: 800, y: 460 }, { x: 800, y: 260 }, { x: 1200, y: 260 }, { x: 1200, y: 900 }],
        [{ x: -40, y: 660 }, { x: 400, y: 660 }, { x: 400, y: 460 }, { x: 800, y: 460 }, { x: 800, y: 660 }, { x: 1200, y: 660 }, { x: 1200, y: 900 }],
      ],
      water: [{ x: 200, y: 460, r: 100 }, { x: 600, y: 170, r: 90 }, { x: 600, y: 750, r: 90 }, { x: 1000, y: 460, r: 110 }, { x: 1400, y: 300, r: 100 }],
      blockers: [{ x: 1000, y: 820, r: 28, kind: 'wreck' }],
    },
    {
      id: 'stormwall', name: 'Stormwall Ridge', diff: 5,
      tagline: 'Two trails knot through a permanent blizzard, crossing four times.',
      lives: 72, cash: 840, hpMult: 4.4, speedMult: 1.07,
      theme: { snow: '#e8edf4', ice: '#d0dae8', pathColor: '#c2ccd6', storm: true },
      paths: [
        [{ x: -40, y: 200 }, { x: 420, y: 200 }, { x: 420, y: 540 }, { x: 820, y: 540 }, { x: 820, y: 200 }, { x: 1240, y: 200 }, { x: 1240, y: 700 }, { x: 1480, y: 700 }],
        [{ x: 720, y: -40 }, { x: 720, y: 300 }, { x: 280, y: 300 }, { x: 280, y: 700 }, { x: 1060, y: 700 }, { x: 1060, y: 340 }, { x: 1480, y: 340 }],
      ],
      water: [{ x: 120, y: 500, r: 90 }, { x: 1380, y: 520, r: 100 }],
      blockers: [{ x: 620, y: 420, r: 30, kind: 'rock' }, { x: 940, y: 420, r: 26, kind: 'crystal' }],
    },
    {
      id: 'longdark', name: 'The Long Dark', diff: 5,
      tagline: 'Two herds cross in the black, on lanes too far apart to guard with one gun.',
      lives: 70, cash: 860, hpMult: 4.6, speedMult: 1.08,
      theme: { snow: '#a9b4cf', ice: '#7d8ab0', pathColor: '#6b779c', dark: true },
      paths: [
        [{ x: -40, y: 240 }, { x: 850, y: 240 }, { x: 850, y: 560 }, { x: 350, y: 560 }, { x: 350, y: 900 }],
        [{ x: -40, y: 780 }, { x: 700, y: 780 }, { x: 700, y: 420 }, { x: 1480, y: 420 }],
      ],
      water: [{ x: 60, y: 420, r: 90 }, { x: 1400, y: 660, r: 95 }],
      blockers: [{ x: 600, y: 340, r: 24, kind: 'crystal' }, { x: 1100, y: 600, r: 24, kind: 'crystal' }, { x: 200, y: 620, r: 22, kind: 'crystal' }],
    },

    /* ============ TIER 3 — THE FROZEN ABYSS (1600 × 920) ============ */
    {
      id: 'approach', name: 'Abyssal Approach', diff: 1,
      tagline: 'The gate to the far ice. Wide, cold and deceptively quiet.',
      lives: 68, cash: 820, hpMult: 5.0, speedMult: 1.05,
      theme: { snow: '#dbe3f0', ice: '#bccce4', pathColor: '#b8c2d0' },
      paths: [[{ x: -40, y: 240 }, { x: 1250, y: 240 }, { x: 1250, y: 560 }, { x: 400, y: 560 }, { x: 400, y: 960 }]],
      water: [{ x: 1500, y: 460, r: 110 }, { x: 120, y: 460, r: 100 }],
      blockers: [{ x: 800, y: 400, r: 30, kind: 'rock' }, { x: 800, y: 760, r: 30, kind: 'crystal' }, { x: 1450, y: 800, r: 26, kind: 'rock' }],
    },
    {
      id: 'causeway', name: 'Shattered Causeway', diff: 1,
      tagline: 'A broken land bridge over open ocean. The herd fords the channel three times.',
      lives: 65, cash: 840, hpMult: 5.4, speedMult: 1.06,
      theme: { snow: '#dceaf2', ice: '#bad6e8', pathColor: '#c6b998' },
      paths: [[{ x: -40, y: 120 }, { x: 240, y: 120 }, { x: 240, y: 380 }, { x: 700, y: 380 }, { x: 700, y: 700 }, { x: 1160, y: 700 }, { x: 1160, y: 300 }, { x: 1560, y: 300 }, { x: 1560, y: 960 }]],
      water: [{ rect: { x: 0, y: 420, w: 1600, h: 150 } }, { x: 400, y: 800, r: 120 }],
      blockers: [{ x: 950, y: 200, r: 32, kind: 'wreck' }, { x: 1380, y: 800, r: 30, kind: 'rock' }],
    },
    {
      id: 'trench', name: 'Leviathan Trench', diff: 2,
      tagline: 'Something enormous swims below. Two herds skirt the trench and rejoin.',
      lives: 62, cash: 860, hpMult: 5.8, speedMult: 1.07,
      theme: { snow: '#d8e8ee', ice: '#b2d2e0', pathColor: '#bfc9cc' },
      paths: [
        [{ x: -40, y: 140 }, { x: 420, y: 140 }, { x: 420, y: 520 }, { x: 900, y: 520 }, { x: 900, y: 200 }, { x: 1360, y: 200 }, { x: 1360, y: 800 }, { x: 1640, y: 800 }],
        [{ x: -40, y: 800 }, { x: 420, y: 800 }, { x: 420, y: 520 }, { x: 900, y: 520 }, { x: 900, y: 800 }, { x: 1360, y: 800 }, { x: 1640, y: 800 }],
      ],
      water: [{ rect: { x: 520, y: 560, w: 280, h: 190 } }, { x: 200, y: 400, r: 120 }, { x: 1180, y: 420, r: 130 }, { x: 1500, y: 200, r: 110 }],
      blockers: [{ x: 660, y: 300, r: 30, kind: 'wreck' }, { x: 1500, y: 560, r: 28, kind: 'rock' }],
    },
    {
      id: 'obsidian', name: 'Obsidian Maze', diff: 2,
      tagline: 'Black volcanic ice, split by a fault. Two herds, and no sky to see them by.',
      lives: 60, cash: 880, hpMult: 6.2, speedMult: 1.08,
      theme: { snow: '#9aa6c6', ice: '#6e7ca6', pathColor: '#5b6890', dark: true },
      paths: [
        [{ x: -40, y: 200 }, { x: 1300, y: 200 }, { x: 1300, y: 600 }, { x: 320, y: 600 }, { x: 320, y: 960 }],
        [{ x: -40, y: 820 }, { x: 950, y: 820 }, { x: 950, y: 420 }, { x: 1640, y: 420 }],
      ],
      water: [{ x: 1500, y: 780, r: 105 }, { x: 90, y: 480, r: 95 }],
      blockers: [{ x: 640, y: 320, r: 24, kind: 'crystal' }, { x: 1120, y: 700, r: 24, kind: 'crystal' }, { x: 400, y: 440, r: 22, kind: 'crystal' }],
    },
    {
      id: 'cathedral', name: 'Aurora Cathedral', diff: 3,
      tagline: 'The herd splits around a frozen cathedral lake and closes again beyond it.',
      lives: 58, cash: 900, hpMult: 6.6, speedMult: 1.09,
      theme: { snow: '#dfe4f6', ice: '#bcc8ee', pathColor: '#c4b9a4', aurora: true },
      paths: [
        [{ x: -40, y: 460 }, { x: 260, y: 460 }, { x: 520, y: 160 }, { x: 1140, y: 160 }, { x: 1400, y: 460 }, { x: 1400, y: 860 }, { x: 1640, y: 860 }],
        [{ x: -40, y: 460 }, { x: 260, y: 460 }, { x: 520, y: 760 }, { x: 1140, y: 760 }, { x: 1400, y: 460 }, { x: 1400, y: 860 }, { x: 1640, y: 860 }],
      ],
      water: [{ x: 830, y: 460, r: 170 }, { x: 200, y: 170, r: 105 }, { x: 200, y: 750, r: 105 }],
      blockers: [{ x: 830, y: 110, r: 30, kind: 'crystal' }, { x: 830, y: 810, r: 30, kind: 'crystal' }, { x: 1530, y: 280, r: 28, kind: 'rock' }],
    },
    {
      id: 'maelstrom', name: 'The Maelstrom', diff: 3,
      tagline: 'One ring of the old spiral still turns — and the undertow drags a second herd in behind it.',
      lives: 55, cash: 920, hpMult: 7.0, speedMult: 1.10,
      theme: { snow: '#d6dff0', ice: '#b4c6e2', pathColor: '#b4bfcc' },
      paths: [
        [{ x: -40, y: 220 }, { x: 1150, y: 220 }, { x: 1150, y: 600 }, { x: 450, y: 600 }, { x: 450, y: 420 }, { x: 1640, y: 420 }],
        [{ x: 760, y: -40 }, { x: 760, y: 60 }, { x: 120, y: 60 }, { x: 120, y: 880 }, { x: 1640, y: 880 }],
      ],
      water: [{ x: 1530, y: 760, r: 105 }, { x: 620, y: 300, r: 90 }],
      blockers: [{ x: 900, y: 500, r: 28, kind: 'rock' }, { x: 260, y: 300, r: 26, kind: 'crystal' }, { x: 1300, y: 700, r: 26, kind: 'rock' }],
    },
    {
      id: 'icefall', name: 'Riven Icefall', diff: 4,
      tagline: 'A shattered cataract of ice. Two trails cross and re-cross in the spray.',
      lives: 52, cash: 940, hpMult: 7.4, speedMult: 1.11,
      theme: { snow: '#e0e8f2', ice: '#bfd2e6', pathColor: '#b9c4cf', storm: true },
      paths: [
        [{ x: -40, y: 180 }, { x: 520, y: 180 }, { x: 520, y: 620 }, { x: 1040, y: 620 }, { x: 1040, y: 180 }, { x: 1560, y: 180 }, { x: 1560, y: 860 }, { x: 1640, y: 860 }],
        [{ x: 800, y: -40 }, { x: 800, y: 380 }, { x: 240, y: 380 }, { x: 240, y: 860 }, { x: 1300, y: 860 }, { x: 1300, y: 380 }, { x: 1640, y: 380 }],
      ],
      water: [{ x: 700, y: 800, r: 110 }, { x: 120, y: 600, r: 95 }, { x: 1450, y: 600, r: 100 }],
      blockers: [{ x: 660, y: 480, r: 30, kind: 'rock' }, { x: 1180, y: 480, r: 26, kind: 'crystal' }],
    },
    {
      id: 'blackice', name: 'Black Ice Labyrinth', diff: 4,
      tagline: 'Three herds pick separate ways through the glass-black ice. Guard them all.',
      lives: 50, cash: 960, hpMult: 7.8, speedMult: 1.12,
      theme: { snow: '#8f9bbe', ice: '#65739e', pathColor: '#525f86', dark: true },
      paths: [
        [{ x: -40, y: 150 }, { x: 1350, y: 150 }, { x: 1350, y: 660 }, { x: 250, y: 660 }, { x: 250, y: 960 }],
        [{ x: -40, y: 820 }, { x: 900, y: 820 }, { x: 900, y: 480 }, { x: 1640, y: 480 }],
        [{ x: 600, y: -40 }, { x: 600, y: 300 }, { x: 1640, y: 300 }],
      ],
      water: [{ x: 80, y: 460, r: 95 }, { x: 1480, y: 800, r: 100 }],
      blockers: [{ x: 380, y: 300, r: 24, kind: 'crystal' }, { x: 1150, y: 380, r: 24, kind: 'crystal' }, { x: 760, y: 560, r: 22, kind: 'crystal' }],
    },
    {
      id: 'throne', name: 'Throne of Winter', diff: 5,
      tagline: 'Three trails converge on the seat of the old ice. Hold all of them at once.',
      lives: 48, cash: 980, hpMult: 8.2, speedMult: 1.13,
      theme: { snow: '#dde2f4', ice: '#b8c4ea', pathColor: '#bfb7a6', aurora: true },
      paths: [
        [{ x: -40, y: 140 }, { x: 600, y: 140 }, { x: 600, y: 460 }, { x: 1100, y: 460 }, { x: 1100, y: 760 }, { x: 1640, y: 760 }],
        [{ x: -40, y: 780 }, { x: 600, y: 780 }, { x: 600, y: 460 }, { x: 1100, y: 460 }, { x: 1100, y: 760 }, { x: 1640, y: 760 }],
        [{ x: 820, y: -40 }, { x: 820, y: 220 }, { x: 1340, y: 220 }, { x: 1340, y: 460 }, { x: 1100, y: 460 }, { x: 1100, y: 760 }, { x: 1640, y: 760 }],
      ],
      water: [{ x: 300, y: 460, r: 130 }, { x: 880, y: 860, r: 110 }, { x: 1500, y: 300, r: 100 }],
      blockers: [{ x: 300, y: 180, r: 28, kind: 'rock' }, { x: 300, y: 740, r: 26, kind: 'rock' }, { x: 1450, y: 620, r: 26, kind: 'crystal' }],
    },
    {
      id: 'worldsend', name: "World's End", diff: 5,
      tagline: 'The last ice. Three trails from three directions, and everything the ocean has left.',
      lives: 45, cash: 1000, hpMult: 8.6, speedMult: 1.15,
      theme: { snow: '#d4dcf0', ice: '#adbde2', pathColor: '#b6b09e', aurora: true },
      paths: [
        [{ x: -40, y: 220 }, { x: 1200, y: 220 }, { x: 1200, y: 560 }, { x: 400, y: 560 }, { x: 400, y: 960 }],
        [{ x: 700, y: -40 }, { x: 700, y: 880 }, { x: 1640, y: 880 }],
        [{ x: 1640, y: 180 }, { x: 1460, y: 180 }, { x: 1460, y: 980 }],
      ],
      water: [{ x: 900, y: 700, r: 120 }, { x: 150, y: 640, r: 120 }, { x: 1400, y: 400, r: 110 }],
      blockers: [{ x: 850, y: 380, r: 32, kind: 'crystal' }, { x: 250, y: 320, r: 28, kind: 'rock' }, { x: 1560, y: 620, r: 28, kind: 'rock' }],
    },
  ];

  /* Richer per-map art direction, merged into each level's theme.
     path/pathEdge/pathCore: the packed-trail colors · deep/shore: water colors
     props: which scenery set the terrain painter scatters around the map. */
  const THEME_EXTRAS = {
    shores:  { snow: '#f4fafe', ice: '#c6e3f5', pathColor: '#e8d19c', pathEdge: '#b3966a', pathCore: '#f6ead0', deep: '#2f8fd6', shore: '#a9e2f2', props: 'pines' },
    pass:    { snow: '#f0f6fc', ice: '#bdd9f0', pathColor: '#d8c9a2', pathEdge: '#a5906c', pathCore: '#e8ddc2', deep: '#2f79c2', shore: '#a6d6ec', props: 'pines' },
    river:   { snow: '#f0f9f7', ice: '#c4e6e4', pathColor: '#e5d09e', pathEdge: '#b49a6d', pathCore: '#f2e4bf', deep: '#1391b8', shore: '#8fdde4', props: 'reeds' },
    alley:   { snow: '#ecf5fc', ice: '#b9daf2', pathColor: '#d7c9a4', pathEdge: '#a28d68', pathCore: '#e7dcc0', deep: '#1f78c4', shore: '#9ed2f0', props: 'floes' },
    village: { snow: '#f6f9fd', ice: '#cfe5f5', pathColor: '#ecd6a8', pathEdge: '#bb9f72', pathCore: '#f8e9ca', deep: '#2f8fd6', shore: '#a9e2f2', props: 'village' },
    caves:   { snow: '#a0abd0', ice: '#6b7ab2', pathColor: '#5e6b9d', pathEdge: '#3d4877', pathCore: '#7381ad', deep: '#23407c', shore: '#5e7cb2', props: 'crystals', glow: '#7fd8f5' },
    ridge:   { snow: '#eceffb', ice: '#c2cff4', pathColor: '#d9c690', pathEdge: '#a8935f', pathCore: '#e9dab4', deep: '#2b6cc0', shore: '#a4d0f2', props: 'pines' },
    bay:     { snow: '#ecf6f3', ice: '#c2e5de', pathColor: '#e2cb96', pathEdge: '#b0985f', pathCore: '#efdfb6', deep: '#0f83a6', shore: '#90dcd8', props: 'bay' },
    peak:    { snow: '#f1f4f9', ice: '#ccd8ea', pathColor: '#cfc39c', pathEdge: '#9c8f6c', pathCore: '#dfd5b6', deep: '#2f79c2', shore: '#a6d6ec', props: 'dead' },
    colony:  { snow: '#eaf0fb', ice: '#c2d4f2', pathColor: '#e0ca9c', pathEdge: '#ad9668', pathCore: '#eedcba', deep: '#2361b4', shore: '#9cc8f0', props: 'colony' },

    /* ---- tier 2: colder light, harder blues ---- */
    flats:     { snow: '#eaf1fb', ice: '#bed9f4', pathColor: '#d6c9a6', pathEdge: '#a08c66', pathCore: '#e5dac0', deep: '#2270c0', shore: '#9cd0ee', props: 'pines' },
    fjord:     { snow: '#e6f2f8', ice: '#b2d9ee', pathColor: '#dcc898', pathEdge: '#ab9464', pathCore: '#eadbb4', deep: '#0e7ba2', shore: '#86d2dc', props: 'bay' },
    cataracts: { snow: '#eaf7f5', ice: '#bce4e4', pathColor: '#e0cb98', pathEdge: '#af9765', pathCore: '#ecdcb4', deep: '#128aa8', shore: '#8cd8dc', props: 'reeds' },
    shelf:     { snow: '#eaf1fc', ice: '#bcd8f4', pathColor: '#d2c6a6', pathEdge: '#9d8a66', pathCore: '#e2d8c0', deep: '#1c6cba', shore: '#98cbee', props: 'floes' },
    rookery:   { snow: '#f4f8fd', ice: '#cde2f4', pathColor: '#e8d4a4', pathEdge: '#b59c6e', pathCore: '#f4e5c4', deep: '#2381c8', shore: '#a4dcf0', props: 'village' },
    basin:     { snow: '#94a1c8', ice: '#6874ac', pathColor: '#59648f', pathEdge: '#3c4670', pathCore: '#6a759e', deep: '#263e6e', shore: '#5a74a4', props: 'crystals', glow: '#7fb8f5' },
    sable:     { snow: '#e4ebf5', ice: '#b9cce6', pathColor: '#c8c0a0', pathEdge: '#948a68', pathCore: '#d8d0b2', deep: '#2470b2', shore: '#a0cce8', props: 'dead' },
    floes:     { snow: '#e9f4fd', ice: '#b6d9f4', pathColor: '#d0c8a8', pathEdge: '#9a8e6a', pathCore: '#e0d8c2', deep: '#156cba', shore: '#92c8ee', props: 'floes' },
    stormwall: { snow: '#ecf1f8', ice: '#c4d3e8', pathColor: '#c6bc9a', pathEdge: '#928866', pathCore: '#d6ccae', deep: '#2470b2', shore: '#a4cce6', props: 'dead' },
    longdark:  { snow: '#8591bb', ice: '#5e6b9a', pathColor: '#4f597f', pathEdge: '#353e60', pathCore: '#5d668c', deep: '#21335c', shore: '#4d6494', props: 'crystals', glow: '#6fa8ea' },

    /* ---- tier 3: the far ice — deepest colour, most dramatic ---- */
    approach:  { snow: '#e2e9f6', ice: '#b0c6ea', pathColor: '#c4bd9e', pathEdge: '#8f8666', pathCore: '#d4cbb0', deep: '#1c5c9e', shore: '#98c0e8', props: 'pines' },
    causeway:  { snow: '#dfeef7', ice: '#a6d2ec', pathColor: '#d2c090', pathEdge: '#a08e5e', pathCore: '#e0d0a4', deep: '#0c6c96', shore: '#82cade', props: 'bay' },
    trench:    { snow: '#daecf3', ice: '#9ecde2', pathColor: '#c2b995', pathEdge: '#8d8462', pathCore: '#d2c9a8', deep: '#085a80', shore: '#78bcd4', props: 'bay' },
    obsidian:  { snow: '#8390b8', ice: '#59689a', pathColor: '#475478', pathEdge: '#2e3757', pathCore: '#525d84', deep: '#1b2f56', shore: '#45608e', props: 'crystals', glow: '#6f9ce8' },
    cathedral: { snow: '#e2e7fb', ice: '#b8c6f4', pathColor: '#d0c298', pathEdge: '#9c8f64', pathCore: '#e0d2ac', deep: '#24509c', shore: '#a2c2ec', props: 'crystals', glow: '#9ce8d4' },
    maelstrom: { snow: '#dae4f5', ice: '#b0c6ec', pathColor: '#c8bd9a', pathEdge: '#948a66', pathCore: '#d8cfae', deep: '#1c58a0', shore: '#9cc6ec', props: 'floes' },
    icefall:   { snow: '#e3ecf6', ice: '#b4cde8', pathColor: '#bcb894', pathEdge: '#898262', pathCore: '#ccc6a6', deep: '#2064a2', shore: '#a0c9e8', props: 'dead' },
    blackice:  { snow: '#7481ac', ice: '#4c5a88', pathColor: '#3c476e', pathEdge: '#262e4c', pathCore: '#46527a', deep: '#152647', shore: '#3a507c', props: 'crystals', glow: '#5f92e2' },
    throne:    { snow: '#dfe4f8', ice: '#b2c0f0', pathColor: '#cabb92', pathEdge: '#978c60', pathCore: '#d9cba6', deep: '#1e4a94', shore: '#9cbcec', props: 'colony' },
    worldsend: { snow: '#d6def4', ice: '#a8bae8', pathColor: '#beb28e', pathEdge: '#8b8160', pathCore: '#cec2a0', deep: '#184288', shore: '#92b4e8', props: 'colony' },
  };
  for (const L of G.LEVELS) Object.assign(L.theme, THEME_EXTRAS[L.id] || {});

  /* Tier metadata is positional: ten battlefields per tier, in order.
     slot (0-9) drives wave density so each tier ramps like a fresh campaign. */
  G.LEVELS.forEach((L, i) => {
    L.tier = Math.floor(i / 10) + 1;
    L.slot = i % 10;
    const d = TIER_DIMS[L.tier] || TIER_DIMS[1];
    L.w = L.w || d.w;
    L.h = L.h || d.h;
    L.bountyMult = L.bountyMult || TIER_BOUNTY[L.tier] || 1;
  });
})();
