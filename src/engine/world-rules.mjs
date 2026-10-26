// General survival rules engine (M7). Pure functions over a plain JSON state; no DOM,
// no three.js. Drives every config-defined action/effect/buff/item/condition/reward the
// runtime supports, for any length of play.
//
// Relationship to the prologue probe (src/prologue-probe.mjs): the probe is the
// native-derived reference for the first 8h30m of chapter 0 and keeps its own checks.
// This engine reuses its verified pieces (attributeWriteback, recoveryTick, threshold
// passives, buff intervals, sleep segment) and generalises the rest. Anything marked
// INFERRED below is a reasonable reading of config semantics, not disassembly.
import {attributeWriteback} from '../attribute-writeback.mjs';
import {recoveryTick} from '../attribute-recovery.mjs';
import {thresholdPassiveEvent} from '../prologue-buffs.mjs';
import {toInternalTime} from '../game-clock.mjs';

export const ATTRS = ['Satiety', 'Morale', 'Stamina', 'Health', 'Vitality'];
export const ATTR_ID = {Satiety: 1, Morale: 2, Stamina: 3, Health: 4, Vitality: 5};
const ATTR_BY_ID = Object.fromEntries(Object.entries(ATTR_ID).map(([k, v]) => [v, k]));
const DAY = 86400;
const f = Math.fround;

export function indexTables(tables) {
  const by = (rows, key = 'ID') => new Map((rows ?? []).map((r) => [r[key], r]));
  return {
    raw: tables,
    item: by(tables.Item), action: by(tables.Action), effect: by(tables.Effect), buff: by(tables.Buff),
    furniture: by(tables.Furniture), func: by(tables.FurnitureFunc), condition: by(tables.ConditionSet),
    reward: by(tables.RewardSet), bag: by(tables.Bag), attr: by(tables.PlayAttribute), chapter: by(tables.Chapter),
    random: by(tables.RandomGroup), recipe: by(tables.CookingRecipe), production: by(tables.ProductionList),
    shop: by(tables.Shop), event: by(tables.Event), story: by(tables.Story), deathInfo: by(tables.DeathInfo, 'DeathID'),
    constant: by(tables.ConstantText),
  };
}

// ---- state -------------------------------------------------------------------
// opts: {attributeId (PlayAttribute row), chapterId, buffs, money, bag, seed}
export function createWorldState(T, {attributeId = 1, chapterId = 2, passiveBuffs = [], buffs = [], money = 0, bagId = 1, seed = 1, day = 0, seconds = 0} = {}) {
  const attr = T.attr.get(attributeId);
  if (!attr) throw new Error('Missing PlayAttribute ' + attributeId);
  const chapter = T.chapter.get(chapterId);
  if (!chapter) throw new Error('Missing Chapter ' + chapterId);
  const bag = T.bag.get(bagId);
  const state = {
    schema: 1, kind: 'survival-log-world', seed, rng: seed >>> 0 || 1,
    chapterId, timeScale: chapter.TimeScale, attributeId,
    time: {day, seconds, total: day * DAY + seconds},
    speed: 1,
    values: Object.fromEntries(ATTRS.map((a) => [a, attr[a]])),
    recovery: Object.fromEntries(ATTRS.map((a) => [a, {attribute: a, cd: toInternalTime(attr['Interval' + a], chapter.TimeScale)}])),
    passives: {},
    buffs: [],
    tags: [],
    money, survivalPoints: 0, exposure: 0,
    bags: {player: {id: 'player', configId: bagId, name: bag?.Name_Local ?? '背包', cols: bag?.Size?.[0] ?? 8, rows: bag?.Size?.[1] ?? 7, burden: bag?.Burden ?? 0, items: []}},
    nextItemId: 1,
    action: null,
    dailyUses: {},
    log: [],
    dead: null,
    counters: {},
    // Dynamic-event director state (src/engine/events.mjs): cd — eventId→day it is next
    // available (-1 never, CdResult.DoResult); scheduled — args rolled for today, {id,hour,
    // overdue}; active — the popup on screen; tasks — accepted Type-3 tasks {id,finishTotal,
    // action,item}; pending — ActiveEvent ids to force-trigger; day — the day last rolled.
    events: {cd: {}, scheduled: [], active: null, tasks: [], pending: [], log: [], day: -1},
    // Items lying on the floor ("脚边" in the original backpack page), per map point:
    // overflow from full bags (DropItemManager.TryDropOverflowItemData) and the contents of
    // demolished containers (AE_DisableFurniture.Run → DropItemFromBagAt).
    ground: {},
    scene: null,
    completedStories: [],
    itemDailyUses: {},
    proficiency: {},
  };
  for (const id of passiveBuffs) state.passives[id] = {present: false, removalCd: null};
  for (const id of buffs) addBuff(state, T, id);
  return state;
}

export function rand(state) {
  // xorshift32, deterministic and serialisable.
  let x = state.rng; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
  state.rng = x || 1;
  return state.rng / 4294967296;
}

function log(state, type, data = {}) {
  state.log.push({t: state.time.total, type, ...data});
  if (state.log.length > 400) state.log.shift();
}

// ---- buffs -------------------------------------------------------------------
// Buff effects that apply to furniture/devices, never to the leading role (Config_Buff
// rows whose effect is one of these are skipped by addBuff on the player; #31).
const FURNITURE_BUFF_EFFECTS = new Set(['Buff/FurnitureDurabilityMax', 'Buff/AE_TrapDurabilityBonus', 'Buff/AE_FurnitureDiscount', 'Buff/AE_TowerDeviceMaxDurability']);
export function hasBuff(state, id) { return state.buffs.some((b) => b.id === id); }

export function addBuff(state, T, id, {source = null} = {}) {
  const row = T.buff.get(id);
  if (!row) return false;
  // Furniture/device-scoped buffs (耐久强化 7/9 etc.) belong on the furniture, not the
  // leading role; the web port has no furniture-buff model, so they are skipped on the
  // player rather than inflating the character's state (#31).
  if (FURNITURE_BUFF_EFFECTS.has(T.effect.get(row.EffectConfigId)?.ConfigName)) return false;
  const existing = state.buffs.find((b) => b.id === id);
  if (existing) {
    existing.layers = Math.min(row.MaxLayerCount || 1, existing.layers + (row.AddLayerCount || 1));
    if (row.BuffDuring > 0) existing.remaining = row.BuffDuring;
    return true;
  }
  state.buffs.push({id, layers: row.InitLayerCount || 1, remaining: row.BuffDuring > 0 ? row.BuffDuring : -1, intervalCd: null, source});
  for (const tag of [...(row.TagList ?? []), ...(row.EventTag ?? [])]) addTag(state, tag);
  log(state, 'buff-add', {id, name: row.Name_Local});
  return true;
}

export function removeBuff(state, T, id) {
  const before = state.buffs.length;
  state.buffs = state.buffs.filter((b) => b.id !== id);
  if (before === state.buffs.length) return false;
  const row = T.buff.get(id);
  for (const tag of [...(row?.TagList ?? []), ...(row?.EventTag ?? [])]) {
    // Keep tags that another active buff still carries.
    if (!state.buffs.some((b) => [...(T.buff.get(b.id)?.TagList ?? []), ...(T.buff.get(b.id)?.EventTag ?? [])].includes(tag))) removeTag(state, tag);
  }
  log(state, 'buff-remove', {id, name: row?.Name_Local});
  return true;
}

export function addTag(state, tag) { if (tag && !state.tags.includes(tag)) state.tags.push(tag); }
export function removeTag(state, tag) { state.tags = state.tags.filter((t) => t !== tag); }

// Aggregate Buff_Default modifiers (max/add/del ratios, speed) of active buffs.
// Child_* passives use FloatValue slots (verified for 1004/1007 in prologue-buffs.mjs;
// the same slot order is INFERRED for the other Child_* rows).
export function modifiers(state, T) {
  const maxima = Object.fromEntries(ATTRS.map((a) => [a, 0]));
  const add = Object.fromEntries(ATTRS.map((a) => [a, 0]));
  const del = Object.fromEntries(ATTRS.map((a) => [a, 0]));
  let speed = 0;
  for (const b of state.buffs) {
    const row = T.buff.get(b.id);
    const e = T.effect.get(row?.EffectConfigId);
    if (!e) continue;
    // Stackable buffs scale their effect by layer count (心态上限 12 is +2 per layer, up to
    // 200 layers): 5 layers → +10 max morale (102 → 110), not +2 (#26).
    const n = b.layers || 1;
    speed += (e.BuffSpeed || 0) * n;
    if (e.ConfigName === 'Buff/Buff_Default') {
      for (const a of ATTRS) {
        maxima[a] += (e['Buff' + a + 'Max'] || 0) * n;
        add[a] += (e['Buff' + a + 'Add'] || 0) * n;
        del[a] += (e['Buff' + a + 'Del'] || 0) * n;
      }
    } else if (e.ConfigName === 'Buff/Child_Fatigue' || e.ConfigName === 'Buff/Child_ExtremeFatigue') {
      ['Satiety', 'Morale', 'Health', 'Vitality'].forEach((a, i) => { add[a] += e['FloatValue' + i] || 0; });
    } else if (e.ConfigName === 'Buff/Child_Dying') {
      ['Satiety', 'Morale', 'Stamina', 'Health'].forEach((a, i) => { add[a] += e['FloatValue' + i] || 0; });
      maxima.Stamina += e.IntValue0 || 0;
    } else if (e.ConfigName === 'Buff/Child_Dismay') {
      add.Stamina += e.FloatValue0 || 0; add.Health += e.FloatValue1 || 0; // INFERRED slot meaning
    } else if (e.ConfigName === 'Buff/Child_Subhealth') {
      maxima.Stamina += e.IntValue0 || 0; maxima.Morale += e.IntValue1 || 0; // INFERRED slot meaning
    }
  }
  // BuffSpeed values sum (保持戒备/极度饥饿/极度疲劳/垂危 are each −0.3), so a heavy debuff
  // stack can drive 1 + speed below zero and make the character walk backward. The native
  // movement system (deep in the agent/ECS locomotion, not reconstructed) never reverses,
  // so the aggregate is floored to keep the multiplier at a small positive crawl. Whether
  // the original sums or multiplies these is INFERRED; the no-reverse floor is the fix.
  speed = Math.max(speed, -0.9);
  return {maxima, add, del, speed};
}

export function maximum(state, T, attribute) {
  const attr = T.attr.get(state.attributeId);
  return attr['Max' + attribute] + modifiers(state, T).maxima[attribute];
}

// ---- attributes --------------------------------------------------------------
// sourceType: 1 buff interval, 2 item, 3 recovery, 5 action (as in the probe).
export function changeAttribute(state, T, attribute, amount, {sourceType = 5, foodSubCategory = 0} = {}) {
  if (!amount || state.dead) return 0;
  const mod = modifiers(state, T);
  if (attribute === 'Health') {
    // Health(4) is outside attributeWriteback's verified set; clamp linearly (INFERRED).
    const max = maximum(state, T, 'Health');
    const before = state.values.Health;
    state.values.Health = Math.max(0, Math.min(max, before + amount));
    // Health changes must still run the threshold passives (亚健康 / Subhealth 10006 at
    // Health ≤ 30); the early return here used to skip it, so 亚健康 never appeared (#25).
    passiveCheck(state, T, 'Health');
    return state.values.Health - before;
  }
  const result = attributeWriteback({attribute, current: state.values[attribute], amount, maximum: maximum(state, T, attribute),
    costRatio: amount > 0 ? mod.add[attribute] : mod.del[attribute], sourceType, foodSubCategory, isLeadingRole: true});
  state.values[attribute] = result.value;
  passiveCheck(state, T, attribute);
  if (result.dead) die(state, T, 'vitality');
  return result.appliedDelta;
}

// Threshold passives (hunger, fatigue, dying, dismay, subhealth...). The add/remove
// mechanics are the probe's verified thresholdPassiveEvent for 1001/1004/1007; other
// passives with the same IntValue0/1/2 layout use the same rule (INFERRED).
const PASSIVES = {10001: 'Satiety', 10003: 'Morale', 10004: 'Stamina', 10006: 'Health', 10007: 'Vitality'};
const PASSIVE_CONFIG = {10001: 'Buff/Passive_Hunger', 10004: 'Buff/Passive_Fatigue', 10007: 'Buff/Passive_Dying'};
function passiveEffect(T, id) {
  const e = T.effect.get(200000000 + id);
  if (!e) return null;
  // thresholdPassiveEvent only accepts its three verified effect IDs; emulate the same
  // rule for the others by presenting a compatible shape.
  return PASSIVE_CONFIG[id] ? e : {...e, ID: 200010001, ConfigName: 'Buff/Passive_Hunger', IntValue3: e.IntValue3 || 0};
}
// "Emptied" passives (Passive_ExtremeHunger 10002 → 1002 when Satiety is 0,
// Passive_ExtremeFatigue 10005 → 1005 when Stamina is 0). Present exactly while the
// attribute is empty (buff text: 饱腹清空时出现 / 精力清空时出现; removal rule INFERRED).
const EMPTIED = {10002: 'Satiety', 10005: 'Stamina'};
function emptiedCheck(state, T) {
  for (const [id, attr] of Object.entries(EMPTIED)) {
    if (!(id in state.passives)) continue;
    const buff = T.effect.get(200000000 + Number(id))?.IntValue0;
    if (!buff) continue;
    const empty = state.values[attr] <= 0;
    if (empty && !hasBuff(state, buff)) addBuff(state, T, buff);
    if (!empty && hasBuff(state, buff)) removeBuff(state, T, buff);
  }
}

function passiveCheck(state, T, attribute, event = 'attribute-change', dt = 0) {
  emptiedCheck(state, T);
  for (const [id, attr] of Object.entries(PASSIVES)) {
    if (!(id in state.passives)) continue;
    if (event === 'attribute-change' && attr !== attribute) continue;
    const effect = passiveEffect(T, Number(id));
    if (!effect) continue;
    const r = thresholdPassiveEvent(state.passives[id], {event, value: state.values[attr], passiveEffect: effect, deltaTime: dt, timeScale: state.timeScale});
    state.passives[id] = {present: r.present, removalCd: r.removalCd};
    if (r.transition?.type === 'add') addBuff(state, T, effect.IntValue0 ?? T.effect.get(200000000 + Number(id)).IntValue0);
    if (r.transition?.type === 'remove') removeBuff(state, T, T.effect.get(200000000 + Number(id)).IntValue0);
  }
}

// ---- death -------------------------------------------------------------------
export function die(state, T, cause) {
  if (state.dead) return;
  // Config_DeathInfo Type-1 rows key the death line by LinkedID, which is a PASSIVE id
  // (10002 极度饥饿, 10005 极度疲劳, 10007 垂危…), not a buff id — each passive effect
  // (200000000+id) carries its buff in IntValue0 (1000X → 100X). Some rows link directly
  // to a buff (1110 受伤流血). Match against the active buffs plus the passive ids whose
  // buff is active; a later-listed, more specific row wins when several match.
  const activeBuffs = new Set(state.buffs.map((b) => b.id));
  const causeIds = new Set(activeBuffs);
  for (let pid = 10001; pid <= 10007; pid++) {
    const buff = T.effect.get(200000000 + pid)?.IntValue0;
    if (buff && activeBuffs.has(buff)) causeIds.add(pid);
  }
  let deathId = null;
  for (const row of T.raw.DeathInfo ?? []) if (row.Type === 1 && causeIds.has(row.LinkedID)) deathId = row.DeathID;
  state.dead = {cause, deathId, day: state.time.day, seconds: state.time.seconds};
  state.action = null;
  log(state, 'death', {cause, deathId});
}

// ---- conditions --------------------------------------------------------------
// Compare enum from ComparisonMethod$$Comparison (RVA 0x2751f10/0x2751f50, static):
// 0 >, 1 >=, 2 == (float: approx), 3 <, 4 <=.
export function compare(mode, current, threshold) {
  switch (mode) {
    case 0: return current > threshold;
    case 1: return current >= threshold;
    case 2: return Math.abs(current - threshold) < 1e-4;
    case 3: return current < threshold;
    case 4: return current <= threshold;
    default: return false;
  }
}

const EMPTY = (v) => v == null || v === '' || v === 0 || v === false || (Array.isArray(v) && !v.length);
const SUPPORTED_CONDITION = new Set(['ID', 'Source', 'EventTag', 'EventNoTag', 'EventTagOr', 'AttriKey', 'Compare', 'Number', 'ItemNeed', 'BagRequire', 'BuffTag', 'BuffNeed', 'SurvivalToDay', 'OpenTimeStart', 'OpenTimeEnd', 'MoneyMin']);

// Returns {ok, known, lacks:[...]}. known=false when a used field is not modelled; the
// caller decides whether unknown passes (visibility) or fails (execution).
export function checkCondition(state, T, conditionId, {containers = []} = {}) {
  if (!conditionId) return {ok: true, known: true, lacks: []};
  const c = T.condition.get(conditionId);
  if (!c) return {ok: false, known: false, lacks: ['条件 ' + conditionId + ' 不存在']};
  const lacks = [];
  let known = true;
  for (const [k, v] of Object.entries(c)) if (!SUPPORTED_CONDITION.has(k) && !EMPTY(v)) known = false;
  const has = (t) => state.tags.includes(t);
  if (c.EventTag?.length && !c.EventTag.every(has)) lacks.push('缺少前置事件');
  if (c.EventNoTag?.some(has)) lacks.push('已完成');
  // BuffTag and EventTagOr appear together on furniture visibility rows (T50x); a match
  // in either passes (INFERRED from data shape: both list the same tag).
  const orTags = [...(c.EventTagOr ?? []), ...(c.BuffTag ?? [])];
  if (orTags.length && !orTags.some(has)) lacks.push('条件未满足');
  for (const id of c.BuffNeed ?? []) if (!hasBuff(state, id)) lacks.push('需要状态 ' + (T.buff.get(id)?.Name_Local ?? id));
  (c.AttriKey ?? []).forEach((key, i) => {
    const attr = ATTR_BY_ID[key];
    if (!attr) { known = false; return; }
    if (!compare(c.Compare?.[i] ?? 1, state.values[attr], c.Number?.[i] ?? 0)) {
      const label = {1: '饱腹', 2: '心态', 3: '精力', 4: '健康', 5: '生命'}[key];
      lacks.push('【' + label + '】需要' + ['高于', '达到', '等于', '低于', '不高于'][c.Compare?.[i] ?? 1] + (c.Number?.[i] ?? 0));
    }
  });
  const bagsToSearch = [state.bags.player, ...containers];
  // ConditionSetManager.CheckItemNeed (RVA 0x30807F0, static): ItemNeed is a multiset
  // (repeated ids add up) compared with the item count over the searched bags
  // (ItemManager.GetDisposableItemCount); a short item lists "【name】n个".
  for (const [id, n] of tally(c.ItemNeed ?? [])) {
    const have = bagsToSearch.reduce((s, b) => s + countItem(b, id), 0);
    if (have < n) lacks.push('需要 ' + (T.item.get(id)?.ItemName_Local ?? id) + (n > 1 ? ' ×' + n + '（有 ' + have + '）' : ''));
  }
  for (const [id, n] of tally(c.BagRequire ?? [])) if (countItem(state.bags.player, id) < n) lacks.push('背包需要 ' + (T.item.get(id)?.ItemName_Local ?? id) + (n > 1 ? ' ×' + n : ''));
  // GetDay is the 0-based day index (PhoneSMSManager.NowDayNumber adds 1 for display);
  // CheckSurvivalDay (RVA 0x3081D00) compares it with ≥ SurvivalToDay.
  if (c.SurvivalToDay && state.time.day < c.SurvivalToDay) lacks.push('第 ' + (c.SurvivalToDay + 1) + ' 天起');
  if (c.OpenTimeStart || c.OpenTimeEnd) {
    const hour = Math.floor(state.time.seconds / 3600);
    const s = c.OpenTimeStart, e = c.OpenTimeEnd;
    const open = s <= e ? hour >= s && hour < e : hour >= s || hour < e;
    if (!open) lacks.push(s + ':00–' + e + ':00 开放');
  }
  if (c.MoneyMin && state.money < c.MoneyMin) lacks.push('金钱不足');
  return {ok: lacks.length === 0, known, lacks};
}

// ---- inventory ---------------------------------------------------------------
export function createContainer(T, {id, configId, name, items = [], counts = []}) {
  const bag = T.bag.get(configId);
  const container = {id, configId, name: name ?? bag?.Name_Local ?? '容器', cols: bag?.Size?.[0] ?? 5, rows: bag?.Size?.[1] ?? 3, burden: bag?.Burden ?? 0, items: []};
  return container;
}

export function itemSize(T, configId) { const s = T.item.get(configId)?.Size; return {w: s?.[0] ?? 1, h: s?.[1] ?? 1}; }

export function findSlot(T, bag, configId, ignoreId = null) {
  const {w, h} = itemSize(T, configId);
  const occ = Array.from({length: bag.rows}, () => Array(bag.cols).fill(false));
  for (const it of bag.items) {
    if (it.uid === ignoreId) continue;
    for (let dy = 0; dy < it.h; dy++) for (let dx = 0; dx < it.w; dx++) if (occ[it.y + dy]) occ[it.y + dy][it.x + dx] = true;
  }
  for (let y = 0; y <= bag.rows - h; y++) for (let x = 0; x <= bag.cols - w; x++) {
    let free = true;
    for (let dy = 0; dy < h && free; dy++) for (let dx = 0; dx < w; dx++) if (occ[y + dy][x + dx]) { free = false; break; }
    if (free) return {x, y, w, h};
  }
  return null;
}

export function canPlaceAt(T, bag, item, x, y) {
  if (x < 0 || y < 0 || x + item.w > bag.cols || y + item.h > bag.rows) return false;
  return !bag.items.some((o) => o.uid !== item.uid && x < o.x + o.w && x + item.w > o.x && y < o.y + o.h && y + item.h > o.y);
}

export function bagWeight(T, bag) { return bag.items.reduce((sum, it) => sum + (T.item.get(it.configId)?.weight ?? 0) * (it.count ?? 1), 0); }

// Adds `count` of an item; returns the last instance touched, or null when nothing fit.
// Items with StackLimit > 1 stack onto an existing instance first. New instances start
// with Config_Item.UseTimes uses (ItemManager.AddItem RVA 0x2635590 passes UseTimes
// unchanged; -1 = infinite use, ItemData.IsInfiniteUse RVA 0x266C8F0).
// opts.overflow: what does not fit drops on the floor of the current map point, as
// ItemManager.AddItem → DropItemManager.TryDropOverflowItemData (RVA 0x26356B0, static).
// The result carries {added, dropped} counts in `addItem.last`.
export function addItem(state, T, bag, configId, count = 1, {overflow = false, uses} = {}) {
  const row = T.item.get(configId);
  addItem.last = {added: 0, dropped: 0};
  if (!row) return null;
  let left = count;
  const limit = Math.max(1, row.StackLimit || 1);
  let last = null;
  for (const it of bag.items) {
    if (!left) break;
    if (it.configId !== configId || it.count >= limit) continue;
    const take = Math.min(left, limit - it.count);
    it.count += take; left -= take; addItem.last.added += take; last = it;
  }
  while (left > 0) {
    const slot = findSlot(T, bag, configId);
    if (!slot) break;
    const take = Math.min(left, limit);
    last = {uid: state.nextItemId++, configId, count: take, uses: uses ?? row.UseTimes, ...slot};
    bag.items.push(last);
    left -= take; addItem.last.added += take;
  }
  if (left > 0 && overflow) { dropToGround(state, configId, left, state.scene, uses); addItem.last.dropped = left; left = 0; }
  return last;
}
// Number of items of one config that fit into a bag (stacking + free cells), used to
// check a whole transaction before paying for it.
export function capacityFor(T, bag, configId, want = Infinity) {
  const row = T.item.get(configId);
  if (!row) return 0;
  const limit = Math.max(1, row.StackLimit || 1);
  let room = bag.items.filter((it) => it.configId === configId).reduce((s, it) => s + Math.max(0, limit - it.count), 0);
  const probe = {...bag, items: [...bag.items]};
  while (room < want) {
    const slot = findSlot(T, probe, configId);
    if (!slot) break;
    probe.items.push({uid: -1 - probe.items.length, configId, count: limit, ...slot});
    room += limit;
  }
  return room;
}
// True when every [configId, count] pair fits into the bag at the same time.
export function fitsAll(T, bag, list) {
  const probe = {...bag, items: bag.items.map((it) => ({...it}))};
  const fake = {nextItemId: 1e9};
  for (const [id, n] of list) {
    addItem(fake, T, probe, id, n);
    if (addItem.last.added < n) return false;
  }
  return true;
}

// ---- floor items -----------------------------------------------------------------
// Items dropped at the player's feet (DropItemManager), kept per map point. A pile keeps
// the remaining uses of a worn item (ItemData.UseTimes) so picking it up restores them.
// The original drops boxes at the player position; piles here are per map point (the
// 「脚边」dock lists them wherever the bag is opened on that map: INFERRED simplification).
export function dropToGround(state, configId, count = 1, scene = state.scene, uses = undefined) {
  if (!count) return;
  state.ground ??= {};
  const list = (state.ground[scene ?? 'unknown'] ??= []);
  const pile = list.find((g) => g.configId === configId && g.uses === uses);
  if (pile) pile.count += count; else list.push({id: state.nextItemId++, configId, count, ...(uses === undefined ? {} : {uses})});
}
export const groundItems = (state, scene = state.scene) => state.ground?.[scene ?? 'unknown'] ?? [];
// Picks floor items into a bag; returns {picked, left}. ids: floor pile ids (all when null).
export function pickFromGround(state, T, bag, ids = null, scene = state.scene) {
  const list = groundItems(state, scene);
  let picked = 0, left = 0;
  for (const g of [...list]) {
    if (ids && !ids.includes(g.id)) continue;
    addItem(state, T, bag, g.configId, g.count, {uses: g.uses});
    const got = addItem.last.added;
    picked += got;
    g.count -= got;
    left += g.count;
  }
  if (state.ground) state.ground[scene ?? 'unknown'] = list.filter((g) => g.count > 0);
  return {picked, left};
}
// Drag from the dock onto a grid cell (GROUND_PICK_TO {id, ownerId, x, y}): one stack goes
// to that cell when it is free, the rest of the pile is picked normally.
export function pickGroundTo(state, T, bag, pileId, x, y, scene = state.scene) {
  const list = groundItems(state, scene);
  const g = list.find((p) => p.id === pileId);
  if (!g) return {picked: 0, left: 0};
  const {w, h} = itemSize(T, g.configId);
  let picked = 0;
  if (Number.isInteger(x) && Number.isInteger(y) && canPlaceAt(T, bag, {uid: -1, w, h}, x, y)) {
    const take = Math.min(g.count, Math.max(1, T.item.get(g.configId)?.StackLimit || 1));
    bag.items.push({uid: state.nextItemId++, configId: g.configId, count: take, uses: g.uses ?? T.item.get(g.configId)?.UseTimes, x, y, w, h});
    g.count -= take; picked += take;
  }
  if (g.count) { addItem(state, T, bag, g.configId, g.count, {uses: g.uses}); picked += addItem.last.added; g.count -= addItem.last.added; }
  state.ground[scene ?? 'unknown'] = list.filter((p) => p.count > 0);
  return {picked, left: g.count};
}
// Drops a bag item (or `count` of a stack) at the player's feet; returns the count dropped.
export function dropFromBag(state, bag, uid, count = Infinity, scene = state.scene) {
  const it = bag.items.find((i) => i.uid === uid);
  if (!it) return 0;
  const n = removeItem(bag, uid, count);
  dropToGround(state, it.configId, n, scene, it.uses ?? undefined);
  return n;
}

export function removeItem(bag, uid, count = Infinity) {
  const it = bag.items.find((i) => i.uid === uid);
  if (!it) return 0;
  const take = Math.min(count, it.count);
  it.count -= take;
  if (it.count <= 0) bag.items = bag.items.filter((i) => i.uid !== uid);
  return take;
}

export function countItem(bag, configId) { return bag.items.filter((i) => i.configId === configId).reduce((s, i) => s + i.count, 0); }

export function consumeItems(bag, configIds) {
  const need = {};
  for (const id of configIds) need[id] = (need[id] ?? 0) + 1;
  for (const [id, n] of Object.entries(need)) if (countItem(bag, Number(id)) < n) return false;
  for (const [id, n] of Object.entries(need)) {
    let left = n;
    for (const it of [...bag.items]) if (left && it.configId === Number(id)) left -= removeItem(bag, it.uid, left);
  }
  return true;
}

// Move an item between bags (drag in the backpack panel). Returns ok/message.
export function moveItem(state, T, from, to, uid, x, y) {
  const it = from.items.find((i) => i.uid === uid);
  if (!it) return {ok: false, message: '物品不存在'};
  if (from !== to && itemInUse(state, uid)) return {ok: false, message: '正在使用中'};
  const target = x === undefined ? findSlot(T, to, it.configId, from === to ? uid : null) : {x, y};
  if (!target || !canPlaceAt(T, to, {...it, uid: from === to ? uid : -1}, target.x, target.y)) {
    // Stack onto a same-config item at the drop cell when possible.
    const onto = x !== undefined ? to.items.find((o) => o.uid !== uid && o.configId === it.configId && x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h) : null;
    const limit = Math.max(1, T.item.get(it.configId)?.StackLimit || 1);
    if (onto && onto.count < limit) {
      const take = Math.min(it.count, limit - onto.count);
      onto.count += take; removeItem(from, uid, take);
      return {ok: true, message: '已堆叠'};
    }
    return {ok: false, message: '放不下'};
  }
  if (from !== to && to.burden && bagWeight(T, to) + (T.item.get(it.configId)?.weight ?? 0) * it.count > to.burden) return {ok: false, message: '超重'};
  if (from !== to) { from.items = from.items.filter((i) => i.uid !== uid); to.items.push(it); }
  it.x = target.x; it.y = target.y;
  return {ok: true, message: '已移动'};
}

// ---- rewards -----------------------------------------------------------------
// Config_RewardSet, in RewardSetManager.ExecuteRewardSet order (RVA 0x26E93D0, static):
// attributes → money → items (ItemChange) → ItemPackage → RandomGroup → ItemCost → points
// → exposure → buffs → tags → guidance furniture show/hide → stories → ActiveEvent.
// Item rewards that do not fit drop at the player's feet (ExecuteItemReward's onFailed
// lambda RVA 0x26EC040 → DropItemManager.DropItem), so nothing is lost. ItemCost is
// checked as a whole first (CanAffordItemCost RVA 0x26E4460) over the given bags;
// opts.requireCost makes an unaffordable reward fail without applying anything.
// Fields not handled are listed in the returned `skipped` list.
export function applyReward(state, T, rewardId, {bag = state.bags.player, costBags = [bag], requireCost = false} = {}) {
  const r = T.reward.get(rewardId);
  if (!r) return {ok: false, gained: [], dropped: [], skipped: ['reward ' + rewardId]};
  const cost = r.ItemCost ?? [];
  if (cost.length && !canAfford(costBags, cost)) {
    if (requireCost) return {ok: false, gained: [], dropped: [], skipped: [], message: '材料不足：' + missingText(T, costBags, cost)};
  }
  const gained = [], dropped = [];
  const give = (id, n = 1) => {
    addItem(state, T, bag, id, n, {overflow: true});
    for (let k = 0; k < addItem.last.added; k++) gained.push(id);
    for (let k = 0; k < addItem.last.dropped; k++) dropped.push(id);
  };
  (r.AttriKeyChange ?? []).forEach((key, i) => { const a = ATTR_BY_ID[key]; if (a) changeAttribute(state, T, a, r.AttriValueChange?.[i] ?? 0); });
  state.money += r.MoneyAdd || 0;
  for (const id of r.ItemChange ?? []) give(id);
  for (const id of r.ItemPackage ?? []) for (const [itemId, n] of rollPackage(state, T, id)) give(itemId, n);
  if (r.RandomGroupId) for (const id of rollRandomGroup(state, T, r.RandomGroupId, r.RandomGroupCount || 1)) give(id);
  if (cost.length) takeFrom(costBags, cost);
  state.survivalPoints += r.SurvivalPoint || 0;
  state.exposure += r.ExposureValue || 0;
  for (const id of r.AddBuff ?? []) addBuff(state, T, id);
  for (const id of r.DelBuff ?? []) removeBuff(state, T, id);
  for (const t of r.AddTag ?? []) addTag(state, t);
  for (const t of r.DelTag ?? []) removeTag(state, t);
  // ExecuteGuidanceFurnitureReward (RVA 0x26E6D40): Furniture.SetVisible on the listed
  // GuidanceFurniture rows; the session hides/shows the matching anchors.
  state.guidance ??= {};
  for (const id of r.ShowGuidanceFurnitureID ?? []) state.guidance[id] = true;
  for (const id of r.HideGuidanceFurnitureID ?? []) state.guidance[id] = false;
  for (const id of r.ActiveStory ?? []) { state.activeStories ??= []; if (!state.activeStories.includes(id)) state.activeStories.push(id); }
  if (r.CounterKey) state.counters[r.CounterKey] = (state.counters[r.CounterKey] ?? 0) + (r.CounterAdd || 0);
  for (const id of r.ActiveEvent ?? []) state.events.pending.push(id);
  const skipped = ['ClearFurnitureBag', 'FurniturelD', 'UnlockSystem', 'UnlockProductionCraft', 'UnlockCookingCraft'].filter((k) => !EMPTY(r[k]));
  return {ok: true, gained, dropped, skipped};
}

// Multiset ItemCost helpers (AggregateItemCost groups the list by config id).
const tally = (ids) => ids.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map());
export function canAfford(bags, ids) {
  for (const [id, n] of tally(ids)) if (bags.reduce((s, b) => s + countItem(b, id), 0) < n) return false;
  return true;
}
function missingText(T, bags, ids) {
  const out = [];
  for (const [id, n] of tally(ids)) {
    const have = bags.reduce((s, b) => s + countItem(b, id), 0);
    if (have < n) out.push((T.item.get(id)?.ItemName_Local ?? id) + ' ' + have + '/' + n);
  }
  return out.join('，');
}
export function takeFrom(bags, ids) {
  for (const [id, n] of tally(ids)) {
    let left = n;
    for (const b of bags) for (const it of [...b.items]) if (left && it.configId === id) left -= removeItem(b, it.uid, left);
  }
}

// Config_Package: fixed ItemIdList × ItemCountList plus RandomAmount draws from each
// RandomID group (ItemManager.TryAddPackageItems → ShopRandomTools.GenerateShopItemList /
// GenerateRandomItemDict, static). Returns [[configId, count], ...].
export function rollPackage(state, T, packageId) {
  const p = (T.raw.Package ?? []).find((x) => x.ID === packageId);
  if (!p) return [];
  const out = new Map();
  (p.ItemIdList ?? []).forEach((id, i) => out.set(id, (out.get(id) ?? 0) + (p.ItemCountList?.[i] ?? 1)));
  (p.RandomID ?? []).forEach((gid, i) => { for (const id of rollRandomGroup(state, T, gid, p.RandomAmount?.[i] ?? 1)) out.set(id, (out.get(id) ?? 0) + 1); });
  return [...out];
}

// Config_RandomGroup: CountList is the weight list (ShopRandomTools.GetRandomItemByWeight
// RVA 0x276C9E0 sums it and walks the cumulative weights with RandomInt(1, total)) and
// GetUniqueRandomItems draws `count` distinct ids, removing each pick from the pool.
// Rows without weights draw uniformly (INFERRED).
export function rollRandomGroup(state, T, groupId, count = 1) {
  const g = T.random.get(groupId);
  if (!g?.IdList?.length) return [];
  const ids = [...g.IdList];
  const weights = g.CountList?.length === ids.length ? [...g.CountList] : ids.map(() => 1);
  const out = [];
  for (let n = 0; n < count && ids.length; n++) {
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = 0;
    if (total > 0) {
      const roll = 1 + Math.floor(rand(state) * total);
      let acc = 0;
      pick = weights.findIndex((w) => (acc += w) >= roll);
      if (pick < 0) pick = ids.length - 1;
    }
    out.push(ids[pick]);
    ids.splice(pick, 1); weights.splice(pick, 1);
  }
  return out;
}

// ---- actions -----------------------------------------------------------------
// One running timed action at a time (the original's leading role casts one action).
// kind: 'item' | 'furniture'. Effects handled per Effect.ConfigName family:
//   Action/Item_Bar_Default, Action/Furniture_Bar_Default, Action/Item_Bar_WithDurability:
//     *Start on begin, *Interval every ItemAttrInterval game seconds, *End + buffs + items on completion
//   Action/Sleep_6Hour, Action/Sleep_1Hour: stamina every IntValue1 s (+FloatValue0), +FloatValue2 at end
//   Action/Read_Book, Action/Play_Games: IntValue0 s delay then every IntValue1 s an
//     AE_AddCostAttr_Float pair (see TIMED_ATTR); books add proficiency exp at the end
//   Action/Eat_*, Take_*, Gift_Bar: their AE_AddCostAttr_Float / AE_AddAttackerBuff /
//     AE_OpenItemPackage nodes at the end (native/effect-tree.py; tree order not decoded)
//   Action/Default_OpenBag and other During<=0 actions: instantaneous
// AttributeHold blocks recovery decrease of the listed attributes (as in the probe).
export function startAction(state, T, actionId, ctx = {}) {
  if (state.dead) return {ok: false, message: '角色已死亡'};
  if (state.action) return {ok: false, message: '正在' + (T.action.get(state.action.actionId)?.Name_Local ?? '行动')};
  const action = T.action.get(actionId);
  if (!action) return {ok: false, message: '动作 ' + actionId + ' 不存在'};
  const effect = T.effect.get(action.EffectConfigID) ?? {};
  const during = action.During > 0 ? action.During : 0;
  const {opts: _opts, ...plain} = ctx;
  const timed = TIMED_ATTR[effect.ConfigName] && effect.IntValue1 > 0;
  state.action = {actionId, effectId: effect.ID ?? 0, configName: effect.ConfigName ?? '', during, elapsed: 0, intervalCd: effect.ItemAttrInterval || 0,
    sleepCd: effect.IntValue0 || 0, timedCd: timed ? (effect.IntValue0 || effect.IntValue1) : 0, ctx: plain, attributeHold: [...(action.AttributeHold ?? [])], fast: !!action.IsFast};
  applyEffectPart(state, T, effect, 'Start', plain);
  log(state, 'action-start', {actionId, name: action.Name_Local});
  if (!during) return finishAction(state, T, ctx.opts ?? {});
  return {ok: true, message: action.NameDoing_Local || action.Name_Local, during};
}

// Item effect trees that end in AE_EatFinished, i.e. consume the used item
// (ItemManager.UseItem RVA 0x2664C10). Generate_BagFurniture pays with CostItem when the
// parcel is created (session), traps/ivy/throwables are spent by their own systems.
export const CONSUMING_FAMILIES = new Set(['Action/Item_Bar_Default', 'Action/Item_Default', 'Action/Eat_Cookies', 'Action/Eat_Burgers', 'Action/Eat_Sweets',
  'Action/Take_Vitamins', 'Action/Take_Medicine', 'Action/Read_Book', 'Action/Read_DyeBook', 'Action/Gift_Bar', 'Action/Item_Bar_WithDurability']);
// Families the web runtime can execute from the backpack (others need a system that is
// not rebuilt: trap placement, renovation, throwing, ivy planting).
export const USABLE_FAMILIES = new Set([...CONSUMING_FAMILIES, 'Action/Play_Games', 'Action/Item_Generate_BagFurniture']);
// Periodic AE_AddCostAttr_Float nodes: [attribute, FloatValue index of the amount,
// FloatValue index of the cap or -1] (E_Action_Read_Book / E_Action_Play_Games lambdas).
const TIMED_ATTR = {
  'Action/Read_Book': [['Morale', 0, -1], ['Stamina', 1, -1]],
  'Action/Read_DyeBook': [['Morale', 0, -1], ['Stamina', 1, -1]],
  'Action/Play_Games': [['Morale', 0, 1], ['Stamina', 2, -1]],
};
// End-of-action AE_AddCostAttr_Float / AE_AddAttackerBuff nodes.
const END_ATTR = {
  'Action/Eat_Cookies': {attr: [['Satiety', 0, -1]]},
  'Action/Eat_Burgers': {attr: [['Satiety', 0, -1]], buffInt: 0},
  'Action/Eat_Sweets': {attr: [['Satiety', 0, -1]], buffInt: 0},
  'Action/Take_Vitamins': {attr: [['Health', 0, 1]]},
  'Action/Take_Medicine': {attr: [['Vitality', 0, 1]]},
};
// AE_AddCostAttr_Float.Run (RVA 0x2F7D630, static): with a cap, current + value ≥ cap is
// clipped to cap - current, and nothing happens when that is ≤ 0.
function costAttrFloat(state, T, effect, [attr, valueIndex, capIndex], sourceType) {
  let v = effect['FloatValue' + valueIndex] || 0;
  if (capIndex >= 0) {
    const cap = effect['FloatValue' + capIndex] || 0;
    if (state.values[attr] + v >= cap) v = cap - state.values[attr];
    if (v <= 0) return;
  }
  if (v) changeAttribute(state, T, attr, v, {sourceType});
}

// ctx is plain JSON (saved with the state): {itemUid, itemConfigId, bagId, furnitureKey}.
// bagId 'player' resolves to the player bag; other ids through opts.resolveBag.
function applyEffectPart(state, T, effect, part, ctx) {
  const foodSub = ctx.itemConfigId ? T.item.get(ctx.itemConfigId)?.SubCategory ?? 0 : 0;
  const sourceType = ctx.itemConfigId ? 2 : 5;
  for (const a of ATTRS) {
    const v = effect['Item' + a + part];
    if (v) changeAttribute(state, T, a, v, {sourceType, foodSubCategory: foodSub});
  }
}

export function cancelAction(state, T) {
  if (!state.action) return {ok: false, message: '没有进行中的动作'};
  log(state, 'action-cancel', {actionId: state.action.actionId});
  state.action = null;
  return {ok: true, message: '已取消'};
}

// The item a running action is using; it may not be moved, sold or dropped meanwhile.
export const itemInUse = (state, uid) => Boolean(state.action?.ctx?.itemUid && state.action.ctx.itemUid === uid);

function finishAction(state, T, opts = {}) {
  const a = state.action;
  const action = T.action.get(a.actionId);
  const effect = T.effect.get(a.effectId) ?? {};
  state.action = null;
  const ctx = a.ctx ?? {};
  const results = {gained: [], dropped: []};
  // The item being used must still exist (it is locked while in use); otherwise the
  // completion effects do not run.
  let bag = null, it = null;
  if (ctx.itemUid) {
    bag = ctx.bagId === 'player' || !ctx.bagId ? state.bags.player : opts.resolveBag?.(ctx.bagId);
    it = bag?.items.find((i) => i.uid === ctx.itemUid) ?? null;
    if (!it) {
      log(state, 'action-complete', {actionId: a.actionId, name: action?.Name_Local, missingItem: true});
      return {ok: false, message: (action?.Name_Local ?? '动作') + '：物品不见了', completed: true, gained: []};
    }
  }
  const sourceType = ctx.itemConfigId ? 2 : 5;
  applyEffectPart(state, T, effect, 'End', ctx);
  if (/^Action\/Sleep_/.test(effect.ConfigName) && effect.FloatValue2) changeAttribute(state, T, 'Stamina', effect.FloatValue2, {sourceType: 5});
  // Sleeping to the end grants the completion buff in IntValue3 (睡觉 action 5 → 神清气爽
  // buff 2; AE_AddAttackerBuff index3, stage2-sleep-action.md). 小睡一会 (200) has none (#27).
  if (/^Action\/Sleep_/.test(effect.ConfigName) && effect.IntValue3) addBuff(state, T, effect.IntValue3);
  const end = END_ATTR[effect.ConfigName];
  if (end) {
    for (const spec of end.attr) costAttrFloat(state, T, effect, spec, sourceType);
    if (end.buffInt !== undefined && effect['IntValue' + end.buffInt]) addBuff(state, T, effect['IntValue' + end.buffInt]);
  }
  for (const id of [effect.ItemEndBuff01, effect.ItemEndBuff02].filter(Boolean)) addBuff(state, T, id);
  for (const id of effect.EAddBuff ?? []) addBuff(state, T, id);
  for (const id of effect.EDelBuff ?? []) removeBuff(state, T, id);
  // ItemGetEnd lists Config_Package ids (AE_OpenItemPackageByConfig reads Effect +0x90;
  // e.g. 上厕所 → package 30001 = 肥料), opened into the player bag, overflow to the floor.
  const give = (id, n) => { addItem(state, T, state.bags.player, id, n, {overflow: true}); for (let k = 0; k < addItem.last.added; k++) results.gained.push(id); for (let k = 0; k < addItem.last.dropped; k++) results.dropped.push(id); };
  for (const pid of effect.ItemGetEnd ?? []) for (const [id, n] of rollPackage(state, T, pid)) give(id, n);
  // Gift_Bar: AE_OpenItemPackage(IntValue0 = Config_Package id).
  if (effect.ConfigName === 'Action/Gift_Bar' && effect.IntValue0) for (const [id, n] of rollPackage(state, T, effect.IntValue0)) give(id, n);
  // Read_Book: AE_AddProficiencyExpFromEffect(StrValue0 = type, IntValue0 = exp).
  if (effect.ConfigName === 'Action/Read_Book' && effect.StrValue0 && effect.IntValue0 > 0) addProficiencyExp(state, T, effect.StrValue0, effect.IntValue0);
  if (effect.PonitEnd) state.survivalPoints += effect.PonitEnd;
  state.exposure += effect.ExposureValue || 0;
  // AE_EatFinished → ItemManager.UseItem: stackable items lose one; others spend one use
  // unless infinite (UseTimes -1), and go when no use is left. Item.DailyMax is counted.
  if (it && CONSUMING_FAMILIES.has(effect.ConfigName)) {
    const row = T.item.get(it.configId);
    if (row?.DailyMax > 0) state.itemDailyUses[it.configId] = (state.itemDailyUses[it.configId] ?? 0) + 1;
    if ((row?.StackLimit ?? 1) > 1) removeItem(bag, it.uid, 1);
    else if (it.uses !== -1) { it.uses -= 1; if (it.uses <= 0) removeItem(bag, it.uid, 1); }
  }
  const completed = {actionId: a.actionId, furnitureKey: ctx.furnitureKey ?? null, itemConfigId: ctx.itemConfigId ?? null, itemUid: ctx.itemUid ?? null, bagId: ctx.bagId ?? null,
    parcelId: ctx.parcelId ?? null, slot: ctx.slot ?? null,
    configName: effect.ConfigName ?? '', gained: results.gained, dropped: results.dropped, disableFurniture: !!effect.EDisableFurniture};
  state.completed ??= [];
  state.completed.push(completed);
  log(state, 'action-complete', {actionId: a.actionId, name: action?.Name_Local, gained: results.gained});
  return {ok: true, message: (action?.Name_Local ?? '动作') + '完成', completed: true, gained: results.gained, dropped: results.dropped};
}

// ---- proficiency ------------------------------------------------------------------
// Config_<Type>Lv rows: Lv + EXP needed for the next level; starting levels are
// Config_PlayerSelect.Init<Type>Lv (ProficiencyManager.AddExp, not traced: INFERRED).
const PROFICIENCY_TABLE = {Production: 'ProductionLv', Cooking: 'CookingLv', Plant: 'PlantLv', Trap: 'TrapLv', Explore: 'ExploreLv', Defense: 'DefenseLv'};
export function proficiencyLevel(state, T, type) {
  const p = state.proficiency?.[type];
  return p ? p.level : 0;
}
export function initProficiency(state, T, select) {
  state.proficiency = {};
  for (const type of Object.keys(PROFICIENCY_TABLE)) state.proficiency[type] = {level: select?.['Init' + type + 'Lv'] ?? 0, exp: 0};
}
export function addProficiencyExp(state, T, type, amount) {
  const rows = T.raw[PROFICIENCY_TABLE[type]];
  if (!rows) return null;
  state.proficiency ??= {};
  const p = (state.proficiency[type] ??= {level: 0, exp: 0});
  p.exp += amount;
  let up = 0;
  for (;;) {
    const row = rows.find((r) => r.Lv === p.level);
    if (!row?.EXP || p.exp < row.EXP) break;
    p.exp -= row.EXP; p.level += 1; up += 1;
  }
  log(state, 'proficiency', {type, amount, level: p.level});
  return {level: p.level, up};
}

// ---- time --------------------------------------------------------------------
// Advance by game seconds. Steps at most 60 game seconds at a time so interval timers
// and passives see every boundary.
export function advance(state, T, gameSeconds, opts = {}) {
  let left = gameSeconds;
  const events = [];
  while (left > 0 && !state.dead) {
    const step = Math.min(left, 60);
    left -= step;
    const dayBefore = state.time.day;
    state.time.total += step;
    state.time.day = Math.floor(state.time.total / DAY);
    state.time.seconds = state.time.total % DAY;
    if (state.time.day !== dayBefore) { events.push({type: 'day', day: state.time.day}); state.dailyUses = {}; state.itemDailyUses = {}; log(state, 'day', {day: state.time.day}); }
    tickRecovery(state, T, step);
    tickBuffs(state, T, step);
    tickAction(state, T, step, events, opts);
    passiveCheck(state, T, null, 'update', f(step / state.timeScale));
  }
  return events;
}

function tickRecovery(state, T, step) {
  const attr = T.attr.get(state.attributeId);
  const mod = modifiers(state, T);
  const dt = f(step / state.timeScale);
  for (const a of ATTRS) {
    if (a === 'Health') {
      // Health recovery toward TargetHealth every IntervalHealth (same rule as the
      // verified attributes; INFERRED because Health is outside the verified writeback).
      state.recovery.Health.cd = f(state.recovery.Health.cd - dt);
      if (state.recovery.Health.cd <= 0) {
        state.recovery.Health.cd = f(attr.IntervalHealth / state.timeScale);
        const target = attr.TargetHealth ?? state.values.Health;
        if (state.values.Health !== target) changeAttribute(state, T, 'Health', state.values.Health < target ? 1 : -1, {sourceType: 3});
      }
      continue;
    }
    const held = state.action?.attributeHold?.includes(ATTR_ID[a]);
    const tick = recoveryTick(state.recovery[a], {worldState: 2, deltaTime: dt, timeScale: state.timeScale, current: state.values[a],
      target: attr['Target' + a] ?? 0, interval: attr['Interval' + a], addRatio: mod.add[a], delRatio: mod.del[a], blockDecrease: !!held, isLeadingRole: true});
    state.recovery[a] = {attribute: a, cd: tick.cd};
    if (tick.request) changeAttribute(state, T, a, tick.request.amount, {sourceType: 3});
  }
}

function tickBuffs(state, T, step) {
  for (const b of [...state.buffs]) {
    const row = T.buff.get(b.id);
    const e = T.effect.get(row?.EffectConfigId);
    if (b.remaining > 0) {
      b.remaining -= step;
      if (b.remaining <= 0) { removeBuff(state, T, b.id); continue; }
    }
    // Child_ExtremeHunger: FloatValue2 Vitality every IntValue0 s (生命每2小时-6);
    // Child_ExtremeFatigue: FloatValue4 Vitality every IntValue0 s (生命每小时-2). Config.
    const childLoss = e?.ConfigName === 'Buff/Child_ExtremeHunger' ? e.FloatValue2 : e?.ConfigName === 'Buff/Child_ExtremeFatigue' ? e.FloatValue4 : 0;
    if (childLoss && e.IntValue0 > 0) {
      b.childCd = (b.childCd ?? e.IntValue0) - step;
      while (b.childCd <= 0 && !state.dead) { b.childCd += e.IntValue0; changeAttribute(state, T, 'Vitality', childLoss, {sourceType: 1}); }
    }
    if (e?.BuffInterval > 0) {
      b.intervalCd = (b.intervalCd ?? e.BuffInterval) - step;
      while (b.intervalCd <= 0) {
        b.intervalCd += e.BuffInterval;
        for (const a of ATTRS) {
          const v = e['Buff' + a + 'Interval'];
          if (v) changeAttribute(state, T, a, v * (b.layers || 1), {sourceType: 1});
        }
      }
    }
  }
}

function tickAction(state, T, step, events, opts) {
  const a = state.action;
  if (!a) return;
  const effect = T.effect.get(a.effectId) ?? {};
  a.elapsed += step;
  if (effect.ItemAttrInterval > 0) {
    a.intervalCd -= step;
    while (a.intervalCd <= 0) {
      a.intervalCd += effect.ItemAttrInterval;
      applyEffectPart(state, T, effect, 'Interval', a.ctx ?? {});
    }
  }
  // Read_Book / Play_Games: Action_TestTimeCondition(IntValue0 delay, IntValue1 period)
  // drives the AE_AddCostAttr_Float pair (E_Action_Read_Book lambdas b__0_7..9, static).
  const timed = TIMED_ATTR[effect.ConfigName];
  if (timed && effect.IntValue1 > 0) {
    a.timedCd = (a.timedCd ?? effect.IntValue0) - step;
    while (a.timedCd <= 0) {
      a.timedCd += effect.IntValue1;
      for (const spec of timed) costAttrFloat(state, T, effect, spec, 5);
    }
  }
  if (/^Action\/Sleep_/.test(effect.ConfigName) && effect.IntValue1 > 0) {
    a.sleepCd -= step;
    while (a.sleepCd <= 0) {
      a.sleepCd += effect.IntValue1;
      const cap = effect.FloatValue1 || 999;
      let amount = effect.FloatValue0 || 0;
      if (state.values.Stamina + amount >= cap) amount = cap - state.values.Stamina;
      if (amount > 0) changeAttribute(state, T, 'Stamina', amount, {sourceType: 5});
      // Wake early when stamina is full after the 3-hour minimum (stage2-sleep-action.md).
      if (a.elapsed >= 3 * 3600 && state.values.Stamina >= maximum(state, T, 'Stamina') - 0.5) { a.elapsed = a.during; break; }
    }
  }
  if (state.action && a.elapsed >= a.during) {
    const done = finishAction(state, T, opts);
    events.push({type: 'action-complete', ...done, actionId: a.actionId});
  }
}

// Game-seconds per real second, given the chapter TimeScale and current speed (the
// probe's verified clock uses deltaTime*TimeScale; sleep uses SpeedUp2).
export function gameRate(state, T) {
  const chapter = T.chapter.get(state.chapterId);
  const sleeping = state.action && /^Action\/Sleep_/.test(state.action.configName);
  const fast = sleeping || state.action?.fast;
  return state.timeScale * (fast ? (chapter?.SpeedUp2 || 4) : state.speed);
}
