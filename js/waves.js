/* Tundra Defense — wave generation.
   generateWave(levelIdx 0-29, wave 1-50) -> { groups, reward }
   Each group: { type, count, spacing (s between spawns), delay (s after prior group), path } */
(function () {
  const G = (globalThis.G = globalThis.G || {});

  const R = (n) => Math.max(1, Math.round(n));

  G.generateWave = function (li, w) {
    /* Density grows with wave and with the level's position *within its tier* —
       each tier ramps like a fresh campaign, plus a flat step up per tier.
       (Using the absolute index would field 5× herds by level 30.) */
    const L = G.LEVELS[li] || {};
    const slot = L.slot == null ? li : L.slot;
    const tier = L.tier || 1;
    const d = 1 + slot * 0.13 + (tier - 1) * 0.22 + Math.max(0, w - 1) * 0.022;
    /* Escalation rank drives the boss-wave extras. Tier 1 keeps its original
       curve exactly (esc === li); later tiers start partway up it. */
    const esc = slot + (tier - 1) * 4;
    const groups = [];
    const g = (type, count, spacing, opts) =>
      groups.push(Object.assign({ type, count: R(count), spacing, delay: 1.2, path: 'alt' }, opts));

    switch (true) {
      case w === 1:  g('pup', 8 * d, 1.0); break;
      case w === 2:  g('pup', 13 * d, 0.8); break;
      case w === 3:  g('pup', 12 * d, 0.7); g('juvenile', 4 * d, 0.9); break;
      case w === 4:  g('juvenile', 10 * d, 0.8); break;
      case w === 5:  g('pup', 18 * d, 0.35); g('juvenile', 6 * d, 0.8); break;
      case w === 6:  g('juvenile', 14 * d, 0.6); g('pup', 8 * d, 0.3); break;
      case w === 7:  g('juvenile', 8 * d, 0.6); g('adult', 5 * d, 1.0); break;
      case w === 8:  g('adult', 10 * d, 0.8); break;
      case w === 9:  g('pup', 30 * d, 0.18); g('adult', 6 * d, 0.8); break;
      case w === 10: g('bull', 5 * d, 1.1); g('adult', 6 * d, 0.6); break; // first muscle wave

      case w === 11: g('adult', 13 * d, 0.55); break;
      case w === 12: g('speedster', 7 * d, 0.7); g('juvenile', 10 * d, 0.5); break;
      case w === 13: g('adult', 10 * d, 0.55); g('speedster', 6 * d, 0.6); break;
      case w === 14: g('stealth', 8 * d, 0.9); g('adult', 6 * d, 0.6); break; // stealth debut
      case w === 15: g('bull', 9 * d, 0.8); g('stealth', 6 * d, 0.7); break;
      case w === 16: g('armored', 7 * d, 1.0); g('adult', 8 * d, 0.5); break; // armor debut
      case w === 17: g('speedster', 14 * d, 0.4); break;
      case w === 18: g('armored', 9 * d, 0.8); g('stealth', 8 * d, 0.6); break;
      case w === 19: g('regen', 9 * d, 0.9); g('adult', 10 * d, 0.5); break; // regen debut
      case w === 20: // BOSS: the first Beachmaster
        g('beachmaster', 1, 1, { hpMult: 1 });
        if (esc >= 1) g('bull', 6 * d, 0.6, { delay: 2.5 });
        if (esc >= 4) g('stealth', 8 * d, 0.5, { delay: 1.5 });
        break;

      case w === 21: g('bull', 12 * d, 0.6); g('regen', 6 * d, 0.8); break;
      case w === 22: g('stealth', 12 * d, 0.5); g('speedster', 8 * d, 0.5); break;
      case w === 23: g('armored', 12 * d, 0.6); g('bull', 8 * d, 0.6); break;
      case w === 24: g('speedster', 18 * d, 0.3); g('stealth', 8 * d, 0.5); break;
      case w === 25: g('regen', 13 * d, 0.6); g('armored', 9 * d, 0.7); break;
      case w === 26: g('stealth', 14 * d, 0.4); g('regen', 8 * d, 0.7); break;
      case w === 27: g('brute', 4 * d, 1.6); g('bull', 12 * d, 0.5); break; // brute debut
      case w === 28: g('armored', 13 * d, 0.55); g('regen', 10 * d, 0.6); break;
      case w === 29: g('juvenile', 40 * d, 0.12); g('speedster', 12 * d, 0.4); break;
      case w === 30: // BOSS: Beachmaster pair
        g('beachmaster', 2, 3.5, { hpMult: 1.6 });
        g('brute', 3 * d, 1.2, { delay: 2 });
        if (esc >= 3) g('beachmaster', 1, 1, { hpMult: 1.6, delay: 3 });
        break;

      case w === 31: g('brute', 6 * d, 1.2); g('armored', 10 * d, 0.6); break;
      case w === 32: g('stealth', 18 * d, 0.35); g('regen', 12 * d, 0.5); break;
      case w === 33: g('bull', 22 * d, 0.35); g('brute', 5 * d, 1.2); break;
      case w === 34: g('speedster', 24 * d, 0.25); g('stealth', 12 * d, 0.4); break;
      case w === 35: g('brute', 9 * d, 1.0); g('armored', 12 * d, 0.5); break;
      case w === 36: g('regen', 18 * d, 0.45); g('brute', 6 * d, 1.1); break;
      case w === 37: g('armored', 18 * d, 0.4); g('speedster', 14 * d, 0.3); break;
      case w === 38: g('beachmaster', 2, 4, { hpMult: 2.2 }); g('stealth', 14 * d, 0.4, { delay: 2 }); break;
      case w === 39: g('brute', 12 * d, 0.8); g('regen', 14 * d, 0.45); break;
      case w === 40: // BOSS: the Colossus surfaces
        g('colossus', 1, 1, { hpMult: 1 });
        if (esc >= 2) g('beachmaster', 1, 1, { hpMult: 2.2, delay: 4 });
        if (esc >= 5) g('brute', 6 * d, 0.9, { delay: 2 });
        break;

      case w === 41: g('brute', 14 * d, 0.7); g('armored', 14 * d, 0.4); break;
      case w === 42: g('stealth', 24 * d, 0.28); g('speedster', 18 * d, 0.25); break;
      case w === 43: g('beachmaster', 3, 3, { hpMult: 2.6 }); g('regen', 14 * d, 0.4, { delay: 2 }); break;
      case w === 44: g('bull', 36 * d, 0.2); g('brute', 8 * d, 0.9); break;
      case w === 45: g('colossus', 1, 1, { hpMult: 1.5 }); g('beachmaster', 2, 3, { hpMult: 2.6, delay: 3 }); break;
      case w === 46: g('armored', 24 * d, 0.3); g('stealth', 16 * d, 0.35); g('brute', 8 * d, 0.9); break;
      case w === 47: g('regen', 24 * d, 0.3); g('speedster', 24 * d, 0.2); break;
      case w === 48: g('colossus', esc >= 4 ? 2 : 1, 6, { hpMult: 1.9 }); g('brute', 10 * d, 0.8, { delay: 3 }); break;
      case w === 49: g('bull', 30 * d, 0.18); g('brute', 12 * d, 0.7); g('armored', 16 * d, 0.3); break;
      case w === 50: // FINAL BOSS
        if (esc >= 7) {
          g('leviathan', 1, 1, { hpMult: 1 + (esc - 7) * 0.35 });
          g('colossus', 1, 1, { hpMult: 2, delay: 5 });
        } else {
          g('emperor', 1, 1, { hpMult: 1 + esc * 0.15 });
          if (esc >= 3) g('colossus', 1, 1, { hpMult: 2, delay: 5 });
        }
        g('stealth', 12 * d, 0.4, { delay: 3 });
        break;

      default: g('adult', 10 * d, 0.6); // unreachable, safety net
    }

    // later tiers pay richer purses to match their far tougher herds
    return { groups, reward: Math.round((100 + w * 3) * (L.bountyMult || 1)) };
  };
})();
