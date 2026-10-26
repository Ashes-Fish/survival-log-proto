// Panel bridge for the full game (M7/M8). Each original WebUI page runs in an iframe and
// speaks the shipped postMessage protocol ({type, data} in, UnitySendEvent out); this
// module plays the Unity side against the rules engine. Message/field names are read
// from the shipped pages (investigation/reports/webui-panel-protocols.md); which fields
// the original C# fills and how is only partly known, so unused fields stay default.
import * as R from '../src/engine/world-rules.mjs';
import * as S from '../src/engine/session.mjs';
import * as C from '../src/engine/crafting.mjs';
import * as P from '../src/engine/planting.mjs';
import {exploreMapPayload} from '../src/game/world-map.mjs';

const PAGES = {
  backpack: '../WebUI/UI/BackpackUI/BackpackUI.html',
  craft: '../WebUI/UI/ToolTable/ToolTable.html',
  cooking: '../WebUI/UI/Cooking/Cooking.html',
  shop: '../WebUI/UI/ShopUI/ShopUI.html',
  map: '../WebUI/UI/ExploreMap/ExploreMap.html',
  event: '../WebUI/UI/EventChoice/EventChoice.html',
  result: '../WebUI/UI/GameResult/GameResult.html',
  confirm: '../WebUI/UI/ConfirmDialog/ConfirmDialog.html',
  reward: '../WebUI/UI/RewardList/RewardList.html',
  story: '../WebUI/UI/TriggerUI/TriggerUI.html',
  pause: '../WebUI/UI/OutSetting/OutSetting.html',
  gameCount: '../WebUI/UI/GameCountTips/GameCountTips.html',
  plant: '../WebUI/UI/PlantPanel/PlantPanel.html',
  addFert: '../WebUI/UI/AddFertilizer/AddFertilizer.html',
  plantDetails: '../WebUI/UI/PlantingDetails/PlantingDetails.html',
};
// Panels that freeze the game clock while open (the original pauses on full-screen UI;
// INFERRED for craft/cooking/shop).
// story (TriggerUI) and pause (OutSetting PAUSE menu) freeze time too — observed: the HUD
// clock does not move while either is open (compare-2026-10-23 n13/n22/n33).
const BLOCKS_TIME = new Set(['backpack', 'craft', 'cooking', 'shop', 'map', 'event', 'result', 'confirm', 'reward', 'story', 'pause', 'plant', 'addFert']);
// plantDetails (PlantingDetails) keeps time running: the page runs its own countdown at
// effectiveTimeScale while open (INFERRED from the page script).
// gameCount (GameCountTips 轮回 popup) does NOT stop time: observed 09:12 → 09:02 with it open (s2-18).
const PLAYER_OWNER = 1, OTHER_OWNER = 2;

export function createPanels({layer, T, tables, mapGraph, hud, getSession, onAction}) {
  let frame = null, ready = false, current = null, ctx = {}, queue = [];

  const post = (type, data) => {
    if (!frame || !ready) { queue.push({type, data}); return; }
    frame.contentWindow.postMessage({type, data, sourcePageId: 'game'}, '*');
  };
  const postAll = (messages) => messages.forEach((m) => post(m.type, m.data));

  addEventListener('message', (event) => {
    if (!frame || event.source !== frame.contentWindow) return;
    const m = event.data;
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
    if (m.type === '__PAGE_READY__') {
      ready = true;
      const pending = queue; queue = [];
      pending.forEach((x) => post(x.type, x.data));
      return;
    }
    // SFX_* and CRAFT_SUCCESS/CRAFT_HIT_STOP style events are the pages' sound cues.
    if (m.type.startsWith('__') || m.type.startsWith('SFX_') || /^CRAFT_(SUCCESS|FAIL|HIT|HIT_STOP)$/.test(m.type) || m.type === 'ITEM_HOVER') return;
    try { handle(m.type, m.data ?? {}); } catch (error) { hud.log('面板事件处理失败：' + m.type + ' ' + error.message); }
  });

  const itemView = (it, extra = {}) => {
    const row = T.item.get(it.configId);
    const using = R.itemInUse(getSession().world, it.uid);
    return {itemId: it.uid, id: it.uid, cfgId: it.configId, x: it.x, y: it.y, w: it.w, h: it.h, icon: row?.WebIcon ?? '', name: row?.ItemName_Local ?? '',
      desc: (row?.ItemDes1_Local ?? '').replace(/\\n/g, '\n'), count: it.count, quality: 0, actionMark: using ? 2 : 0, canQuickUse: !!row?.UseAction && !row?.CantUse,
      useTimes: it.uses, useTimesMax: row?.UseTimes || 0, weight: (row?.weight ?? 0) / 1000, ...extra};
  };
  const player = () => getSession().world.bags.player;
  // Config weights are grams (Item.weight, Bag.Burden); the panels show kilograms.
  const weight = (bag) => R.bagWeight(T, bag) / 1000;
  const burden = (bag) => (bag.burden || 0) / 1000;
  // 「脚边」ground dock shared by BackpackUI/ToolTable/Cooking (webui-grounddock.js data:
  // {label, allText, groups:[{cfg,name,icon,w,h,count,heavy,ids}]}).
  function groundDockJson() {
    const piles = R.groundItems(getSession().world, getSession().scene);
    if (!piles.length) return '';
    const text = (id, fallback) => T.constant.get(id)?.Text_Local ?? fallback;
    return JSON.stringify({label: text('GroundDock_Label', '脚边'), allText: text('GroundDock_PickAll', '全拿'),
      groups: piles.map((g) => { const s = R.itemSize(T, g.configId); return {cfg: g.configId, name: T.item.get(g.configId)?.ItemName_Local ?? '', icon: T.item.get(g.configId)?.WebIcon ?? '', w: s.w, h: s.h, count: g.count, heavy: false, ids: [g.id]}; })});
  }
  function pickGround(ids) {
    const r = R.pickFromGround(getSession().world, T, player(), ids, getSession().scene);
    if (r.left) hud.toast(T.constant.get('ItemManager_BagNoSpace_0')?.Text_Local ?? '空间不足，无法放入');
    afterChange();
  }
  // GROUND_PICK {ids, all} / GROUND_PICK_TO {id, ownerId, x, y} from the 「脚边」dock; a
  // drop on the other grid (furniture bag) goes there, anything else into the player bag.
  function groundEvent(type, data) {
    if (type === 'GROUND_PICK') { pickGround((data.ids ?? []).map(Number)); return true; }
    if (type === 'GROUND_PICK_TO') {
      const to = (current === 'backpack' && data.ownerId === OTHER_OWNER && ctx.container) ? ctx.container : player();
      const r = R.pickGroundTo(getSession().world, T, to, Number(data.id), data.x, data.y, getSession().scene);
      if (r.left) hud.toast(T.constant.get('ItemManager_BagNoSpace_0')?.Text_Local ?? '空间不足，无法放入');
      afterChange();
      return true;
    }
    return false;
  }

  // ---- backpack ---------------------------------------------------------------
  function backpackMessages() {
    const w = getSession().world;
    const other = ctx.container;
    const out = [
      {type: 'WebUI_Backpack_InfoAMsg', data: {backpackName: player().name, ownerId: PLAYER_OWNER, gridCols: player().cols, gridRows: player().rows,
        currentWeight: weight(player()), maxWeight: burden(player()) || 100, overweightLine: (burden(player()) || 100) * 0.8, isDualBag: !!other, isPrologue: false}},
      {type: 'WebUI_Backpack_ItemsAMsg', data: {itemsJson: JSON.stringify(player().items.map((it) => itemView(it)))}},
    ];
    if (other) {
      out.push({type: 'WebUI_Backpack_InfoBMsg', data: {backpackName: other.name, ownerId: OTHER_OWNER, gridCols: other.cols, gridRows: other.rows, currentWeight: weight(other), maxWeight: burden(other),
        ...coldInfo(other)}});
      out.push({type: 'WebUI_Backpack_ItemsBMsg', data: {itemsJson: JSON.stringify(other.items.map((it) => itemView(it)))}});
    } else {
      out.push({type: 'WebUI_Backpack_InfoBMsg', data: {backpackName: '', ownerId: OTHER_OWNER, gridCols: 0, gridRows: 0}});
      out.push({type: 'WebUI_Backpack_ItemsBMsg', data: {itemsJson: '[]'}});
    }
    out.push({type: 'WebUI_Backpack_GroundDockMsg', data: {groundDockJson: groundDockJson()}});
    // Button and hint texts: the original C# fills these through LocalizationMsg; without it
    // the page showed bare arrows instead of 「全部取出 / 全部放入」 (compare-2026-10-23 #6).
    const c = (id, fb) => T.constant.get(id)?.Text_Local ?? fb;
    out.push({type: 'WebUI_Backpack_LocalizationMsg', data: {toSelfText: c('UI_BattleBag_0', '← 全部取出'), toOtherText: c('UI_BattleBag_1', '全部放入 →'),
      transferCategoryToSelfText: c('UI_BattleBag_2', '← 分类取出'), transferCategoryToOtherText: c('UI_BattleBag_3', '分类放入 →'),
      emptyTransferText: c('UI_BattleBag_4', '无可转移物品'), weightLabel: c('UI_BattleBag_5', '负重'), shelfLifeLabel: c('UI_BattleBag_6', '保质期'),
      dualBagHintText: c('UI_BattleBag_10', ''), singleBagHintText: c('UI_BattleBag_8', ''), quickUseHintText: c('SR_Web_BackpackUI_QuickUseHint', ''),
      sortBackpackText: c('UI_BattleBag_9', '一键整理'), discardAllText: c('SR_Web_BackpackUI_DiscardAll', '一键丢弃')}});
    void w;
    return out;
  }
  // Refrigerated containers (Furniture.ColdRate < 1, e.g. 双门冰箱 0.2): the original tints
  // the grid (isFreezing + isPowered) and shows 「冷冻中，物品剩余保存时间延长{0}倍」 with
  // {0} = 1 / ColdRate (observed 5× for the fridge, compare-2026-10-23 n24). There is no
  // power model in this build, so electrical fridges are treated as powered (INFERRED).
  function coldInfo(container) {
    const s = getSession();
    const owner = Object.values(s.furniture ?? {}).find((f) => f.container === container);
    const f = owner ? T.furniture.get(owner.furnitureId) : null;
    if (!f || !(f.ColdRate > 0 && f.ColdRate < 1)) return {isFreezing: false, isPowered: false};
    const text = (T.constant.get('FridgePowerOn')?.Text_Local ?? '冷冻中，物品剩余保存时间延长{0}倍').replace('{0}', String(Math.round(1 / f.ColdRate)));
    return {isFreezing: true, isPowered: true, bagTips: text, bagTipsColor: '#5aa6ff'};
  }
  const bagOf = (owner) => (owner === OTHER_OWNER ? ctx.container : owner === PLAYER_OWNER ? player() : null);

  function moveBetween(srcOwner, dstOwner, uid, x, y) {
    const from = bagOf(srcOwner);
    const session = getSession();
    if (!from) return;
    if (R.itemInUse(session.world, uid)) { hud.toast('正在使用中'); return; }
    if (!dstOwner) { // dropped outside the grids: it lands at the player's feet
      const it = from.items.find((i) => i.uid === uid);
      if (it && R.dropFromBag(session.world, from, uid, Infinity, session.scene)) hud.log((T.item.get(it.configId)?.ItemName_Local ?? '物品') + '：放在了脚边');
      return;
    }
    const to = bagOf(dstOwner);
    if (!to) return;
    const r = R.moveItem(session.world, T, from, to, uid, x, y);
    if (!r.ok) hud.toast(r.message);
  }

  // ---- crafting (ToolTable) ------------------------------------------------------
  function craftMessages() {
    const w = getSession().world;
    const recipes = C.craftRecipes(w, T, {extra: ctx.container ? [ctx.container] : []});
    // Sort craftable-first across the WHOLE list, then cap — slicing before sorting (the
    // old bug, #21) dropped craftable recipes past index 400 of 780.
    const shown = recipes.map((r) => {
      const product = T.item.get(r.products[0]);
      return {recipeKey: String(r.id), name: r.name, icon: product?.WebIcon ?? '', noteCategory: r.category, canCraft: r.canCraft, craftLocked: r.locked, isNew: false,
        materialsJson: JSON.stringify(r.materials.map((m) => ({name: m.name, icon: m.icon, have: m.have, need: m.need, hasEnough: m.have >= m.need}))),
        productDesc: product?.ItemDes1_Local ?? ''};
    });
    shown.sort((a, b) => Number(b.canCraft) - Number(a.canCraft));
    return [
      {type: 'WebUI_ToolTable_BagMsg', data: {bagOwnerId: PLAYER_OWNER, bagItems: player().items.map((it) => itemView(it)), bagCols: player().cols, bagRows: player().rows,
        workbenchOwnerId: OTHER_OWNER, workbenchItems: [], workbenchCols: 3, workbenchRows: 1, activeLeftTab: 0, cabinetTabs: []}},
      {type: 'WebUI_ToolTable_StatusMsg', data: {weightCurrent: weight(player()), weightMax: burden(player()) || 100, maxCraftCount: 9, craftBtnLocked: !ctx.recipeId,
        previewShow: !!ctx.recipeId, ...(ctx.recipeId ? previewOf(ctx.recipeId) : {})}},
      {type: 'WebUI_ToolTable_RecipeMsg', data: {show: true, recipes: shown, recentRecipeKeys: []}},
      {type: 'WebUI_ToolTable_GroundDockMsg', data: {groundDockJson: groundDockJson()}},
    ];
  }
  const previewOf = (id) => { const p = T.item.get(T.production.get(id)?.ProductID?.[0]); return {previewIcon: p?.WebIcon ?? '', previewName: p?.ItemName_Local ?? ''}; };

  // ---- cooking -------------------------------------------------------------------
  function cookingMessages() {
    const w = getSession().world;
    ctx.stove ??= R.createContainer(T, {id: 'stove', configId: 0, name: '灶台'});
    ctx.stove.cols = 3; ctx.stove.rows = 1;
    const recipes = C.cookingRecipes(w, T, ctx.stove.items).slice(0, 120).map((r) => {
      const p = T.item.get(r.product);
      return {recipeId: r.id, name: r.name, icon: p?.WebIcon ?? '', status: r.status, costText: (r.specific.length ? r.specific.map((id) => T.item.get(id)?.ItemName_Local) : r.tags.map((t) => '食材标签' + t)).join('|'),
        effectText: p?.ItemDes1_Local ?? '', craftLocked: false};
    });
    return [
      {type: 'WebUI_Cooking_BagMsg', data: {bagOwnerId: PLAYER_OWNER, workbenchOwnerId: OTHER_OWNER, bagItems: player().items.map((it) => itemView(it)), workbenchItems: ctx.stove.items.map((it) => itemView(it)),
        bagCols: player().cols, bagRows: player().rows, bagMaxCols: player().cols, bagMaxRows: player().rows, cookType: 1, powerCost: 0, batteryPercent: 100,
        workbenchCols: 3, workbenchRows: 1, maxFoodCount: 3, maxSeasoningCount: 2, fuelSlotCount: 0, fuelRate: 1, workbenchName: ctx.anchor?.name ?? '灶台', bagIsFreezing: false, workbenchIsFreezing: false}},
      {type: 'WebUI_Cooking_RecipeMsg', data: {recipes, unlockedCount: recipes.length, totalCount: T.raw.CookingRecipe.length}},
      {type: 'WebUI_Cooking_GroundDockMsg', data: {groundDockJson: groundDockJson()}},
    ];
  }

  // ---- shop ----------------------------------------------------------------------
  function shopMessages() {
    const w = getSession().world;
    const stock = C.shopStock(w, T, ctx.shopId) ?? [];
    return [
      {type: 'WebUI_Shop_BagInfoMsg', data: {shopName: T.shop.get(ctx.shopId)?.ShopName_Local ?? '交易', buyerId: PLAYER_OWNER, gridCols: player().cols, gridRows: player().rows,
        currentWeight: weight(player()), maxWeight: burden(player()) || 100, overweightLine: (burden(player()) || 100) * 0.8, playerGold: w.money, discountRate: 1}},
      {type: 'WebUI_Shop_BagItemsMsg', data: {itemsJson: JSON.stringify(player().items.map((it) => itemView(it, {sellPrice: C.sellPrice(T, it.configId)})))}},
      {type: 'WebUI_Shop_ShopItemsMsg', data: {itemsJson: JSON.stringify(stock.map((s) => {
        const sz = R.itemSize(T, s.id);
        return {itemConfigId: s.id, name: s.name, icon: s.icon, price: s.price, remain: s.remain, weight: (T.item.get(s.id)?.weight ?? 0) / 1000, w: sz.w, h: sz.h, demoLocked: false};
      }))}},
      {type: 'WebUI_Shop_CartSummaryMsg', data: {cartItemCount: 0, cartTotalPrice: 0}},
    ];
  }

  // ---- map ------------------------------------------------------------------------
  function mapMessages() {
    const s = getSession();
    const payload = exploreMapPayload(mapGraph, {mode: ctx.mode ?? 'explore', selectedId: ctx.selectedId ?? null,
      unlocked: new Set(S.unlockedPointIds(s, T)), visited: new Set(s.visited),
      constantText: tables.ConstantText, rawPoints: tables.MapPoint, itemName: (id) => T.item.get(id)?.ItemName_Local ?? String(id),
      entryHint: (id) => { const r = S.entryRequirement(s, T, id); return r.met ? '' : r.lacks.join('，'); }});
    return [{type: payload.type, data: payload.data}, ...payload.then];
  }

  // ---- event ----------------------------------------------------------------------
  // ctx.event is events.describe(): {type, title, text, icon, ok, choices:[{id,label,
  // enabled,reason,isDefault}], defaultChoice, countdown}. A Type-3 task shows 接受; its
  // options gate on the child NeedConditionSetId (CheckEventChoiceCondition).
  function eventMessages() {
    const e = ctx.event;
    const choice = e.choices.length > 0 && !ctx.result;
    const reward = ctx.result?.reward;
    const tag = e.type === 3 ? 'milestone' : '';
    return [
      {type: 'WebUI_EventChoice_Msg', data: {title: e.title, desc: ctx.result?.text ?? e.text, hasIcon: !!e.icon, iconUrl: e.icon, mode: choice ? 'choice' : 'result',
        okText: e.ok, countdown: choice ? e.countdown : 0, tagText: tag, viewOnly: false,
        rewardJson: JSON.stringify((reward?.gained ?? []).map((id) => ({icon: T.item.get(id)?.WebIcon ?? '', name: T.item.get(id)?.ItemName_Local ?? '', count: 1})))}},
      {type: 'WebUI_EventChoice_OptionMsg', data: {optionList: choice ? e.choices.map((c, i) => ({Index: i, Label: c.label, SubLabel: '', Enabled: c.enabled !== false, Reason: c.reason ?? '', IsDefault: c.isDefault || c.id === e.defaultChoice})) : []}},
    ];
  }

  // ---- result ---------------------------------------------------------------------
  // Rows use ConstantText SR_UI_GameResult_* templates ("生存天数：{0}天"); the page splits
  // label/value at the first colon. Which template the original fills per row is INFERRED.
  function resultMessages() {
    const w = getSession().world;
    const text = (id, ...args) => (tables.ConstantText.find((r) => r.ID === id)?.Text_Local ?? '').replace(/\{(\d)(:[^}]*)?\}/g, (_, i) => String(args[i] ?? ''));
    const clock = String(Math.floor(w.time.seconds / 3600)).padStart(2, '0') + ':' + String(Math.floor((w.time.seconds % 3600) / 60)).padStart(2, '0');
    return [{type: 'WebUI_GameResult_DataMsg', data: {deathTitle: ctx.title ?? '你死了',
      turnCountText: text('SR_UI_GameResult_2', ctx.days), dayTimeText: '死亡时间：第 ' + ctx.days + ' 天 ' + clock,
      totalPointsText: '生存点数：' + Math.round(w.survivalPoints), tipsText: ctx.text ?? '',
      isBtnStartGameVisible: true, isBtnEndGameVisible: true, isBtnHoldOutVisible: false, isBtnViewDossierVisible: false}}];
  }

  const BUILD = {backpack: backpackMessages, craft: craftMessages, cooking: cookingMessages, shop: shopMessages, map: mapMessages, event: eventMessages, result: resultMessages,
    confirm: confirmMessages, reward: rewardMessages, story: storyMessages, pause: pauseMessages,
    gameCount: () => [{type: 'WebUI_GameCountTips_UpdateMsg', data: {title: ctx.title ?? '', line0: ctx.line0 ?? '', line1: ctx.line1 ?? ''}}],
    plant: plantMessages, addFert: addFertMessages, plantDetails: plantDetailsMessages};

  // ---- planting pages (PlantPanel / AddFertilizer / PlantingDetails) ------------------
  // Field names are the pages' own (WebUI_PlantPanel_*Msg …). Values follow
  // Reducer_Web_PlantPanel.RecalcSelection (0x2B07120, static) and src/engine/planting.mjs.
  // ctx.furnitureKey selects the pot. Texts: ConstantText WebUI_<Page>_<n>.
  const ct = (page, n, fb = '') => T.constant.get('WebUI_' + page + '_' + n)?.Text_Local ?? fb;
  const potOf = () => getSession().furniture[ctx.furnitureKey];
  const ownedOf = (id) => R.countItem(player(), id);
  const iconOf = (id) => T.item.get(id)?.WebIcon ?? '';
  const hasStory = (id) => Boolean(T.item.get(id)?.Story);
  const distinct = (pred) => [...new Set(player().items.filter((it) => pred(T.item.get(it.configId))).map((it) => it.configId))];
  // Seeds: bag items with Item.Plant ≠ 0; fertilizers: Category 11 (AE_OpenAddFertilizer).
  const seedList = () => distinct((row) => row?.Plant);
  const fertList = () => distinct((row) => row?.Category === 11);
  function gainDesc(plant, n) {
    const fmt = T.constant.get('SR_Web_PlantPanel_GainItem')?.Text_Local ?? '{0}个{1}';
    const names = (ids) => { const m = new Map(); for (const id of ids ?? []) m.set(id, (m.get(id) ?? 0) + n); return [...m].map(([id, c]) => fmt.replace('{0}', c).replace('{1}', T.item.get(id)?.ItemName_Local ?? id)).join('、'); };
    const lines = [ct('PlantPanel', 37, '正常预计收获：') + names(plant.Gain)];
    if (plant.Perfect_Gain?.length) lines.push(ct('PlantPanel', 35, '有可能多产出（完美收获）：') + names(plant.Perfect_Gain));
    if (plant.Gain_Seed?.length) lines.push(ct('PlantPanel', 36, '有可能多产出（种子）：') + names(plant.Gain_Seed));
    return lines.join('\n');
  }
  function plantSelection() {
    const w = getSession().world, fs = potOf();
    const fp = P.potRow(T, fs?.furnitureId);
    const env = P.environment(w, T, fp);
    const seedItem = ctx.seeds?.[ctx.seedIndex], plant = seedItem ? P.plantRow(T, T.item.get(seedItem).Plant) : null;
    const fertItem = ctx.ferts?.[ctx.fertIndex] ?? 0;
    const need = plant ? P.requiredSeeds(plant, fp) : 0;
    const ok = plant ? P.envOk(env, plant) : {light: false, temp: false};
    const enough = plant ? need > 0 && ownedOf(seedItem) >= need : false;
    const cap = fp?.Capacity ?? 1;
    const missing = fertItem ? Math.max(0, cap - Math.min(ownedOf(fertItem), cap)) : 0;
    const expected = plant ? Math.trunc(P.growthTime(T, plant, fp, {fertItem, fertMissing: missing, w})) : 0;
    const tired = w.values.Stamina < P.actionCost(T);
    const L = (n, fb) => ct('PlantPanel', n, fb);
    const warning = !plant ? '' : need <= 0 ? L(32, '容器太小，无法容纳此植物') : !enough ? L(5, '种子数量太少，无法种植')
      : (!ok.light || !ok.temp) ? L(6, '环境不适宜，无法播种') : tired ? (T.constant.get('HandMadeComponent_0')?.Text_Local ?? '精力不足') : '';
    return {seedItem, plant, fertItem, env, fp, data: {selectedSeedIndex: ctx.seedIndex, selectedFertIndex: ctx.fertIndex, requiredSeedCount: need, isLightOk: ok.light, isTempOk: ok.temp,
      expectedGrowthSeconds: expected, canStartPlant: Boolean(plant) && enough && ok.light && ok.temp && !tired, warningText: warning,
      lightStatusText: plant ? (ok.light ? L(28, '光照充足') : L(21, '光照不足')) : '', tempStatusText: plant ? (ok.temp ? L(29, '温度适宜') : L(23, '温度过低')) : ''}};
  }
  function plantMessages() {
    const fs = potOf();
    const f = T.furniture.get(fs?.furnitureId);
    ctx.seeds = seedList(); ctx.ferts = fertList();
    ctx.seedIndex ??= -1; ctx.fertIndex ??= -1;
    const sel = plantSelection();
    const {env, fp} = sel;
    const L = (n, fb) => ct('PlantPanel', n, fb);
    return [
      {type: 'WebUI_PlantPanel_FacilityMsg', data: {facilityName: f?.Name_Local ?? '', facilityIcon: f?.ICON ?? '', facilityDesc: '', capacity: fp?.Capacity ?? 1,
        actualLight: env.light, coldStress: env.cold, weatherId: env.weather.ID, weatherName: env.weather.Name_Local, weatherLight: env.weather.LightValue, weatherColdBase: env.weather.ColdValue,
        areaId: env.areaId, areaName: env.area.Name_Local, roomBaseLight: env.weather.LightValue * env.lightMul, roomBaseHeat: env.areaTemp,
        facilityLightBonus: fp?.AddLight ?? 0, facilityHeatBonus: fp?.AddHeat ?? 0, electricLightBonus: 0, electricHeatBonus: 0, needPower: env.needPower, isPowerOn: env.powered,
        commitLightBonus: 0, commitHeatBonus: 0}},
      {type: 'WebUI_PlantPanel_SeedMsg', data: {seeds: ctx.seeds.map((id) => {
        const it = T.item.get(id), p = P.plantRow(T, it.Plant);
        return {itemConfigId: id, plantConfigId: it.Plant, name: it.ItemName_Local, icon: iconOf(id), ownedCount: ownedOf(id), plantSize: p?.Size ?? 1, lightNeed: p?.LightNeed ?? 0,
          coldResistance: p?.ColdResistance ?? 0, growthTime: p?.GrowthTime ?? 0, plantName: p?.Name_Local ?? '', plantDesc: (p?.Des_Local ?? '').replace(/\\n/g, '\n'),
          plantIcon: iconOf(p?.Gain?.[0]) || iconOf(id), gainDesc: p ? gainDesc(p, P.requiredSeeds(p, fp) || 1) : '', hasStory: hasStory(id), noBaseFert: false};
      })}},
      {type: 'WebUI_PlantPanel_FertMsg', data: {ferts: ctx.ferts.map((id) => ({itemConfigId: id, name: T.item.get(id).ItemName_Local, icon: iconOf(id), ownedCount: ownedOf(id),
        speedRate: T.item.get(id).Plant_Fast ?? 0, hasStory: hasStory(id)}))}},
      {type: 'WebUI_PlantPanel_SelectionMsg', data: sel.data},
      {type: 'WebUI_PlantPanel_LocalizationMsg', data: {titleText: L(0, '播种准备'), seedInfoLabel: L(1, '种子/底肥'), harvestLabel: L(3, '种植信息'), startBtnText: L(4, '开始种植'), startBtnKey: '',
        selectSeedLabel: L(7, '选择种子 (必需)'), emptySeedText: L(7, '选择种子 (必需)'), emptyFertText: L(8, '添加底肥 (可选)'), growthTimeLabel: L(13, '预计生长时间'),
        lightStatusLabel: L(15, '光照状态'), tempStatusLabel: L(16, '温度状态'), envLabel: L(25, '环境干预修正'), containerLabel: L(24, '种植容器'), capacityLabel: L(17, '种植空间'),
        needFillLabel: L(12, '需要'), currentLabel: L(11, '持有'), facilityLabel: L(27, '设施'), electricLabel: L(31, '电力'), powerOffLabel: L(31, '电力'), commitLabel: '',
        activeLabel: L(38, '生效中'), speedUpLabel: L(39, '生长速度提升'), fertShortText: ct('AddFertilizer', 13, '肥料数量不足'),
        noBaseFertText: T.constant.get('SR_Web_PlantPanel_NoBaseFert')?.Text_Local ?? ''}},
    ];
  }
  // AddFertilizer (mode 0 施肥): costCount = pot Capacity; newRemainSeconds = remain / (1 + s)
  // (PlantComponent.AddFertilizer divides the remaining time by 1 + Plant_Fast).
  function addFertMessages() {
    const w = getSession().world, fs = potOf();
    const fp = P.potRow(T, fs?.furnitureId), view = P.growthView(w, T, fs) ?? {remain: 0};
    ctx.ferts = fertList(); ctx.fertIndex ??= -1;
    const cap = fp?.Capacity ?? 1, id = ctx.ferts[ctx.fertIndex];
    const s = id ? T.item.get(id).Plant_Fast ?? 0 : 0;
    const L = (n, fb) => ct('AddFertilizer', n, fb);
    return [
      {type: 'WebUI_AddFertilizer_PlantInfoMsg', data: {mode: 0, plantName: P.plantRow(T, fs?.plant?.plantId)?.Name_Local ?? '', remainSeconds: Math.round(view.remain)}},
      {type: 'WebUI_AddFertilizer_FertMsg', data: {ferts: ctx.ferts.map((x) => ({itemConfigId: x, name: T.item.get(x).ItemName_Local, icon: iconOf(x), ownedCount: ownedOf(x), costCount: cap,
        speedRate: T.item.get(x).Plant_Fast ?? 0, hasStory: hasStory(x)}))}},
      {type: 'WebUI_AddFertilizer_SelectionMsg', data: {selectedFertIndex: ctx.fertIndex, newRemainSeconds: Math.round(view.remain / (1 + s)),
        canConfirm: Boolean(id) && ownedOf(id) >= cap && w.values.Stamina >= P.actionCost(T)}},
      {type: 'WebUI_AddFertilizer_LocalizationMsg', data: {titleText: L(0, '追肥'), cancelBtnText: L(1, '取消'), confirmBtnText: L(2, '确定'), clearText: L(3, '清空选择'), costLabel: L(4, '消耗'),
        currentLabel: L(9, '当前'), acceleratedLabel: L(10, '加速后'), activeLabel: L(6, '生效中'), speedUpLabel: L(7, '生长速度提升'), selectFertText: L(8, '选择肥料'),
        tillSoilTitle: L(11, '翻土作业'), tillSoilSelectText: L(12, '准备翻土（需要肥料）')}},
    ];
  }
  // PlantingDetails: status, progress / countdown and anomaly cards. The page draws icons
  // for frost / lightLow / pest only; weed and drought are listed without an icon.
  function plantDetailsMessages() {
    const w = getSession().world, fs = potOf(), p = fs?.plant;
    const plant = P.plantRow(T, p?.plantId), f = T.furniture.get(fs?.furnitureId);
    const view = P.growthView(w, T, fs) ?? {progress: 0, remain: 0, stalled: false, decayRemain: 0};
    const L = (n, fb) => ct('PlantingDetails', n, fb);
    const status = !p ? '' : p.state === P.PLANT_STATE.mature ? L(4, '成熟') : p.state === P.PLANT_STATE.withered ? L(5, '枯萎') : p.state === P.PLANT_STATE.poor ? L(6, '贫瘠')
      : view.stalled ? L(2, '停滞') : L(3, '生长中');
    const anomalies = [];
    const decay = Math.round(view.decayRemain ?? 0);
    if (p?.flags & P.ANOMALY.frost) anomalies.push({iconKey: 'frost', label: L(7, '寒冷'), isDanger: true, remainSeconds: decay});
    if (p?.flags & P.ANOMALY.lightLow) anomalies.push({iconKey: 'lightLow', label: L(8, '阳光不足'), isDanger: false, remainSeconds: 0});
    if (p?.flags & P.ANOMALY.pest) anomalies.push({iconKey: 'pest', label: L(9, '虫害'), isDanger: true, remainSeconds: decay});
    if (p?.flags & P.ANOMALY.weed) anomalies.push({iconKey: 'weed', label: '杂草', isDanger: false, remainSeconds: 0});
    if (p?.flags & P.ANOMALY.drought) anomalies.push({iconKey: 'drought', label: '干旱', isDanger: false, remainSeconds: 0});
    anomalies.forEach((a, i) => { a.Index = i; });
    return [
      {type: 'WebUI_PlantingDetails_InfoMsg', data: {containerName: f?.Name_Local ?? '', containerIcon: f?.ICON ?? '', plantName: plant?.Name_Local ?? '', plantIcon: iconOf(plant?.Gain?.[0]),
        statusText: status, isStalled: Boolean(view.stalled), growthProgress: view.progress, remainSeconds: Math.round(view.remain),
        effectiveTimeScale: R.gameRate(w, T), showEradicateBtn: p?.state === P.PLANT_STATE.growing || p?.state === P.PLANT_STATE.mature}},
      {type: 'WebUI_PlantingDetails_AnomalyMsg', data: {anomalies}},
      {type: 'WebUI_PlantingDetails_LocalizationMsg', data: {eradicateBtnText: L(0, '铲除植物'), confirmBtnText: L(1, '确定'), statusStallText: L(2), statusGrowingText: L(3),
        statusMatureText: L(4), statusWitheredText: L(5), statusPoorText: L(6)}},
    ];
  }
  function plantEvent(type, data) {
    const session = getSession();
    if (current === 'plant') {
      if (type === 'SELECT_SEED') { ctx.seedIndex = Number(data.index); refresh(); return true; }
      if (type === 'SELECT_FERT') { ctx.fertIndex = Number(data.index); refresh(); return true; }
      if (type === 'START_PLANT') {
        const sel = plantSelection();
        if (!sel.seedItem || !sel.data.canStartPlant) { if (sel.data.warningText) hud.toast(sel.data.warningText); return true; }
        const key = ctx.furnitureKey;
        close();
        const r = S.startPlantWork(session, T, key, {kind: 'sow', plantId: sel.plant.ID, seedItem: sel.seedItem, seedCount: sel.data.requiredSeedCount, fertItem: sel.fertItem});
        if (!r.ok) hud.toast(r.message);
        onAction('plant', r);
        return true;
      }
    }
    if (current === 'addFert') {
      if (type === 'SELECT_FERT') { ctx.fertIndex = Number(data.index); refresh(); return true; }
      if (type === 'CONFIRM') {
        const id = ctx.ferts?.[ctx.fertIndex], key = ctx.furnitureKey;
        if (!id) return true;
        close();
        const r = S.startPlantWork(session, T, key, {kind: 'fert', fertItem: id});
        if (!r.ok) hud.toast(r.message);
        onAction('plant', r);
        return true;
      }
    }
    if (current === 'plantDetails' && type === 'ERADICATE') {
      const key = ctx.furnitureKey;
      // 「确定要铲除当前植物吗？此操作不可撤销。」 (WebUI_PlantingDetails_10 / _11) first.
      open('confirm', {title: ct('PlantingDetails', 10, '提示'), body: ct('PlantingDetails', 11, '确定要铲除当前植物吗？此操作不可撤销。'), confirmText: ct('PlantingDetails', 1, '确定'),
        cancelText: ct('AddFertilizer', 1, '取消'),
        onConfirm: () => { const r = S.eradicatePlant(session, T, key); if (!r.ok) hud.toast(r.message); onAction('plant', r); }});
      return true;
    }
    return false;
  }

  // ---- confirm dialog (original ConfirmDialog page) --------------------------------
  // ctx: {title, body, confirmText, cancelText, dialogType, onConfirm, onCancel}.
  // dialogType follows ConfirmationDialogType (0 Ok_Cancel, 1 Ok; dump.cs).
  function confirmMessages() {
    return [{type: 'WebUI_ConfirmationDialog_UpdateMsg', data: {title: ctx.title ?? '', body: ctx.body ?? '', confirmText: ctx.confirmText ?? '确认',
      cancelText: ctx.cancelText ?? '', dialogType: ctx.dialogType ?? 0}}];
  }

  // ---- story popup (original TriggerUI page) ----------------------------------------
  // ctx: {story (Config_Story row), onConfirm, onClose}. Fields are those the page reads
  // (WebUI_TriggerUI_UpdateMsg: title, des1, des2, buttonText, imageUrl, showClose).
  // Config_Story.Icon 'Assets/RuntimeAssets/Texture/<dir>/<name>' maps to the exported
  // WebUI/Res/<dir>/<name>.webp (Story/1019, EventNew/044 …).
  function storyMessages() {
    const st = ctx.story ?? {};
    const m = /Texture\/([^/]+)\/([^/]+)$/.exec(st.Icon ?? '');
    const text = (v) => (v ?? '').replace(/\\n/g, '\n');
    return [{type: 'WebUI_TriggerUI_UpdateMsg', data: {title: st.StoryName_Local ?? '', des1: text(st.Des1_Local), des2: text(st.Des2_Local),
      buttonText: st.ButtonDes_Local || '确定', imageUrl: m ? '../../Res/' + m[1] + '/' + m[2] + '.webp' : '', showClose: true}}];
  }

  // ---- pause menu (original OutSetting page, ESC) -----------------------------------
  // Only the menu column is driven (BACK / SAVE_EXIT / OPEN_SETTINGS …). Texts come from
  // ConstantText where the page has an i18n hook; settings tabs are not reconstructed.
  function pauseMessages() {
    const t = (id, fb) => T.constant.get(id)?.Text_Local ?? fb;
    return [
      {type: 'WebUI_OutSetting_MenuMsg', data: {restartRoundVisible: false}},
      {type: 'WebUI_OutSetting_LocalizationMsg', data: {backText: t('SR_Web_OutSetting_0', '返回'), saveExitText: t('SR_Web_OutSetting_1', '保存并退出'),
        settingsText: t('SR_Web_OutSetting_Settings', '设置'), codexText: t('SR_Web_OutSetting_Codex', '图鉴'), achievementText: t('SR_Web_OutSetting_Achievement', '成就')}},
    ];
  }

  // ---- reward list (original RewardList page) ---------------------------------------
  // ctx: {variant: 'explore'|'addItem', title, desc, tone: 'success'|'fail', items: [{configId, count}], onClose}.
  function rewardMessages() {
    const items = (ctx.items ?? []).map((x) => ({icon: T.item.get(x.configId)?.WebIcon ?? '', name: T.item.get(x.configId)?.ItemName_Local ?? String(x.configId), count: x.count ?? 1}));
    return [{type: 'WebUI_RewardList_UpdateMsg', data: {variant: ctx.variant ?? 'addItem', title: ctx.title ?? '', desc: ctx.desc ?? '', tone: ctx.tone ?? '', note: ctx.note ?? '',
      itemsJson: JSON.stringify(items), hasItems: items.length > 0, listLabel: ctx.listLabel ?? '', emptyLabel: ctx.emptyLabel ?? '', confirmLabel: ctx.confirmLabel ?? '确认', autoClosing: false}}];
  }

  function refresh() { if (current && ready) postAll(BUILD[current]()); }
  function afterChange() { onAction('refresh'); refresh(); }

  function handle(type, data) {
    const session = getSession();
    const w = session.world;
    if (current === 'confirm' && (type === 'CONFIRM' || type === 'CANCEL')) {
      const done = type === 'CONFIRM' ? ctx.onConfirm : ctx.onCancel;
      close(); done?.();
      return;
    }
    if (current === 'reward' && type === 'CLOSE') { const done = ctx.onClose; close(); done?.(); return; }
    if (current === 'story' && (type === 'CONFIRM' || type === 'CLOSE')) {
      const done = type === 'CONFIRM' ? ctx.onConfirm : ctx.onClose;
      close(); done?.();
      return;
    }
    if (current === 'pause') {
      if (type === 'BACK' || type === 'ACTION_CLOSE' || type === 'CLOSE') { close(); return; }
      if (type === 'SAVE_EXIT') { close(); onAction('saveExit'); return; }
      if (type === 'SFX_PANEL_ENTER') return;
      hud.toast('网页版暂未实现：' + ({OPEN_SETTINGS: '设置', CODEX: '图鉴', ACHIEVEMENT: '成就'}[type] ?? type));
      return;
    }
    if (type === 'ACTION_CLOSE' || type === 'CLOSE') { close(); return; }
    if ((current === 'plant' || current === 'addFert' || current === 'plantDetails') && plantEvent(type, data)) return;
    if ((current === 'backpack' || current === 'craft' || current === 'cooking') && groundEvent(type, data)) return;
    if (current === 'backpack') {
      if (type === 'CLICK_ITEM') {
        const it = player().items.find((i) => i.uid === Number(data.itemId)) ?? ctx.container?.items.find((i) => i.uid === Number(data.itemId));
        if (!it) return;
        const fromPlayer = player().items.includes(it);
        if (!fromPlayer) { moveBetween(OTHER_OWNER, PLAYER_OWNER, it.uid); afterChange(); return; }
        const r = S.useItem(session, T, it.uid);
        hud.log((T.item.get(it.configId)?.ItemName_Local ?? '物品') + '：' + r.message);
        if (r.ok) { close(); onAction('used', {configId: it.configId}); } else hud.toast(r.message);
        return;
      }
      if (type === 'DRAG_ITEM') { moveBetween(data.srcOwnerId, data.dstOwnerId, Number(data.itemId), data.x, data.y); afterChange(); return; }
      if (type === 'QUICK_TRANSFER_ITEM') { const fromPlayer = player().items.some((i) => i.uid === Number(data.itemId)); moveBetween(fromPlayer ? PLAYER_OWNER : OTHER_OWNER, fromPlayer ? OTHER_OWNER : PLAYER_OWNER, Number(data.itemId)); afterChange(); return; }
      if (type === 'TRANSFER_TO_SELF' && ctx.container) { for (const it of [...ctx.container.items]) moveBetween(OTHER_OWNER, PLAYER_OWNER, it.uid); afterChange(); return; }
      if (type === 'TRANSFER_TO_OTHER' && ctx.container) { for (const it of [...player().items]) moveBetween(PLAYER_OWNER, OTHER_OWNER, it.uid); afterChange(); return; }
      if (type === 'DROP_ITEM') {
        // RA_DropItem: the item lands at the player's feet (「脚边」dock), never destroyed.
        const uid = Number(data.itemId);
        const bag = player().items.some((i) => i.uid === uid) ? player() : ctx.container;
        if (!bag) return;
        if (R.itemInUse(w, uid)) { hud.toast('正在使用中'); return; }
        R.dropFromBag(w, bag, uid, data.dropOne ? 1 : Infinity, session.scene);
        afterChange();
        return;
      }
    }
    if (current === 'craft') {
      if (type === 'RECIPE_CLICK') { ctx.recipeId = Number(data.recipeKey); refresh(); return; }
      if (type === 'CRAFT') {
        const r = C.craft(w, T, ctx.recipeId, {qty: data.qty || 1, extra: ctx.container ? [ctx.container] : []});
        hud.log(r.message);
        if (r.ok) {
          S.advanceSession(session, T, r.seconds);
          const p = r.products[0];
          post('WebUI_ToolTable_ResultMsg', {show: true, isSuccess: true, productIcon: p?.icon ?? '', productName: p?.name ?? '', productCount: r.made, resultText: r.message});
        } else hud.toast(r.message);
        afterChange();
        return;
      }
      if (type === 'RESULT_CONFIRM') { post('WebUI_ToolTable_ResultMsg', {show: false}); refresh(); return; }
      if (type === 'ITEM_MOVE') return;
    }
    if (current === 'cooking') {
      if (type === 'ITEM_MOVE') {
        const from = data.fromOwnerId === OTHER_OWNER ? ctx.stove : player();
        const to = data.toOwnerId === OTHER_OWNER ? ctx.stove : data.toOwnerId === PLAYER_OWNER ? player() : null;
        if (to) { const r = R.moveItem(w, T, from, to, Number(data.itemId), data.x, data.y); if (!r.ok) hud.toast(r.message); }
        refresh(); return;
      }
      if (type === 'RECIPE_CLICK') { ctx.recipeId = Number(data.recipeId); return; }
      if (type === 'START_COOK') {
        const match = ctx.recipeId ?? C.cookingRecipes(w, T, ctx.stove.items).find((r) => r.status === 2)?.id;
        const r = match ? C.cook(w, T, match, ctx.stove) : {ok: false, message: '没有匹配的菜谱'};
        hud.log(r.message);
        if (!r.ok) { hud.toast(r.message); post('WebUI_Cooking_CookingStateMsg', {isCooking: false}); return; }
        S.advanceSession(session, T, r.seconds);
        const p = T.item.get(r.product);
        post('WebUI_Cooking_CookingStateMsg', {isCooking: false});
        post('WebUI_Cooking_ResultMsg', {productsJson: JSON.stringify([{RecipeName: p?.ItemName_Local ?? '', Icon: p?.WebIcon ?? '', QualityTier: r.quality === 'Good' ? 2 : 3, CookingTier: 1}])});
        afterChange();
        return;
      }
      if (type === 'STOP_COOK') return;
    }
    if (current === 'shop') {
      if (type === 'BUY_SHOP_ITEM') { const r = C.buy(w, T, ctx.shopId, Number(data.itemConfigId)); hud.log(r.message); if (!r.ok) hud.toast(r.message); afterChange(); return; }
      if (type === 'CLICK_BAG_ITEM') { const r = C.sell(w, T, ctx.shopId, Number(data.itemId)); hud.log(r.message); if (!r.ok) hud.toast(r.message); afterChange(); return; }
      if (type === 'CHECKOUT' || type === 'CANCEL_BUY') return;
    }
    if (current === 'map') {
      if (type === 'SELECT_MAP') { ctx.selectedId = Number(data.configId); refresh(); return; }
      if (type === 'GO') {
        const list = mapMessages().find((m) => m.type === 'WebUI_ExploreMap_MapListMsg').data.mapList;
        const id = ctx.selectedId ?? list.find((m) => m.isActive)?.configId;
        const s = getSession();
        const name = tables.MapPoint.find((p) => p.ID === id)?.Name_Local ?? '目的地';
        // Lock state (UnlockTag) is the hard gate; the entry requirement (key card / day /
        // hours) is shown but not blocking in this build (ExploreManager.CanEnterMapPoint
        // does not enforce it; some key items are unobtainable here).
        const gate = S.canEnterPoint(s, T, id);
        if (!gate.ok) { hud.toast(name + '：' + gate.lacks.join('，')); return; }
        if (ctx.mode === 'trade') {
          const shelf = Number(tables.MapPoint.find((p) => p.ID === id)?.ShelfShopId);
          if (!shelf) { hud.toast('这个交易点没有货架'); return; }
          close(); open('shop', {shopId: shelf, tradePointId: id}); return;
        }
        // Exploration: only the exported scenes can actually be entered; the rest are
        // refused with a clear message rather than a 404 on a missing scene JSON.
        if (!S.sceneExported(id)) { hud.toast(name + '：场景暂未开放（网页版未导出）'); return; }
        close();
        onAction('travel', {mapPointId: id});
        return;
      }
    }
    if (current === 'event') {
      if (type === 'CHOOSE') {
        const choice = ctx.event.choices[data.index];
        if (!choice || choice.enabled === false) { if (choice?.reason) hud.toast(choice.reason); return; }
        const res = ctx.onResolve(ctx.event.id, choice.id ?? null);
        // A task accepted via a choice closes straight away (StartReward already paid).
        if (res.accepted) { const done = ctx.onDone; close(); done?.(res); return; }
        ctx.result = {text: res.followUp?.text || ctx.event.text, reward: res.reward};
        refresh();
        return;
      }
      if (type === 'CONFIRM' || type === 'TIMEEND') {
        let res = null;
        if (!ctx.result) {
          // TIMEEND picks the default option; CONFIRM on a choice-less event resolves it.
          const def = type === 'TIMEEND' ? (ctx.event.defaultChoice || null) : null;
          res = ctx.onResolve(ctx.event.id, def);
        }
        const done = ctx.onDone; close(); done?.(res); return;
      }
    }
    if (current === 'result') {
      if (type === 'START_GAME') { onAction('restart'); return; }
      if (type === 'END_GAME') { onAction('quit'); return; }
    }
    hud.log('面板事件未接入：' + current + ' · ' + type);
  }

  function open(name, options = {}) {
    if (!PAGES[name]) throw new Error('unknown panel ' + name);
    close();
    current = name; ctx = {...options}; ready = false; queue = [];
    frame = document.createElement('iframe');
    frame.src = PAGES[name];
    frame.className = 'webui-frame';
    frame.dataset.panel = name;
    layer.appendChild(frame);
    layer.classList.add('on');
    postAll(BUILD[name]());
  }
  function close() {
    // Ingredients left on the stove go back to the bag; what does not fit lands at the feet.
    if (current === 'cooking' && ctx.stove?.items.length) {
      const w = getSession().world;
      for (const it of [...ctx.stove.items]) if (!R.moveItem(w, T, ctx.stove, player(), it.uid).ok) R.dropFromBag(w, ctx.stove, it.uid, Infinity, getSession().scene);
    }
    frame?.remove();
    frame = null; ready = false; current = null; ctx = {}; queue = [];
    layer.classList.remove('on');
    // A click inside the page's iframe moved keyboard focus into it; removing the iframe
    // would leave the game without key events (E / B / ESC stopped working after a story).
    window.focus();
  }

  return {
    open, close, refresh, handle,
    isOpen: (name) => (name ? current === name : current !== null),
    current: () => current,
    ready: () => ready,
    blocksTime: () => current !== null && BLOCKS_TIME.has(current),
    context: () => ctx,
  };
}
