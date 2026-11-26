// Loadout data: characters, weapons, XP progression. Shared by UI and combat.

export const CHARACTERS = [
  {
    id: 'scout',
    name: 'SCOUT',
    hp: 80,
    speed: 10.2,
    color: 0x45d7ff,
    blurb: 'Fast and elusive. Lower health, rapid repositioning.'
  },
  {
    id: 'marine',
    name: 'MARINE',
    hp: 100,
    speed: 7.8,
    color: 0x6f9dff,
    blurb: 'Balanced all-rounder. No weaknesses, no excuses.'
  },
  {
    id: 'heavy',
    name: 'HEAVY',
    hp: 140,
    speed: 5.6,
    color: 0xffa657,
    blurb: 'Armoured bulwark. Soaks damage at a walking pace.'
  }
];

// damage / rounds-per-minute / magazine / spread (radians) / level gate
export const WEAPONS = [
  {
    id: 'pistol', name: 'PISTOL', level: 1, damage: 26, rpm: 340, magazine: 12,
    spread: 0.012, range: 90, pellets: 1, reload: 1.05, auto: false,
    color: 0xffc857, blurb: 'Sidearm. Precise, reliable, endless reserve.'
  },
  {
    id: 'smg', name: 'SMG', level: 1, damage: 15, rpm: 880, magazine: 30,
    spread: 0.038, range: 65, pellets: 1, reload: 1.4, auto: true,
    color: 0x5ee08a, blurb: 'Close-quarters spray. High rate of fire.'
  },
  {
    id: 'rifle', name: 'RIFLE', level: 2, damage: 36, rpm: 540, magazine: 24,
    spread: 0.014, range: 150, pellets: 1, reload: 1.7, auto: true,
    color: 0x6fa8ff, blurb: 'Versatile assault rifle. Controlled bursts.'
  },
  {
    id: 'shotgun', name: 'SHOTGUN', level: 2, damage: 12, rpm: 90, magazine: 6,
    spread: 0.105, range: 42, pellets: 8, reload: 2.0, auto: false,
    color: 0xff845d, blurb: 'Eight pellets per shell. Devastating up close.'
  },
  {
    id: 'sniper', name: 'SNIPER', level: 3, damage: 115, rpm: 48, magazine: 5,
    spread: 0.002, range: 260, pellets: 1, reload: 2.25, auto: false,
    color: 0xc792ff, blurb: 'One shot, one takedown. Longest range.'
  },
  {
    id: 'launcher', name: 'LAUNCHER', level: 3, damage: 92, rpm: 52, magazine: 3,
    spread: 0.006, range: 130, pellets: 1, reload: 2.6, auto: false,
    splash: 5.5, color: 0xff6f91, blurb: 'Explosive payload with splash damage.'
  }
];

export const LEVELS = [
  { level: 1, minXp: 0 },
  { level: 2, minXp: 100 },
  { level: 3, minXp: 300 }
];

export const MASTERY_XP = 700;
export const XP_PER_KILL = 100;
export const KILL_REWARD = 1.2;
export const MATCH_PKG_PATH = 'gno.land/r/arena3d/match';

export function levelForXp(xp) {
  let level = 1;
  for (const l of LEVELS) if (xp >= l.minXp) level = l.level;
  return level;
}

export function levelProgress(xp, level) {
  const current = LEVELS[Math.max(0, level - 1)].minXp;
  const next = level < LEVELS.length ? LEVELS[level].minXp : MASTERY_XP;
  return {
    current,
    next,
    value: Math.max(0, Math.min(1, (xp - current) / (next - current))),
    mastery: level >= LEVELS.length
  };
}

export function characterById(id) {
  return CHARACTERS.find((c) => c.id === id) || CHARACTERS[1];
}

export function weaponById(id) {
  return WEAPONS.find((w) => w.id === id) || WEAPONS[0];
}

export function unlockedWeaponIds(level) {
  return WEAPONS.filter((w) => w.level <= level).map((w) => w.id);
}

export function cssColor(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}
