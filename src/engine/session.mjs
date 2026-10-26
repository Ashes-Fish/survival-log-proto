// Gameplay session (M6/M7): the whole play state beyond one scene — current scene,
// per-scene furniture state (opened, looted, removed, disabled), container contents,
// travel, and the generic furniture-function executor. Pure JSON + functions; the
// three.js runtime renders it, Node tests drive it directly.
import * as R from './world-rules.mjs';
import {removeGet} from './crafting.mjs';
import * as P from './planting.mjs';

export const FUNC = Object.freeze({bag: 1, action: 2, install: 3, refund: 4, remove: 5, special: 6, floor: 7, vehicle: 8, trunk: 9, plasticBag: 10});

// Chapter/attribute defaults for the post-tutorial game (打工仔 → Player 1, PlayAttribute 1,
// Chapter 2 = Scene_AfterTheDisaster03). Config-derived; the native world init beyond
// these rows is not reconstructed (see investigation/reports/m7-core.md).
export function createSession(T, {playerSelectId = 1, startScene = 1, seed = 20261022, day = 0, seconds = 8 * 3600} = {}) {
  const select = T.raw.PlayerSelect?.find((p) => p.ID === playerSelectId);
  const player = T.raw.Player?.find((p) => p.ID === (select?.PlayerConfigId ?? 1));
  const passives = (player?.BuffList ?? []).filter((id) => id >= 10000);
  const startBuffs = (player?.BuffList ?? []).filter((id) => id < 10000);
  const money = player?.InitMoney > 0 ? player.InitMoney : (T.raw.GlobalSetting?.find((g) => g.ID === 'DefaultMoney')?.Params1 ?? 0);
  const world = R.createWorldState(T, {attributeId: player?.LinkAttr ?? 1, chapterId: 2, passiveBuffs: passives, buffs: startBuffs, money, bagId: player?.Bag ?? 1, seed, day, seconds});
  R.initProficiency(world, T, select);
  world.scene = startScene;
  return {
    schema: 1, kind: 'survival-log-session', playerSelectId,
    world,
    scene: startScene,
    position: null,
    furniture: {},     // key `${scene}:${guidanceId}` -> {removed, disabled, container, furnitureId}
    visited: [startScene],
    unlocked: [],
    parcels: [],       // furniture packages waiting at the door: {id, itemConfigId, furnitureId}
    placed: [],        // installed furniture: {id, furnitureId, scene, x, z, yaw}
  };
}

// Brings a saved session up to the current shape (fields added after it was written).
export function upgradeSession(session, T) {
  const w = session.world;
  w.ground ??= {};
  w.scene ??= session.scene;
  w.completedStories ??= [];
  w.itemDailyUses ??= {};
  w.guidance ??= {};
  if (!w.proficiency || !Object.keys(w.proficiency).length) R.initProficiency(w, T, T.raw.PlayerSelect?.find((p) => p.ID === session.playerSelectId));
  session.parcels ??= [];
  session.placed ??= [];
  // Dynamic-event director (events.mjs) replaced the old {fired, pending} shape.
  const ev = w.events ?? {};
  w.events = {cd: ev.cd ?? {}, scheduled: ev.scheduled ?? [], active: ev.active ?? null,
    tasks: ev.tasks ?? [], pending: ev.pending ?? [], log: ev.log ?? [], day: ev.day ?? -1};
  for (const fs of Object.values(session.furniture)) delete fs.uses;
  return session;
}

// Config_GuidanceFurniture visibility: IsShow (anchors built hidden carry initiallyHidden),
// then RewardSet Show/HideGuidanceFurnitureID (RewardSetManager.ExecuteGuidanceFurnitureReward
// → Furniture.SetVisible).
export const guidanceVisible = (session, anchor) => session.world.guidance?.[anchor.guidanceId] ?? !anchor.initiallyHidden;

export const furnitureKey = (scene, anchor) => scene + ':' + (anchor.guidanceId ?? anchor.id);

export function furnitureState(session, scene, anchor) {
  const key = furnitureKey(scene, anchor);
  session.furniture[key] ??= {removed: false, disabled: false, container: null, furnitureId: anchor.id};
  return session.furniture[key];
}

// Lazily creates the furniture's container with its configured initial items
// (Config_GuidanceFurniture.ItemIdList / ItemCountList).
export function containerFor(session, T, scene, anchor) {
  const fs = furnitureState(session, scene, anchor);
  if (fs.container) return fs.container;
  const furniture = T.furniture.get(anchor.id);
  const bagId = furniture?.BagId || anchor.bagId || 0;
  if (!bagId) return null;
  const c = R.createContainer(T, {id: furnitureKey(scene, anchor), configId: bagId, name: furniture?.Name_Local});
  (anchor.items ?? []).forEach((id, i) => R.addItem(session.world, T, c, id, anchor.counts?.[i] ?? 1));
  fs.container = c;
  return c;
}

// Config_FurnitureFunc.DailyMax counts per game day: uses live in world.dailyUses, which
// world-rules clears at every day boundary (the per-furniture `uses` map of old saves is
// no longer read).
const dailyKey = (scene, anchor, funcId) => furnitureKey(scene, anchor) + ':' + funcId;
export const dailyUsed = (session, scene, anchor, funcId) => session.world.dailyUses[dailyKey(scene, anchor, funcId)] ?? 0;

// Buttons for one furniture: visibility (VisibilityConditionSetId) and availability
// (ConditionSetId) evaluated by the general condition checker. Unknown visibility is
// shown; unknown availability is allowed but flagged.
export function buttonsFor(session, T, scene, anchor) {
  const furniture = T.furniture.get(anchor.id);
  const fs = furnitureState(session, scene, anchor);
  if (!furniture || fs.removed || fs.disabled || !guidanceVisible(session, anchor)) return [];
  const container = furniture.BagId ? containerFor(session, T, scene, anchor) : null;
  const out = [];
  // FurnitureFunc.Chapter (IsChapterConditionMet RVA 0x2F36D70, static): 0 always, 1 only
  // before the disaster, 2 only after. Without this the home door showed the pre-disaster
  // tutorial「出门」(239, needs TAG_KEY_PICKED_UP) first, which can never be used after it.
  const post = (T.chapter.get(session.world.chapterId)?.WorldStateType ?? 2) === 2;
  // Config_Furniture.RemoveFunc (拆除) and MoveFunc (移动) belong to plan mode: the
  // original's function bar never lists them (observed: 抽屉柜/床/衣柜 show no 拆除 in the
  // bar, while plan mode offers 拆除 + 移动 on the slot; compare-2026-10-23 s2-12/s2-27).
  // planButtonsFor() returns them. A FurnitureFunc entry that is itself a 拆除 (25
  // furniture list 299 there) stays in the bar as configured.
  const pot = P.isPot(T, anchor.id);
  if (pot) { fs.furnitureId ??= anchor.id; P.plantState(fs); }
  for (const id of furniture.FurnitureFunc ?? []) {
    const func = T.func.get(id);
    if (!func) continue;
    if (func.Chapter && func.Chapter !== (post ? 2 : 1)) continue;
    // Pot buttons follow the plant state (Furniture.IsFurnitureFuncVisible 0x2F37360) and
    // need PlantActionCost stamina (CheckPlantActionPrecondition 0x2EB73F0, 「精力不足」).
    if (pot && P.isPlantFunc(id)) {
      if (!P.funcVisible(fs, id)) continue;
      const tired = session.world.values.Stamina < P.actionCost(T);
      out.push({id, label: func.BtnName_Local || ('功能 ' + id), tip: func.BtnTips_Local || '', icon: func.BtnIcon || '', type: func.FuncType,
        enabled: !tired, lacks: tired ? [T.constant.get('HandMadeComponent_0')?.Text_Local ?? '精力不足'] : [], known: true, preview: func.PreviewAttrDelta || '', plant: true});
      continue;
    }
    const vis = R.checkCondition(session.world, T, func.VisibilityConditionSetId, {containers: container ? [container] : []});
    if (func.VisibilityConditionSetId && vis.known && !vis.ok) continue;
    const avail = R.checkCondition(session.world, T, func.ConditionSetId, {containers: container ? [container] : []});
    const daily = func.DailyMax ? dailyUsed(session, scene, anchor, id) >= func.DailyMax : false;
    out.push({id, label: func.BtnName_Local || ('功能 ' + id), tip: func.BtnTips_Local || '', icon: func.BtnIcon || '', type: func.FuncType,
      enabled: avail.ok && !daily, lacks: daily ? ['今日已用完'] : avail.lacks, known: vis.known && avail.known, preview: func.PreviewAttrDelta || ''});
  }
  return pot ? P.sortByPriority(out) : out;
}

// Plan-mode buttons for one furniture (Config_Furniture.RemoveFunc then MoveFunc), in the
// order the original plan-mode slot menu shows them: 拆除, 移动 (observed s2-12).
// Furniture the scene marks as not removable (Config_GuidanceFurniture.CanRemove false:
// 床, 房门, 窗户 …) offers none.
export function planButtonsFor(session, T, scene, anchor) {
  const furniture = T.furniture.get(anchor.id);
  const fs = furnitureState(session, scene, anchor);
  if (!furniture || fs.removed || !guidanceVisible(session, anchor) || anchor.canRemove === false) return [];
  const out = [];
  // A pot with a plant in it (any state but Idle) refuses 拆除 with 「植物种植中，无法拆除」
  // (ConstantText FF_PlantingCantRemove; which check raises it is INFERRED).
  const planted = (fs.plant?.state ?? 0) !== P.PLANT_STATE.idle;
  for (const id of [...(furniture.RemoveFunc ?? []), ...(furniture.MoveFunc ?? [])]) {
    const func = T.func.get(id);
    if (!func) continue;
    const avail = R.checkCondition(session.world, T, func.ConditionSetId);
    if (planted && (furniture.RemoveFunc ?? []).includes(id)) { avail.ok = false; avail.lacks = [T.constant.get('FF_PlantingCantRemove')?.Text_Local ?? '植物种植中，无法拆除']; }
    out.push({id, label: func.BtnName_Local || ('功能 ' + id), tip: func.BtnTips_Local || '', icon: func.BtnIcon || '', type: func.FuncType,
      enabled: avail.ok, lacks: avail.lacks, known: avail.known, confirm: func.ConfirmInfo_Local || '', move: T.effect.get(T.action.get(func.ActionIds?.[0])?.EffectConfigID)?.ConfigName === 'Action/Move_Furniture'});
  }
  return out;
}

// Furniture durability (Config_Furniture.isShowHP / FurnitureHP / FurnitureHPMax): the
// original floats a green 「700/1000」 bar above the home door (observed n71/n75/s2-02).
// The current value lives in the furniture state once it changes; repairs
// (Action/Item_Bar_WithDurability, e.g. 修补房门 func 30) add -IntValue0 (100 for the door,
// FurnitureFunc 30 tip 「修复目标100点耐久」), capped at the maximum.
export function furnitureHp(session, T, scene, anchor) {
  const f = T.furniture.get(anchor.id);
  if (!f?.isShowHP || !(f.FurnitureHPMax > 0)) return null;
  const fs = furnitureState(session, scene, anchor);
  return {hp: fs.hp ?? f.FurnitureHP, max: f.FurnitureHPMax};
}

// Executes one FurnitureFunc. Returns {ok, message, open?: {panel, container}, travel?}.
// Chain: ConditionSetId → RewardSetId (cost/side effects at start, INFERRED order) →
// ActionIds in sequence (timed actions run through world-rules; the last OpenBag action
// opens the container). A use counts toward DailyMax only once the function has started.
export function runFunction(session, T, scene, anchor, funcId) {
  const w = session.world;
  const func = T.func.get(funcId);
  if (!func) return {ok: false, message: '功能不存在'};
  if (w.dead) return {ok: false, message: '角色已死亡'};
  if (w.action) return {ok: false, message: '正在' + (T.action.get(w.action.actionId)?.Name_Local ?? '行动')};
  if (func.DailyMax && dailyUsed(session, scene, anchor, funcId) >= func.DailyMax) return {ok: false, message: '今日已用完'};
  const result = executeFunction(session, T, scene, anchor, func);
  if (result.ok && func.DailyMax) w.dailyUses[dailyKey(scene, anchor, funcId)] = dailyUsed(session, scene, anchor, funcId) + 1;
  return result;
}

function executeFunction(session, T, scene, anchor, func) {
  const w = session.world;
  const fs = furnitureState(session, scene, anchor);
  const container = containerFor(session, T, scene, anchor);
  const cond = R.checkCondition(w, T, func.ConditionSetId, {containers: container ? [container] : []});
  if (!cond.ok) return {ok: false, message: func.BtnName_Local + '：' + cond.lacks.join('，')};

  if (P.isPot(T, anchor.id) && P.isPlantFunc(func.ID)) { P.plantState(fs); const pre = P.canRun(w, T, fs, func.ID); if (!pre.ok) return {ok: false, message: func.BtnName_Local + '：' + pre.message}; }
  if (func.FuncType === FUNC.bag) return {ok: true, message: '打开' + anchor.name, open: {panel: 'backpack', container}};
  if (func.FuncType === FUNC.remove) { fs.removed = true; dropContainer(session, T, scene, fs); return {ok: true, message: '拆除了' + anchor.name, removed: true}; }
  if (func.FuncType === FUNC.floor || func.JumpMapId) return {ok: true, message: func.BtnName_Local, travel: {mapPointId: func.JumpMapId || null}};
  if (func.FuncType !== FUNC.action) return {ok: false, message: func.BtnName_Local + '：该类功能（类型 ' + func.FuncType + '）暂未接入'};

  // The function's RewardSet ItemCost is checked as a whole before anything starts, over
  // the bags that the condition also searched; the cost is taken from the same bags.
  const bags = [w.bags.player, ...(container ? [container] : [])];
  if (func.RewardSetId) {
    const paid = R.applyReward(w, T, func.RewardSetId, {costBags: bags, requireCost: true});
    if (!paid.ok) return {ok: false, message: func.BtnName_Local + '：' + paid.message};
  }
  const actions = [...(func.ActionIds ?? [])];
  if (!actions.length) return {ok: true, message: func.BtnName_Local, completed: true};
  return queueActions(session, T, scene, anchor, actions, container);
}

// Demolishing a furniture drops everything inside it at its feet (AE_DisableFurniture.Run
// RVA 0x2F97DA0 → DropItemFromBagAt for every item of the furniture bag).
function dropContainer(session, T, scene, fs) {
  const items = fs.container?.items ?? [];
  for (const it of items) R.dropToGround(session.world, it.configId, it.count, scene);
  if (fs.container) fs.container.items = [];
  return items.length;
}

const OPEN_PANEL = {
  'Action/Default_OpenBag': 'backpack', 'Action/Open_HandMade': 'craft', 'Action/Open_CookingPanel': 'cooking',
  'Action/OpenWorkbenchDrawer': 'backpack', 'Action/Wait_OpenPreMap': 'map',
  // A shop shelf opens the trade shop (Action/Default_OpenShop, effect 8); a door opens
  // the exploration map (Action/Wait_OpenMap, effect 57); the drone opens the trade map
  // (Action/Wait_OpenTradeMap). The shop id / map mode come from the furniture via
  // openContext(); the runtime fills them when the furniture carries one.
  'Action/Default_OpenShop': 'shop', 'Action/Wait_OpenMap': 'map', 'Action/Wait_OpenTradeMap': 'map',
  // Pots: 种植 opens PlantPanel (Effect 17 AE_OpenPlantPanel), 施肥 opens AddFertilizer
  // (Effect 19 AE_OpenAddFertilizer); the panel then dispatches action 1611.
  'Action/Default_OpenPlantPanel': 'plant', 'Action/Default_OpenAddFertilizer': 'addFert',
};
// Extra panel options for a furniture that opens the shop or the map.
function openContext(session, T, panel, anchor, effectName) {
  if (panel === 'shop') return {shopId: T.furniture.get(anchor?.id)?.ShopId || anchor?.shopId || 0};
  if (panel === 'map') return {mode: effectName === 'Action/Wait_OpenTradeMap' ? 'trade' : 'explore'};
  if (panel === 'plant' || panel === 'addFert') return {furnitureKey: furnitureKey(session.scene, anchor)};
  return {};
}

// Runs actions one after another. A timed action registers onComplete to start the next.
function queueActions(session, T, scene, anchor, actions, container) {
  const w = session.world;
  const [first, ...rest] = actions;
  const action = T.action.get(first);
  const effect = T.effect.get(action?.EffectConfigID);
  const panel = OPEN_PANEL[effect?.ConfigName];
  if (panel) {
    // Opening a panel ends the chain; it is instantaneous in the original too (During -1).
    return {ok: true, message: action.Name_Local, open: {panel, container, ...openContext(session, T, panel, anchor, effect?.ConfigName)}};
  }
  const result = R.startAction(w, T, first, {furnitureKey: furnitureKey(scene, anchor), opts: {resolveBag: bagResolver(session)}});
  if (!result.ok) return result;
  if (result.completed && rest.length) return queueActions(session, T, scene, anchor, rest, container);
  if (rest.length) session.pending = {scene, anchor: {id: anchor.id, guidanceId: anchor.guidanceId, name: anchor.name, items: anchor.items, counts: anchor.counts, bagId: anchor.bagId}, actions: rest};
  return {...result, pendingActions: rest.length};
}

export function bagResolver(session) {
  return (id) => Object.values(session.furniture).find((f) => f.container?.id === id)?.container ?? null;
}

// Advances game time and applies completion side effects the rules layer reports
// (furniture disabled by EDisableFurniture), then continues a queued action chain.
export function advanceSession(session, T, seconds) {
  session.world.scene = session.scene;
  const events = R.advance(session.world, T, seconds, {resolveBag: bagResolver(session)});
  const inst = instanceTick(session, T, seconds);
  if (inst) events.push(inst);
  for (const done of session.world.completed?.splice(0) ?? []) {
    const fs = done.furnitureKey ? session.furniture[done.furnitureKey] : null;
    if (done.disableFurniture && fs) fs.disabled = true;
    // Demolish (Effect Action/Furniture_Bar_Demolish, AE_DisableFurniture.Run): the
    // furniture's bag contents drop at its feet, the furniture is removed, a story it
    // carried completes (OnStoryCarrierRemoved), and RemoveGet materials drop too
    // (AE_DropFurnitureRemoveGet.Run RVA 0x2F985C0 → DropItemAtPosition); they are picked
    // into the player bag here when there is room.
    if (fs && T.effect.get(T.action.get(done.actionId)?.EffectConfigID)?.ConfigName === 'Action/Furniture_Bar_Demolish') {
      const scene = Number(done.furnitureKey.split(':')[0]);
      fs.removed = true;
      dropContainer(session, T, scene, fs);
      // Installed furniture (anchor guidanceId 'placed-<id>') leaves the placed list.
      session.placed = (session.placed ?? []).filter((x) => scene + ':placed-' + x.id !== done.furnitureKey);
      const story = T.furniture.get(fs.furnitureId)?.Story;
      if (story) completeStory(session, T, story);
      done.gained = [...(done.gained ?? []), ...removeGet(session.world, T, fs.furnitureId)];
      done.removed = true;
    }
    if (fs && done.configName === 'Action/Item_Bar_WithDurability') {
      const f = T.furniture.get(fs.furnitureId);
      const heal = -(T.effect.get(T.action.get(done.actionId)?.EffectConfigID)?.IntValue0 ?? 0);
      if (f?.FurnitureHPMax > 0 && heal > 0) fs.hp = Math.min(f.FurnitureHPMax, (fs.hp ?? f.FurnitureHP) + heal);
    }
    // Move_Furniture (移动 1608, Action 204, 900 s): the furniture stands on the chosen slot
    // once the action completes (the original's 「选择{0}槽位，移动 {1}」 flow).
    if (fs && done.configName === 'Action/Move_Furniture' && done.slot) {
      fs.moved = {node: done.slot.node, x: done.slot.x, y: done.slot.y ?? 0, z: done.slot.z, yaw: done.slot.yaw ?? 0};
      done.moved = {furnitureKey: done.furnitureKey, ...fs.moved};
    }
    // Pot work (action 1611 Default_PlantSeed: sow / top-dress) and care actions.
    if (fs && done.configName === 'Action/Default_PlantSeed') Object.assign(done, {plant: P.completeWork(session.world, T, fs)});
    if (fs && PLANT_CARE.has(done.configName)) Object.assign(done, {plant: P.completeCare(session.world, T, fs, done.configName)});
    if (done.plant?.gained?.length) done.gained = [...(done.gained ?? []), ...done.plant.gained];
    if (done.plant?.dropped?.length) done.dropped = [...(done.dropped ?? []), ...done.plant.dropped];
    if (done.configName === 'Action/Item_Generate_BagFurniture' && done.itemUid) {
      const p = generateParcel(session, T, done);
      events.push({type: 'parcel', ...p});
    }
    if (done.configName === 'Action/Install_BagFurniture' && done.parcelId) {
      const r = installParcel(session, T, done.parcelId, done.slot ?? {});
      events.push({type: 'installed', ...r});
    }
    events.push({type: 'completed', ...done});
  }
  const next = continueChain(session, T);
  if (next) events.push({type: 'chain', ...next});
  // Plants grow everywhere the player is (PlantComponent ticks on the home map; game time
  // is global, so ticking all pots after each advance is equivalent).
  for (const [key, fs] of Object.entries(session.furniture)) {
    if (!fs.plant || fs.removed) continue;
    for (const e of P.tickPlant(session.world, T, fs)) events.push({...e, furnitureKey: key});
  }
  return events;
}
const PLANT_CARE = new Set(['Action/Default_CurePest', 'Action/Default_CureWeed', 'Action/Default_Water', 'Action/Default_CleanupPlant',
  'Action/Default_HarvestPlant', 'Action/Default_TillSoil', 'Action/Default_EradicatePlant']);

// PlantPanel START_PLANT / AddFertilizer CONFIRM: record the pending work and start action
// 1611 「正在种植」 (900 s) on the pot (LeadingRole.OnPlantPanelStartPlant 0x2F60E10 /
// OnAddFertilizerConfirm 0x2F5F0D0). The stamina gate applies before it starts.
export function startPlantWork(session, T, key, job) {
  const fs = session.furniture[key];
  if (!fs) return {ok: false, message: '花盆不存在'};
  if (session.world.values.Stamina < P.actionCost(T)) return {ok: false, message: T.constant.get('HandMadeComponent_0')?.Text_Local ?? '精力不足'};
  if (job.kind === 'sow') P.setPendingPlant(fs, job); else P.setPendingFert(fs, job.fertItem);
  const r = R.startAction(session.world, T, 1611, {furnitureKey: key, opts: {resolveBag: bagResolver(session)}});
  if (!r.ok) fs.plant.pending = null;
  return r;
}

// ---- stories (Config_Story) ---------------------------------------------------------
// PromptTriggerManager.OnStoryCompleted (RVA 0x26D1BE0, static): a story moves to the
// completed list once; its RewardSet is paid only when its ConditionSetId holds, and a
// completed story never pays again (so reading the wallet twice gives 70 once).
export const storyCompleted = (session, id) => session.world.completedStories.includes(id);
export function completeStory(session, T, storyId) {
  const w = session.world;
  if (storyCompleted(session, storyId)) return {ok: false, already: true, gained: [], dropped: []};
  const story = T.story.get(storyId);
  if (!story) return {ok: false, gained: [], dropped: []};
  w.completedStories.push(storyId);
  R.addTag(w, 'Story_' + storyId);
  if (story.ConditionSetId && !R.checkCondition(w, T, story.ConditionSetId).ok) return {ok: true, paid: false, gained: [], dropped: []};
  const r = story.RewardSetId ? R.applyReward(w, T, story.RewardSetId) : null;
  return {ok: true, paid: Boolean(r), gained: r?.gained ?? [], dropped: r?.dropped ?? [], money: T.reward.get(story.RewardSetId)?.MoneyAdd || 0};
}

// Called by the runtime after advance(): continues a queued chain whose previous timed
// action has completed.
export function continueChain(session, T) {
  const p = session.pending;
  if (!p || session.world.action) return null;
  session.pending = null;
  const container = containerFor(session, T, p.scene, p.anchor);
  return queueActions(session, T, p.scene, p.anchor, p.actions, container);
}

// Uses a backpack item (eat/drink/read/medicine...) through its Config_Item.UseAction.
// Checks follow ItemManager's use path: Item.ConditionSetId (e.g. books need 精力 ≥ 10,
// ConditionSet 5002), Item.DailyMax per day (ItemManager_1「{0}今日使用次数已达上限」),
// and only effect families the runtime can execute (see R.USABLE_FAMILIES).
export function useItem(session, T, uid, bag = session.world.bags.player) {
  const w = session.world;
  const it = bag.items.find((i) => i.uid === uid);
  if (!it) return {ok: false, message: '物品不存在'};
  const row = T.item.get(it.configId);
  const text = (id, fallback, ...args) => (T.constant.get(id)?.Text_Local ?? fallback).replace(/\{(\d)\}/g, (_, i) => String(args[i] ?? ''));
  if (!row?.UseAction || row.CantUse) return {ok: false, message: text('ItemManager_7', '该物品无法直接使用')};
  const family = T.effect.get(T.action.get(row.UseAction)?.EffectConfigID)?.ConfigName ?? '';
  if (!R.USABLE_FAMILIES.has(family)) return {ok: false, message: row.ItemName_Local + '：网页版暂未接入这种用法'};
  if (row.DailyMax > 0 && (w.itemDailyUses[it.configId] ?? 0) >= row.DailyMax) return {ok: false, message: text('ItemManager_1', '{0}今日使用次数已达上限', row.ItemName_Local)};
  if (row.ConditionSetId) {
    const c = R.checkCondition(w, T, row.ConditionSetId);
    if (!c.ok) return {ok: false, message: text('ItemManager_2', '属性不满足使用条件') + '：' + c.lacks.join('，')};
  }
  if (family === 'Action/Item_Generate_BagFurniture' && parcelsWaiting(session) >= parcelLimit(T)) return {ok: false, message: text('BagFurniture_Full_0', '玄关已满,先安装或退货后再使用')};
  const bagId = bag === w.bags.player ? 'player' : bag.id;
  return R.startAction(w, T, row.UseAction, {itemUid: it.uid, itemConfigId: it.configId, bagId, opts: {resolveBag: bagResolver(session)}});
}

// ---- furniture parcels (Item.TargetFurnitureID) -----------------------------------
// Using a parcel item (Action/Item_Generate_BagFurniture → AE_GenerateBagFurniture.Run
// RVA 0x2FBE470, static) creates a parcel (BagFurniture, template furniture 1000 with the
// target's BagResName box model) at the free home package point nearest the player
// (BuildComponent.CreateBagFurniture RVA 0x2EDB5E0: 'HomePackage' + digits nodes,
// IsNormalPackagePoint RVA 0x2EDC8C0; HomePackageMax = 8) and pays with CostItem. The
// parcel's buttons (BagFurniture.BuildBtnDataList RVA 0x2F52400, static array
// [298, 1607, 1609] filtered by FurnitureFunc.Chapter, IsChapterConditionMet RVA
// 0x2F36D70: Chapter 1 only before the disaster, 2 only after): 安装 (298, Action 198
// Install_BagFurniture, 900 s) and 拆除 (1609: BagFurniture.Dismantle RVA 0x2F52B60 drops
// the target furniture's RemoveGet materials, no refund). 退货 (1607) is pre-disaster only.
// The install slot is a free Config_MapSlot of the home whose Type equals the target's
// Furniture.SlotType (every placed home furniture matches its slot type: config-derived;
// the planning-mode UI that picks a slot is not rebuilt, the nearest free slot is taken).
export const parcelLimit = (T) => T.raw.GlobalSetting?.find((g) => g.ID === 'HomePackageMax')?.Params1 || 8;
export const parcelsWaiting = (session) => session.parcels.length;
export const PARCEL_FUNCS = Object.freeze({install: 298, refund: 1607, dismantle: 1609});
function generateParcel(session, T, done) {
  const w = session.world;
  const bag = done.bagId === 'player' || !done.bagId ? w.bags.player : bagResolver(session)(done.bagId);
  const it = bag?.items.find((i) => i.uid === done.itemUid);
  const row = T.item.get(done.itemConfigId);
  if (!it || !row?.TargetFurnitureID) return {ok: false};
  if (parcelsWaiting(session) >= parcelLimit(T)) return {ok: false, message: T.constant.get('BagFurniture_Full_0')?.Text_Local ?? '玄关已满'};
  R.removeItem(bag, it.uid, 1);
  const parcel = {id: w.nextItemId++, itemConfigId: row.ID, furnitureId: row.TargetFurnitureID, point: null};
  session.parcels.push(parcel);
  return {ok: true, parcel};
}
// Assigns package points to parcels that have none (the runtime passes the scene's
// package nodes and the player position; the nearest free node wins).
export function placeParcels(session, packages, near = null) {
  const taken = new Set(session.parcels.map((p) => p.point).filter(Boolean));
  for (const p of session.parcels) {
    if (p.point) continue;
    const free = packages.filter((n) => !taken.has(n.node));
    if (!free.length) break;
    free.sort((a, b) => (near ? Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z) : a.node.localeCompare(b.node)));
    p.point = free[0].node;
    taken.add(p.point);
  }
  return session.parcels;
}
// Buttons of a parcel (post-disaster chapter: 安装, 拆除).
export function parcelButtons(session, T, parcel) {
  const post = (T.chapter.get(session.world.chapterId)?.WorldStateType ?? 2) === 2;
  return [PARCEL_FUNCS.install, PARCEL_FUNCS.refund, PARCEL_FUNCS.dismantle].map((id) => T.func.get(id)).filter((f) => f && (f.Chapter === 0 || f.Chapter === (post ? 2 : 1)))
    .map((f) => ({id: f.ID, label: f.BtnName_Local, tip: f.BtnTips_Local || '', confirm: f.ConfirmInfo_Local || '', enabled: true, lacks: [], known: true}));
}
// Free install slots for a furniture: Config_MapSlot rows of the scene (desc.slots) with
// the furniture's SlotType that no visible anchor or installed furniture occupies.
export function freeSlots(session, T, desc, furnitureId) {
  const type = T.furniture.get(furnitureId)?.SlotType;
  const used = new Set([
    ...desc.anchors.filter((a) => !furnitureState(session, desc.id, a).removed && guidanceVisible(session, a)).map((a) => furnitureState(session, desc.id, a).moved?.node ?? a.anchor),
    ...session.placed.filter((p) => p.scene === desc.id).map((p) => p.slot),
  ]);
  return (desc.slots ?? []).filter((s) => s.type === type && !used.has(s.node) && (!s.unlockTag || session.world.tags.includes(s.unlockTag)));
}
// Starts installing a parcel (Install_BagFurniture, 900 s); the furniture appears on the
// chosen slot when the action completes (advanceSession).
export function startInstall(session, T, parcelId, slot) {
  const w = session.world;
  const p = session.parcels.find((x) => x.id === parcelId);
  if (!p) return {ok: false, message: '包裹不存在'};
  if (!slot) return {ok: false, message: (T.furniture.get(p.furnitureId)?.Name_Local ?? '家具') + '：没有空余的' + (T.raw.SlotType?.find((s) => s.ID === T.furniture.get(p.furnitureId)?.SlotType)?.Name_Local ?? '') + '槽位'};
  const actionId = T.func.get(PARCEL_FUNCS.install)?.ActionIds?.[0] ?? 198;
  const r = R.startAction(w, T, actionId, {parcelId, slot: {node: slot.node, x: slot.x, z: slot.z, yaw: slot.unityYawDeg ?? 0}});
  return r;
}
// Starts moving a furniture to a free slot of its SlotType (移动, MoveFunc → Action 204
// Move_Furniture); the furniture changes place when the action completes.
export function startMove(session, T, scene, anchor, funcId, slot) {
  const func = T.func.get(funcId);
  if (!func || !slot) return {ok: false, message: '没有可用的槽位'};
  const cond = R.checkCondition(session.world, T, func.ConditionSetId);
  if (!cond.ok) return {ok: false, message: func.BtnName_Local + '：' + cond.lacks.join('，')};
  return R.startAction(session.world, T, func.ActionIds[0], {furnitureKey: furnitureKey(scene, anchor),
    slot: {node: slot.node, x: slot.x, y: slot.y ?? 0, z: slot.z, yaw: slot.unityYawDeg ?? 0}});
}

// Installs a parcel: its furniture goes on the slot and the parcel goes.
export function installParcel(session, T, parcelId, place) {
  const i = session.parcels.findIndex((p) => p.id === parcelId);
  if (i < 0) return {ok: false, message: '包裹不存在'};
  const p = session.parcels[i];
  session.parcels.splice(i, 1);
  const placed = {id: p.id, furnitureId: p.furnitureId, scene: homePointId(session, T), slot: place.node ?? null, x: place.x, z: place.z, yaw: place.yaw ?? 0};
  session.placed.push(placed);
  return {ok: true, placed, message: '安装了 ' + (T.furniture.get(p.furnitureId)?.Name_Local ?? p.furnitureId)};
}
// Dismantles a parcel (拆除 1609): the target furniture's RemoveGet materials land at the
// parcel (BagFurniture.Dismantle → DropItemAtPosition), no money back.
export function dismantleParcel(session, T, parcelId) {
  const i = session.parcels.findIndex((p) => p.id === parcelId);
  if (i < 0) return {ok: false, message: '包裹不存在'};
  const p = session.parcels[i];
  session.parcels.splice(i, 1);
  const scene = homePointId(session, T);
  const got = T.furniture.get(p.furnitureId)?.RemoveGet ?? [];
  for (const id of got) R.dropToGround(session.world, id, 1, scene);
  return {ok: true, message: '拆除了包裹，材料放在了脚边', dropped: got};
}
// Refunds a parcel: the parcel item comes back (BagFurniture 退货 is a pre-disaster shop
// refund; kept for old saves and tests).
export function returnParcel(session, T, parcelId) {
  const i = session.parcels.findIndex((p) => p.id === parcelId);
  if (i < 0) return {ok: false, message: '包裹不存在'};
  const p = session.parcels[i];
  session.parcels.splice(i, 1);
  R.addItem(session.world, T, session.world.bags.player, p.itemConfigId, 1, {overflow: true});
  return {ok: true, message: '退回了 ' + (T.item.get(p.itemConfigId)?.ItemName_Local ?? p.itemConfigId)};
}

// ---- travel ----------------------------------------------------------------------
// Travel time follows GameTimeManager.JumpMap (RVA 0x26123F0, static): when the
// destination is a home-type point (Config_MapPoint.Type 1) the time of the point being
// left is charged, otherwise the destination's. MapPointRules.GetTravelTime (RVA
// 0x289D9F0) reads TimeByPlayer[index - 1] when that entry is positive, else Time; the
// index is a 1-based runtime value read at +0xB0 (taken as the player select: INFERRED).
export function pointTravelSeconds(point, playerSelectId = 1) {
  const byPlayer = point?.TimeByPlayer?.[playerSelectId - 1];
  return byPlayer > 0 ? byPlayer : (point?.Time ?? 0);
}
export function travelSeconds(T, fromId, toId, playerSelectId = 1) {
  const points = T.raw.MapPoint ?? [];
  const to = points.find((p) => p.ID === toId);
  const from = points.find((p) => p.ID === fromId);
  return pointTravelSeconds(to?.Type === 1 ? from : to, playerSelectId);
}
// The player's home point: Config_PlayerSelect.InitMapConfigId (家 = 1 for 打工仔).
export function homePointId(session, T) {
  return T.raw.PlayerSelect?.find((p) => p.ID === session.playerSelectId)?.InitMapConfigId || 1;
}
export function isHomeScene(session, T, scene = session.scene) {
  const home = homePointId(session, T);
  const group = T.raw.MapPoint?.find((p) => p.ID === home)?.HomeGroup;
  return scene === home || (group > 0 && T.raw.MapPoint?.find((p) => p.ID === scene)?.HomeGroup === group);
}

// Map-point lock state (FloorTagConstants.IsMapPointUnlocked RVA 0x25F8290): a point is
// unlocked when its Config_MapPoint.UnlockTag (0x98) is empty, or the player holds that
// tag (TagManager.HasTag). IsUnlock makes it open from the start. The reward/story AddTag
// of School_Open / Supermarket_Open / Hospital_Open / TradePointUnlock_* flips this.
export function isPointUnlocked(session, T, pointId) {
  const p = T.raw.MapPoint?.find((r) => r.ID === pointId);
  if (!p) return false;
  if (p.IsUnlock) return true;
  const tag = p.UnlockTag;
  if (!tag) return true;
  return session.world.tags.includes(tag);
}
// The ids the explore/trade map should show as open (consumed by world-map lockStateOf).
export function unlockedPointIds(session, T) {
  return (T.raw.MapPoint ?? []).filter((p) => isPointUnlocked(session, T, p.ID)).map((p) => p.ID);
}

// Config_MapPoint.ConditionSetId / CostItems are an ENTRY requirement shown on the map
// (key card, survival day, open hours). ExploreManager.CanEnterMapPoint (RVA 0x25E9B80)
// does NOT gate on them (it checks challenge/demo/tower-wave blocks only), and the shipped
// build has no way to obtain some key items, so travel is not hard-blocked on them — the
// requirement is surfaced to the player and left non-blocking (INFERRED: the key-card
// consumption path is not reconstructed). The lock state (UnlockTag) is the real gate.
export function entryRequirement(session, T, pointId) {
  const p = T.raw.MapPoint?.find((r) => r.ID === pointId);
  if (!p?.ConditionSetId) return {met: true, lacks: []};
  const c = R.checkCondition(session.world, T, p.ConditionSetId);
  return {met: c.ok, lacks: c.lacks};
}
export function canEnterPoint(session, T, pointId) {
  const p = T.raw.MapPoint?.find((r) => r.ID === pointId);
  if (!p) return {ok: false, lacks: ['未知地点']};
  if (!isPointUnlocked(session, T, pointId)) return {ok: false, lacks: [(p.UnlockHint_Local || p.Name_Local + ' 尚未解锁')]};
  return {ok: true, lacks: []};
}

// Which exploration scene JSON backs a map point, and whether the web build ships it.
// Only a handful of scenes are exported (world/scenes/*.json); travel to the rest is
// refused with a clear message instead of a 404. The scene file is named by the point id.
export const EXPORTED_SCENES = Object.freeze(new Set([1, 2, 8, 1000, 1004]));
export function sceneExported(pointId) { return EXPORTED_SCENES.has(pointId); }

// Moves the session to another map point. The point being left is closed first
// (ExploreManager.OnExploreEnd runs before the time jump), so the road time accrues no
// exposure to it; then the clock jumps by the travel time.
export function travel(session, T, toScene, mapPoints = T.raw.MapPoint ?? []) {
  const w = session.world;
  if (w.action) return {ok: false, message: '正在行动，不能出发'};
  const point = mapPoints.find((p) => p.ID === toScene);
  const seconds = travelSeconds(T, session.scene, toScene, session.playerSelectId);
  leaveInstance(session, T);
  advanceSession(session, T, seconds);
  if (w.dead) return {ok: false, message: '途中死亡', dead: true, seconds};
  session.scene = toScene;
  session.position = null;
  if (!session.visited.includes(toScene)) session.visited.push(toScene);
  enterInstance(session, T, toScene);
  return {ok: true, seconds, message: '抵达 ' + (point?.Name_Local ?? toScene)};
}

// Ends an exploration (or any trip) and goes home. Mirrors ExploreManager.OnExploreEnd
// (RVA 0x25EB5A0, static): FailedBuff when the exposure is full, InitialBuff removed, and
// the items gained since entering (RecordItemSnapshot / CalculateAndSaveReward) are
// reported for the RewardList result page. forced = the exposure filled up.
export function returnHome(session, T, {forced = false} = {}) {
  const w = session.world;
  if (w.dead) return {ok: false, message: '角色已死亡'};
  const home = homePointId(session, T);
  if (isHomeScene(session, T)) return {ok: false, message: '已经在家里了'};
  if (w.action) {
    if (!forced) return {ok: false, message: '正在' + (T.action.get(w.action.actionId)?.Name_Local ?? '行动')};
    R.cancelAction(w, T);
    session.pending = null;
  }
  const brought = broughtItems(session);
  const inst = session.instance && T.raw.Instance?.find((r) => r.ID === session.instance.id);
  if (forced && inst) for (const id of inst.FailedBuff ?? []) R.addBuff(w, T, id);
  const from = session.scene;
  const r = travel(session, T, home);
  return {...r, from, forced, brought, wasInstance: Boolean(inst)};
}

function bagCounts(bag) {
  const counts = {};
  for (const it of bag.items) counts[it.configId] = (counts[it.configId] ?? 0) + it.count;
  return counts;
}
function broughtItems(session) {
  const start = session.instance?.snapshot;
  if (!start) return [];
  const now = bagCounts(session.world.bags.player);
  return Object.entries(now).map(([id, n]) => ({configId: Number(id), count: n - (start[id] ?? 0)})).filter((x) => x.count > 0);
}

export function saveSession(session) { return JSON.stringify(session); }
export function loadSession(text) {
  const s = JSON.parse(text);
  if (s?.kind !== 'survival-log-session' || s.schema !== 1) throw new Error('存档格式不兼容');
  return s;
}

// ---- exploration instances (Config_Instance) -----------------------------------
// Entering an exploration map applies InitialBuff (保持戒备 1120 and the hidden T50x
// "not yet searched" buffs that gate furniture buttons) and snapshots the bag
// (ExploreManager.RecordItemSnapshot) so the trip's haul can be shown on return.
// Exposure follows ExploreManager.Update (RVA 0x25EDEF0, static): it grows by
// deltaTime × TimeExposure, where deltaTime is internal clock time = game seconds /
// TimeScale of the instance's chapter (Config_Chapter row = MapPoint.ChapterID), plus
// action ExposureValue; it is clamped to ExposureLimit, and reaching the limit ends the
// exploration (OnExploreEnd: FailedBuff, forced return home). The runtime performs the
// return on the 'exposure-full' event.
export function enterInstance(session, T, scene) {
  const inst = T.raw.Instance?.find((r) => r.ID === scene);
  session.instance = inst ? {id: scene, exposure: 0, full: false, alarmed: false, snapshot: bagCounts(session.world.bags.player)} : null;
  if (!inst) return;
  for (const id of inst.InitialBuff ?? []) R.addBuff(session.world, T, id);
  session.world.exposure = 0;
  // The exploration map runs on its own chapter clock (Config_Chapter[MapPoint.ChapterID],
  // TimeScale 120 vs 240 at home). Every rule converts with the same scale, so only the
  // real-time pace changes (INFERRED: the chapter switch on JumpMap is not traced).
  session.world.timeScale = instanceTimeScale(T, scene);
}
export function leaveInstance(session, T) {
  const inst = session.instance && T.raw.Instance?.find((r) => r.ID === session.instance.id);
  if (inst) for (const id of inst.InitialBuff ?? []) R.removeBuff(session.world, T, id);
  session.instance = null;
  session.world.exposure = 0;
  session.world.timeScale = T.chapter.get(session.world.chapterId)?.TimeScale ?? session.world.timeScale;
}
function instanceTimeScale(T, id) {
  const chapterId = T.raw.MapPoint?.find((p) => p.ID === id)?.ChapterID || id;
  return T.chapter.get(chapterId)?.TimeScale || 120;
}
export function instanceTick(session, T, seconds) {
  const cur = session.instance;
  if (!cur || cur.full) return null;
  const inst = T.raw.Instance.find((r) => r.ID === cur.id);
  const w = session.world;
  w.exposure = Math.min(inst.ExposureLimit, w.exposure + (inst.TimeExposure || 0) * seconds / instanceTimeScale(T, cur.id));
  cur.exposure = w.exposure;
  if (w.exposure >= inst.ExposureLimit) { cur.full = true; return {type: 'exposure-full', limit: inst.ExposureLimit}; }
  if (w.exposure >= inst.ExposureLimit * inst.ExposureAlarm && !cur.alarmed) { cur.alarmed = true; return {type: 'exposure-alarm'}; }
  return null;
}

// PlantingDetails ERADICATE (EnumNotify_Plant.EradicatePlant 7004): runs action 1619
// 铲除植物 (300 s, Effect 66 Default_EradicatePlant) on the pot. The 花盆's own function
// list has no 1619, so this page is its only way in.
export function eradicatePlant(session, T, key) {
  const fs = session.furniture[key];
  if (!fs?.plant) return {ok: false, message: '花盆不存在'};
  const pre = P.canRun(session.world, T, fs, 1619);
  if (!pre.ok) return pre;
  return R.startAction(session.world, T, 1619, {furnitureKey: key, opts: {resolveBag: bagResolver(session)}});
}
