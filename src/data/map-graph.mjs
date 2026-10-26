// Builds the map graph: Config_MapPoint destinations → Config_Map scenes that hold their
// anchor nodes → links between points. Pure function so the generator script and the
// unit tests run the same code.
//
// Evidence levels (kept on every edge):
//   'config'   – both ends named by config fields (EntryNodeName + shared HomeGroup).
//   'inferred' – travel from home to a world-map point; Config_MapPoint.Time is the
//                shipped travel cost, but the runtime GetTravelTime() body is unread.
// Unresolved anchor names are reported, never guessed.

const ANCHOR_FIELDS = {position: 'PositionName', exit: 'ExitPos', entry: 'EntryNodeName'};

export function buildMapGraph({mapPoints, mapRooms, mapSlots, maps, provenance = null}) {
  const nodeIndex = new Map();
  for (const scene of maps) {
    for (const node of scene.MapPoints) {
      if (!nodeIndex.has(node.NodeName)) nodeIndex.set(node.NodeName, []);
      nodeIndex.get(node.NodeName).push({scene: scene.Name, pos: node.WorldPos});
    }
  }
  const cameraIndex = new Map();
  for (const scene of maps) {
    for (const range of scene.CameraRanges) {
      if (!cameraIndex.has(range.NodeName)) cameraIndex.set(range.NodeName, []);
      cameraIndex.get(range.NodeName).push(scene.Name);
    }
  }

  const unresolved = [];
  const points = mapPoints.map((row) => {
    const anchors = {};
    for (const [key, field] of Object.entries(ANCHOR_FIELDS)) {
      const name = row[field];
      if (!name) continue;
      const hits = nodeIndex.get(name) ?? [];
      if (!hits.length) unresolved.push({pointId: row.ID, field, name});
      anchors[key] = {node: name, scenes: hits};
    }
    const cameraScenes = row.CameraRange ? (cameraIndex.get(row.CameraRange) ?? []) : [];
    if (row.CameraRange && !cameraScenes.length) unresolved.push({pointId: row.ID, field: 'CameraRange', name: row.CameraRange});
    return {
      id: row.ID,
      name: row.Name_Local,
      category: row.PointCategory,
      type: row.Type,
      chapterId: row.ChapterID,
      unlocked: row.IsUnlock,
      unlockTag: row.UnlockTag || null,
      conditionSetId: row.ConditionSetId || null,
      homeGroup: row.HomeGroup || null,
      travelSeconds: row.Time,
      travelSecondsByPlayer: row.TimeByPlayer,
      costItems: row.CostItems,
      webIcon: row.WebIcon || null,
      groundBox: row.GroundBoxName || null,
      cameraRange: row.CameraRange ? {node: row.CameraRange, scenes: cameraScenes} : null,
      anchors,
      scenes: [...new Set(Object.values(anchors).flatMap((a) => a.scenes.map((s) => s.scene)))].sort(),
    };
  });

  const byId = new Map(points.map((p) => [p.id, p]));
  const edges = [];
  // Floors / sub-areas: a point with EntryNodeName is entered from the main point of its
  // HomeGroup (the group whose own id equals the group number).
  for (const p of points) {
    if (!p.anchors.entry || !p.homeGroup) continue;
    const parent = byId.get(p.homeGroup);
    if (!parent || parent.id === p.id) continue;
    edges.push({from: parent.id, to: p.id, kind: 'floor', via: p.anchors.entry.node, evidence: 'config', bidirectional: true});
  }
  // World-map travel: home (id 1) to every category-1/2 destination that is a travel
  // target (Type 2). Type 1/3 points (home variants, bedroom, neighbours) are not
  // world-map destinations as far as config shows.
  const home = byId.get(1);
  for (const p of points) {
    if (!home || p.id === home.id || p.type !== 2 || ![1, 2].includes(p.category)) continue;
    edges.push({from: home.id, to: p.id, kind: 'travel', seconds: p.travelSeconds, evidence: 'inferred', bidirectional: true});
  }

  const roomsById = new Map(mapRooms.map((r) => [r.ID, r.Name_Local]));
  const slotSummary = {};
  for (const slot of mapSlots) {
    const key = slot.MapID;
    slotSummary[key] ??= {pointId: key, total: 0, rooms: {}};
    slotSummary[key].total += 1;
    const room = slot.Room ? (roomsById.get(slot.Room) ?? 'room ' + slot.Room) : '未分房间';
    slotSummary[key].rooms[room] = (slotSummary[key].rooms[room] ?? 0) + 1;
  }

  const scenes = maps
    .filter((s) => s.MapPoints.length || s.CameraRanges.length)
    .map((s) => ({
      name: s.Name,
      nodeCount: s.MapPoints.length,
      buildingNodeCount: s.BuildingMapPoints.length,
      packageNodeCount: s.PackageMapPoints.length,
      cameraRanges: s.CameraRanges.map((c) => c.NodeName),
      unlockTags: s.UnlockBoxes.map((u) => u.Tag),
      pointIds: points.filter((p) => p.scenes.includes(s.Name)).map((p) => p.id),
    }));

  return {
    schema: 1,
    sources: ['Config_MapPoint', 'Config_MapRoom', 'Config_MapSlot', 'Config_Map (Map-decoded.json)'],
    mapProvenance: provenance,
    coverage: 'Static config only: anchors and travel costs, not scene geometry, navmesh or runtime unlock order.',
    counts: {points: points.length, scenes: scenes.length, sceneRows: maps.length, edges: edges.length, unresolved: unresolved.length},
    points,
    edges,
    scenes,
    rooms: mapRooms.map((r) => ({id: r.ID, name: r.Name_Local, light: r.Light, heat: r.Heat})),
    slots: Object.values(slotSummary),
    unresolved,
  };
}
