// Crafting, cooking, trading and building (M7). Pure functions over the world state
// from world-rules.mjs; containers are world-rules bags.
//
// Evidence: recipe rows, materials, products, cook times, prices and removal returns
// come from config (Config_ProductionList / CookingRecipe / Shop / Item / Furniture).
// The matching and pricing rules marked INFERRED are readings of those fields; the
// native craft/cook/shop controllers are not reconstructed (see m7-core.md).
import * as R from './world-rules.mjs';

const count = (ids) => ids.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map());

// Items available to a recipe: the player bag plus any extra containers (workbench).
function pool(state, extra = []) { return [state.bags.player, ...extra]; }
function have(bags, id) { return bags.reduce((s, b) => s + R.countItem(b, id), 0); }
function take(bags, id, n) {
  for (const b of bags) {
    for (const it of [...b.items]) {
      if (!n) return;
      if (it.configId === id) n -= R.removeItem(b, it.uid, n);
    }
  }
}

// ---- crafting (Config_ProductionList) ------------------------------------------
// A recipe is listed when IsUseable and its show_level <= the player's craft level
// (craft level starts at 1; INFERRED from show_level/craft_level distributions, most
// rows are 0/1). It can be crafted when craft_level <= level and every MaterialList
// entry is present (multiset).
export function craftRecipes(state, T, {level = R.proficiencyLevel(state, T, 'Production'), extra = []} = {}) {
  const bags = pool(state, extra);
  const out = [];
  for (const r of T.raw.ProductionList ?? []) {
    if (!r.IsUseable) continue;
    if ((r.show_level ?? 0) > level) continue;
    const need = count(r.MaterialList ?? []);
    const materials = [...need].map(([id, n]) => ({id, need: n, have: have(bags, id), name: T.item.get(id)?.ItemName_Local ?? String(id), icon: T.item.get(id)?.WebIcon ?? ''}));
    const enough = materials.every((m) => m.have >= m.need);
    out.push({id: r.ID, name: r.ShopName_Local, category: r.NoteCategory ?? 0, products: r.ProductID ?? [], materials,
      canCraft: enough && (r.craft_level ?? 0) <= level, locked: (r.craft_level ?? 0) > level});
  }
  return out;
}

// Consumes materials, adds products to the player bag and reports the time spent.
// Products that do not fit go to the floor (ToolTableManager.CollectBatchProducts →
// DropItemManager.DropItemFromBag, text ToolTable_59「放不下的成品放在了脚边」), so a full
// bag never destroys materials.
export function craft(state, T, recipeId, {qty = 1, extra = []} = {}) {
  const r = T.production.get(recipeId);
  if (!r) return {ok: false, message: '配方不存在'};
  if (state.action) return {ok: false, message: '正在行动'};
  const recipe = craftRecipes(state, T, {extra}).find((x) => x.id === recipeId);
  if (!recipe?.canCraft) return {ok: false, message: r.ShopName_Local + '：材料不足'};
  const bags = pool(state, extra);
  let made = 0, dropped = 0;
  for (let i = 0; i < qty; i++) {
    if (!recipe.materials.every((m) => have(bags, m.id) >= m.need)) break;
    for (const m of recipe.materials) take(bags, m.id, m.need);
    for (const id of r.ProductID ?? []) { R.addItem(state, T, state.bags.player, id, 1, {overflow: true}); dropped += R.addItem.last.dropped; }
    made += 1;
  }
  // Craft duration: one game minute per LifeMin point is INFERRED; the runtime
  // advances the clock by `seconds`.
  const minutes = (r.LifeMin || 30) * made;
  const note = dropped ? '（' + (T.constant.get('ToolTable_59')?.Text_Local ?? '放不下的成品放在了脚边') + '）' : '';
  return {ok: true, message: '制作了 ' + r.ShopName_Local + (made > 1 ? ' ×' + made : '') + note, made, dropped, seconds: minutes * 60,
    products: (r.ProductID ?? []).map((id) => ({id, name: T.item.get(id)?.ItemName_Local, icon: T.item.get(id)?.WebIcon}))};
}

// ---- cooking (Config_CookingRecipe) ---------------------------------------------
// Ingredients are the items in the stove container. Matching is a MULTISET test
// (Furniture.TryEvaluateRecipeMatchInternal RVA 0x2F4EE20, static): the stove is tallied
// into configId→count (CountMaterialsInternal 0x2F2F6E0) and FoodTag1..3→count; a recipe
// matches when either its SpecificItems multiset (checked first) or its TagCombo multiset
// (HasSufficientCountsInternal 0x2F35D70: every required count ≤ the stove's) is covered.
// So 清炒时蔬 (TagCombo [5,5]) needs two tag-5 items — one energy drink (one tag 5) fails.
// Quality (CookingProductIndex.GetQuality): Normal; more ingredients than the recipe needs
// give Good/Perfect (INFERRED). Config_CookingRecipe has no CanCook field. MinLevel ≤ level.
const countTags = (ids, T) => ids.reduce((m, id) => {
  const it = T.item.get(id);
  for (const t of [it?.FoodTag1, it?.FoodTag2, it?.FoodTag3]) if (t) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}, new Map());
const covers = (need, have) => { for (const [k, n] of need) if ((have.get(k) ?? 0) < n) return false; return true; };

export function cookingRecipes(state, T, ingredients, {level = R.proficiencyLevel(state, T, 'Cooking')} = {}) {
  const ids = ingredients.map((i) => i.configId);
  const itemCounts = count(ids);
  const tagCounts = countTags(ids, T);
  const out = [];
  for (const r of T.raw.CookingRecipe ?? []) {
    if ((r.MinLevel ?? 0) > level) continue;
    let status = 0;
    if (r.SpecificItems?.length) {
      const need = count(r.SpecificItems);
      status = covers(need, itemCounts) ? 2 : ([...need.keys()].some((id) => itemCounts.has(id)) ? 1 : 0);
    } else if (r.TagCombo?.length) {
      const need = count(r.TagCombo);
      status = covers(need, tagCounts) ? 2 : ([...need.keys()].some((t) => tagCounts.has(t)) ? 1 : 0);
    }
    if (!status && (r.show_level ?? 0) > 1) continue;
    out.push({id: r.ID, name: r.RecipeName_Local, status, cookTime: r.CookTime, product: r.NormalItemID, tags: r.TagCombo, specific: r.SpecificItems});
  }
  return out.sort((a, b) => b.status - a.status || a.id - b.id);
}

export function cook(state, T, recipeId, stove) {
  const r = T.recipe.get(recipeId);
  if (!r) return {ok: false, message: '菜谱不存在'};
  const options = cookingRecipes(state, T, stove.items);
  const match = options.find((o) => o.id === recipeId);
  if (!match || match.status !== 2) return {ok: false, message: r.RecipeName_Local + '：食材不符'};
  const used = stove.items.length;
  const quality = used > Math.max(r.TagCombo?.length ?? 0, r.SpecificItems?.length ?? 0) + 1 ? 'Good' : 'Normal';
  const product = quality === 'Good' ? r.GoodItemID : r.NormalItemID;
  stove.items = [];
  // The dish goes to the player bag (dishes are often 2×2 and do not fit the stove grid);
  // when the bag is full it is left at the player's feet (Cooking page ground dock).
  R.addItem(state, T, state.bags.player, product, 1, {overflow: true});
  const dropped = R.addItem.last.dropped;
  return {ok: true, message: '做好了 ' + (T.item.get(product)?.ItemName_Local ?? r.RecipeName_Local) + (dropped ? '（背包放不下，放在了脚边）' : ''), product, quality, dropped, seconds: r.CookTime || 0};
}

// ---- trading (Config_Shop at trade map points; Config_MapPoint.ShelfShopId) -------
// Stock = ItemIdList/ItemCountList. Buy price = Item.price (INFERRED: the shop's
// DiscountRate is 0 for all trade shops). Sell price = price × TradeSellRate when set,
// else × 0.5 (INFERRED).
export function shopStock(state, T, shopId) {
  state.shops ??= {};
  const shop = T.shop.get(shopId);
  if (!shop) return null;
  state.shops[shopId] ??= {remain: Object.fromEntries((shop.ItemIdList ?? []).map((id, i) => [id, shop.ItemCountList?.[i] ?? 1]))};
  return (shop.ItemIdList ?? []).map((id) => ({id, name: T.item.get(id)?.ItemName_Local ?? String(id), icon: T.item.get(id)?.WebIcon ?? '',
    price: buyPrice(T, id), remain: state.shops[shopId].remain[id] ?? 0}));
}
export const buyPrice = (T, id) => Math.max(1, Math.round(T.item.get(id)?.price ?? 1));
export const sellPrice = (T, id) => { const it = T.item.get(id); return Math.max(0, Math.floor((it?.price ?? 0) * (it?.TradeSellRate > 0 ? it.TradeSellRate : 0.5))); };

export function buy(state, T, shopId, itemId, n = 1) {
  const stock = shopStock(state, T, shopId)?.find((s) => s.id === itemId);
  if (!stock) return {ok: false, message: '商店没有这件商品'};
  if (stock.remain < n) return {ok: false, message: '库存不足'};
  const cost = stock.price * n;
  if (state.money < cost) return {ok: false, message: '钱不够（需要 ' + cost + '）'};
  // Room is checked for the whole quantity before paying (ItemManager_BagNoSpace_0).
  if (R.capacityFor(T, state.bags.player, itemId, n) < n) return {ok: false, message: T.constant.get('ItemManager_BagNoSpace_0')?.Text_Local ?? '空间不足，无法放入'};
  R.addItem(state, T, state.bags.player, itemId, n);
  state.money -= cost;
  state.shops[shopId].remain[itemId] -= n;
  return {ok: true, message: '买下 ' + stock.name + ' ×' + n + '（-' + cost + '）', cost};
}

export function sell(state, T, shopId, uid) {
  const it = state.bags.player.items.find((i) => i.uid === uid);
  if (!it) return {ok: false, message: '物品不存在'};
  if (R.itemInUse(state, uid)) return {ok: false, message: '正在使用中，不能卖'};
  const price = sellPrice(T, it.configId);
  if (price <= 0) return {ok: false, message: '对方不收这个'};
  R.removeItem(state.bags.player, uid, 1);
  state.money += price;
  shopStock(state, T, shopId);
  state.shops[shopId].remain[it.configId] = (state.shops[shopId].remain[it.configId] ?? 0) + 1;
  return {ok: true, message: '卖出 ' + T.item.get(it.configId)?.ItemName_Local + '（+' + price + '）', price};
}

// ---- building (Furniture.RemoveFunc / RemoveGet; Item.TargetFurnitureID) ----------
// Demolish (FurnitureFunc 299, Action 199 Furniture_Bar_Demolish, EDisableFurniture):
// on completion the furniture is gone and RemoveGet materials drop at its place
// (AE_DropFurnitureRemoveGet); they go into the player bag when there is room and stay
// on the floor otherwise.
export function removeGet(state, T, furnitureId) {
  const got = [];
  for (const id of T.furniture.get(furnitureId)?.RemoveGet ?? []) {
    R.addItem(state, T, state.bags.player, id, 1, {overflow: true});
    if (R.addItem.last.added) got.push(id);
  }
  return got;
}
// Install from a package item (Install_BagFurniture): consumes the item, returns the
// furniture id to place. Placement position is chosen by the runtime.
export function install(state, T, uid) {
  const it = state.bags.player.items.find((i) => i.uid === uid);
  const target = it && T.item.get(it.configId)?.TargetFurnitureID;
  if (!target) return {ok: false, message: '这不是可安装的家具包裹'};
  R.removeItem(state.bags.player, uid, 1);
  return {ok: true, furnitureId: target, message: '安装了 ' + (T.furniture.get(target)?.Name_Local ?? target)};
}
