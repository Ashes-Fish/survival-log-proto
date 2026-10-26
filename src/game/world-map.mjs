// World map: turns data/map-graph.json into the messages the original ExploreMap panel
// (WebUI/UI/ExploreMap/ExploreMap.html) listens for. Pure, so tests and the runtime
// share it.
//
// Evidence:
//   config   – item fields follow WebUI_ExploreMap_MapPointItem / MapInfoMsg bindings in
//              il2cpp dump.cs; names, icons, travel seconds, unlock flags from Config_MapPoint.
//   inferred – which ConstantText key fills each LocalizationMsg field (matched by text,
//              the C# body that sends them is not read); the hour/minute formatting of
//              travel time (FormatMapIndexTravelTime body not read); lockState for points
//              whose unlock condition is not modelled is shown as 1 (locked).

// LocalizationMsg field -> ConstantText ID (inferred by meaning).
export const EXPLORE_MAP_TEXT = Object.freeze({
  areaLabel: 'SR_Web_ExploreMap_4',
  timeDuringLabel: 'SR_Web_ExploreMap_0',
  carryLabel: 'SR_Web_ExploreMap_1',
  requireLabel: 'SR_Web_ExploreMap_2',
  goText: 'SR_Web_ExploreMap_3',
  unlockHintLabel: 'SR_Web_ExploreMap_5',
  lockedText: 'SR_Web_ExploreMap_6',
  comingSoonText: 'SR_Web_ExploreMap_7',
  produceLabel: 'SR_Web_ExploreMap_28',
  darkText: 'SR_Web_ExploreMap_29',
  newSuffix: 'SR_Web_ExploreMap_20',
});

export const MAP_MODE = Object.freeze({explore: 2, trade: 3});

export function formatTravelTime(seconds) {
  if (!seconds) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours && minutes) return hours + '小时' + minutes + '分钟';
  return hours ? hours + '小时' : minutes + '分钟';
}

// unlocked: set of point ids the player has unlocked at runtime (beyond IsUnlock).
export function lockStateOf(point, unlocked = new Set()) {
  return point.unlocked || unlocked.has(point.id) ? 0 : 1;
}

// Points shown in one map mode. Category 2 = exploration, 3 = trade (Config_MapPoint.PointCategory).
export function mapPointsFor(graph, mode = 'explore') {
  const category = MAP_MODE[mode];
  if (!category) throw new Error('unknown map mode ' + mode);
  return graph.points.filter((p) => p.category === category);
}

export function exploreMapList(graph, {mode = 'explore', selectedId = null, unlocked = new Set(), visited = new Set()} = {}) {
  const points = mapPointsFor(graph, mode);
  const selected = selectedId ?? points.find((p) => lockStateOf(p, unlocked) === 0)?.id ?? points[0]?.id ?? null;
  return points.map((p, index) => ({
    Index: index,
    name: p.name,
    isLock: lockStateOf(p, unlocked) !== 0,
    isActive: p.id === selected,
    configId: p.id,
    isVisited: visited.has(p.id),
    lockState: lockStateOf(p, unlocked),
    hasNew: false,
    aidUrgency: 0, damagedDays: 0, fallInDays: 0,
    isNew: false, relieved: false, defendTag: '', pulse: 0, fallEvac: false, campBond: 0,
  }));
}

export function exploreMapInfo(graph, configId, {mode = 'explore', unlocked = new Set(), rawPoints = null, itemName = (id) => String(id), entryHint = () => ''} = {}) {
  const point = graph.points.find((p) => p.id === configId);
  if (!point) throw new Error('unknown map point ' + configId);
  const raw = rawPoints?.find((r) => r.ID === configId) ?? null;
  return {
    mapName: point.name,
    mapIcon: point.webIcon ?? '',
    timeDuring: formatTravelTime(point.travelSeconds),
    itemRequire: (point.costItems ?? []).map(itemName).join('、'),
    // Entry requirement (key card / survival day / open hours) when it is not yet met;
    // surfaced here, not enforced on GO (see session.entryRequirement).
    openRequire: entryHint(configId) || '',
    description: raw?.Dec_Local ?? '',
    isTradeMode: mode === 'trade',
    chapterLabel: '',
    lockState: lockStateOf(point, unlocked),
    unlockHint: raw?.UnlockHint_Local ?? '',
    unlockCondJson: '[]',
    produce: raw?.Subtitle_Local ?? '',
    // LightLevel -> 昏暗 mapping is not read from code; never claim darkness.
    isDark: false,
    damagedDays: 0, fallInDays: 0, fallDay: 0, fallEvac: false,
    statusJson: '', campHeader: '', shelterSmsHint: '',
    tradeCatJson: '[]', tradeCatMore: 0, stockPct: 0,
    tripIndex: 0, tripCost: 0, tripHave: 0, dailyOnce: false, doneToday: false,
  };
}

export function exploreMapLocalization(constantText) {
  const out = {};
  for (const [field, id] of Object.entries(EXPLORE_MAP_TEXT)) {
    const row = constantText.find((r) => r.ID === id);
    if (row?.Text_Local) out[field] = row.Text_Local;
  }
  return out;
}

// Full payload in the {type, data, then} shape world/ui.mjs sends.
export function exploreMapPayload(graph, {mode = 'explore', selectedId = null, unlocked = new Set(), visited = new Set(), constantText = [], rawPoints = null, itemName, entryHint} = {}) {
  const mapList = exploreMapList(graph, {mode, selectedId, unlocked, visited});
  const active = mapList.find((m) => m.isActive);
  const then = [{type: 'WebUI_ExploreMap_MapListMsg', data: {mapList}}];
  if (active) then.push({type: 'WebUI_ExploreMap_MapInfoMsg', data: exploreMapInfo(graph, active.configId, {mode, unlocked, rawPoints, itemName, entryHint})});
  return {type: 'WebUI_ExploreMap_LocalizationMsg', data: exploreMapLocalization(constantText), then};
}

// Decides what a GO click means. Only lockState 0 points with resolved scene anchors
// can be travelled to; the caller performs the actual scene switch (M6.3).
export function travelRequest(graph, configId, {unlocked = new Set()} = {}) {
  const point = graph.points.find((p) => p.id === configId);
  if (!point) return {ok: false, message: '未知地点'};
  if (lockStateOf(point, unlocked) !== 0) return {ok: false, message: point.name + '：尚未解锁'};
  const entry = point.anchors.position;
  if (!entry?.scenes.length) return {ok: false, message: point.name + '：场景锚点未解析，暂不能前往'};
  return {ok: true, pointId: point.id, name: point.name, scene: entry.scenes[0].scene, anchor: entry.node, travelSeconds: point.travelSeconds,
    message: '前往 ' + point.name + '（Config_MapPoint.Time ' + formatTravelTime(point.travelSeconds) + '）'};
}
