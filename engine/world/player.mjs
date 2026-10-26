import * as THREE from 'three';

const SPEED = 3.2;

export function createPlayer({scene, navigator: initialNavigator, spawn}) {
  let navigator = initialNavigator;
  const mesh = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.24, 0.95, 8, 16),
    new THREE.MeshStandardMaterial({color: '#e8d9a8', roughness: 0.6}),
  );
  body.position.y = 0.72;
  body.castShadow = true;
  mesh.add(body);
  mesh.position.set(spawn.x, 0, spawn.z);
  scene.add(mesh);

  let route = [];
  let lastDirection = {x: 0, z: 0};
  let target = new THREE.Vector3(spawn.x, 0, spawn.z);
  let moving = false;
  let stuck = 0;

  function walkTo(x, z) {
    target.set(x, 0, z);
    const path = navigator.findPath(mesh.position, target);
    // No path means the target is unreachable (behind a wall): stay put instead of
    // walking straight through it.
    route = path;
    moving = path.length > 0;
  }

  function update(dt) {
    if (!route.length) { moving = false; return; }
    const waypoint = route[0];
    const dx = waypoint.x - mesh.position.x;
    const dz = waypoint.z - mesh.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.12) {
      route.shift();
      if (!route.length) moving = false;
      return;
    }
    const step = Math.min(SPEED * dt, distance);
    const sx = (dx / distance) * step, sz = (dz / distance) * step;
    const {x, z} = mesh.position;
    // Path waypoints are grid-cell centres; check the real body footprint every step so
    // a cut corner cannot carry the walker into a wall or furniture. Slide along the
    // obstacle when only one axis is blocked. A walker that starts inside a blocked spot
    // (after a teleport) may move out.
    const free = (nx, nz) => !navigator.blocked(nx, nz) || navigator.blocked(x, z);
    if (free(x + sx, z + sz)) { mesh.position.x += sx; mesh.position.z += sz; stuck = 0; }
    else if (free(x + sx, z)) { mesh.position.x += sx; stuck = 0; }
    else if (free(x, z + sz)) { mesh.position.z += sz; stuck = 0; }
    else if ((stuck += dt) > 0.4) { route = []; moving = false; stuck = 0; return; }
    lastDirection = {x: dx / distance, z: dz / distance};
  }

  let character = null;
  function attachCharacter(object) {
    // Drop the placeholder capsule and mount the skinned character instead.
    mesh.remove(body);
    mesh.add(object);
    character = object;
  }

  return {
    mesh,
    update,
    walkTo,
    attachCharacter,
    hasCharacter: () => Boolean(character),
    teleport: (x, z) => { route = []; moving = false; mesh.position.set(x, 0, z); },
    isMoving: () => moving,
    direction: () => lastDirection,
    position: () => ({x: mesh.position.x, z: mesh.position.z}),
    rerouteAfterLayoutChange: () => { if (moving) walkTo(target.x, target.z); },
    // Scene switches swap the navigation grid without recreating the walker.
    setNavigator: (next) => { navigator = next; route = []; moving = false; },
  };
}
