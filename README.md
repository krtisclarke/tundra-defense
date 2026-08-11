# 🐧 Tundra Defense — Penguins vs. Sea Lions

A tower defense game. The sea lion herds are marching on the penguin
colony — recruit penguin defenders, hold the line across **30 battlefields** in **three
campaign tiers** and **three difficulties**, and keep every last chick safe.

Runs in any modern browser on **Mac and PC** — no install, no internet, no dependencies.
Also playable on a **phone or tablet held sideways**: the controls become a side dock with
a drag-to-place touch scheme, and you can add it to your home screen as a full-screen app.

### Play it anywhere

**https://krtisclarke.github.io/tundra-defense/** — the hosted copy, kept current with
this repo. On a phone, open it once and **Share → Add to Home Screen** (iPhone) or
**⋮ → Add to Home screen** (Android): you get a full-screen app with its own icon, and
after that first visit it keeps working **offline** — no computer, no internet.

### Playing on a phone

Hold the phone **sideways** (portrait shows a rotate prompt). Tap a penguin to pick it
up, drag on the map to aim the ghost, lift your finger to place. Long-press any penguin
or boost for its stats. The controls live in a side dock so the battlefield gets the
whole screen height.

## How to run

**Easiest:** double-click `index.html` — it opens in your browser and just works.

**Recommended:** use the launcher for your platform (starts a tiny local server, which some
browsers prefer for saved games):

- **Mac:** double-click `Play on Mac.command`
  *(first time: right-click → Open if macOS warns about an unidentified developer)*
- **Windows:** double-click `Play on Windows.bat`

Both use Node or Python if you have them, and fall back to opening `index.html` directly.

## The game

### Three difficulties — pick one when you start a battle

| | Waves | Tower prices | Lives | Victory reward | Retry cost |
|---|---|---|---|---|---|
| 🐣 **Easy** | 30 | 15% cheaper | +25% | 100 🪨 | 25 🪨 |
| 🐧 **Medium** | 40 | standard | standard | 250 🪨 | 50 🪨 |
| 🦭 **Hard** | 50 | 15% pricier | −20% | 500 🪨 | 100 🪨 |

Every campaign ends on a boss wave: the Beachmaster pair (30), the Colossus (40), or the
Emperor / Leviathan (50). Beating a level on any difficulty unlocks the next battlefield.

**Second Chance:** if the colony falls, spend pebbles to retry — lives fully restored, the
field cleared, and the wave that beat you replays with your towers and fish intact.

**🌊 The Endless Tide:** beat the final boss and the victory screen offers **Keep Going** —
the waves continue past the campaign, tougher every wave, with a boss court every 10th,
until the colony falls. Your win and its pebbles are already banked; every 10th endless
wave survived pays a bonus (one Second Chance's worth), every 100th pays **ten times
that** (250 / 500 / 1,000 🪨 by difficulty), and each battlefield remembers your record
wave on the level select.

### Two currencies: fish & pebbles

**🐟 Fish** is match money: pops and wave clears pay it, and it recruits and upgrades
penguins. It resets every battle.

Winning a battle earns **🪨 pebbles** — a permanent currency stored with your profile.
Spend them in the **Boost Shop** (main menu, or from the difficulty screen) *before* a match.
Boosts you own appear in the command dock during battle — one click fires them:

| Boost | Cost | Effect |
|---|---|---|
| 🐟 Fish Feast | 15 | +600 🐟 fish, instantly |
| 🧊 Ice Spikes | 20 | a 40-spike wall (10 dmg each) near the exit of every trail |
| 🥁 War Frenzy | 25 | every penguin attacks 50% faster for 15s |
| ❄️ Big Freeze | 30 | every sea lion frozen for 4s (bosses 1.5s) |
| 💖 Second Wind | 40 | +25 lives |
| 🏔️ Avalanche | 50 | 60 damage to everything on the field, ignoring armor |

### Heroes — one champion fights beside you

Pick a hero on the challenge screen before a battle. In battle they place like a tower
(a fish price, one per battle), then **level up on their own** — one level every 3 waves
held, to level 10 — and their damage **scales with the herd itself**: as tough as the sea
lions are, the hero hits proportionally, from the home shores to the Frozen Abyss to the
deep Endless Tide. At level 3 the signature ability unlocks — free to fire (press **H**),
recharging over time.

| Hero | Recruited | Style | Ability |
|---|---|---|---|
| ⚔️ **Captain Frost** | free | heavy single-target damage | 🏔️ Avalanche Charge — smashes the whole field |
| 📯 **Commander Beak** | 5,000 🪨 | nearby penguins fight harder & faster | 📯 War Cry — everyone attacks 50% faster for 8s |
| ❄️ **Elder Shiver** | 7,500 🪨 | slows whole packs, deeper each level | ❄️ Cold Snap — freezes every sea lion for 2.5s |

Heroes are permanent once recruited — the two elders are the colony's long-term pebble goals.

### 🏛️ Colony Upgrades — pebbles that work forever

The permanent half of the pebble economy (main menu or challenge screen). Six upgrades,
three tiers each — starting fish, starting lives, bigger bounties, cheaper towers,
discounted Second Chances, richer wave rewards. Bought once, active in every battle
from then on.

### Your penguins — 20 towers, 4 classes, each with 2 upgrade paths × 3 tiers

A brand-new colony starts with a five-penguin starter kit (Pebble Flinger, Snowball
Roller, Slush Thrower, Harpoon Sniper, Fish Vendor); the rest join **two at a time as
battlefields are defended**, on any difficulty — the full roster is in hand by eight
battlefields. Existing profiles keep everything they've earned. Every penguin's card
shows its **☠ kill count**, and the victory screen names the battle's top defender.

| Class | Towers |
|---|---|
| ❄ **Frostline** — frontline damage | Pebble Flinger, Snowball Roller, Ice Shard Gunner, Glacier Cannon, Slush Thrower |
| ⚓ **Navy** — military hardware | Harpoon Sniper, Torpedo Sub 🌊, Depth Charge Boat 🌊, Jetpack Penguin, Artillery Emperor |
| 🔮 **Mystic** — aurora magic | Aurora Mage, Frost Witch, Blizzard Caller, Shadow Diver, Sun Priest |
| 🛠 **Support** — economy & buffs | Fish Vendor, Igloo Fortress, Sonar Station, War Drummer, Ice Wall Builder |

🌊 = must be placed on water. Only one upgrade path per tower can reach Tier 3 — choose wisely.

### The sea lions — 13 types that split when destroyed

Pup → Juvenile → Adult → Bull … bigger sea lions break apart into smaller ones, so a wave is
never over until the last pup is down. Watch for:

- **Speedster** — twice as fast as anything else
- **Stealth** — invisible without detection (Shadow Diver sees them innately; many towers can learn to)
- **Armored** — flat damage reduction; shred it (Frost Witch) or pierce it (Harpoon, Sun Priest)
- **Regenerator** — heals while it swims
- **Brute** — a wall of blubber that splits into two Bulls
- **Boss class:** the **Beachmaster** (wave 20), the **Colossus** (wave 40), the **Emperor Sea Lion**
  (wave 50) — and on the last four battlefields, the **Ancient Leviathan**.

Sea lions get tougher on every level (up to 2.6× HP on The Last Colony) and mix into
nastier combinations as the campaign goes on.

### The three campaign tiers

The 30 battlefields are grouped into tiers on the level select. Each tier is a fresh
difficulty ramp on a **physically larger, more tangled map** — and every tier starts
tougher than the one before it finished, so even Easy in the Deep Tundra outbites
anything in the Frostlands.

| Tier | Battlefields | Map size | Sea lion HP | Bounties |
|---|---|---|---|---|
| ❄ **The Frostlands** | 1–10 | 1280 × 800 | 1.0× → 2.6× | 1× |
| 🌨 **The Deep Tundra** | 11–20 | 1440 × 860 | 2.8× → 4.6× | 1.5× |
| 🌑 **The Frozen Abyss** | 21–30 | 1600 × 920 | 5.0× → 8.6× | 2.3× |

Tracks get longer with the tiers too — from a 2,240px stroll on Icy Shores to the
9,180px six-lane crawl of the Black Ice Labyrinth. Beat any battlefield on any
difficulty to unlock the next.

### The 30 battlefields

1. **Icy Shores** ★ — a gentle S-curve to learn on
2. **Glacier Pass** ★ — long switchbacks
3. **Frozen River** ★★ — the trail crosses a river; subs and boats shine
4. **Iceberg Alley** ★★ — two entrances merge mid-map
5. **Penguin Village** ★★★ — the trail wraps around the village
6. **Crystal Caves** ★★★ — a tight serpentine with **no water at all**
7. **Aurora Ridge** ★★★★ — the trail splits around a mountain lake
8. **Shipwreck Bay** ★★★★ — drowned coastline, navy country
9. **Blizzard Peak** ★★★★★ — brutally short path, every shot counts
10. **The Last Colony** ★★★★★ — two independent trails, the final stand

**The Deep Tundra** — 11. Windswept Flats ★ · 12. Hollow Fjord ★ · 13. Twin Cataracts ★★ ·
14. Splintered Shelf ★★★ · 15. The Rookery ★★ · 16. Nightfall Basin ★★★ ·
17. Sable Glacier ★★★★ · 18. Drifting Floes ★★★★ · 19. Stormwall Ridge ★★★★★ ·
20. The Long Dark ★★★★★

**The Frozen Abyss** — 21. Abyssal Approach ★ · 22. Shattered Causeway ★ ·
23. Leviathan Trench ★★ · 24. Obsidian Maze ★★ · 25. Aurora Cathedral ★★★ ·
26. The Maelstrom ★★★ · 27. Riven Icefall ★★★★ · 28. Black Ice Labyrinth ★★★★ ·
29. Throne of Winter ★★★★★ · 30. World's End ★★★★★

### Unlocking

**Each difficulty is its own campaign.** Battlefield 1 is open on all three from the start;
after that you advance one battlefield at a time on the difficulty you're playing, and
clearing an entire tier of ten opens the next tier **on that difficulty**:

```
Easy:    Frostlands 1-10  →  Deep Tundra 11-20  →  Frozen Abyss 21-30
Medium:  Frostlands 1-10  →  Deep Tundra 11-20  →  Frozen Abyss 21-30
Hard:    Frostlands 1-10  →  Deep Tundra 11-20  →  Frozen Abyss 21-30
```

A win counts for every **easier** difficulty too — clear the Frostlands on Hard and the
Deep Tundra opens on Easy and Medium as well, so nobody has to replay a campaign they've
already proven. The level-select tier headers show how far along each difficulty you are,
and locked difficulties on the challenge screen tell you exactly what's still in the way.

### How the star ratings are set

Stars are **measured, not guessed**. A map's real difficulty is the *tower-seconds* it
affords you — how long a sea lion is under fire (track length ÷ speed) multiplied by how
many buildable spots can reach an average point of its route — weighed against how tough
the herd is and how many independent routes you must cover at once.

The counter-intuitive part: a long, tightly-folded serpentine is **generous**, not cruel.
One tower covers several lanes at once and the enemy walks past your guns for a minute and
a half. The genuinely hard maps are the *short* ones (Blizzard Peak, Aurora Ridge, World's
End) and the ones that **split** into routes you cannot defend with the same guns.

### Music

Each battlefield plays a Game Boy-style chiptune loop (a cheery march early on, a darker
theme mid-campaign, a driving track for the finale) — and the tempo climbs **+1% with every
wave**, so wave 50 hits about 1.6× the speed of wave 1. The 🔊 button mutes music and
sound effects together.

### Saving

- The game **autosaves after every wave**.
- The **💾 Save** button saves **mid-wave** — even with sea lions on the field — and the level
  screen shows a **Continue** button to pick up exactly where you left off.
- Progress is stored in your browser (localStorage). *Reset Progress* on the main menu wipes it.
- **💾 Back Up Progress** (main menu) writes everything — pebbles, unlocks, saved games — to one
  file you keep. On iPhone/iPad it opens the share sheet (**Save to Files**; pick an iCloud Drive
  folder and it follows you to your other devices). **📂 Load Backup** restores it anywhere,
  including a different browser or computer.

### Controls

The interface is a bottom command dock built for keyboard + mouse: build palette in the middle
(laid out like your keyboard), selection card on the left, wave controls on the right.

| Input | Action |
|---|---|
| **1–5** / **Q–T** / **A–G** / **Z–B** | Build a Frostline / Navy / Mystic / Support penguin (or click its slot), then click the map. Hold **Shift** to place several |
| Click a placed penguin | Its card appears bottom-left |
| **Q** / **W** (selected) | Buy upgrade path 1 / 2 |
| **T** (selected) | Cycle targeting: first / last / strong / close |
| **X** (selected) | Sell |
| **Space** | Send next wave |
| **Tab** | Cycle game speed 1× / 2× / 3× |
| **P** | Quick pause · **M** mute |
| **Ctrl/⌘+S** | Save mid-wave |
| **Esc** / right-click | Cancel placement → deselect → pause menu |
| ⛶ (top-right corner) | Toggle fullscreen — available on every screen |

### Tips

- Slush Throwers and Snowball Rollers make everything else hit more often — slow is damage.
- Build a Fish Vendor or two before wave 10; the economy snowballs.
- Have stealth detection online before wave 14, and armor-shred before wave 16.
- Save a Harpoon Sniper with the **Leviathan Lance** upgrade for boss waves.
- Ice Walls placed near the exit catch whatever slips through.

## Files

```
index.html        the game (open this)
style.css         UI styling
js/data.js        towers, upgrades, enemies, 30 levels across 3 tiers
js/waves.js       wave generation (up to 50 waves × 30 levels)
js/engine.js      simulation: combat, targeting, saves
js/render.js      canvas art: maps, penguins, sea lions
js/ui.js          menus, shop, HUD, persistence, sound
js/main.js        boot
serve.js          tiny local web server used by the launchers
```

Built with vanilla JavaScript and HTML5 canvas — no frameworks, no build step.
