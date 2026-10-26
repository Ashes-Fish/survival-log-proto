// Occupancy grid + A*. Local sliding alone wedges the walker between two furniture
// boxes (the nightstand/bed corner), so pathing has to be global.
// Blocking comes from furniture/collider boxes (`solids`) and, for exported scenes, a
// wall grid sampled from the shell geometry (`grid`, see export-scene-shell.py).
const CELL = 0.28;
// Agent radius of the original: the baked NavMesh of the scene bundles uses
// agentRadius 0.2 (NavMeshData build settings, e.g. battlescene_tansuo_small01; static
// read), the same as the 打工仔 prefab capsule (PF_WorkingBoy CapsuleCollider 0.2). The
// earlier 0.32 sealed the repair-hut doorway between the cart and the wall.
const PLAYER_RADIUS = 0.2;

export function createNavigator({bounds, solids, grid = null}) {
  const gridW = Math.ceil((bounds.maxX - bounds.minX) / CELL);
  const gridH = Math.ceil((bounds.maxZ - bounds.minZ) / CELL);
  const occupancy = new Uint8Array(gridW * gridH);

  const wallAt = (x, z) => {
    if (!grid) return false;
    const i = Math.floor((x - grid.originX) / grid.cell);
    const j = Math.floor((z - grid.originZ) / grid.cell);
    if (j < 0 || j >= grid.height || i < 0 || i >= grid.width) return false;
    return grid.rows[j].charCodeAt(i) === 35; // '#'
  };

  const blocked = (x, z) => {
    const r = PLAYER_RADIUS;
    if (x < bounds.minX + r * 0.5 || x > bounds.maxX - r * 0.5 || z < bounds.minZ + r * 0.5 || z > bounds.maxZ - r * 0.5) return true;
    for (const solid of solids) {
      if (!(x + r > solid.minX && x - r < solid.maxX && z + r > solid.minZ && z - r < solid.maxZ)) continue;
      // Rotated furniture carries its oriented footprint: test in the box's own frame.
      const o = solid.obb;
      if (!o) return true;
      const dx = x - o.cx, dz = z - o.cz;
      if (Math.abs(dx * o.cos - dz * o.sin) < o.hx + r && Math.abs(dx * o.sin + dz * o.cos) < o.hz + r) return true;
    }
    if (grid) {
      const k = r * 0.7;
      if (wallAt(x, z) || wallAt(x + k, z) || wallAt(x - k, z) || wallAt(x, z + k) || wallAt(x, z - k)) return true;
    }
    return false;
  };

  const index = (i, j) => j * gridW + i;
  const cellCentre = (i, j) => ({x: bounds.minX + (i + 0.5) * CELL, z: bounds.minZ + (j + 0.5) * CELL});

  function buildOccupancy() {
    for (let j = 0; j < gridH; j++) {
      for (let i = 0; i < gridW; i++) {
        const c = cellCentre(i, j);
        occupancy[j * gridW + i] = blocked(c.x, c.z) ? 1 : 0;
      }
    }
  }

  function nearestFree(i, j) {
    if (i >= 0 && j >= 0 && i < gridW && j < gridH && !occupancy[j * gridW + i]) return {i, j};
    for (let r = 1; r < 8; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= gridW || nj >= gridH) continue;
        if (!occupancy[nj * gridW + ni]) return {i: ni, j: nj};
      }
    }
    return null;
  }

  const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  // Cells the walker can reach from a start cell (same moves as A*: 8 directions, no
  // corner cutting).
  function reachable(start) {
    const seen = new Uint8Array(gridW * gridH);
    const queue = [index(start.i, start.j)];
    seen[queue[0]] = 1;
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q], ci = k % gridW, cj = (k - ci) / gridW;
      for (const [di, dj] of STEPS) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= gridW || nj >= gridH) continue;
        const nk = index(ni, nj);
        if (seen[nk] || occupancy[nk]) continue;
        if (di && dj && (occupancy[index(ci + di, cj)] || occupancy[index(ci, cj + dj)])) continue;
        seen[nk] = 1;
        queue.push(nk);
      }
    }
    return seen;
  }
  // The walk target for a clicked cell: the cell itself when the walker can reach it,
  // otherwise the closest reachable free cell within ~2 m. A target inside furniture or a
  // wall (an exit node in a door collider, say) resolves to the walker's side rather than
  // to the first free cell behind the wall, which A* could never reach.
  function reachableGoal(start, gi, gj) {
    const reach = reachable(start);
    if (gi >= 0 && gj >= 0 && gi < gridW && gj < gridH && reach[index(gi, gj)]) return {i: gi, j: gj};
    let best = null, bestD = Infinity;
    for (let dj = -8; dj <= 8; dj++) for (let di = -8; di <= 8; di++) {
      const ni = gi + di, nj = gj + dj;
      if (ni < 0 || nj < 0 || ni >= gridW || nj >= gridH || !reach[index(ni, nj)]) continue;
      const d = di * di + dj * dj;
      if (d < bestD) { bestD = d; best = {i: ni, j: nj}; }
    }
    return best;
  }

  function findPath(from, to) {
    const start = nearestFree(Math.floor((from.x - bounds.minX) / CELL), Math.floor((from.z - bounds.minZ) / CELL));
    if (!start) return [];
    const goal = reachableGoal(start, Math.floor((to.x - bounds.minX) / CELL), Math.floor((to.z - bounds.minZ) / CELL));
    if (!goal) return [];
    // Binary-heap A*: exported scenes are up to ~200×150 cells.
    const heap = [];
    const push = (node) => { heap.push(node); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p].f <= heap[k].f) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l].f < heap[m].f) m = l; if (r < heap.length && heap[r].f < heap[m].f) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    push({i: start.i, j: start.j, g: 0, f: 0});
    const best = new Map([[index(start.i, start.j), 0]]);
    const cameFrom = new Map();
    const closed = new Uint8Array(gridW * gridH);
    const goalKey = index(goal.i, goal.j);
    let guard = 0;
    while (heap.length && guard++ < 200000) {
      const current = pop();
      const key = index(current.i, current.j);
      if (closed[key]) continue;
      if (key === goalKey) {
        const path = [];
        let walk = key;
        while (walk !== undefined) {
          path.push({x: bounds.minX + ((walk % gridW) + 0.5) * CELL, z: bounds.minZ + (Math.floor(walk / gridW) + 0.5) * CELL});
          walk = cameFrom.get(walk);
        }
        return smooth(path.reverse());
      }
      closed[key] = 1;
      for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
        const ni = current.i + di, nj = current.j + dj;
        if (ni < 0 || nj < 0 || ni >= gridW || nj >= gridH) continue;
        const nk = index(ni, nj);
        if (occupancy[nk] || closed[nk]) continue;
        if (di && dj && (occupancy[index(current.i + di, current.j)] || occupancy[index(current.i, current.j + dj)])) continue;
        const g = current.g + (di && dj ? 1.4142 : 1);
        if (best.has(nk) && best.get(nk) <= g) continue;
        best.set(nk, g);
        cameFrom.set(nk, key);
        push({i: ni, j: nj, g, f: g + Math.hypot(ni - goal.i, nj - goal.j)});
      }
    }
    return [];
  }

  // Drop waypoints that a straight walk can skip (line of sight checked against the real
  // body footprint, so shortcuts never clip a wall corner).
  function clear(a, b) {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL * 0.5));
    for (let s = 1; s < steps; s++) {
      const x = a.x + (b.x - a.x) * s / steps, z = a.z + (b.z - a.z) * s / steps;
      if (blocked(x, z)) return false;
    }
    return true;
  }
  function smooth(path) {
    if (path.length < 3) return path;
    const out = [path[0]];
    let anchor = path[0];
    for (let k = 1; k < path.length - 1; k++) {
      if (!clear(anchor, path[k + 1])) { out.push(path[k]); anchor = path[k]; }
    }
    out.push(path[path.length - 1]);
    return out;
  }

  // First standable point near the given point, used as the spawn.
  function findSpawn(center) {
    for (let radius = 0; radius < 10; radius += 0.3) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
        const x = Math.min(Math.max(center.x + Math.cos(angle) * radius, bounds.minX + 0.6), bounds.maxX - 0.6);
        const z = Math.min(Math.max(center.z + Math.sin(angle) * radius, bounds.minZ + 0.6), bounds.maxZ - 0.6);
        if (!blocked(x, z)) return {x, z};
      }
    }
    return {x: center.x, z: center.z};
  }

  return {blocked, buildOccupancy, findPath, findSpawn, cellSize: CELL, playerRadius: PLAYER_RADIUS};
}
