// Compare a decoded native save against the browser's derived model.
// The native AttrDict stores ids 1..5 as fixed point (trunc(value*1000)) and ids
// 101..105 (maxima) at plain scale, as observed in every decoded save. Unknown
// fields stay unknown; nothing is matched by default.
const ATTRIBUTE_IDS = [1, 2, 3, 4, 5];
const ATTRIBUTE_NAMES = {1: 'Satiety', 2: 'Morale', 3: 'Stamina', 4: 'Health', 5: 'Vitality'};
const MAXIMUM_IDS = [101, 102, 103, 104, 105];

function pairMap(pairs) {
  if (!Array.isArray(pairs)) return null;
  const map = new Map();
  for (const entry of pairs) {
    if (!Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[0])) throw new TypeError('Invalid attribute dictionary');
    map.set(entry[0], entry[1]);
  }
  return map;
}

export function summarizeNativeSave(root, tables) {
  if (!root || typeof root !== 'object') throw new TypeError('Missing decoded save');
  const cur = root.CurSave;
  if (!cur || !cur.LeadingRole) throw new TypeError('Save has no leading role');
  const role = cur.LeadingRole;
  const attributes = pairMap(role.AttrDict);
  if (!attributes) throw new TypeError('Save has no attribute dictionary');
  const items = (role.ItemList ?? []).map((item) => ({
    configId: item.ItemConfigId, count: item.ItemCount, x: item.BagPos?.[0], y: item.BagPos?.[1],
  }));
  return {
    identity: {
      chapterId: root.InitChapterId, playerId: root.InitPlayerId, mapId: root.InitMapConfigId,
      playerSelectId: root.PlayerSelectId, difficultyLevels: root.DifficultyLevels,
    },
    day: cur.Day, gameTime: cur.GameTime,
    role: {
      name: role.Name, money: role.Money, mapConfigId: role.MapConfigId, chapterId: role.ChapterId,
      position: role.Position, attributes, items,
    },
    achievements: (root.SymbolData?.SymbolMap ?? []).map((entry) => entry[0]),
    saveName: root.Name,
  };
}

function check(id, label, status, observed, expected, note) {
  return {id, label, status, observed, expected, note: note ?? null};
}

function equal(observed, expected) {
  return JSON.stringify(observed) === JSON.stringify(expected);
}

export function compareToBrowser(summary, model, tables) {
  const checks = [];
  const identity = summary.identity;
  checks.push(identity.chapterId === model.chapterId
    ? check('identity.chapter', '章节', 'match', identity.chapterId, model.chapterId)
    : check('identity.chapter', '章节', 'mismatch', identity.chapterId, model.chapterId));
  checks.push(identity.playerId === model.playerId
    ? check('identity.player', '玩家配置', 'match', identity.playerId, model.playerId)
    : check('identity.player', '玩家配置', 'mismatch', identity.playerId, model.playerId));
  checks.push(identity.mapId === model.mapId
    ? check('identity.map', '地图', 'match', identity.mapId, model.mapId)
    : check('identity.map', '地图', 'mismatch', identity.mapId, model.mapId));
  const levels = model.difficulty?.levels;
  checks.push(Array.isArray(identity.difficultyLevels) && equal(identity.difficultyLevels, levels)
    ? check('identity.difficulty', '难度等级', 'match', identity.difficultyLevels, levels)
    : check('identity.difficulty', '难度等级', 'mismatch', identity.difficultyLevels, levels));

  checks.push(summary.role.money === model.money
    ? check('money', '金钱', 'match', summary.role.money, model.money, '仅在存档尚未产生收入时成立')
    : check('money', '金钱', 'mismatch', summary.role.money, model.money, '存档可能已产生收入'));

  const bag = model.bag;
  let placementOk = true, weight = 0, unknownItems = 0;
  for (const item of summary.role.items) {
    const config = tables.Item.find((row) => row.ID === item.configId);
    if (!config) { unknownItems += 1; placementOk = false; continue; }
    const [w, h] = config.Size ?? [1, 1];
    if (!Number.isSafeInteger(item.x) || !Number.isSafeInteger(item.y) || item.x < 0 || item.y < 0 || item.x + w > bag.cols || item.y + h > bag.rows) placementOk = false;
    weight += (config.weight ?? 0) * (item.count ?? 1);
  }
  checks.push(placementOk
    ? check('bag.grid', '背包格位', 'match', summary.role.items.length + ' 件', bag.cols + '×' + bag.rows)
    : check('bag.grid', '背包格位', 'mismatch', summary.role.items.length + ' 件', bag.cols + '×' + bag.rows, unknownItems ? '存在未识别的配置 ID' : null));
  checks.push(weight <= bag.burden
    ? check('bag.weight', '背包负重', 'match', weight + ' g', '≤ ' + bag.burden + ' g')
    : check('bag.weight', '背包负重', 'mismatch', weight + ' g', '≤ ' + bag.burden + ' g'));

  const maxima = MAXIMUM_IDS.map((id) => summary.role.attributes.get(id));
  const expectedMaxima = model.baseAttributes ? ATTRIBUTE_IDS.map((id) => model.baseAttributes[ATTRIBUTE_NAMES[id]].maximum) : null;
  if (maxima.every((value) => Number.isFinite(value)) && expectedMaxima) {
    const actual = maxima;
    checks.push(equal(actual, expectedMaxima)
      ? check('attributes.maximum', '属性上限', 'match', actual, expectedMaxima)
      : check('attributes.maximum', '属性上限', 'mismatch', actual, expectedMaxima));
  } else checks.push(check('attributes.maximum', '属性上限', 'unknown', null, expectedMaxima, '存档缺少上限字段'));

  const values = ATTRIBUTE_IDS.map((id) => summary.role.attributes.get(id));
  if (values.every((value) => Number.isSafeInteger(value))) {
    checks.push(check('attributes.fixedpoint', '属性定点', 'match', values.map((v) => v / 1000), 'trunc(value×1000)'));
  } else checks.push(check('attributes.fixedpoint', '属性定点', 'unknown', values, 'trunc(value×1000)', '属性缺失或非整数'));

  return {checks, ok: checks.every((entry) => entry.status !== 'mismatch'), mismatches: checks.filter((entry) => entry.status === 'mismatch').length};
}
