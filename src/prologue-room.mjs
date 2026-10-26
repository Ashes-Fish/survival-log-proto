// Source-derived top-down layout for the chapter 0 prologue room (Home_XUZhang).
// Positions come from Config_Map MapPoints via PrologueMap.json; furniture identity
// from Config_GuidanceFurniture (MapPointID 8) and Config_Furniture. Movement speed
// and interaction radius are browser-side parameters, not native observations.
export const ROOM_SCHEMA = 1;
export const MOVE_SPEED = 2.6;
export const INTERACT_RADIUS = 1.1;

const PROLOGUE_MAP_ID = 8;
// Observed prologue furniture only. Codes 400/402/403/404 each occur exactly once in
// Config_Furniture, so the mapping is per-id, not a general function-code rule.
const INTERACTIONS = new Map([
  [9104, { kind: 'sleep', verb: '睡觉' }],
  [9109, { kind: 'openBag', verb: '打开床头柜' }],
  [9110, { kind: 'openBag', verb: '打开纸箱' }],
  [9111, { kind: 'openBag', verb: '搜索衣柜' }],
  [9113, { kind: 'openDoor', verb: '打开房门' }],
  [9114, { kind: 'remove', verb: '移除障碍物', storyId: 1501 }],
]);
const DECOR = new Set([9105, 9106, 9107, 9108, 9112, 915]);

function one(rows, test, label) {
  const hits = (rows ?? []).filter(test);
  if (hits.length !== 1) throw new TypeError('Missing or ambiguous ' + label);
  return hits[0];
}

export function createPrologueRoom(tables) {
  const map = tables.PrologueMap?.map;
  if (map?.Name !== 'Home_XUZhang') throw new TypeError('Unsupported prologue map');
  const camera = one(map.CameraRanges, () => true, 'camera range');
  const [minX, , minZ] = camera.MinWorldPos;
  const [maxX, , maxZ] = camera.MaxWorldPos;
  if (![minX, minZ, maxX, maxZ].every(Number.isFinite) || !(maxX > minX) || !(maxZ > minZ)) throw new TypeError('Invalid camera bounds');

  const guidance = (tables.GuidanceFurniture ?? []).filter((r) => r.MapPointID === PROLOGUE_MAP_ID && r.IsShow);
  if (!guidance.length) throw new TypeError('No prologue furniture');
  const seen = new Set();
  const anchors = guidance.map((row) => {
    if (seen.has(row.FurnitureId)) throw new TypeError('Duplicate furniture ' + row.FurnitureId);
    seen.add(row.FurnitureId);
    const point = one(map.MapPoints, (p) => p.NodeName === row.PosPoint, 'map point ' + row.PosPoint);
    const [x, y, z] = point.WorldPos;
    if (![x, y, z].every(Number.isFinite)) throw new TypeError('Invalid position for ' + row.PosPoint);
    const furniture = one(tables.Furniture ?? [], (f) => f.ID === row.FurnitureId, 'furniture ' + row.FurnitureId);
    const interaction = INTERACTIONS.get(row.FurnitureId);
    if (!interaction && !DECOR.has(row.FurnitureId)) throw new TypeError('Unknown prologue furniture ' + row.FurnitureId);
    const icon = typeof furniture.ICON === 'string' && furniture.ICON.startsWith('../../Res/') ? '/WebUI/Res/' + furniture.ICON.slice('../../Res/'.length) : null;
    return {
      furnitureId: row.FurnitureId,
      name: furniture.Name_Local,
      kind: interaction ? interaction.kind : 'decor',
      verb: interaction ? interaction.verb : '查看',
      storyId: interaction?.storyId ?? null,
      bagConfigId: row.PackageID === 0 && furniture.BagId ? furniture.BagId : null,
      x, y, z, icon,
      pointName: row.PosPoint,
    };
  }).sort((a, b) => a.furnitureId - b.furnitureId);

  const spawn = one(map.MapPoints, (p) => p.NodeName === 'HomeXuZhangStart', 'spawn point');
  const [sx, , sz] = spawn.WorldPos;
  return {
    schema: ROOM_SCHEMA,
    mapName: map.Name,
    bounds: { minX, minZ, maxX, maxZ, width: maxX - minX, depth: maxZ - minZ },
    spawn: { x: sx, z: sz, y: spawn.WorldPos[1] },
    anchors,
    provenance: {
      positionSource: 'Config_Map.MapPoints via PrologueMap.json',
      furnitureSource: 'Config_GuidanceFurniture MapPointID=' + PROLOGUE_MAP_ID + ', joined to Config_Furniture',
      mapSha256: tables.PrologueMap?.provenance?.sha256 ?? null,
    },
    limitations: [
      'Floor and wall geometry are not in the configuration; the browser draws a schematic room, not original art.',
      'MOVE_SPEED and INTERACT_RADIUS are browser-side values; native movement speed and interaction range are not observed.',
      'Wall-mounted anchors keep their world height but are drawn flat.',
    ],
  };
}

export function clampToBounds(room, x, z) {
  const b = room.bounds;
  return { x: Math.min(b.maxX, Math.max(b.minX, x)), z: Math.min(b.maxZ, Math.max(b.minZ, z)) };
}

export function stepPlayer(room, player, dt) {
  if (!(dt >= 0)) throw new TypeError('Invalid delta');
  if (player.tx === null || player.tz === null) return player;
  const dx = player.tx - player.x, dz = player.tz - player.z;
  const distance = Math.hypot(dx, dz);
  const step = MOVE_SPEED * dt;
  if (distance <= step || distance < 0.02) return { ...player, x: player.tx, z: player.tz, tx: null, tz: null };
  const next = clampToBounds(room, player.x + (dx / distance) * step, player.z + (dz / distance) * step);
  return { ...player, x: next.x, z: next.z };
}

export function nearestAnchor(room, position, radius = INTERACT_RADIUS) {
  let best = null;
  for (const anchor of room.anchors) {
    const d = Math.hypot(anchor.x - position.x, anchor.z - position.z);
    if (d <= radius && (!best || d < best.distance)) best = { anchor, distance: d };
  }
  return best;
}
