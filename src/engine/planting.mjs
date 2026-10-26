// Planting (种植) — pots, growth, anomalies, harvest. Rules follow the static native
// derivation in investigation/plant-native/README.md (GameAssembly.dll b0d29e5d…, offline
// disassembly; [S] = static derivation, [I] = inferred). Nothing here was observed running.
//
// Per-pot state lives in the furniture state (session.furniture[key].plant), mirroring
// PlantComponent: {state, plantId, seedCount, fertItem, fertMissing, start, cachedTime,
// flags, anyAnomaly, decayStart, stallStart, matureStart, nextCheck, pending}.
// Times are game seconds since the start of the save (world.time.total).
import * as R from './world-rules.mjs';

export const PLANT_STATE = Object.freeze({idle: 0, growing: 1, mature: 2, withered: 3, poor: 4});
// PlantAnomaly [Flags] (dump.cs).
export const ANOMALY = Object.freeze({pest: 1, weed: 2, drought: 4, lightLow: 8, lightHigh: 16, frost: 32, needFert: 256});
const LETHAL = ANOMALY.pest | ANOMALY.frost;           // decay countdown → Withered (AddAnomaly 0x2EE97B0)
const ROLLED = ANOMALY.pest | ANOMALY.weed | ANOMALY.drought;
const DAY = 86400;                                      // GameKey.GameTime_DayTime
const ENV_RECHECK = 600;                                // PlantComponent.ENV_RECHECK_INTERVAL_SEC
// Pot buttons by function id (IsFurnitureFuncVisible 0x2F37360 / EvaluatePlantOp 0x2EB8C00).
export const PLANT_FUNCS = Object.freeze({plant: 1610, fert: 1611, pest: 1613, weed: 1614, water: 1615, cleanup: 1616, harvest: 1617, till: 1618, eradicate: 1619});
// ApplyPlantPriority (0x2F25200) static order: the first visible one goes to the front.
const PRIORITY = [1613, 1614, 1615, 1617, 1616, 1618];

const g = (T, id, field = 'Params1', fallback = 0) => T.raw.GlobalSetting?.find((r) => r.ID === id)?.[field] ?? fallback;
export const plantRow = (T, id) => T.raw.Plant?.find((p) => p.ID === id) ?? null;
export const potRow = (T, furnitureId) => {
  const fid = T.furniture.get(furnitureId)?.PlantFurnitureID;
  return fid ? T.raw.FurniturePlant?.find((r) => r.ID === fid) ?? null : null;
};
export const isPot = (T, furnitureId) => Boolean(potRow(T, furnitureId));
export const actionCost = (T) => g(T, 'PlantActionCost', 'Params1', 5);
const now = (w) => w.time.total;
const prof = (w, T, field) => T.raw.PlantLv?.find((r) => r.Lv === R.proficiencyLevel(w, T, 'Plant'))?.[field] ?? 0;

export function plantState(fs) {
  fs.plant ??= {state: PLANT_STATE.idle, plantId: 0, seedCount: 0, fertItem: 0, fertMissing: 0, start: 0, cachedTime: 0, flags: 0, anyAnomaly: false,
    decayStart: 0, stallStart: 0, matureStart: 0, nextCheck: 0, lastEnvCheck: 0};
  return fs.plant;
}

// ---- environment (EvaluateEnvironment 0x2EEB080 [S]) -----------------------------------
// light = Weather.LightValue × EnvAreaWeather.LightMul + fp.AddLight (+ electric light when
// powered); cold = max(0, Weather.ColdValue − fp.AddHeat − areaTemp). Not modelled here:
// electric light/heat (no power system — electric pots count as unpowered), heat devices
// (SumDeviceHeat), the greenhouse commit bonus, talents. Every home pot is in area 1 室内
// (EnvAreaHelper.GetFurnitureAreaId falls back to 1; the real area comes from the slot's
// SlotComponent, not exported — INFERRED for the home slots).
export function currentWeather(w, T) {
  const day = w.time.day + 1, hour = Math.floor(w.time.seconds / 3600);
  const rows = T.raw.DailyWeather ?? [];
  const maxDay = rows.reduce((m, r) => Math.max(m, r.Day), 1);
  const d = ((day - 1) % maxDay) + 1;
  const id = rows.find((r) => r.Day === d && r.Hour === hour)?.WeatherID ?? 1;
  return T.raw.Weather?.find((r) => r.ID === id) ?? {ID: 1, Name_Local: '晴天', LightValue: 2, ColdValue: 0};
}
export function environment(w, T, fp, {areaId = 1} = {}) {
  const weather = currentWeather(w, T);
  const area = T.raw.EnvArea?.find((r) => r.ID === areaId) ?? {Name_Local: '室内'};
  const aw = T.raw.EnvAreaWeather?.find((r) => r.AreaID === areaId) ?? {LightMul: 1, TempAdd: 0};
  const powered = false;
  const eLight = fp?.NeedPower && powered ? fp.ElectricLight : 0, eHeat = fp?.NeedPower && powered ? fp.ElectricHeat : 0;
  const light = (weather.LightValue ?? 1) * (aw.LightMul ?? 1) + (fp?.AddLight ?? 0) + eLight;
  const cold = Math.max(0, (weather.ColdValue ?? 0) - (fp?.AddHeat ?? 0) - eHeat - (aw.TempAdd ?? 0));
  return {weather, area, areaId, light, cold, lightMul: aw.LightMul ?? 1, areaTemp: aw.TempAdd ?? 0, powered, needPower: Boolean(fp?.NeedPower)};
}
export const envOk = (env, plant) => ({light: env.light - (plant?.LightNeed ?? 0) >= 0, temp: env.cold <= (plant?.ColdResistance ?? 0)});

// ---- growth time (CalcActualGrowthTime 0x2EEA3E0 [S]) ----------------------------------
// T = GrowthTime / ((1 + facility) (1 + fert) (1 + prof)); fert = ratio × Plant_Fast,
// ratio = (Capacity − missing) / Capacity. Talent terms are 0 (no talents in this build).
export function growthTime(T, plant, fp, {fertItem = 0, fertMissing = 0, fertRateOverride = -1, w = null} = {}) {
  let fert = 0;
  if (fertRateOverride >= 0) fert = fertRateOverride;
  else if (fertItem > 0) {
    const cap = fp?.Capacity ?? 1;
    const ratio = cap <= 0 || cap - fertMissing >= cap ? 1 : Math.max(0, (cap - fertMissing) / cap);
    fert = ratio * (T.item.get(fertItem)?.Plant_Fast ?? 0);
  }
  const facility = fp?.NeedPower ? 0 : (fp?.GrowthFaster ?? 0); // unpowered electric pots get no bonus
  const p = w ? prof(w, T, 'growth_speed_bonus') : 0;
  const t = (plant?.GrowthTime ?? 0) / ((1 + facility) * (1 + fert) * (1 + p));
  return t > 0 ? t : 1;
}
export const requiredSeeds = (plant, fp) => Math.floor((fp?.Capacity ?? 1) / Math.max(1, plant?.Size ?? 1));

// ---- lifecycle tick (Plant_GrowingState / Plant_MatureState Update [S]) -----------------
// Called with the world time after each advance step. Returns events for the runtime.
export function tickPlant(w, T, fs, {areaId = 1} = {}) {
  const p = fs.plant;
  if (!p) return [];
  const out = [];
  const t = now(w);
  const plant = plantRow(T, p.plantId);
  const fp = potRow(T, fs.furnitureId);
  if (p.state === PLANT_STATE.growing && plant) {
    // anomaly rolls: one per 24 h of non-stalled growth, max 7 catch-ups (TryAnomalyCheckTick)
    if (!p.nextCheck) p.nextCheck = t + DAY;
    let n = 0;
    while (!(p.flags & ROLLED) && t >= p.nextCheck && n < 7) {
      p.nextCheck += DAY; n += 1;
      const added = rollAnomaly(w, T, p, plant, fp, t);
      if (added) out.push({type: 'plant-anomaly', anomaly: added});
    }
    // Environment: rechecked when the weather changes (Furniture.OnWeatherChangedForPlant)
    // and every 600 s while LightLow/Frost is set (MaybeRecheckEnvironment). Not at sowing.
    const weatherId = currentWeather(w, T).ID;
    if (p.weatherId === undefined) p.weatherId = weatherId;
    if (weatherId !== p.weatherId) { p.weatherId = weatherId; checkEnvironment(w, T, fs, {areaId}); }
    else if ((p.flags & (ANOMALY.lightLow | ANOMALY.frost)) && t - (p.lastEnvCheck ?? 0) >= ENV_RECHECK) checkEnvironment(w, T, fs, {areaId});
    if (!p.flags) {
      const progress = Math.min((t - p.start) / (p.cachedTime || 1), 1);
      if (progress >= 1) { p.state = PLANT_STATE.mature; p.matureStart = t; out.push({type: 'plant-mature'}); }
    } else if ((p.flags & LETHAL) && p.decayStart > 0 && t - p.decayStart >= (plant.DecayTime || DAY)) {
      toWithered(p); out.push({type: 'plant-withered', reason: 'decay'});
    }
  } else if (p.state === PLANT_STATE.mature && plant) {
    if (plant.HarvestTime > 0 && t - p.matureStart >= plant.HarvestTime) { toWithered(p); out.push({type: 'plant-withered', reason: 'timeout'}); }
  }
  return out;
}
function toWithered(p) { p.state = PLANT_STATE.withered; p.flags = 0; p.decayStart = 0; p.stallStart = 0; p.matureStart = 0; }

// CheckPlantAnomalies (0x2EEAA60 [S]): p_X = max(0, 1 − pest_rate_reduction) × max(0, plant.X
// + fp.XControl); normalised when the sum exceeds 1; one draw, at most one anomaly.
function rollAnomaly(w, T, p, plant, fp, t) {
  const red = Math.max(0, 1 - prof(w, T, 'pest_rate_reduction'));
  const ctl = fp?.NeedPower ? {PestControl: 0, WeedControl: 0, DryControl: 0} : fp ?? {};
  let pp = red * Math.max(0, plant.Pest + (ctl.PestControl ?? 0));
  let pw = red * Math.max(0, plant.Weed + (ctl.WeedControl ?? 0));
  let pd = red * Math.max(0, plant.Dry + (ctl.DryControl ?? 0));
  const sum = pp + pw + pd;
  if (sum <= 0) return 0;
  if (sum > 1) { pp /= sum; pw /= sum; pd /= sum; }
  const r = R.rand(w);
  const type = r < pp ? ANOMALY.pest : r < pp + pw ? ANOMALY.weed : r < pp + pw + pd ? ANOMALY.drought : 0;
  if (type) addAnomaly(p, type, t);
  return type;
}
function addAnomaly(p, type, t) {
  if (!p.flags) p.stallStart = t;
  p.flags |= type;
  p.anyAnomaly = true;
  if ((type & LETHAL) && !p.decayStart) p.decayStart = t;
}
// ClearAnomaly (0x2EEAE60 [S]): stall time is added to start and nextCheck when the last flag goes.
function clearAnomaly(p, type, t) {
  if (!(p.flags & type)) return;
  p.flags &= ~type;
  if (!(p.flags & LETHAL)) p.decayStart = 0;
  if (!p.flags && p.stallStart) { const d = t - p.stallStart; p.start += d; p.nextCheck += d; p.stallStart = 0; }
}
// CheckEnvironmentAnomalies (0x2EEA760 [S]): Growing only; LightLow stalls, Frost is lethal.
export function checkEnvironment(w, T, fs, {areaId = 1} = {}) {
  const p = fs.plant;
  if (!p || p.state !== PLANT_STATE.growing) return;
  const plant = plantRow(T, p.plantId);
  const env = environment(w, T, potRow(T, fs.furnitureId), {areaId});
  const ok = envOk(env, plant);
  const t = now(w);
  p.lastEnvCheck = t;
  if (!ok.light) addAnomaly(p, ANOMALY.lightLow, t); else clearAnomaly(p, ANOMALY.lightLow, t);
  if (!ok.temp) addAnomaly(p, ANOMALY.frost, t); else clearAnomaly(p, ANOMALY.frost, t);
}

// ---- buttons (visibility by state, priority order) -----------------------------------
export function funcVisible(fs, funcId) {
  const p = fs.plant ?? {state: PLANT_STATE.idle, flags: 0};
  switch (funcId) {
    case PLANT_FUNCS.plant: return p.state === PLANT_STATE.idle;
    case PLANT_FUNCS.fert: return p.state === PLANT_STATE.growing && !(p.fertItem > 0);
    case PLANT_FUNCS.pest: return p.state === PLANT_STATE.growing && Boolean(p.flags & ANOMALY.pest);
    case PLANT_FUNCS.weed: return p.state === PLANT_STATE.growing && Boolean(p.flags & ANOMALY.weed);
    case PLANT_FUNCS.water: return p.state === PLANT_STATE.growing && Boolean(p.flags & ANOMALY.drought);
    case PLANT_FUNCS.cleanup: return p.state === PLANT_STATE.withered;
    case PLANT_FUNCS.harvest: return p.state === PLANT_STATE.mature;
    case PLANT_FUNCS.till: return p.state === PLANT_STATE.poor;
    case PLANT_FUNCS.eradicate: return p.state === PLANT_STATE.growing || p.state === PLANT_STATE.mature;
    default: return true;
  }
}
// EvaluatePlantOp (0x2EB8C00) + stamina: may this pot function start now?
export function canRun(w, T, fs, funcId) {
  if (!funcVisible(fs, funcId)) return {ok: false, message: '当前状态无法执行'};
  if (w.values.Stamina < actionCost(T)) return {ok: false, message: T.constant.get('HandMadeComponent_0')?.Text_Local ?? '精力不足'};
  return {ok: true};
}
export function isPlantFunc(id) { return Object.values(PLANT_FUNCS).includes(id); }
export function sortByPriority(buttons) {
  const first = PRIORITY.find((id) => buttons.some((b) => b.id === id));
  if (first === undefined) return buttons;
  const i = buttons.findIndex((b) => b.id === first);
  return [buttons[i], ...buttons.slice(0, i), ...buttons.slice(i + 1)];
}

// ---- actions ---------------------------------------------------------------------------
const bagsOf = (w) => [w.bags.player];
const owned = (w, id) => R.countItem(w.bags.player, id);
function staminaOk(w, T) { return w.values.Stamina >= actionCost(T); }
function pay(w, T) { R.changeAttribute(w, T, 'Stamina', -actionCost(T)); }
function take(w, id, n) { let left = n; for (const it of [...w.bags.player.items]) { if (!left) break; if (it.configId === id) left -= R.removeItem(w.bags.player, it.uid, left); } return n - left; }

// PlantPanel START_PLANT → SetPendingPlant + action 1611 「正在种植」 900 s (OnPlantPanelStartPlant).
export function setPendingPlant(fs, {plantId, seedItem, seedCount, fertItem}) {
  plantState(fs).pending = {kind: 'sow', plantId, seedItem, seedCount, fertItem: fertItem || 0};
}
// AddFertilizer CONFIRM → pending fertilize work, also on action 1611 (OnAddFertilizerConfirm).
export function setPendingFert(fs, fertItem) { plantState(fs).pending = {kind: 'fert', fertItem}; }

// Effect 18 Default_PlantSeed (action 1611 end): AE_ConfirmPlantSeed / AE_AddFertilizer.
export function completeWork(w, T, fs) {
  const p = plantState(fs);
  const job = p.pending;
  p.pending = null;
  if (!job) return {ok: false, message: '没有待执行的种植'};
  const fp = potRow(T, fs.furnitureId);
  if (job.kind === 'sow') {
    if (p.state !== PLANT_STATE.idle || owned(w, job.seedItem) < job.seedCount) return {ok: false, message: '种子不足或花盆不空'};
    pay(w, T);
    take(w, job.seedItem, job.seedCount);
    let fert = job.fertItem, missing = 0;
    if (fert > 0) {
      const cap = fp?.Capacity ?? 1;
      const use = Math.min(owned(w, fert), cap);
      if (use <= 0) fert = 0; else { take(w, fert, use); missing = cap - use; }
    }
    const plant = plantRow(T, job.plantId);
    Object.assign(p, {state: PLANT_STATE.growing, plantId: job.plantId, seedCount: job.seedCount, fertItem: fert, fertMissing: fert > 0 ? missing : 0,
      start: now(w), flags: 0, anyAnomaly: false, decayStart: 0, stallStart: 0, matureStart: 0, nextCheck: now(w) + DAY, lastEnvCheck: 0, weatherId: currentWeather(w, T).ID});
    p.cachedTime = growthTime(T, plant, fp, {fertItem: fert, fertMissing: p.fertMissing, w});
    return {ok: true, message: '种下了 ' + (plant?.Name_Local ?? ''), sown: true};
  }
  if (job.kind === 'fert') return addFertilizer(w, T, fs, job.fertItem);
  return {ok: false, message: ''};
}

// AE_AddFertilizer.Run (0x2FB9B70) / AddFertilizer (0x2EE9950) [S]: needs Capacity units;
// growing and not yet fertilised; progress is kept, the remaining time is divided by (1 + s).
export function addFertilizer(w, T, fs, fertItem) {
  const p = plantState(fs);
  const fp = potRow(T, fs.furnitureId);
  const cap = fp?.Capacity ?? 1;
  if (p.state !== PLANT_STATE.growing || p.fertItem > 0) return {ok: false, message: '无法施肥'};
  if (owned(w, fertItem) < cap) return {ok: false, message: T.constant.get('WebUI_AddFertilizer_13')?.Text_Local ?? '肥料数量不足'};
  pay(w, T);
  take(w, fertItem, cap);
  const s = T.item.get(fertItem)?.Plant_Fast ?? 0;
  const t = now(w);
  const elapsed = t - p.start;
  p.start = t - Math.trunc(elapsed / (1 + s));
  p.fertItem = fertItem; p.fertMissing = 0;
  p.cachedTime = growthTime(T, plantRow(T, p.plantId), fp, {fertRateOverride: s, w});
  return {ok: true, message: '施肥：' + (T.item.get(fertItem)?.ItemName_Local ?? '')};
}

// Care actions run their 300 s action, then this (AE_CurePlantAnomaly / Cleanup / Harvest /
// TillSoil / Eradicate). Each costs PlantActionCost stamina.
export function completeCare(w, T, fs, effectName) {
  const p = plantState(fs);
  const t = now(w);
  const plant = plantRow(T, p.plantId);
  const cure = {'Action/Default_CurePest': ANOMALY.pest, 'Action/Default_CureWeed': ANOMALY.weed, 'Action/Default_Water': ANOMALY.drought}[effectName];
  if (cure) {
    if (p.state !== PLANT_STATE.growing || !(p.flags & cure)) return {ok: false, message: ''};
    pay(w, T); clearAnomaly(p, cure, t);
    return {ok: true, message: {1: '除虫完成', 2: '除草完成', 4: '浇水完成'}[cure]};
  }
  if (effectName === 'Action/Default_CleanupPlant') {
    if (p.state !== PLANT_STATE.withered) return {ok: false, message: ''};
    pay(w, T);
    const gained = [], dropped = [];
    for (let i = 0; i < (p.seedCount || 1); i++) for (const id of plant?.WitheredGain ?? []) give(w, T, id, gained, dropped);
    reset(p);
    return {ok: true, message: '清理了枯萎的植物', gained, dropped};
  }
  if (effectName === 'Action/Default_HarvestPlant') {
    if (p.state !== PLANT_STATE.mature) return {ok: false, message: ''};
    pay(w, T);
    return harvest(w, T, p, plant);
  }
  if (effectName === 'Action/Default_TillSoil') {
    if (p.state !== PLANT_STATE.poor) return {ok: false, message: ''};
    pay(w, T); reset(p);
    return {ok: true, message: '翻土完成'};
  }
  if (effectName === 'Action/Default_EradicatePlant') {
    if (p.state !== PLANT_STATE.growing && p.state !== PLANT_STATE.mature) return {ok: false, message: ''};
    pay(w, T); reset(p);
    return {ok: true, message: '铲除了植物'};
  }
  return {ok: false, message: ''};
}
function reset(p) { Object.assign(p, {state: PLANT_STATE.idle, plantId: 0, seedCount: 0, fertItem: 0, fertMissing: 0, start: 0, cachedTime: 0, flags: 0, decayStart: 0, stallStart: 0, matureStart: 0, nextCheck: 0, pending: null}); }
function give(w, T, id, gained, dropped) {
  R.addItem(w, T, w.bags.player, id, 1, {overflow: true});
  for (let k = 0; k < R.addItem.last.added; k++) gained.push(id);
  for (let k = 0; k < R.addItem.last.dropped; k++) dropped.push(id);
}

// RollYield (0x2FC19B0) / ApplyHarvestMorale (0x2FBF0C0) / SettleHarvest (0x2FC2970) [S]:
// n × Gain always; per seed a perfect roll (Perfect_Rate + PlantLv.perfect_grow_rate) adds
// Perfect_Gain; per seed a seed roll (Seed_Rate) adds Gain_Seed; +2 morale on any perfect
// hit; Plant exp RoundToInt(HarvestExp) (+ Discovery_Exp the first time a crop is
// harvested — once-only is INFERRED); the pot goes to Poor (needs 翻土重置). Rare/flower seed
// discovery and talent bonuses are not modelled.
function harvest(w, T, p, plant) {
  const n = Math.max(1, p.seedCount);
  const gained = [], dropped = [];
  let perfect = 0, seeds = 0;
  for (let i = 0; i < n; i++) for (const id of plant?.Gain ?? []) give(w, T, id, gained, dropped);
  const rate = (plant?.Perfect_Rate ?? 0) + prof(w, T, 'perfect_grow_rate');
  if (plant?.Perfect_Gain?.length && rate > 0) for (let i = 0; i < n; i++) if (R.rand(w) < rate) { perfect += 1; for (const id of plant.Perfect_Gain) give(w, T, id, gained, dropped); }
  if (plant?.Gain_Seed?.length) {
    const sr = Math.min(1, plant.Seed_Rate ?? 0);
    for (let i = 0; i < n; i++) if (R.rand(w) < sr) { seeds += 1; for (const id of plant.Gain_Seed) give(w, T, id, gained, dropped); }
  }
  const morale = perfect > 0 ? g(T, 'Plant_Harvest_Perfect_Morale', 'Params2', 2) : g(T, 'Plant_Harvest_Morale', 'Params2', 0);
  if (morale) R.changeAttribute(w, T, 'Morale', morale);
  w.plantDiscovered ??= [];
  const first = plant && !w.plantDiscovered.includes(plant.ID);
  if (first) w.plantDiscovered.push(plant.ID);
  const exp = Math.round(plant?.HarvestExp ?? 0) + (first ? plant?.Discovery_Exp ?? 0 : 0);
  if (exp) R.addProficiencyExp(w, T, 'Plant', exp);
  // TransitionToPoor (0x2EEE460): every plant field zeroed, state Poor.
  reset(p);
  p.state = PLANT_STATE.poor;
  return {ok: true, message: '收获了 ' + (plant?.Name_Local ?? ''), gained, dropped, perfect, seeds, morale, exp, harvested: true};
}

// ---- views for the panels / HUD -------------------------------------------------------
export function growthView(w, T, fs) {
  const p = fs.plant;
  if (!p || !p.plantId) return null;
  const t = now(w);
  const stalledFor = p.flags && p.stallStart ? t - p.stallStart : 0;
  const elapsed = Math.max(0, t - p.start - stalledFor);
  const total = p.cachedTime || 1;
  const progress = p.state === PLANT_STATE.growing ? Math.min(elapsed / total, 1) : p.state === PLANT_STATE.mature ? 1 : 0;
  const stage = progress >= 1 ? 3 : progress >= 0.5 ? 2 : progress >= 0.15 ? 1 : 0; // GetStageForProgress
  const plant = plantRow(T, p.plantId);
  const model = p.state === PLANT_STATE.withered ? plant?.Modle5 : plant?.['Modle' + (stage + 1)];
  return {progress, stage, remain: p.state === PLANT_STATE.growing ? Math.max(0, total - elapsed) : 0, total, model: model?.split('/').pop() ?? null,
    stalled: p.state === PLANT_STATE.growing && Boolean(p.flags), decayRemain: (p.flags & LETHAL) && p.decayStart ? Math.max(0, (plant?.DecayTime || DAY) - (t - p.decayStart)) : 0,
    harvestRemain: p.state === PLANT_STATE.mature ? Math.max(0, (plant?.HarvestTime ?? 0) - (t - p.matureStart)) : 0};
}
// PlantHudStatus (CoreUI1): 0 Growing 1 Mature 2 Withered 3 Pest 4 Frost 5 Weed 6 Drought 7 LightLow.
export function hudStatus(fs) {
  const p = fs.plant;
  if (!p) return null;
  if (p.state === PLANT_STATE.mature) return 1;
  if (p.state === PLANT_STATE.withered) return 2;
  if (p.state !== PLANT_STATE.growing) return null;
  if (p.flags & ANOMALY.pest) return 3;
  if (p.flags & ANOMALY.frost) return 4;
  if (p.flags & ANOMALY.weed) return 5;
  if (p.flags & ANOMALY.drought) return 6;
  if (p.flags & ANOMALY.lightLow) return 7;
  return 0;
}
