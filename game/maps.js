// Three hand-procedured battlegrounds. Each map owns its palette, geometry,
// lighting, fog, colliders and spawn points.
import * as THREE from 'three';
import { WorldBuilder, makeRandom } from './world.js';

function wallAlongX(b, z, from, to, gapA, gapB, h, color, thickness = 0.7) {
  const segments = gapA === null ? [[from, to]] : [[from, gapA], [gapB, to]];
  for (const [a, c] of segments) {
    if (c - a <= 0.1) continue;
    b.box((a + c) / 2, h / 2, z, c - a, h, thickness, color, { collide: true });
  }
}

function wallAlongZ(b, x, from, to, gapA, gapB, h, color, thickness = 0.7) {
  const segments = gapA === null ? [[from, to]] : [[from, gapA], [gapB, to]];
  for (const [a, c] of segments) {
    if (c - a <= 0.1) continue;
    b.box(x, h / 2, (a + c) / 2, thickness, h, c - a, color, { collide: true });
  }
}

function crateStack(b, x, z, count, size = 1.5, color = 0x526273) {
  for (let i = 0; i < count; i++) {
    const y = size / 2 + i * size;
    b.box(x, y, z, size, size, size, color, { collide: true, roughness: 0.6, metalness: 0.35 });
    b.box(x, y + size / 2 - 0.045, z, size * 0.92, 0.08, size * 0.92, 0xf0a23b,
      { collide: false, emissive: 0xa85a10, emissiveIntensity: 0.55, shootable: false });
  }
}

/* -------------------------------------------------------------------------- */
/* 1. THE FOUNDRY — indoor close-quarters arena                              */
/* -------------------------------------------------------------------------- */
function buildFoundry(scene) {
  const b = new WorldBuilder(scene, {
    sky: 0x0a111a,
    fogColor: 0x0c1520,
    fogDensity: 0.011,
    hemiSky: 0x9fc4dd,
    hemiGround: 0x2c3644,
    hemiIntensity: 1.35,
    sunColor: 0xffd6a5,
    sunIntensity: 0.95,
    ambientColor: 0xa9c6dd,
    ambientIntensity: 0.8,
    bounds: { minX: -29, maxX: 29, minZ: -29, maxZ: 29 },
    playerSpawns: [new THREE.Vector3(0, 0, 21), new THREE.Vector3(4, 0, 23)],
    botSpawns: [
      new THREE.Vector3(-23, 0, -22), new THREE.Vector3(21, 0, -21),
      new THREE.Vector3(-21, 0, 20), new THREE.Vector3(22, 0, 9),
      new THREE.Vector3(0, 0, -23)
    ]
  });

  const concrete = 0x394654;
  const wall = 0x4b5a6b;
  const metal = 0x5e6f80;

  b.box(0, -0.2, 0, 62, 0.4, 62, 0x2a3543, { collide: false });
  b.box(0, 7.2, 0, 62, 0.4, 62, 0x1b2531, { collide: false, shootable: false });

  // Outer shell.
  wallAlongX(b, -31, -31, 31, null, null, 7, concrete, 0.8);
  wallAlongX(b, 31, -31, 31, null, null, 7, concrete, 0.8);
  wallAlongZ(b, -31, -31, 31, null, null, 7, concrete, 0.8);
  wallAlongZ(b, 31, -31, 31, null, null, 7, concrete, 0.8);

  // Interior rooms and corridors with door gaps.
  wallAlongZ(b, -10, -30, 14, -7, -2, 6, wall);
  wallAlongX(b, 2, -30, 16, -16, -11, 6, wall);
  wallAlongZ(b, 12, 2, 30, 12, 17, 6, wall);
  wallAlongX(b, -13, -10, 30, 4, 9, 6, wall);
  wallAlongZ(b, 0, -30, -13, -23, -18, 6, metal);
  wallAlongX(b, 21, 12, 31, 20, 25, 6, metal);

  // Structural pillars.
  for (const [x, z] of [[-27, -27], [27, -27], [-27, 27], [27, 27], [-10, 2], [12, -13]]) {
    b.box(x, 3, z, 1.5, 6, 1.5, metal, { collide: true });
  }

  // Crates, stacks and low cover.
  [
    [-20, -9, 2], [-24, -5, 1], [-17, -16, 1], [-4, -20, 2], [5, -25, 1],
    [20, -8, 2], [24, -14, 1], [17, 8, 1], [20, 18, 2], [4, 12, 1],
    [-4, 26, 2], [-19, 8, 1], [-25, 14, 2], [7, -5, 1], [25, 25, 1]
  ].forEach(([x, z, n]) => crateStack(b, x, z, n));

  // Overhead light strips and glowing wall panels.
  for (const x of [-20, -6, 8, 22]) {
    for (const z of [-20, 0, 20]) {
      b.box(x, 6.85, z, 5, 0.09, 0.36, 0xbfe9ff,
        { emissive: 0x69bcd8, emissiveIntensity: 1.4, shootable: false });
    }
  }
  b.box(-30.5, 3.5, 0, 0.12, 1.2, 8, 0xff8c42, { emissive: 0xff6a1e, emissiveIntensity: 1.2, shootable: false });
  b.box(30.5, 3.5, 0, 0.12, 1.2, 8, 0x45d7ff, { emissive: 0x1f9dc9, emissiveIntensity: 1.2, shootable: false });

  b.pointLight(-22, 5.5, -18, 0xffa055, 75, 26);
  b.pointLight(20, 5.5, 16, 0x59c8ff, 75, 26);
  b.pointLight(0, 5.5, 0, 0xffd7a0, 55, 22);
  b.pointLight(-18, 5.5, 20, 0x59c8ff, 60, 22);

  return b;
}

/* -------------------------------------------------------------------------- */
/* 2. VERDANT RUINS — foggy jungle with trees and broken stonework           */
/* -------------------------------------------------------------------------- */
function buildJungle(scene) {
  const b = new WorldBuilder(scene, {
    sky: 0x234733,
    fogColor: 0x244b35,
    fogDensity: 0.026,
    hemiSky: 0x9fd99a,
    hemiGround: 0x1d331f,
    hemiIntensity: 0.95,
    ambientIntensity: 0.4,
    sunColor: 0xffe6a8,
    sunIntensity: 0.8,
    sunPos: [18, 38, -12],
    bounds: { minX: -37, maxX: 37, minZ: -37, maxZ: 37 },
    playerSpawns: [new THREE.Vector3(0, 0, 21), new THREE.Vector3(4, 0, 24)],
    botSpawns: [
      new THREE.Vector3(-22, 0, -19), new THREE.Vector3(22, 0, -17),
      new THREE.Vector3(-20, 0, 21), new THREE.Vector3(20, 0, 19),
      new THREE.Vector3(0, 0, -25)
    ]
  });

  const rand = makeRandom(90210);
  const spawns = [...b.playerSpawns, ...b.botSpawns];
  const clearOfSpawns = (x, z, d) => spawns.every((p) => Math.hypot(p.x - x, p.z - z) > d);

  b.ground(110, 110, 0x2c4d31, 0, { segsX: 20, segsZ: 20 });

  // Dirt clearings and dark undergrowth patches.
  for (let i = 0; i < 34; i++) {
    const x = (rand() * 2 - 1) * 36;
    const z = (rand() * 2 - 1) * 36;
    b.cylinder(x, 0.015, z, 1.4 + rand() * 3.4, 1.6 + rand() * 3.6, 0.03,
      rand() > 0.5 ? 0x53452c : 0x24402a, { segments: 9, collide: false, shootable: false });
  }

  // Dense trees: solid trunks, layered canopy that bullets can cut through.
  let planted = 0;
  for (let tries = 0; tries < 420 && planted < 72; tries++) {
    const x = (rand() * 2 - 1) * 36;
    const z = (rand() * 2 - 1) * 36;
    if (!clearOfSpawns(x, z, 4.2)) continue;
    if (Math.abs(x) < 6 && Math.abs(z) < 6) continue; // keep the ruin courtyard open
    const h = 5 + rand() * 4;
    const r = 0.28 + rand() * 0.22;
    const trunkColor = rand() > 0.5 ? 0x5b442d : 0x6b5237;
    b.cylinder(x, h / 2, z, r * 0.75, r, h, trunkColor, { collide: true, segments: 7 });
    const leaf = [0x2f7a3c, 0x3c9148, 0x4aa457, 0x286b39][Math.floor(rand() * 4)];
    for (let k = 0; k < 3; k++) {
      const y = h * (0.62 + k * 0.19);
      const radius = (2.5 - k * 0.45) * (0.85 + rand() * 0.3);
      b.cone(x, y + 1.2, z, radius, 2.6 + rand(), leaf,
        { collide: false, segments: 7, flatShading: true });
    }
    // Hanging vines on some trees.
    if (rand() > 0.6) {
      b.cylinder(x + r * 1.8, h * 0.62, z, 0.05, 0.05, h * 0.55, 0x4d8b46,
        { collide: false, segments: 4, shootable: false });
    }
    planted++;
  }

  // Ruined stone courtyard.
  const stone = 0x70765f;
  const moss = 0x48613e;
  wallAlongX(b, -12, -15, 15, -3, 3, 4.2, stone, 1.2);
  wallAlongX(b, 12, -15, 15, -4, 2, 3.6, stone, 1.2);
  wallAlongZ(b, -15, -12, 12, -2, 4, 4.6, stone, 1.2);
  wallAlongZ(b, 15, -12, 12, -5, 1, 3.2, stone, 1.2);

  for (const [x, z, h] of [[-8, -8, 5], [8, -8, 3.5], [-8, 8, 4], [8, 8, 5.5]]) {
    b.box(x, h / 2, z, 1.4, h, 1.4, stone, { collide: true });
    b.box(x, h - 0.2, z, 1.6, 0.4, 1.6, moss, { collide: false });
  }
  // Broken archway at the centre.
  b.box(-2.6, 1.8, 0, 1.1, 3.6, 1.1, stone, { collide: true });
  b.box(2.6, 1.8, 0, 1.1, 3.6, 1.1, stone, { collide: true });
  b.box(0, 3.7, 0, 7, 0.8, 1.3, stone, { collide: true });
  b.box(0, 4.1, 0, 5.4, 0.16, 1.4, moss, { collide: false });

  // Fallen blocks and scattered boulders.
  for (let i = 0; i < 26; i++) {
    const x = (rand() * 2 - 1) * 34;
    const z = (rand() * 2 - 1) * 34;
    if (!clearOfSpawns(x, z, 3)) continue;
    if (rand() > 0.55) {
      b.rock(x, 0.45, z, 0.7 + rand() * 0.9, stone,
        { collide: true, rotY: rand() * 3, sy: 0.65 });
    } else {
      b.box(x, 0.4, z, 2 + rand() * 1.5, 0.8, 1.5, moss,
        { collide: true, rotY: rand() * 1.2 });
    }
  }

  // Fern clumps for readable foliage silhouettes.
  for (let i = 0; i < 48; i++) {
    const x = (rand() * 2 - 1) * 35;
    const z = (rand() * 2 - 1) * 35;
    if (!clearOfSpawns(x, z, 2.5)) continue;
    for (let k = 0; k < 3; k++) {
      b.cone(x + (rand() - 0.5) * 1.2, 0.55, z + (rand() - 0.5) * 1.2,
        0.42 + rand() * 0.25, 1.1 + rand() * 0.7, 0x3f9a4b,
        { collide: false, segments: 5, shootable: false });
    }
  }

  b.pointLight(0, 6, 0, 0xc8ff9a, 1.25, 28);
  b.pointLight(-18, 5, 18, 0x9fe0a0, 0.8, 22);
  b.pointLight(18, 5, -18, 0x9fe0a0, 0.7, 22);

  return b;
}

/* -------------------------------------------------------------------------- */
/* 3. SUNKEN ATOLL — desert island with water, palms and bleached rock       */
/* -------------------------------------------------------------------------- */
function buildAtoll(scene) {
  const b = new WorldBuilder(scene, {
    sky: 0x8acbe8,
    fogColor: 0xbcdde4,
    fogDensity: 0.0058,
    hemiSky: 0xe8f7ff,
    hemiGround: 0xa88755,
    hemiIntensity: 1.0,
    sunColor: 0xfff1c9,
    sunIntensity: 1.25,
    sunPos: [30, 44, 20],
    bounds: { minX: -33, maxX: 33, minZ: -33, maxZ: 33 },
    playerSpawns: [new THREE.Vector3(0, 0, 19), new THREE.Vector3(5, 0, 21)],
    botSpawns: [
      new THREE.Vector3(-17, 0, -12), new THREE.Vector3(15, 0, -15),
      new THREE.Vector3(-19, 0, 13), new THREE.Vector3(19, 0, 15),
      new THREE.Vector3(0, 0, -21)
    ]
  });

  const rand = makeRandom(424242);
  const spawns = [...b.playerSpawns, ...b.botSpawns];
  const clearOfSpawns = (x, z, d) => spawns.every((p) => Math.hypot(p.x - x, p.z - z) > d);

  // Ocean with a gently animated surface.
  const water = b.ground(280, 280, 0x1f86ab, -0.55,
    { segsX: 48, segsZ: 48, transparent: true, opacity: 0.88, roughness: 0.25, metalness: 0.12 });
  const basePositions = Float32Array.from(water.geometry.attributes.position.array);
  b.animate((dt, time) => {
    const attr = water.geometry.attributes.position;
    for (let i = 0; i < attr.count; i++) {
      const x = basePositions[i * 3];
      const y = basePositions[i * 3 + 1];
      attr.array[i * 3 + 2] = Math.sin(x * 0.09 + time * 1.1) * 0.18 + Math.cos(y * 0.12 + time * 0.8) * 0.14;
    }
    attr.needsUpdate = true;
  });

  // Sand shelf and wind-shaped dunes.
  b.cylinder(0, -0.32, 0, 31, 33, 0.64, 0xd8b87b, { segments: 40, collide: false });
  b.ground(70, 70, 0xe2c489, 0.02, { segsX: 18, segsZ: 18, shootable: false });
  for (let i = 0; i < 22; i++) {
    const a = rand() * Math.PI * 2;
    const d = 14 + rand() * 18;
    b.sphere(Math.cos(a) * d, -0.55, Math.sin(a) * d, 2.4 + rand() * 2.6, 0xd3b276,
      { collide: false, sy: 0.22, segments: 10, shootable: false });
  }

  // Palms: leaning segmented trunks with broad fronds.
  function palm(x, z, scale = 1) {
    const lean = (rand() - 0.5) * 0.55;
    const leanZ = (rand() - 0.5) * 0.55;
    const segments = 5;
    const segH = 1.5 * scale;
    for (let i = 0; i < segments; i++) {
      const t = i / segments;
      b.cylinder(x + lean * t * t * 3, segH * (i + 0.5), z + leanZ * t * t * 3,
        0.22 * scale - t * 0.06, 0.26 * scale - t * 0.06, segH + 0.05, 0x8b643b,
        { collide: i < 2, segments: 6, rotZ: lean * 0.3 });
    }
    const cx = x + lean * 3;
    const cz = z + leanZ * 3;
    const top = segments * segH;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const frond = b.box(cx + Math.cos(a) * 1.3 * scale, top + 0.15, cz + Math.sin(a) * 1.3 * scale,
        2.8 * scale, 0.12, 0.75 * scale, k % 2 ? 0x3f9b54 : 0x4fb262,
        { collide: false, rotY: -a, rotZ: -0.22, shootable: true });
      frond.material.side = THREE.DoubleSide;
    }
    b.sphere(cx, top + 0.1, cz, 0.35 * scale, 0x6d4e2c, { collide: false, segments: 8, shootable: false });
  }
  const palmSpots = [
    [-24, -6], [-21, 10], [-12, 22], [7, 25], [22, 19], [26, 2],
    [22, -18], [8, -26], [-9, -25], [-25, -19], [-4, 12], [14, 5]
  ];
  palmSpots.forEach(([x, z]) => palm(x, z, 0.85 + rand() * 0.4));

  // Weathered ruins, boulders and shipwreck crates.
  const limestone = 0xb8ab8e;
  b.box(-6, 2, -6, 1.4, 4, 1.4, limestone, { collide: true });
  b.box(6, 2, -6, 1.4, 4, 1.4, limestone, { collide: true });
  b.box(0, 4.25, -6, 9, 0.7, 1.5, limestone, { collide: true });
  b.box(-13, 1.6, 5, 7, 3.2, 1.1, limestone, { collide: true });
  b.box(13, 1.2, 8, 6, 2.4, 1.1, limestone, { collide: true });
  b.box(0, 0.75, 12, 5, 1.5, 1.4, limestone, { collide: true });

  for (let i = 0; i < 30; i++) {
    const a = rand() * Math.PI * 2;
    const d = 8 + rand() * 22;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!clearOfSpawns(x, z, 3)) continue;
    b.rock(x, 0.35, z, 0.6 + rand() * 1.1, rand() > 0.5 ? 0x938d7e : 0xa8a08c,
      { collide: true, rotY: rand() * 6, sy: 0.7 });
  }
  crateStack(b, -10, -14, 2, 1.4, 0x9a7950);
  crateStack(b, 11, 14, 1, 1.4, 0x9a7950);
  crateStack(b, 3, -17, 2, 1.4, 0x9a7950);

  // A few weathered posts on the beach.
  for (const [x, z] of [[-28, 3], [28, -6], [-15, -26]]) {
    b.cylinder(x, 1.1, z, 0.16, 0.2, 2.2, 0x7b5c3d, { collide: true, segments: 6 });
  }

  return b;
}

export const MAPS = [
  {
    id: 'foundry',
    name: 'THE FOUNDRY',
    tag: 'CQC / INDOOR',
    blurb: 'Tight rooms, lit corridors and crate cover. Shotguns and SMGs rule here.',
    accent: '#45d7ff',
    build: buildFoundry
  },
  {
    id: 'jungle',
    name: 'VERDANT RUINS',
    tag: 'FOLIAGE / FOG',
    blurb: 'Dense canopy, moss-bound stone and heavy fog. Stay close to your squad.',
    accent: '#5ee08a',
    build: buildJungle
  },
  {
    id: 'atoll',
    name: 'SUNKEN ATOLL',
    tag: 'OPEN / ISLAND',
    blurb: 'Sun-bleached sand, swaying palms and long sightlines. Bring the rifle.',
    accent: '#ffc857',
    build: buildAtoll
  }
];

export function getMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}
