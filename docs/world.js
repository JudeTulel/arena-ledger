// Procedural world primitives shared by all three maps.
import * as THREE from 'three';

/** Deterministic pseudo-random generator so maps look the same every run. */
export function makeRandom(seed = 1337) {
  let s = seed >>> 0;
  return function random() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Accumulates procedural geometry, AABB colliders, raycast targets and
 * per-frame animations into a single disposable group.
 */
export class WorldBuilder {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'world';
    scene.add(this.group);

    this.colliders = [];
    this.shootables = [];
    this.animated = [];
    this.playerSpawns = opts.playerSpawns || [new THREE.Vector3(0, 0, 8)];
    this.botSpawns = opts.botSpawns || [];
    this.bounds = opts.bounds || { minX: -30, maxX: 30, minZ: -30, maxZ: 30 };

    scene.background = new THREE.Color(opts.sky ?? 0x0b1018);
    scene.fog = opts.fogColor
      ? new THREE.FogExp2(opts.fogColor, opts.fogDensity ?? 0.02)
      : null;

    const hemi = new THREE.HemisphereLight(
      opts.hemiSky ?? 0xbfd9ef,
      opts.hemiGround ?? 0x30343c,
      opts.hemiIntensity ?? 0.75
    );
    this.group.add(hemi);

    const sun = new THREE.DirectionalLight(opts.sunColor ?? 0xffffff, opts.sunIntensity ?? 1.05);
    sun.position.set(opts.sunPos?.[0] ?? 24, opts.sunPos?.[1] ?? 40, opts.sunPos?.[2] ?? 16);
    this.group.add(sun);

    if (opts.ambientIntensity) {
      this.group.add(new THREE.AmbientLight(opts.ambientColor ?? 0xffffff, opts.ambientIntensity));
    }
  }

  /** Register a mesh; optionally solid for movement and/or hit by bullets. */
  add(mesh, collide = false, shootable = true) {
    this.group.add(mesh);
    if (shootable) this.shootables.push(mesh);
    if (collide) {
      mesh.updateWorldMatrix(true, false);
      this.colliders.push(new THREE.Box3().setFromObject(mesh));
    }
    return mesh;
  }

  material(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.88,
      metalness: opts.metalness ?? 0.04,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      flatShading: !!opts.flatShading,
      transparent: !!opts.transparent,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
      depthWrite: opts.depthWrite !== false
    });
  }

  box(x, y, z, w, h, d, color, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.material(color, opts));
    mesh.position.set(x, y, z);
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    if (opts.rotX) mesh.rotation.x = opts.rotX;
    if (opts.rotZ) mesh.rotation.z = opts.rotZ;
    return this.add(mesh, !!opts.collide, opts.shootable !== false);
  }

  cylinder(x, y, z, rTop, rBottom, h, color, opts = {}) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBottom, h, opts.segments ?? 8, 1),
      this.material(color, opts)
    );
    mesh.position.set(x, y, z);
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    if (opts.rotX) mesh.rotation.x = opts.rotX;
    if (opts.rotZ) mesh.rotation.z = opts.rotZ;
    return this.add(mesh, !!opts.collide, opts.shootable !== false);
  }

  cone(x, y, z, radius, h, color, opts = {}) {
    return this.cylinder(x, y, z, 0, radius, h, color, opts);
  }

  sphere(x, y, z, r, color, opts = {}) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, opts.segments ?? 12, opts.segments ?? 10),
      this.material(color, opts)
    );
    mesh.position.set(x, y, z);
    return this.add(mesh, !!opts.collide, opts.shootable !== false);
  }

  rock(x, y, z, r, color, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), this.material(color, { flatShading: true, ...opts }));
    mesh.position.set(x, y, z);
    mesh.rotation.set(opts.rotX ?? 0, opts.rotY ?? 0, opts.rotZ ?? 0);
    mesh.scale.set(opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1);
    return this.add(mesh, !!opts.collide, opts.shootable !== false);
  }

  /** Flat horizontal surface. Not solid — it sits under the player's feet. */
  ground(sizeX, sizeZ, color, y = 0, opts = {}) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(sizeX, sizeZ, opts.segsX ?? 1, opts.segsZ ?? 1),
      this.material(color, { ...opts, side: THREE.DoubleSide })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    this.add(mesh, false, opts.shootable !== false);
    return mesh;
  }

  pointLight(x, y, z, color, intensity, distance = 22) {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.set(x, y, z);
    this.group.add(light);
    return light;
  }

  animate(fn) { this.animated.push(fn); }

  update(dt, time) {
    for (const fn of this.animated) fn(dt, time);
  }

  /** Cylinder-vs-AABB movement test plus arena bounds. */
  blocked(x, z, feet, radius = 0.45, height = 1.75) {
    const b = this.bounds;
    if (x - radius < b.minX || x + radius > b.maxX || z - radius < b.minZ || z + radius > b.maxZ) return true;
    const head = feet + height;
    for (const box of this.colliders) {
      if (x + radius > box.min.x && x - radius < box.max.x &&
          z + radius > box.min.z && z - radius < box.max.z &&
          head > box.min.y && feet < box.max.y) return true;
    }
    return false;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.colliders.length = 0;
    this.shootables.length = 0;
    this.animated.length = 0;
  }
}
