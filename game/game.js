// ARENA LEDGER — self-contained three.js first-person shooter client.
// Optional globals: window.ArenaNet and window.ArenaWallet (loaded via <script> tags).
import * as THREE from 'three';
import { MAPS, getMap } from './maps.js';
import {
  CHARACTERS, WEAPONS, MASTERY_XP, XP_PER_KILL, KILL_REWARD, MATCH_PKG_PATH,
  levelForXp, levelProgress, characterById, weaponById, cssColor
} from './weapons.js';

const $ = (id) => document.getElementById(id);
const EYE = 1.62;
const myId = 'PL-' + Math.random().toString(36).slice(2, 8).toUpperCase();
const keys = new Set();
const raycaster = new THREE.Raycaster();
const clock = { last: performance.now() };

/* ------------------------------- renderer -------------------------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.autoClear = false; // we render the world, then the viewmodel over it
$('game-root').appendChild(renderer.domElement);
const canvas = renderer.domElement;
canvas.tabIndex = 0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.05, 420);
camera.rotation.order = 'YXZ';
scene.add(camera);

// Separate scene for the first-person weapon so it never clips into walls.
const viewScene = new THREE.Scene();
const viewCamera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.01, 12);
viewScene.add(new THREE.HemisphereLight(0xffffff, 0x3b4a5a, 1.5));
const viewSun = new THREE.DirectionalLight(0xffffff, 1.7);
viewSun.position.set(2, 3, 4);
viewScene.add(viewSun);

/* -------------------------------- state ---------------------------------- */
const state = {
  started: false,
  mapId: MAPS[0].id,
  charId: 'marine',
  weaponId: 'pistol',
  callsign: 'PILOT-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
  level: 1,
  xp: 0,
  kills: 0,
  hp: 100,
  maxHp: 100,
  ammo: 12,
  reloading: 0,
  nextFire: 0,
  shooting: false,
  yaw: 0,
  pitch: 0,
  pos: new THREE.Vector3(0, EYE, 20),
  velY: 0,
  grounded: true,
  dead: false,
  respawnAt: 0,
  world: null,
  matchId: '',
  roomId: 'arena-demo',
  netReady: false,
  remoteStates: [],
  remotes: new Map(),
  bots: [],
  effects: [],
  damageFlash: 0,
  hitMarker: 0,
  recoil: 0,
  muzzle: 0,
  lastBroadcast: 0,
  walletConnected: false
};

let viewModel = null;
let muzzleFlash = null;
let muzzleLight = null;
let toastTimer = 0;

// requestPointerLock may return a promise (and reject without user activation).
function requestLock() {
  try {
    const result = canvas.requestPointerLock?.();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (err) { /* resume overlay handles a missing lock */ }
}

/* --------------------------- selection screens ---------------------------- */
function renderMapCards() {
  const host = $('map-list');
  host.innerHTML = '';
  MAPS.forEach((map) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option' + (state.mapId === map.id ? ' selected' : '');
    btn.innerHTML =
      `<div class="option-title"><span class="swatch" style="background:${map.accent};color:${map.accent}"></span>${map.name}</div>` +
      `<div class="option-tag">${map.tag}</div><div class="option-sub">${map.blurb}</div>`;
    btn.addEventListener('click', () => { state.mapId = map.id; renderMapCards(); });
    host.appendChild(btn);
  });
}

function renderCharacterCards() {
  const host = $('char-list');
  host.innerHTML = '';
  CHARACTERS.forEach((char) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option' + (state.charId === char.id ? ' selected' : '');
    btn.innerHTML =
      `<div class="option-title"><span class="swatch" style="background:${cssColor(char.color)};color:${cssColor(char.color)}"></span>${char.name}</div>` +
      `<div class="option-sub">${char.blurb}</div>` +
      `<div class="option-stats"><span>HP <b>${char.hp}</b></span><span>SPD <b>${char.speed.toFixed(1)}</b></span></div>`;
    btn.addEventListener('click', () => { state.charId = char.id; renderCharacterCards(); });
    host.appendChild(btn);
  });
}

function renderWeaponCards() {
  const host = $('weapon-list');
  host.innerHTML = '';
  $('unlock-hint').textContent = state.level >= 3 ? 'ALL UNLOCKED' : `LEVEL ${state.level} UNLOCKS`;
  WEAPONS.forEach((w) => {
    const locked = w.level > state.level;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option' + (state.weaponId === w.id ? ' selected' : '') + (locked ? ' locked' : '');
    btn.innerHTML =
      `<div class="option-title"><span class="swatch" style="background:${cssColor(w.color)};color:${cssColor(w.color)}"></span>${w.name}</div>` +
      `<div class="option-tag">${locked ? `<span class="lock-badge">LVL ${w.level} LOCKED</span>` : (w.auto ? 'AUTO' : 'SEMI')}</div>` +
      `<div class="option-sub">${w.blurb}</div>` +
      `<div class="option-stats"><span>DMG <b>${w.damage}</b></span><span>RPM <b>${w.rpm}</b></span><span>MAG <b>${w.magazine}</b></span><span>SPREAD <b>${(w.spread * 100).toFixed(1)}</b></span></div>`;
    if (!locked) btn.addEventListener('click', () => { state.weaponId = w.id; renderWeaponCards(); });
    host.appendChild(btn);
  });
}

function setWalletStatus(text, cls = '') {
  const el = $('wallet-status');
  el.textContent = text;
  el.className = 'wallet-status' + (cls ? ' ' + cls : '');
}

function detectWallet() {
  if (typeof window.ArenaWallet !== 'undefined' && window.ArenaWallet) {
    setWalletStatus('WALLET DETECTED · READY — CLICK ENTER MATCH TO CONNECT', 'ready');
  } else {
    setWalletStatus('NO WALLET DETECTED · DEMO MODE (REWARDS SIMULATED)', 'error');
  }
}

/* -------------------------------- avatars --------------------------------- */
function createAvatar(name, color, kind, id, hp) {
  const group = new THREE.Group();
  const entity = {
    kind, id, name, hp, maxHp: hp, dead: false, respawnAt: 0, group,
    nextTracer: 0, nextShot: 0
  };
  group.userData.entity = entity;

  const armour = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.2, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151d27, roughness: 0.85 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.78, 0.36), armour);
  torso.position.y = 1.16;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 8), armour);
  head.position.y = 1.76;
  group.add(head);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.1, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x05090d, emissive: color, emissiveIntensity: 0.7 })
  );
  visor.position.set(0, 1.78, -0.2);
  group.add(visor);

  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.78, 0.26), dark);
    leg.position.set(side * 0.17, 0.39, 0);
    group.add(leg);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.62, 0.2), armour);
    arm.position.set(side * 0.42, 1.18, -0.06);
    group.add(arm);
  }

  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.11, 0.62), dark);
  gun.position.set(0.32, 1.2, -0.4);
  group.add(gun);

  group.traverse((obj) => { if (obj.isMesh) obj.userData.entity = entity; });
  return entity;
}

function colorFromId(id) {
  let hash = 0;
  for (let i = 0; i < String(id).length; i++) hash = (Math.imul(hash, 31) + String(id).charCodeAt(i)) >>> 0;
  const palette = [0x45d7ff, 0xff845d, 0x5ee08a, 0xc792ff, 0xffc857, 0x6fa8ff];
  return palette[hash % palette.length];
}

function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
  });
}

/* ------------------------------- world setup ------------------------------ */
function resetPlayer() {
  const char = characterById(state.charId);
  state.maxHp = char.hp;
  state.hp = char.hp;
  state.dead = false;
  state.velY = 0;
  state.grounded = true;
  const spawns = state.world.playerSpawns;
  const sp = spawns[Math.floor(Math.random() * spawns.length)];
  state.pos.set(sp.x, EYE, sp.z);
  state.yaw = Math.atan2(sp.x, sp.z); // face the middle of the arena
  state.pitch = 0;
  state.ammo = weaponById(state.weaponId).magazine;
  state.reloading = 0;
  state.nextFire = performance.now() + 200;
  camera.position.copy(state.pos);
  camera.rotation.set(state.pitch, state.yaw, 0);
}

function spawnBots(count) {
  const spots = state.world.botSpawns.length ? state.world.botSpawns : [new THREE.Vector3(8, 0, 8)];
  const names = ['ROOK', 'VIPER', 'GHOST', 'ECHO', 'ONYX'];
  for (let i = 0; i < count; i++) {
    const spot = spots[i % spots.length];
    const bot = createAvatar(names[i % names.length], colorFromId(names[i]), 'bot', `bot-${i}`, 100);
    bot.group.position.copy(spot);
    bot.spawn = spot.clone();
    bot.waypoint = spots[(i + 2) % spots.length].clone();
    bot.speed = 2.5 + i * 0.28;
    bot.nextShot = performance.now() + 1800 + i * 450;
    scene.add(bot.group);
    state.bots.push(bot);
  }
}

function setupWorld(mapId) {
  if (state.world) state.world.dispose();
  state.bots.forEach((bot) => { scene.remove(bot.group); disposeObject(bot.group); });
  state.bots.length = 0;
  state.remotes.forEach((r) => { scene.remove(r.group); disposeObject(r.group); });
  state.remotes.clear();
  state.world = getMap(mapId).build(scene);
  resetPlayer();
  spawnBots(4);
  $('hud-map').textContent = getMap(mapId).name;
}

/* --------------------------- weapons and shooting ------------------------- */
function buildViewModel() {
  if (viewModel) { viewScene.remove(viewModel); disposeObject(viewModel); }
  const w = weaponById(state.weaponId);
  viewModel = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x202a35, roughness: 0.42, metalness: 0.65 });
  const accentMat = new THREE.MeshStandardMaterial({ color: w.color, emissive: w.color, emissiveIntensity: 0.45, roughness: 0.4 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.16, 0.52), bodyMat);
  viewModel.add(body);

  const long = w.id === 'sniper' || w.id === 'launcher' || w.id === 'shotgun';
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(w.id === 'launcher' ? 0.085 : 0.038, w.id === 'launcher' ? 0.09 : 0.045, long ? 0.72 : 0.46, 10),
    bodyMat
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.015, long ? -0.58 : -0.44);
  viewModel.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.13), bodyMat);
  grip.position.set(0, -0.18, 0.12);
  grip.rotation.x = -0.22;
  viewModel.add(grip);

  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.34), accentMat);
  strip.position.set(0, 0.095, -0.06);
  viewModel.add(strip);

  if (w.id === 'launcher') {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.34, 10), accentMat);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0, -0.28);
    viewModel.add(tube);
  }

  muzzleFlash = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.14, 0),
    new THREE.MeshBasicMaterial({ color: 0xffe4a0, transparent: true, opacity: 0.95, depthWrite: false })
  );
  muzzleFlash.position.set(0, 0.015, long ? -1.0 : -0.72);
  muzzleFlash.visible = false;
  viewModel.add(muzzleFlash);

  muzzleLight = new THREE.PointLight(0xffd27a, 0, 3);
  muzzleLight.position.copy(muzzleFlash.position);
  viewModel.add(muzzleLight);

  viewModel.position.set(0.29, -0.25, -0.62);
  viewScene.add(viewModel);
}

function selectWeapon(id) {
  const w = weaponById(id);
  if (w.level > state.level || state.dead) return;
  state.weaponId = id;
  state.ammo = w.magazine;
  state.reloading = 0;
  state.nextFire = performance.now() + 180;
  buildViewModel();
  addFeed('EQUIPPED ' + w.name);
}

function startReload() {
  const w = weaponById(state.weaponId);
  if (!state.started || state.dead || state.reloading > 0 || state.ammo >= w.magazine) return;
  state.reloading = w.reload;
}

function avatarTargets() {
  const targets = [];
  for (const bot of state.bots) if (!bot.dead && bot.group.visible) targets.push(bot.group);
  for (const remote of state.remotes.values()) if (!remote.dead && remote.group.visible) targets.push(remote.group);
  return targets;
}

function findEntity(obj) {
  let node = obj;
  while (node) {
    if (node.userData && node.userData.entity) return node.userData.entity;
    node = node.parent;
  }
  return null;
}

function spawnTracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.92, depthWrite: false });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  state.effects.push({ obj: line, ttl: 0.11, max: 0.11, kind: 'line' });
}

function spawnImpact(point, color) {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.11, 0),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false })
  );
  mesh.position.copy(point);
  scene.add(mesh);
  state.effects.push({ obj: mesh, ttl: 0.28, max: 0.28, kind: 'impact' });
}

function spawnExplosion(point, color) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 10),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, wireframe: true, depthWrite: false })
  );
  mesh.position.copy(point);
  scene.add(mesh);
  state.effects.push({ obj: mesh, ttl: 0.38, max: 0.38, kind: 'boom' });
}

function muzzleWorld() {
  camera.updateMatrixWorld();
  return camera.localToWorld(new THREE.Vector3(0.24, -0.16, -0.45));
}

function explode(point, weapon) {
  spawnExplosion(point, weapon.color);
  const radius = weapon.splash || 0;
  if (!radius) return;
  for (const ent of [...state.bots, ...state.remotes.values()]) {
    if (ent.dead || !ent.group.visible) continue;
    const centre = ent.group.position.clone().setY(1.1);
    const d = centre.distanceTo(point);
    if (d < radius) applyHit(ent, weapon.damage * (1 - d / radius), weapon, centre);
  }
}

function applyHit(ent, damage, weapon, point) {
  ent.hp -= damage;
  state.hitMarker = 1;
  spawnImpact(point || ent.group.position.clone().setY(1.2), weapon.color);
  if (ent.kind === 'remote' && state.netReady) {
    const net = window.ArenaNet;
    if (net && typeof net.sendHit === 'function') {
      try { net.sendHit(ent.id, Math.round(damage), weapon.id); } catch (err) { /* network is optional */ }
    }
  }
  if (ent.hp <= 0 && !ent.dead) registerKill(ent, weapon);
}

function attemptFire(now) {
  if (!state.started || !state.world || state.dead || state.reloading > 0 || now < state.nextFire) return;
  const w = weaponById(state.weaponId);
  if (state.ammo <= 0) { startReload(); return; }

  state.ammo--;
  state.nextFire = now + 60000 / w.rpm;
  state.recoil = 1;
  state.muzzle = 1;

  const origin = camera.position.clone();
  const q = camera.quaternion.clone();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const targets = avatarTargets().concat(state.world.shootables);
  const from = muzzleWorld();

  for (let pellet = 0; pellet < (w.pellets || 1); pellet++) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
      .addScaledVector(right, (Math.random() - 0.5) * 2 * w.spread)
      .addScaledVector(up, (Math.random() - 0.5) * 2 * w.spread)
      .normalize();
    raycaster.set(origin, dir);
    raycaster.far = w.range;
    const hits = raycaster.intersectObjects(targets, true);
    const hit = hits.length ? hits[0] : null;
    const end = hit ? hit.point.clone() : origin.clone().addScaledVector(dir, w.range);
    if (pellet < 3 || (w.pellets || 1) === 1) spawnTracer(from, end, w.color);
    if (hit) {
      const ent = findEntity(hit.object);
      if (ent && !ent.dead) applyHit(ent, w.damage, w, hit.point);
      else spawnImpact(hit.point, w.color);
    }
    if (w.splash) explode(end, w);
  }
  if (state.ammo === 0) startReload();
}

/* --------------------------- kills, XP and rewards ------------------------ */
function addFeed(text, cls = '') {
  const feed = $('kill-feed');
  const el = document.createElement('div');
  el.className = 'feed-item' + (cls ? ' ' + cls : '');
  el.textContent = text;
  feed.prepend(el);
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => el.remove(), 5200);
}

function showRewardToast() {
  const el = $('reward-toast');
  el.classList.remove('show');
  void el.offsetWidth; // restart the CSS animation
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1550);
}

function registerKill(ent, weapon) {
  ent.dead = true;
  ent.respawnAt = performance.now() + 2600;
  ent.group.visible = false;

  state.kills++;
  state.xp += XP_PER_KILL;
  const newLevel = levelForXp(state.xp);
  if (newLevel !== state.level) {
    state.level = newLevel;
    addFeed(`LEVEL ${newLevel} · NEW WEAPONS UNLOCKED`, 'gold');
    renderWeaponCards();
  }
  addFeed(`YOU ▸ ${ent.name}  [${weapon.name}]`, 'gold');
  showRewardToast(); // economy pays KILL_REWARD tokens per takedown
}

function killPlayer() {
  if (state.dead) return;
  state.dead = true;
  state.hp = 0;
  state.shooting = false;
  state.respawnAt = performance.now() + 2000;
  $('respawn-count').textContent = '2';
  $('respawn-overlay').classList.remove('hidden');
  addFeed('YOU WERE DOWNED', 'danger');
}

/* ----------------------------- player movement ---------------------------- */
function hasLineOfSight(from, to) {
  const dir = to.clone().sub(from);
  const dist = dir.length();
  if (dist <= 0.6) return true;
  dir.normalize();
  raycaster.set(from, dir);
  raycaster.far = dist - 0.5;
  const blocked = raycaster.intersectObjects(state.world.shootables, false).length > 0;
  return !blocked;
}

function updatePlayer(dt, now) {
  if (state.dead) {
    $('respawn-count').textContent = String(Math.max(1, Math.ceil((state.respawnAt - now) / 1000)));
    if (now >= state.respawnAt) {
      resetPlayer();
      $('respawn-overlay').classList.add('hidden');
    }
    return;
  }

  const char = characterById(state.charId);
  const forwardInput = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafeInput = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const speed = char.speed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1.18 : 1);

  const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const move = forward.multiplyScalar(forwardInput).add(right.multiplyScalar(strafeInput));
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed * dt);
    const feet = state.pos.y - EYE;
    if (!state.world.blocked(state.pos.x + move.x, state.pos.z, feet)) state.pos.x += move.x;
    if (!state.world.blocked(state.pos.x, state.pos.z + move.z, feet)) state.pos.z += move.z;
  }

  if (keys.has('Space') && state.grounded) { state.velY = 5.2; state.grounded = false; }
  state.velY -= 15 * dt;
  let feet = state.pos.y - EYE + state.velY * dt;
  if (feet <= 0) { feet = 0; state.velY = 0; state.grounded = true; }
  state.pos.y = feet + EYE;

  camera.position.copy(state.pos);
  camera.rotation.set(state.pitch, state.yaw, 0);

  if (state.reloading > 0) {
    state.reloading -= dt;
    if (state.reloading <= 0) {
      state.reloading = 0;
      state.ammo = weaponById(state.weaponId).magazine;
      addFeed('MAGAZINE READY');
    }
  }

  if (state.shooting && now >= state.nextFire && weaponById(state.weaponId).auto) attemptFire(now);
  if (state.damageFlash > 0) state.damageFlash = Math.max(0, state.damageFlash - dt * 2.4);
  if (state.hitMarker > 0) state.hitMarker = Math.max(0, state.hitMarker - dt * 5);
}

/* -------------------------------- bots / remotes -------------------------- */
function updateBots(dt, now) {
  for (const bot of state.bots) {
    if (bot.dead) {
      if (now >= bot.respawnAt) {
        bot.dead = false;
        bot.hp = bot.maxHp;
        bot.group.visible = true;
        bot.group.position.copy(bot.spawn);
        bot.waypoint.copy(bot.spawn);
      }
      continue;
    }

    const pos = bot.group.position;
    const dxw = bot.waypoint.x - pos.x;
    const dzw = bot.waypoint.z - pos.z;
    const distW = Math.hypot(dxw, dzw);
    if (distW < 1.2) {
      const spawns = state.world.botSpawns;
      bot.waypoint.copy(spawns[Math.floor(Math.random() * spawns.length)]);
    } else {
      const nx = pos.x + (dxw / distW) * bot.speed * dt;
      const nz = pos.z + (dzw / distW) * bot.speed * dt;
      if (!state.world.blocked(nx, pos.z, 0, 0.45, 1.8)) pos.x = nx;
      if (!state.world.blocked(pos.x, nz, 0, 0.45, 1.8)) pos.z = nz;
      bot.group.rotation.y = Math.atan2(-dxw, -dzw);
    }
    pos.y = Math.sin(now * 0.004 + bot.speed) * 0.025;

    const toPlayer = camera.position.clone().sub(pos.clone().setY(1.2));
    if (distW > 0 && toPlayer.length() < 27 && now >= bot.nextShot &&
        hasLineOfSight(pos.clone().setY(1.25), camera.position)) {
      bot.nextShot = now + 2600 + Math.random() * 2200;
      spawnTracer(pos.clone().setY(1.25), camera.position.clone(), colorFromId(bot.id));
      state.damageFlash = Math.min(1, state.damageFlash + 0.45);
      state.hp = Math.max(0, state.hp - (5 + Math.floor(Math.random() * 6)));
      if (state.hp <= 0) killPlayer();
    }
  }
}

function syncRemotes(dt, now) {
  const seen = new Set();
  for (const s of state.remoteStates) {
    if (!s || !s.id || s.id === myId) continue;
    seen.add(s.id);
    let remote = state.remotes.get(s.id);
    if (!remote) {
      remote = createAvatar(String(s.name || 'RIVAL'), colorFromId(s.id), 'remote', s.id, 140);
      scene.add(remote.group);
      state.remotes.set(s.id, remote);
    }
    if (Array.isArray(s.pos) && s.pos.length >= 3) {
      remote.group.position.lerp(new THREE.Vector3(s.pos[0], s.pos[1] - EYE, s.pos[2]), Math.min(1, dt * 12));
    }
    if (Array.isArray(s.rot) && s.rot.length >= 1) {
      let delta = s.rot[0] - remote.group.rotation.y;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      remote.group.rotation.y += delta * Math.min(1, dt * 12);
    }
    if (s.shooting && now > remote.nextTracer) {
      remote.nextTracer = now + 190;
      spawnTracer(remote.group.position.clone().setY(1.25), camera.position.clone(), colorFromId(s.id));
    }
    if (remote.dead && now >= remote.respawnAt) {
      remote.dead = false;
      remote.hp = remote.maxHp;
      remote.group.visible = true;
    }
  }
  for (const [id, remote] of state.remotes) {
    if (!seen.has(id)) {
      scene.remove(remote.group);
      disposeObject(remote.group);
      state.remotes.delete(id);
    }
  }
}

function updateEffects(dt) {
  for (let i = state.effects.length - 1; i >= 0; i--) {
    const effect = state.effects[i];
    effect.ttl -= dt;
    const t = Math.max(0, effect.ttl / effect.max);
    if (effect.kind === 'line') {
      effect.obj.material.opacity = t * 0.92;
    } else {
      effect.obj.material.opacity = t * (effect.kind === 'boom' ? 0.6 : 1);
      effect.obj.scale.setScalar(1 + (1 - t) * (effect.kind === 'boom' ? 5.5 : 2.4));
    }
    if (effect.ttl <= 0) {
      scene.remove(effect.obj);
      effect.obj.geometry.dispose();
      effect.obj.material.dispose();
      state.effects.splice(i, 1);
    }
  }
}

/* ------------------------------ HUD updates ------------------------------- */
function updateHUD() {
  if (!state.started) return;
  const w = weaponById(state.weaponId);
  const char = characterById(state.charId);
  const progress = levelProgress(state.xp, state.level);

  $('hud-level').textContent = `LVL ${state.level}` + (state.level === 3 ? ' · MAX' : '');
  $('hud-xp-text').textContent = progress.mastery
    ? `MASTERY ${state.xp} / ${MASTERY_XP}`
    : `XP ${state.xp} / ${progress.next}`;
  $('xp-fill').style.width = (progress.value * 100).toFixed(1) + '%';
  $('hud-kills').textContent = String(state.kills);

  $('hud-hp').textContent = String(Math.ceil(state.hp));
  $('hud-maxhp').textContent = '/ ' + state.maxHp;
  const hpPct = Math.max(0, (state.hp / state.maxHp) * 100);
  $('hp-fill').style.width = hpPct.toFixed(1) + '%';
  $('hp-fill').classList.toggle('low', hpPct < 30);
  $('low-health').classList.toggle('on', hpPct < 30 && !state.dead);

  $('hud-char').textContent = `${char.name} · ${char.speed.toFixed(1)} SPD`;
  $('hud-weapon').textContent = w.name;
  $('hud-weapon').style.color = cssColor(w.color);
  $('hud-ammo').textContent = String(state.ammo);
  $('reload-hint').textContent = state.reloading > 0 ? 'RELOADING…' : (state.ammo === 0 ? 'PRESS R TO RELOAD' : '\u00a0');
  $('damage-vignette').style.opacity = (state.damageFlash * 0.85).toFixed(2);
  $('hitmarker').classList.toggle('on', state.hitMarker > 0);

  const netStatus = $('net-status');
  netStatus.textContent = state.netReady
    ? `NETWORK · ${state.remotes.size} RIVAL(S) · ${state.roomId}`
    : 'LOCAL DEMO · BOTS ACTIVE';
  netStatus.classList.toggle('offline', !state.netReady);
}

function handleIncomingHit(hit) {
  try {
    const info = (hit && typeof hit === 'object') ? hit : {};
    const target = info.targetId ?? info.target ?? info.id;
    if (target && target !== myId) return;
    const damage = Number(info.damage) || 8;
    state.hp = Math.max(0, state.hp - damage);
    state.damageFlash = 1;
    const source = info.fromId || info.sourceId || info.source || info.weapon || 'RIVAL';
    addFeed(`${source} ▸ YOU`, 'danger');
    if (state.hp <= 0) killPlayer();
  } catch (err) { /* malformed network hit: ignore */ }
}

/* -------------------------------- networking ------------------------------ */
function broadcastState(now) {
  if (!state.netReady || now - state.lastBroadcast < 100) return;
  const net = window.ArenaNet;
  if (!net || typeof net.broadcast !== 'function') return;
  state.lastBroadcast = now;
  try {
    net.broadcast({
      id: myId,
      name: state.callsign,
      pos: [+state.pos.x.toFixed(2), +state.pos.y.toFixed(2), +state.pos.z.toFixed(2)],
      rot: [+state.yaw.toFixed(3), +state.pitch.toFixed(3)],
      weapon: state.weaponId,
      shooting: state.shooting
    });
  } catch (err) { /* network is optional */ }
}

/* ---------------------------------- start --------------------------------- */
async function startGame() {
  if (state.started) return;
  const btn = $('play-btn');
  btn.disabled = true;
  btn.textContent = 'DEPLOYING…';

  // Request pointer lock inside the click gesture; the user can click again if blocked.
  requestLock();

  state.callsign = ($('callsign').value || state.callsign).trim().slice(0, 16) || state.callsign;
  state.roomId = new URLSearchParams(location.search).get('room') || 'arena-demo';
  state.matchId = 'arena-' + Date.now().toString(36);
  state.level = levelForXp(state.xp);

  setupWorld(state.mapId);
  state.started = true;
  $('start-screen').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('hud-room').textContent = 'ROOM ' + state.roomId;
  buildViewModel();
  addFeed('MATCH STARTED · ' + getMap(state.mapId).name);

  const net = typeof window.ArenaNet !== 'undefined' ? window.ArenaNet : null;
  if (net) {
    try {
      if (typeof net.join === 'function') {
        const joined = net.join(state.roomId, {
          id: myId, name: state.callsign, char: state.charId,
          level: state.level, hp: state.maxHp
        });
        state.netReady = true;
        if (joined && typeof joined.then === 'function') {
          joined.then((ok) => {
            if (!ok && (!net.status || !net.status().connected)) {
              state.netReady = false;
              addFeed('PEER NETWORK OFFLINE · DEMO BOTS');
            }
          }).catch(() => { state.netReady = false; });
        }
      }
      if (typeof net.onState === 'function') {
        net.onState((states) => { state.remoteStates = Array.isArray(states) ? states : []; });
      }
      if (typeof net.onHit === 'function') net.onHit(handleIncomingHit);
    } catch (err) {
      console.warn('ArenaNet unavailable; continuing in demo mode.', err);
      state.netReady = false;
    }
  }
  if (!state.netReady) addFeed('DEMO MODE · LOCAL BOTS');

  const wallet = typeof window.ArenaWallet !== 'undefined' ? window.ArenaWallet : null;
  if (wallet && typeof wallet.connect === 'function') {
    try {
      setWalletStatus('CONNECTING WALLET…');
      const connected = await wallet.connect();
      if (connected && connected.ok === false) {
        throw new Error(connected.error || 'Wallet not connected');
      }
      state.walletConnected = true;
      setWalletStatus('WALLET CONNECTED · ENTERING MATCH', 'ready');
      if (typeof wallet.enter === 'function') {
        const pkgPath = wallet.PKG_PATH || MATCH_PKG_PATH;
        const entered = await wallet.enter(state.matchId, pkgPath);
        if (entered && entered.ok === false) throw new Error(entered.error || 'Entry failed');
      }
      addFeed(`ENTRY PAID · 2 TOKENS · REWARD ${KILL_REWARD}/KILL`, 'gold');
    } catch (err) {
      console.warn('ArenaWallet unavailable; continuing in demo mode.', err);
      state.walletConnected = false;
      setWalletStatus('DEMO MODE · WALLET UNAVAILABLE', 'error');
      addFeed('DEMO MODE · REWARDS SIMULATED');
    }
  } else {
    setWalletStatus('DEMO MODE · NO WALLET DETECTED', 'error');
    addFeed('DEMO MODE · REWARDS SIMULATED');
  }
}

/* ---------------------------------- inputs -------------------------------- */
document.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (!state.started) return;
  if (e.code === 'KeyR') startReload();
  if (e.code.startsWith('Digit')) {
    const index = Number(e.code.slice(5)) - 1;
    const unlocked = WEAPONS.filter((w) => w.level <= state.level);
    if (unlocked[index]) selectWeapon(unlocked[index].id);
  }
});
document.addEventListener('keyup', (e) => keys.delete(e.code));

document.addEventListener('mousemove', (e) => {
  if (!state.started || state.dead || document.pointerLockElement !== canvas) return;
  state.yaw -= e.movementX * 0.0021;
  state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - e.movementY * 0.0021));
});

document.addEventListener('mousedown', (e) => {
  if (!state.started || e.button !== 0) return;
  if (document.pointerLockElement !== canvas) {
    requestLock();
    return;
  }
  state.shooting = true;
  attemptFire(performance.now());
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) state.shooting = false; });

document.addEventListener('pointerlockchange', () => {
  if (!state.started) return;
  const locked = document.pointerLockElement === canvas;
  $('resume-overlay').classList.toggle('hidden', locked);
  if (!locked) state.shooting = false;
});

canvas.addEventListener('click', () => {
  if (state.started && document.pointerLockElement !== canvas) requestLock();
});

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  viewCamera.aspect = w / h;
  viewCamera.updateProjectionMatrix();
});

$('play-btn').addEventListener('click', () => { startGame().catch((err) => console.error(err)); });

/* -------------------------------- main loop ------------------------------- */
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - clock.last) / 1000, 0.05);
  clock.last = now;

  if (state.started && state.world) {
    updatePlayer(dt, now);
    updateBots(dt, now);
    syncRemotes(dt, now);
    updateEffects(dt);
    state.world.update(dt, now / 1000);
    broadcastState(now);
  }

  state.recoil = Math.max(0, state.recoil - dt * 7);
  state.muzzle = Math.max(0, state.muzzle - dt * 10);
  if (viewModel) {
    viewModel.position.z = -0.62 + state.recoil * 0.13;
    viewModel.position.y = -0.25 - state.recoil * 0.03;
    viewModel.rotation.x = -state.recoil * 0.22;
  }
  if (muzzleFlash) {
    muzzleFlash.visible = state.muzzle > 0.12;
    muzzleFlash.scale.setScalar(0.7 + state.muzzle * 0.9);
  }
  if (muzzleLight) muzzleLight.intensity = state.muzzle * 3.2;

  updateHUD();
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(viewScene, viewCamera);
}

$('callsign').value = state.callsign;
renderMapCards();
renderCharacterCards();
renderWeaponCards();
detectWallet();

// Small inspection surface for demos and automated smoke tests.
window.ArenaGame = { state, setupWorld, selectWeapon, registerKill, createAvatar, attemptFire };
requestAnimationFrame(frame);
