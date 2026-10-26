// Full-game runtime (M6–M8): loads scenes from world/scenes/*.json, drives the general
// rules engine (src/engine/world-rules.mjs + session.mjs), and bridges the original
// WebUI panels. The prologue room (world/index.html) keeps the native-derived probe.
import * as THREE from 'three';
import {fetchScene, loadScene, createCutaway, placeModel} from '../engine/world/scene-loader.mjs';
import {loadModel} from '../engine/world/assets.mjs';
import * as P from '../src/engine/planting.mjs';
import {createNavigator} from '../engine/world/navigation.mjs';
import {createPlayer} from '../engine/world/player.mjs';
import {loadCharacter} from '../engine/world/character.mjs';
import * as R from '../src/engine/world-rules.mjs';
import * as S from '../src/engine/session.mjs';
import {createPanels} from './panels.mjs';
import {createGameHud} from './hud.mjs';
import {createEvents} from '../src/engine/events.mjs';
import {createAudio} from './audio.mjs';
import {createNpcs} from './npc.mjs';
import {createPerf} from './perf.mjs';
import {createWorldUi} from './world-ui.mjs';
import {openOverlay, closeOverlay, post as postOverlay, overlayOpen} from './overlay.mjs';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
// The random/task event system is switched off by default at the user's request
// (2026-10-23): no daily rolls, no popups, no task tracker. ?events=1 turns it back on.
const EVENTS_ON = params.get('events') === '1';
const SAVE_KEY = 'survival-log/game-save/v1';
const INTERACT_RADIUS = 1.4;

const hud = createGameHud();
const perf = createPerf();
const loading = document.getElementById('loading');
const setLoading = (on, text = '', progress = 0) => {
  loading.classList.toggle('on', on);
  loading.querySelector('.text').textContent = text;
  loading.querySelector('.bar i').style.width = Math.round(progress * 100) + '%';
};
setLoading(true, '加载配置', 0.05);

const TABLES = ['Item', 'Action', 'Effect', 'Buff', 'Furniture', 'FurnitureFunc', 'ConditionSet', 'RewardSet', 'Bag', 'PlayAttribute', 'Chapter',
  'RandomGroup', 'CookingRecipe', 'ProductionList', 'Shop', 'Event', 'Story', 'DeathInfo', 'Player', 'PlayerSelect', 'GlobalSetting', 'MapPoint',
  'ConstantText', 'GuidanceNpc', 'Instance', 'EventLog', 'BlackScreen', 'Weather', 'DailyWeather', 'ItemSubCategory',
  'Package', 'ProductionLv', 'CookingLv', 'PlantLv', 'TrapLv', 'ExploreLv', 'DefenseLv', 'SlotType',
  'ThinkTime', 'ThinkActionType', 'ThinkExplore', 'DifficultyPreset', 'Plant', 'FurniturePlant', 'EnvArea', 'EnvAreaWeather'];
const t0 = performance.now();
const tables = Object.fromEntries(await Promise.all(TABLES.map(async (n) => [n, await (await fetch('../data/Config_' + n + '.json')).json()])));
const T = R.indexTables(tables);
const mapGraph = await (await fetch('../data/map-graph.json')).json();
perf.mark('tables', performance.now() - t0);

// ---- renderer ---------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({antialias: true, stencil: true}); // stencil: hover outline (world-ui.mjs)
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Neutral tone mapping keeps the albedo hues of the original textures (ACES pushed the
// cream plaster toward grey-brown); warm sky/ground and sun approximate the original's
// warm interior look (screenshot comparison, investigation/home-look/; INFERRED values).
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

const scene3 = new THREE.Scene();
scene3.background = new THREE.Color('#0b0e0b');
const hemi = new THREE.HemisphereLight('#fff1dc', '#6b5a44', 1.6);
scene3.add(hemi);
const sun = new THREE.DirectionalLight('#fff0d8', 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, {left: -14, right: 14, top: 14, bottom: -14, near: 0.5, far: 80});
scene3.add(sun, sun.target);

// Camera: original Chapter.FollowPos is a per-chapter camera offset (e.g. [4.96, 8, -6.65]);
// mapped into the x-negated frame it becomes (-x, y, z). Perspective FOV is INFERRED.
// Near plane 0.5 m: the follow camera is never closer than ~6 m to the floor, and a 0.1 m
// near plane wasted depth precision there, so floor decals, carpets and rugs lying a few
// millimetres above the floor flickered against it (z-fighting; reported 2026-10-23).
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.5, 400);
let followOffset = new THREE.Vector3(-3, 5, -4);
let zoom = 1.6;
const camTarget = new THREE.Vector3();
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
addEventListener('wheel', (e) => { zoom = THREE.MathUtils.clamp(zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.8, 3.5); }, {passive: true});
const cutaway = createCutaway();
const worldUi = createWorldUi({camera, scene3, layer: document.getElementById('world-ui')});

// Camera mode (original CoreUI0 CAMERA_MODE button 「视角切换 · 跟随主角 ↔ 自由观察」, hint
// SR_Web_CoreUI1_19 「[WASD] 移动镜头 [空格] 镜头跟随」; observed s2-05..s2-09): WASD pans the
// camera away from the character, space or the button returns it to following.
let camFollow = true;
const panKeys = new Set();

// ---- session ----------------------------------------------------------------
let session = null;
let loadedFromSave = false;
const saved = params.get('new') ? null : localStorage.getItem(SAVE_KEY);
if (saved && !params.get('scene')) {
  try { session = S.upgradeSession(S.loadSession(saved), T); loadedFromSave = true; hud.log('已读取存档'); } catch (error) { hud.log('存档不可用：' + error.message); }
}
if (!session) {
  session = S.createSession(T, {startScene: Number(params.get('scene') || 1)});
  // Web-build deviation (user request 2026-10-26): a new game starts with one 启程种植礼盒
  // (Item 12700 → Package 30002: 普通小型花盆包裹, six seed kinds ×4, 基础肥料 ×1) in the
  // backpack, since the post-disaster web build has no seed source yet. Not in the original's
  // starting inventory.
  R.addItem(session.world, T, session.world.bags.player, 12700, 1);
}
if (params.get('scene')) session.scene = Number(params.get('scene'));
// With events off, the door's「出门探索」(func 1002, VisibilityConditionSetId 1028 =
// tag CanExplore) could never appear: the only grant is task event 10350「探索工具」(day 7,
// RewardSet 6080). Grant the tag directly instead (deviation from the original's pacing).
if (!EVENTS_ON) R.addTag(session.world, 'CanExplore');

const resIndex = await (await fetch('../data/res-index.json')).json();
const events = createEvents(T, tables, resIndex);
const audio = createAudio();
const panels = createPanels({layer: document.getElementById('ui-layer'), T, tables, mapGraph, hud, getSession: () => session, onAction: handlePanelAction});

let current = null;   // loaded scene handle
let loadedAt = 0;
let navigator = null;
let player = null;
let character = null;
let npcs = null;
let pendingAnchor = null;
let paused = false;
let gameSpeed = 1;
const anchorByObject = new Map();

// While a scene loads the game is held: no clock, events, walking or autosave, and the
// session already describes where the player will stand once it is loaded (the target
// scene, at the given position, the saved one for the same scene, or the spawn). A save
// in that window can no longer pair the new scene with the old coordinates
// (review-2026-10-22 #20).
let sceneLoading = false;
async function enterScene(id, {position = null} = {}) {
  const from = current?.desc.id ?? null;
  sceneLoading = true;
  session.scene = id;
  session.world.scene = id;
  if (position) session.position = position;
  else if (from !== null && from !== id) session.position = null;
  setLoading(true, '加载场景', 0.1);
  const started = performance.now();
  if (current) { current.dispose(); npcs?.dispose(); }
  const desc = await fetchScene(id, '../world/scenes/');
  // Furniture moved in plan mode stands on its new slot (S.startMove → state.moved).
  desc.anchors = desc.anchors.map((a) => { const m = S.furnitureState(session, id, a).moved; return m ? {...a, anchor: m.node, x: m.x, y: m.y, z: m.z, unityYawDeg: m.yaw} : a; });
  if (planMode) exitPlan();
  current = await loadScene(desc, {cutaway, base: '../world/', anchorFilter: (a) => !S.furnitureState(session, id, a).removed && S.guidanceVisible(session, a),
    onProgress: (p, label) => setLoading(true, '加载 ' + desc.name + ' · ' + label, 0.1 + p * 0.85)});
  scene3.add(current.group);
  await addHomeFurniture(id);
  anchorByObject.clear();
  for (const a of current.anchors) if (a.object) anchorByObject.set(a.object, a);
  plantVisuals.clear();
  await syncPlants();
  navigator = createNavigator({bounds: current.bounds, solids: current.solids, grid: current.grid});
  navigator.buildOccupancy();
  const want = session.position ?? desc.spawn ?? {x: (desc.bounds.minX + desc.bounds.maxX) / 2, z: (desc.bounds.minZ + desc.bounds.maxZ) / 2};
  const spawn = navigator.blocked(want.x, want.z) ? navigator.findSpawn(want) : want;
  if (!player) {
    player = createPlayer({scene: scene3, navigator, spawn});
    try { character = await loadCharacter('../world/assets/character.glb'); player.attachCharacter(character.root); } catch (e) { hud.log('角色模型加载失败：' + e.message); }
  } else {
    player.setNavigator(navigator);
    player.teleport(spawn.x, spawn.z);
  }
  const chapter = T.chapter.get(desc.id >= 1000 ? desc.id : session.world.chapterId);
  if (chapter?.FollowPos) followOffset = new THREE.Vector3(-chapter.FollowPos[0], chapter.FollowPos[1], chapter.FollowPos[2]);
  camTarget.set(spawn.x, 0, spawn.z);
  npcs = await createNpcs({scene3, desc, T, tables, session, hud, loadCharacter});
  session.position = {x: spawn.x, z: spawn.z};
  hud.setScene(desc.name);
  syncSideButtons();
  audio.playScene(desc, session);
  perf.mark('scene-' + id, performance.now() - started);
  loadedAt = performance.now();
  sceneLoading = false;
  setLoading(false);
  hud.log('进入 ' + desc.name);
}

// ---- interaction ------------------------------------------------------------
function anchorAt(event) {
  const pointer = new THREE.Vector2((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(pointer, camera);
  const objects = current.anchors.filter(interactive).map((a) => a.object);
  const hit = ray.intersectObjects(objects, true)[0];
  if (hit) {
    let node = hit.object;
    while (node && !anchorByObject.has(node)) node = node.parent;
    if (node) return {anchor: anchorByObject.get(node)};
  }
  const npcHit = npcs?.pick(ray);
  if (npcHit) return {npc: npcHit};
  const ground = new THREE.Vector3();
  if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ground)) return {ground};
  return null;
}

function approachPoint(box) {
  const cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2;
  const gap = navigator.playerRadius + 0.3;
  const at = player.position();
  const candidates = [
    {x: cx, z: box.maxZ + gap}, {x: cx, z: box.minZ - gap}, {x: box.minX - gap, z: cz}, {x: box.maxX + gap, z: cz},
    {x: box.minX - gap, z: box.minZ - gap}, {x: box.maxX + gap, z: box.maxZ + gap}, {x: box.minX - gap, z: box.maxZ + gap}, {x: box.maxX + gap, z: box.minZ - gap},
  ].filter((p) => !navigator.blocked(p.x, p.z));
  candidates.sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z));
  return candidates[0] ?? navigator.findSpawn({x: cx, z: cz});
}

function distanceTo(box) {
  const p = player.position();
  return Math.hypot(Math.max(box.minX - p.x, 0, p.x - box.maxX), Math.max(box.minZ - p.z, 0, p.z - box.maxZ));
}

// An anchor the player can click or press E on: drawn, not demolished, not hidden by a
// story reward. Door parcels have no furniture state of their own.
function interactive(a) {
  if (!a.object) return false;
  if (a.parcel) return true;
  return !S.furnitureState(session, session.scene, a).removed && S.guidanceVisible(session, a);
}

function nearestAnchor() {
  let best = null, bestD = INTERACT_RADIUS;
  for (const a of current?.anchors ?? []) {
    if (!a.box || !interactive(a)) continue;
    const d = distanceTo(a.box);
    if (d < bestD && (a.parcel || T.furniture.get(a.id)?.FurnitureFunc?.length || storyOf(a))) { bestD = d; best = a; }
  }
  return best;
}

// A furniture's story (Config_Furniture.Story) can be read until it is completed
// (Furniture.GetValidStoryId: active stories only; PromptTriggerManager.OnStoryCompleted
// moves it to the completed list). Stories with IsActivated false wait for ActiveStory.
function storyOf(anchor) {
  const id = T.furniture.get(anchor.id)?.Story;
  const story = id ? T.story.get(id) : null;
  if (!story || S.storyCompleted(session, id)) return null;
  // Config_Story.Stage: 1 before the disaster, 2 after, -1 always (INFERRED from the
  // original pre-disaster home: 钥匙 Stage 1 and 便签 Stage -1 popped, 房门 Stage 2 did not;
  // compare-2026-10-23 n22/n72/n75).
  const post = (T.chapter.get(session.world.chapterId)?.WorldStateType ?? 2) === 2;
  if (story.Stage === 1 && post) return null;
  if (story.Stage === 2 && !post) return null;
  if (!story.IsActivated && !(session.world.activeStories ?? []).includes(id)) return null;
  return story;
}

// The original shows a furniture's unread Story first (TriggerUI popup, e.g. 冰箱 → 便签,
// 钥匙 → 拿起); its function bar appears only on the next interaction once the story is
// done. ✕ closes the popup without completing the story (observed: closing the key popup
// with ✕ left the key on the table; compare-2026-10-23 n72/n73). Furniture with no
// visible function and no story shows nothing (observed: bed/wardrobe/stove pre-disaster).
function openFurniture(anchor) {
  if (anchor.parcel) { openParcel(anchor); return; }
  const story = storyOf(anchor);
  if (story) { readStory(anchor, story); return; }
  const buttons = S.buttonsFor(session, T, session.scene, anchor);
  // A pot with a plant but nothing to do (growing, already fertilized, no anomaly) opens the
  // original PlantingDetails page instead. No direct caller of Ac_PlantingDetails_Open was
  // found in GameAssembly.dll, so when the original opens it is INFERRED.
  const plant = S.furnitureState(session, session.scene, anchor).plant;
  if (!buttons.length && plant && plant.state !== P.PLANT_STATE.idle) { openPlantDetails(anchor); return; }
  if (!buttons.length) return;
  menuAnchor = anchor;
  hud.showMenu(anchor, buttons, (button) => runButton(anchor, button), screenOf(anchor));
}
let menuAnchor = null;

// ---- planting visuals ----------------------------------------------------------
// The plant on a pot is the Config_Plant stage model (Modle1–4 by growth stage 0–3, Modle5
// when withered; PlantComponent visual swap) placed on the pot's PlantPos point, read from
// the pot prefab (world/assets/plant-points.json; P_FlowerPot_006_S1_M04 → Small_a01, y
// 0.4357). A pot holds one plant point per seed slot; the home 花盆 has Capacity 1.
let plantPoints = null;
const plantVisuals = new Map(); // anchor key -> {model, object}
async function syncPlants() {
  if (!current) return;
  plantPoints ??= await (await fetch('../world/assets/plant-points.json')).json().catch(() => ({}));
  const seen = new Set();
  for (const a of current.anchors) {
    if (!a.object || !P.isPot(T, a.id)) continue;
    const key = S.furnitureKey(session.scene, a);
    const fs = session.furniture[key];
    const view = fs?.plant && fs.plant.state !== P.PLANT_STATE.idle && fs.plant.state !== P.PLANT_STATE.poor ? P.growthView(session.world, T, fs) : null;
    const want = view?.model ?? null;
    const had = plantVisuals.get(key);
    if (had && had.model === want && had.object.parent) { seen.add(key); continue; }
    had?.object.removeFromParent();
    plantVisuals.delete(key);
    if (!want) continue;
    const obj = await loadModel(want, '../world/assets/').catch(() => null);
    if (!obj) continue;
    // The plant is a child of the pot model (clicks / hover on it select the pot). The
    // prefab-local point goes into the exported frame, where x is negated.
    const pt = plantPoints?.[a.model]?.[0] ?? {x: 0, y: 0.4, z: 0};
    obj.position.set(-pt.x, pt.y, pt.z);
    obj.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
    a.object.add(obj);
    plantVisuals.set(key, {model: want, object: obj});
    seen.add(key);
  }
  for (const [key, v] of plantVisuals) if (!seen.has(key)) { v.object.removeFromParent(); plantVisuals.delete(key); }
}
// Stage changes happen between events (progress 0.15 / 0.5): resync every few seconds.
let plantSyncAt = 0;

function openPlantDetails(anchor) {
  panels.open('plantDetails', {furnitureKey: S.furnitureKey(session.scene, anchor)});
}

// Where the original floats a furniture's bar: its name just above the furniture (centre
// top) and the button row to the LEFT of the furniture at about half its height (observed
// n52 小纸箱, n76 房门). Returns the projected screen box of the furniture: {x, y} = top
// centre, left / midY for the bar.
function screenOf(anchor) {
  const b = anchor.box;
  const y0 = b.minY ?? 0, y1 = b.maxY ?? 1;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const x of [b.minX, b.maxX]) for (const y of [y0, y1]) for (const z of [b.minZ, b.maxZ]) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight;
    left = Math.min(left, sx); right = Math.max(right, sx); top = Math.min(top, sy); bottom = Math.max(bottom, sy);
  }
  const t = new THREE.Vector3((b.minX + b.maxX) / 2, y1, (b.minZ + b.maxZ) / 2).project(camera);
  return {x: (t.x + 1) / 2 * innerWidth, y: (1 - t.y) / 2 * innerHeight, left, right, top, midY: (top + bottom) / 2};
}

function readStory(anchor, story) {
  if (!story) return;
  panels.open('story', {story, onClose: () => {}, onConfirm: () => {
    const r = S.completeStory(session, T, story.ID);
    events.onStory(session, story.ID);
    if (r.money) hud.log(story.StoryName_Local + '：+' + r.money + ' 元');
    if (r.gained?.length) hud.log(story.StoryName_Local + '：获得 ' + r.gained.map((id) => T.item.get(id)?.ItemName_Local).join('、'));
    if (r.dropped?.length) hud.toast(constant('ToolTable_59', '放不下的东西放在了脚边'));
    if (story.StoryThink_Local) worldUi.say(story.StoryThink_Local);
    syncGuidance();
  }});
}

// Shows/hides anchors after RewardSet Show/HideGuidanceFurnitureID (e.g. the wallet is
// gone once its story is read; Story_1001 shows the old photo frame).
async function syncGuidance() {
  for (const a of [...current.anchors]) {
    if (a.parcel || typeof a.guidanceId !== 'number') continue;
    const fs = S.furnitureState(session, session.scene, a);
    const visible = S.guidanceVisible(session, a) && !fs.removed;
    if (a.object && !visible) { refreshFurniture(a); a.hidden = true; continue; }
    if (!a.object && a.hidden && visible && !fs.disabled) {
      const {object: _o, box: _b, solid: _s, hidden: _h, point: _p, ...plain} = a;
      current.anchors[current.anchors.indexOf(a)] = plain;
      const rec = await placeModel(current, plain, {base: '../world/'});
      if (rec.object) anchorByObject.set(rec.object, rec);
    }
  }
  navigator.buildOccupancy();
}

function runButton(anchor, button) {
  if (!button.enabled) { hud.toast(button.label + '：' + (button.lacks.join('，') || '条件未满足')); return; }
  const result = S.runFunction(session, T, session.scene, anchor, button.id);
  hud.log(anchor.name + ' · ' + button.label + '：' + result.message);
  if (!result.ok) { hud.toast(result.message); return; }
  audio.playFunction(button.id, T);
  if (result.removed) { refreshFurniture(anchor); if (R.groundItems(session.world).length) hud.toast('里面的东西放在了脚边'); return; }
  if (result.open) {
    const o = result.open;
    if (o.panel === 'shop' && !o.shopId) { hud.toast('这个货架还没接入商店'); }
    else panels.open(o.panel, {container: o.container, anchor, furnitureId: anchor.id, shopId: o.shopId, mode: o.mode, furnitureKey: o.furnitureKey});
  }
  if (result.during) audio.playAction(session.world.action?.actionId, T);
  if (result.travel) openMap(result.travel);
  afterAction();
}

function refreshFurniture(anchor) {
  if (!anchor.object) return;
  anchor.object.removeFromParent();
  anchorByObject.delete(anchor.object);
  const at = anchor.solid ? current.solids.indexOf(anchor.solid) : -1;
  if (at >= 0) current.solids.splice(at, 1);
  anchor.object = null;
  anchor.box = null;
  anchor.solid = null;
  navigator.buildOccupancy();
}

function afterAction() {
  for (const a of current.anchors) {
    if (!a.object || a.parcel) continue;
    // Demolished (Furniture_Bar_Demolish completed) or hidden by a reward: no longer drawn.
    if (S.furnitureState(session, session.scene, a).removed || !S.guidanceVisible(session, a)) { refreshFurniture(a); continue; }
    if (S.furnitureState(session, session.scene, a).disabled && T.furniture.get(a.id)?.FurnitureFunc?.every((id) => T.func.get(id)?.FuncType === 2)) {
      // EDisableFurniture (e.g. 回收 a newspaper pile): the furniture is consumed.
      if ((T.effect.get(T.action.get(T.func.get(T.furniture.get(a.id).FurnitureFunc[0])?.ActionIds?.[0])?.EffectConfigID) ?? {}).EDisableFurniture) refreshFurniture(a);
    }
  }
}

// ---- furniture parcels and installed furniture (home) -------------------------------
// Door parcels stand on the home 'HomePackage' points (scene desc.packages) with the
// target's BagResName box model; installed furniture stands on its Config_MapSlot node.
// Both are added to the scene handle as anchors so walking, picking and E work as usual.
async function addHomeFurniture(sceneId) {
  if (!S.isHomeScene(session, T, sceneId) || !current.desc.packages?.length) return;
  S.placeParcels(session, current.desc.packages, session.position ?? current.desc.spawn);
  for (const parcel of session.parcels) {
    const node = current.desc.packages.find((n) => n.node === parcel.point);
    if (node) await addParcelAnchor(parcel, node);
  }
  for (const placed of session.placed.filter((x) => x.scene === sceneId)) await addPlacedAnchor(placed);
  // (demolished installed furniture leaves session.placed in the session layer)
}
async function addParcelAnchor(parcel, node) {
  const target = T.furniture.get(parcel.furnitureId);
  const template = T.furniture.get(1000); // BagFurniture.TemplateConfigId
  const model = target?.BagResName || template?.BagResName || 'P_WoodBox_01';
  const a = {id: 1000, guidanceId: 'parcel-' + parcel.id, parcel, name: (T.constant.get('BagFurniture_DeliveryName_0')?.Text_Local ?? '{0}的快递').replace('{0}', target?.Name_Local ?? '家具'), model, x: node.x, y: 0, z: node.z, unityYawDeg: node.unityYawDeg ?? 0};
  const rec = await placeModel(current, a, {base: '../world/'});
  if (rec.object) anchorByObject.set(rec.object, rec);
  return rec;
}
async function addPlacedAnchor(placed) {
  const f = T.furniture.get(placed.furnitureId);
  const a = {id: placed.furnitureId, guidanceId: 'placed-' + placed.id, name: f?.Name_Local ?? '家具', model: f?.ResName ?? null, anchor: placed.slot,
    x: placed.x, y: 0, z: placed.z, unityYawDeg: placed.yaw ?? 0, bagId: f?.BagId || 0, items: [], counts: []};
  const rec = await placeModel(current, a, {base: '../world/'});
  if (rec.object) anchorByObject.set(rec.object, rec);
  return rec;
}
function removeAnchor(anchor) {
  refreshFurniture(anchor);
  current.anchors.splice(current.anchors.indexOf(anchor), 1);
}

// A parcel item finished: the parcel shows up at the door (toast when away from home).
async function onParcel(e) {
  if (!e.ok) { if (e.message) hud.toast(e.message); return; }
  const name = T.furniture.get(e.parcel.furnitureId)?.Name_Local ?? '家具';
  hud.log((T.constant.get('BagFurniture_DeliveryName_0')?.Text_Local ?? '{0}的快递').replace('{0}', name) + '：放在了玄关');
  if (S.isHomeScene(session, T) && current.desc.packages?.length) {
    S.placeParcels(session, current.desc.packages, player.position());
    const node = current.desc.packages.find((n) => n.node === e.parcel.point);
    if (node) { await addParcelAnchor(e.parcel, node); navigator.buildOccupancy(); }
  }
  panels.refresh();
}
// An install finished: the parcel box goes and the furniture stands on its slot.
async function onInstalled(e) {
  if (!e.ok) { hud.toast(e.message); return; }
  hud.log(e.message);
  const box = current.anchors.find((a) => a.parcel?.id === e.placed.id);
  if (box) removeAnchor(box);
  if (e.placed.scene === session.scene) await addPlacedAnchor(e.placed);
  navigator.buildOccupancy();
}
// A plan-mode move finished: the furniture model goes to its new slot.
async function onMoved(m) {
  const a = current?.anchors.find((x) => S.furnitureKey(session.scene, x) === m.furnitureKey);
  if (!a) return;
  refreshFurniture(a);
  const {object: _o, box: _b, solid: _s, point: _p, ...plain} = a;
  const moved = {...plain, anchor: m.node, x: m.x, y: m.y, z: m.z, unityYawDeg: m.yaw};
  current.anchors[current.anchors.indexOf(a)] = moved;
  const rec = await placeModel(current, moved, {base: '../world/'});
  if (rec.object) anchorByObject.set(rec.object, rec);
  navigator.buildOccupancy();
}
function openParcel(anchor) {
  const parcel = anchor.parcel;
  const buttons = S.parcelButtons(session, T, parcel);
  menuAnchor = anchor;
  hud.showMenu(anchor, buttons, (button) => runParcelButton(anchor, button), screenOf(anchor));
}
function runParcelButton(anchor, button) {
  const parcel = anchor.parcel;
  if (session.world.action) { hud.toast('正在' + (T.action.get(session.world.action.actionId)?.Name_Local ?? '行动')); return; }
  if (button.id === S.PARCEL_FUNCS.install) {
    const slots = S.freeSlots(session, T, current.desc, parcel.furnitureId);
    const p = player.position();
    slots.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    const r = S.startInstall(session, T, parcel.id, slots[0] ?? null);
    hud.log(anchor.name + ' · ' + button.label + '：' + r.message);
    if (!r.ok) hud.toast(r.message); else audio.playAction(T.func.get(button.id)?.ActionIds?.[0], T);
    return;
  }
  const act = () => {
    const r = button.id === S.PARCEL_FUNCS.dismantle ? S.dismantleParcel(session, T, parcel.id) : S.returnParcel(session, T, parcel.id);
    hud.log(anchor.name + ' · ' + button.label + '：' + r.message);
    if (!r.ok) { hud.toast(r.message); return; }
    removeAnchor(anchor);
    navigator.buildOccupancy();
  };
  if (button.confirm) {
    panels.open('confirm', {title: button.label, body: button.confirm.replace(/\\n/g, '\n'), confirmText: constant('SR_UI_ConfirmationDialog_0', '确认'),
      cancelText: constant('SR_UI_ConfirmationDialog_1', '取消'), dialogType: 0, onConfirm: act});
  } else act();
}

function openMap(hint = {}) {
  const mode = session.scene >= 1100 ? 'trade' : 'explore';
  panels.open('map', {mode});
}

// ---- going home ------------------------------------------------------------------
// The original ends an exploration through the CoreUI1「撤退」button (EXPLORE_BACK) or
// ESC, which opens a ConfirmDialog「是否退出 / 是否退出当前探索?」(LogicAdapter.
// ShowExploreExitDialog RVA 0x290A730, static); away from home the CoreUI0 home button
// (GO_HOME, 回家) asks「确认回家 / 确定要返回家中吗？」. Both go through the original
// ConfirmDialog page here.
const constant = (id, fallback) => T.constant.get(id)?.Text_Local ?? fallback;
function askGoHome() {
  if (S.isHomeScene(session, T)) { hud.toast(constant('SR_UI_BattleUI_Step0_6', '已经在家里了')); return; }
  if (session.world.action) { hud.toast('正在' + (T.action.get(session.world.action.actionId)?.Name_Local ?? '行动')); return; }
  const exploring = Boolean(session.instance);
  panels.open('confirm', {
    title: exploring ? constant('SR_UI_BattleUI_Step1_6', '是否退出') : constant('SR_UI_BattleUI_Step0_8', '确认回家'),
    body: exploring ? constant('SR_UI_BattleUI_Step1_7', '是否退出当前探索?') : constant('SR_UI_BattleUI_Step0_9', '确定要返回家中吗？'),
    confirmText: constant('SR_UI_ConfirmationDialog_0', '确认'), cancelText: constant('SR_UI_ConfirmationDialog_1', '取消'), dialogType: 0,
    onConfirm: () => goHome(),
  });
}

// HUD 回家 button (the original CoreUI0 GO_HOME button, shown away from home).
const homeBtn = document.getElementById('homeBtn');
homeBtn.addEventListener('click', () => { if (!travelling && !sceneLoading && !panels.isOpen()) askGoHome(); });

async function goHome({forced = false} = {}) {
  if (travelling) return;
  const home = S.homePointId(session, T);
  const seconds = S.travelSeconds(T, session.scene, home, session.playerSelectId);
  showTravelScreen(seconds);
  travelling = true;
  const result = S.returnHome(session, T, {forced});
  hud.log(result.message);
  if (!result.ok) { travelling = false; hud.hideBlackScreen(); if (!checkDeath()) hud.toast(result.message); return; }
  await enterScene(home, {position: null});
  hud.hideBlackScreen();
  travelling = false;
  if (result.wasInstance) think.explore(0, result.from);
  if (result.wasInstance) {
    // ExploreManager.CalculateAndSaveReward → RewardList 'explore' page (success / 仓促逃回).
    panels.open('reward', {variant: 'explore', tone: forced ? 'fail' : 'success',
      title: forced ? constant('SR_UI_ExploreReward_1', '仓促逃回') : constant('SR_UI_ExploreReward_0', '成功返回'),
      desc: forced ? constant('SR_UI_ExploreReward_3', '你被丧尸发现，仓促地逃了回来，受了一些伤……') : constant('SR_UI_ExploreReward_2', '在丧尸发现你之前，你返回了家中，并带回了不少物资……'),
      items: result.brought, confirmLabel: constant('SR_UI_ConfirmationDialog_0', '确认')});
  }
}

function showTravelScreen(seconds) {
  // Config_BlackScreen 201: "{1}赶路中…… {0}分钟后" travel interstitial.
  const template = tables.BlackScreen.find((b) => b.ID === 201)?.Voice_Local ?? '{1}赶路中…… {0}分钟后';
  hud.blackScreen(template.replace('{1}', '').replace('{0}', String(Math.round(seconds / 60))));
}

function handlePanelAction(kind, data) {
  if (kind === 'travel') return travelTo(data.mapPointId);
  if (kind === 'refresh') return afterAction();
  if (kind === 'plant') { if (data?.during) audio.playAction(session.world.action?.actionId, T); afterAction(); return; }
  if (kind === 'pause') { paused = data; return; }
  if (kind === 'used') { audio.playAction(T.item.get(data.configId)?.UseAction, T); return; }
  if (kind === 'restart') { localStorage.removeItem(SAVE_KEY); location.search = DEBUG ? '?new=1&debug=1' : '?new=1'; return; }
  if (kind === 'quit') { localStorage.removeItem(SAVE_KEY); location.href = '../index.html'; return; }
  // PAUSE → 保存并退出: save, then back to the start page (the original returns to its main menu).
  if (kind === 'saveExit') { save(); location.href = '../index.html'; return; }
  return null;
}

async function travelTo(mapPointId) {
  const point = tables.MapPoint.find((p) => p.ID === mapPointId);
  if (!point || travelling) return;
  if (mapPointId === session.scene) { hud.toast(constant('SR_UI_Map_1', '已经在当前地图了。')); return; }
  showTravelScreen(S.travelSeconds(T, session.scene, mapPointId, session.playerSelectId));
  travelling = true;
  const result = S.travel(session, T, mapPointId, tables.MapPoint);
  hud.log(result.message);
  if (!result.ok) { travelling = false; hud.hideBlackScreen(); if (!checkDeath()) hud.toast(result.message); return; }
  await enterScene(mapPointId);
  hud.hideBlackScreen();
  travelling = false;
  if (session.instance) think.explore(1, mapPointId);
}

function showEvent(fired) {
  paused = true;
  hud.log('事件：' + fired.title);
  panels.open('event', {event: fired, onResolve: (id, choice) => events.resolve(session, id, choice), onDone: () => { paused = false; }});
}

function talkTo(npc) {
  const r = npcs.talk(npc);
  if (r.shopId) panels.open('shop', {shopId: r.shopId});
}

// Home exit / exploration exit: Config_MapPoint.ExitPos. At home it offers the map; on
// an exploration map it offers the way home (OnExploreEnd moves the role to ExitPos).
function exitCheck() {
  const exit = current?.desc.exit;
  if (!exit || panels.isOpen()) return;
  const p = player.position();
  const near = Math.hypot(p.x - exit.x, p.z - exit.z) < 1.0;
  if (near && !exitArmed) { exitArmed = true; hud.prompt(S.isHomeScene(session, T) ? 'Q · 离开（打开地图）' : 'Q · ' + constant('SR_Web_CoreUI0_16', '回家')); }
  if (!near && exitArmed) { exitArmed = false; hud.prompt(''); }
}
let exitArmed = false;
let travelling = false;

function checkDeath() {
  if (!session.world.dead || hud.isGameOver()) return Boolean(session.world.dead);
  const d = session.world.dead;
  const info = T.deathInfo.get(d.deathId);
  const logRow = tables.EventLog.find((e) => e.EventLog === info?.EventLogID);
  panels.open('result', {dead: d, text: logRow?.Text_Local ?? '你没能活下来。', days: session.world.time.day + 1});
  hud.gameOver();
  audio.playDeath(T.raw.Player.find((p) => p.ID === (T.raw.PlayerSelect.find((x) => x.ID === session.playerSelectId)?.PlayerConfigId ?? 1))?.DeadFmod);
  return true;
}

// ---- hover, markers, thoughts ---------------------------------------------------
// Hovering a furniture outlines it and floats its name (original, observed s2-03/s2-04);
// the furniture with an unread inspect story carries a magnifier; furniture with a shown
// durability carries its bar (worldUi). The name is Config_Furniture.Name_Local, or the
// parcel's 「…的快递」 name.
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!current || sceneLoading || panels.isOpen()) { worldUi.clearHover(); return; }
  if (planMode) { planHover(event); return; }
  const hit = anchorAt(event)?.anchor;
  if (hit && (hit.parcel || T.furniture.get(hit.id)?.isShowName !== false)) worldUi.setHover(hit, hit.name);
  else worldUi.clearHover();
});
renderer.domElement.addEventListener('pointerleave', () => worldUi.clearHover());

// Magnifier: a visible furniture whose unread story is a 「查看」 note (Config_Story.ShowType
// 1, e.g. 钱包/钥匙/手机/双肩背包/牛皮笔记本/黑板/房门). Observed: the wallet, keys, phone,
// notebook and backpack carry it before the disaster (n11/n71); which field the original
// reads is INFERRED (ShowType 2 rows — 冰箱便签, 纸箱 — had no magnifier).
function worldMarkers() {
  if (!current || planMode) return [];
  const out = [];
  for (const a of current.anchors) {
    if (!a.object || !a.box || a.parcel || !interactive(a)) continue;
    const story = storyOf(a);
    // The bar shows only while durability is below the maximum: the door (700/1000) carries
    // one, the undamaged windows (1000/1000, isShowHP too) do not (observed n71/n75; the
    // exact rule is INFERRED).
    const full = S.furnitureHp(session, T, session.scene, a);
    const hp = full && full.hp < full.max ? full : null;
    if ((story && story.ShowType === 1) || hp) out.push({key: S.furnitureKey(session.scene, a), box: a.box, magnifier: Boolean(story && story.ShowType === 1), hp});
  }
  return out;
}

// Character thoughts (Config_ThinkTime / ThinkActionType / ThinkExplore / Story.StoryThink),
// shown as a line of text above the head like the original (observed n30 「钱包里还有些零钱，
// 希望能买到多一点物资……」, a ThinkOpen row). Rules from the table fields: ThinkTime rows
// fire once on their survival day (Day 1 = the first day) in Order; ThinkActionType rows
// fire when an action of that Config_Action.ActionType starts, with probability Rate and a
// per-row cool-down TypeCD (game seconds), choosing the row whose BuffID the player has
// (else BuffID 0); ThinkExplore on entering (TriggerType 1) or leaving (0) an exploration
// of chapter ChapterId (-1 any). PlayerSelectId [] = everyone. Timing details INFERRED.
// The pre-disaster ThinkOpen rows belong to the pre-disaster chapter (stage 3).
const think = (() => {
  const text = (key) => T.constant.get(key)?.Text_Local ?? null;
  const forPlayer = (r) => !r.PlayerSelectId?.length || r.PlayerSelectId.includes(session.playerSelectId);
  const pick = (keys) => keys.length ? text(keys[Math.floor(R.rand(session.world) * keys.length)]) : null;
  let lastAction = null;
  function state() { return (session.world.think ??= {days: [], cd: {}}); }
  function tick() {
    const st = state(), w = session.world;
    const day = w.time.day + 1;
    if (!st.days.includes(day)) {
      st.days.push(day);
      const rows = (tables.ThinkTime ?? []).filter((r) => r.Day === day && forPlayer(r)).sort((a, b) => a.Order - b.Order);
      for (const r of rows) worldUi.say(r.Text_Local);
    }
    const a = w.action;
    if (a && a !== lastAction) {
      const type = T.action.get(a.actionId)?.ActionType;
      const buffs = new Set(w.buffs.map((b) => b.id));
      const rows = (tables.ThinkActionType ?? []).filter((r) => r.ActionType === type && forPlayer(r));
      const row = rows.find((r) => r.BuffID && buffs.has(r.BuffID)) ?? rows.find((r) => !r.BuffID && r.PlayerSelectId?.length) ?? rows.find((r) => !r.BuffID);
      if (row && (st.cd[row.ID] ?? -Infinity) <= w.time.total && R.rand(w) < row.Rate) {
        st.cd[row.ID] = w.time.total + (row.TypeCD || 0);
        const line = pick(row.RandomThink ?? []);
        if (line) worldUi.say(line);
      }
    }
    lastAction = a;
  }
  function explore(trigger, sceneId) {
    const rows = (tables.ThinkExplore ?? []).filter((r) => r.TriggerType === trigger && forPlayer(r) && (r.ChapterId === -1 || r.ChapterId === sceneId));
    const row = rows.find((r) => r.ChapterId === sceneId) ?? rows.find((r) => r.ChapterId === -1);
    if (row && R.rand(session.world) < row.Rate) { const line = pick(row.RandomThink ?? []); if (line) worldUi.say(line); }
  }
  return {tick, explore};
})();

// ---- rebirth count (轮回) ----------------------------------------------------------
// HUD 「轮回：{0}」 box (SR_Web_CoreUI1_2) at the bottom right; clicking it opens the
// original GameCountTips page 「这是你第{0}次重生 （{1}/{2}）· <preset>」 (observed n11/s2-18:
// 「这是你第1次重生 （1/4）· 满仓无忧」). {2} = RebirthMaxChances (3) + 1 and the lines are
// UI_GameCountTips_0/1. The original also pops it after loading a save (n11). There is no
// rebirth system here, so the count stays 1 (world.rebirth); the preset is the one chosen
// at the start (session.difficultyName, else the default preset).
const cycleBox = document.getElementById('cycle');
function rebirthTexts() {
  const n = session.world.rebirth ?? 1;
  const max = (tables.GlobalSetting.find((g) => g.ID === 'RebirthMaxChances')?.Params1 ?? 3) + 1;
  const preset = session.difficultyName ?? tables.DifficultyPreset?.find((d) => d.IsDefault === 1)?.PresetName_Local ?? '';
  return {box: constant('SR_Web_CoreUI1_2', '轮回：{0}').replace('{0}', String(n)),
    title: constant('SR_UI_GameCountTips_0', '这是你第{0}次重生  （{1}/{2}）').replace('{0}', String(n)).replace('{1}', String(n)).replace('{2}', String(max)) + (preset ? ' · ' + preset : ''),
    line0: constant('UI_GameCountTips_0', ''), line1: constant('UI_GameCountTips_1', '')};
}
function showRebirthTips() {
  const t = rebirthTexts();
  panels.open('gameCount', {title: t.title, line0: t.line0, line1: t.line1});
}
cycleBox.addEventListener('click', () => { if (!panels.isOpen() && !planMode) showRebirthTips(); });

// ---- side buttons: camera mode, plan mode ------------------------------------------
const camBtn = document.getElementById('camBtn'), planBtn = document.getElementById('planBtn');
camBtn.parentElement.querySelector('.tip b').textContent = constant('SR_Web_CoreUI0_4', '视角切换');
camBtn.parentElement.querySelector('.tip span').textContent = constant('SR_Web_CoreUI0_5', '跟随主角 ↔ 自由观察');
planBtn.parentElement.querySelector('.tip b').textContent = constant('SR_Web_CoreUI0_6', '计划模式');
planBtn.parentElement.querySelector('.tip span').textContent = constant('SR_Web_CoreUI0_7', '暂停时间，安排家具与陷阱布局');
camBtn.addEventListener('click', () => { camFollow = !camFollow; syncSideButtons(); });
planBtn.addEventListener('click', () => { if (panels.isOpen()) return; planMode ? exitPlan() : enterPlan(); });
function syncSideButtons() {
  camBtn.classList.toggle('active', !camFollow);
  planBtn.classList.toggle('active', planMode);
  // Plan mode only exists at home (the original hides it during explorations).
  planBtn.parentElement.hidden = !S.isHomeScene(session, T);
}
function panCamera(dt) {
  const fwd = new THREE.Vector3(-followOffset.x, 0, -followOffset.z).normalize();
  const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const v = new THREE.Vector3();
  if (panKeys.has('w')) v.add(fwd);
  if (panKeys.has('s')) v.sub(fwd);
  if (panKeys.has('d')) v.sub(right);
  if (panKeys.has('a')) v.add(right);
  if (v.lengthSq()) camTarget.addScaledVector(v.normalize(), dt * 8);
  const b = current?.bounds;
  if (b) { camTarget.x = THREE.MathUtils.clamp(camTarget.x, b.minX, b.maxX); camTarget.z = THREE.MathUtils.clamp(camTarget.z, b.minZ, b.maxZ); }
}

// ---- plan mode (计划模式) ------------------------------------------------------------
// Original (observed n50, s2-10..s2-30): time stops; the scene turns grey; every
// furniture slot at home is drawn as a pale box; the bottom bar is the original BuildTips
// page (放置类型 家具/陷阱/防御 + 取消) and the side button turns yellow. Hovering a slot shows
// its size and furniture name (「中 · 抽屉柜」, or 「桌上 · 空闲」 for an empty one); clicking an
// occupied slot offers 拆除 / 移动 (Config_Furniture.RemoveFunc / MoveFunc); 移动 asks for a
// target slot of the same size (BuildTips_1 「选择{0}槽位，移动 {1}」). 陷阱/防御 and the grey
// post-process are stand-ins: traps and defence are not rebuilt; the grey is a CSS filter.
let planMode = false, planMove = null, planSlots = [];
const slotTip = document.getElementById('slotTip');
const SLOT_BOX = new THREE.MeshBasicMaterial({color: '#f4f4f4', transparent: true, opacity: 0.32, depthWrite: false});
const SLOT_EDGE = new THREE.LineBasicMaterial({color: '#ffffff', transparent: true, opacity: 0.85});
const SLOT_HOT = new THREE.MeshBasicMaterial({color: '#fff3c4', transparent: true, opacity: 0.55, depthWrite: false});
const SLOT_TARGET = new THREE.MeshBasicMaterial({color: '#ffd24a', transparent: true, opacity: 0.42, depthWrite: false});
const planGroup = new THREE.Group();
const slotName = (type) => tables.SlotType?.find((x) => x.ID === type)?.Name_Local ?? '';
function slotOccupant(slot) {
  for (const a of current.anchors) {
    if (!a.object || a.parcel) continue;
    if ((S.furnitureState(session, session.scene, a).moved?.node ?? a.anchor) === slot.node) return a;
  }
  return null;
}
function buildPlanSlots() {
  for (const m of planGroup.children) m.geometry.dispose();
  planGroup.clear();
  planSlots = [];
  for (const slot of current.desc.slots ?? []) {
    const occ = slotOccupant(slot);
    const b = occ?.box;
    const w = b ? Math.max(0.3, b.maxX - b.minX) : 0.6, d = b ? Math.max(0.3, b.maxZ - b.minZ) : 0.6, h = b ? Math.max(0.12, (b.maxY ?? 1) - (b.minY ?? 0)) : 0.05;
    const cx = b ? (b.minX + b.maxX) / 2 : slot.x, cz = b ? (b.minZ + b.maxZ) / 2 : slot.z, y0 = b ? (b.minY ?? 0) : (slot.y ?? 0);
    const geo = new THREE.BoxGeometry(w + 0.08, h + 0.04, d + 0.08);
    const mesh = new THREE.Mesh(geo, SLOT_BOX);
    mesh.position.set(cx, y0 + h / 2, cz);
    mesh.renderOrder = 10;
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), SLOT_EDGE));
    planGroup.add(mesh);
    planSlots.push({slot, mesh, occupant: occ});
  }
  scene3.add(planGroup);
}
function buildTipsMessages(info = '', name = '', icon = '') {
  return [
    {type: 'WebUI_BuildTips_LocalizationMsg', data: {typeToggleLabel: constant('SR_Web_BuildTips_0', '▾ 放置类型 ▾'), cancelBtnText: constant('SR_Web_BuildTips_1', '取消'),
      furnitureLabel: constant('SR_Web_BuildTips_2', '家 具'), trapLabel: constant('SR_Web_BuildTips_3', '陷 阱'), defenseLabel: constant('SR_Web_BuildTips_4', '防 御'), renovationLabel: constant('SR_Web_BuildTips_5', '装 修')}},
    {type: 'WebUI_BuildTips_UpdateMsg', data: {showTypeToggle: !planMove, showDefenseTab: true, showRenovationTab: false, currentType: 0, hideMask: 0,
      showInfoBar: Boolean(info), infoText: info, furnitureName: name, furnitureIcon: icon}},
  ];
}
function enterPlan() {
  if (planMode || !current || sceneLoading || travelling || session.world.dead || !S.isHomeScene(session, T)) return;
  planMode = true;
  hud.hideMenu();
  worldUi.clearHover();
  pendingAnchor = null;
  document.body.classList.add('plan');
  worldUi.quiet(true);
  renderer.domElement.style.filter = 'grayscale(0.85) brightness(0.92)';
  buildPlanSlots();
  openOverlay('BuildTips', '../WebUI/UI/BuildTips/BuildTips.html', {messages: buildTipsMessages(), onEvent: planEvent});
  syncSideButtons();
  // 「规划模式」 flashes above the bar on entering (observed s2-16; SR_Web_OutSetting_HotKey_Label_PlanMode).
  const hint = document.getElementById('planHint');
  hint.textContent = constant('SR_Web_OutSetting_HotKey_Label_PlanMode', '规划模式');
  hint.classList.add('on');
  clearTimeout(enterPlan.timer);
  enterPlan.timer = setTimeout(() => hint.classList.remove('on'), 1500);
}
function exitPlan() {
  if (!planMode) return;
  planMode = false;
  planMove = null;
  document.body.classList.remove('plan');
  worldUi.quiet(false);
  renderer.domElement.style.filter = '';
  for (const m of planGroup.children) m.geometry.dispose();
  planGroup.removeFromParent();
  planGroup.clear();
  planSlots = [];
  slotTip.classList.remove('on');
  hud.hideMenu();
  closeOverlay('BuildTips');
  document.getElementById('planHint').classList.remove('on');
  syncSideButtons();
}
function planEvent(type, data) {
  if (type === 'EXIT_PLAN_MODE') { exitPlan(); return; }
  if (type === 'CANCEL_INSTALL') { cancelPlanMove(); return; }
  if (type === 'SWITCH_TYPE' && data.type !== 0) {
    // 陷阱 / 防御 placement is not rebuilt; the tab returns to 家具.
    hud.toast('网页版暂未实现：陷阱 / 防御布置');
    postOverlay('BuildTips', 'WebUI_BuildTips_UpdateMsg', {currentType: 0});
  }
}
function cancelPlanMove() {
  planMove = null;
  for (const x of planSlots) x.mesh.material = SLOT_BOX;
  for (const m of buildTipsMessages()) postOverlay('BuildTips', m.type, m.data);
}
function slotAt(event) {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1), camera);
  // While choosing a move target only the highlighted target slots are pickable, so a
  // larger box in front of one does not swallow the click.
  const pool = planMove ? planMove.targets : planSlots;
  const hit = ray.intersectObjects(pool.map((x) => x.mesh), false)[0];
  return hit ? pool.find((x) => x.mesh === hit.object) : null;
}
function planHover(event) {
  const s = hud.menuOpen() ? null : slotAt(event);
  for (const x of planSlots) x.mesh.material = x === s ? SLOT_HOT : (planMove?.targets.includes(x) ? SLOT_TARGET : SLOT_BOX);
  if (!s) { slotTip.classList.remove('on'); return; }
  const type = tables.SlotType?.find((x) => x.ID === s.slot.type);
  slotTip.querySelector('img').src = '../WebUI/Res/icon/' + (type?.WebIcon ?? 'dakaimubiao.png').split('/').pop();
  slotTip.querySelector('b').textContent = slotName(s.slot.type);
  slotTip.querySelector('span').textContent = s.occupant ? s.occupant.name : constant('SlotHeadBar_0', '空闲');
  slotTip.style.transform = 'translate(' + (event.clientX + 18) + 'px,' + (event.clientY - 44) + 'px)';
  slotTip.classList.add('on');
}
function planClick(event) {
  const s = slotAt(event);
  hud.hideMenu();
  if (planMove) {
    if (s && planMove.targets.includes(s)) {
      const r = S.startMove(session, T, session.scene, planMove.anchor, planMove.funcId, s.slot);
      hud.log(planMove.anchor.name + ' · 移动：' + r.message);
      if (!r.ok) { hud.toast(r.message); return; }
      exitPlan();
    }
    return;
  }
  if (!s?.occupant) return; // empty slot: nothing happens (observed s2-30)
  const a = s.occupant;
  const buttons = S.planButtonsFor(session, T, session.scene, a);
  if (!buttons.length) return;
  menuAnchor = a;
  slotTip.classList.remove('on');
  hud.showMenu(a, buttons, (b) => runPlanButton(a, b), screenOf(a), {plan: true});
}
function runPlanButton(anchor, button) {
  if (session.world.action) { hud.toast('正在' + (T.action.get(session.world.action.actionId)?.Name_Local ?? '行动')); return; }
  if (button.move) {
    const free = new Set(S.freeSlots(session, T, current.desc, anchor.id).map((f) => f.node));
    const targets = planSlots.filter((x) => free.has(x.slot.node));
    const f = T.furniture.get(anchor.id);
    if (!targets.length) { hud.toast('没有空余的' + slotName(f?.SlotType) + '槽位'); return; }
    planMove = {anchor, funcId: button.id, targets};
    for (const x of planSlots) x.mesh.material = targets.includes(x) ? SLOT_TARGET : SLOT_BOX;
    const info = constant('BuildTips_1', '选择{0}槽位，移动 {1}').replace('{0}', slotName(f?.SlotType)).replace(/\s*\{1\}/, '');
    for (const m of buildTipsMessages(info, f?.Name_Local ?? anchor.name, f?.ICON ?? '')) postOverlay('BuildTips', m.type, m.data);
    return;
  }
  const act = () => {
    const r = S.runFunction(session, T, session.scene, anchor, button.id);
    hud.log(anchor.name + ' · ' + button.label + '：' + r.message);
    if (!r.ok) { hud.toast(r.message); return; }
    exitPlan();
    afterAction();
  };
  if (button.confirm) {
    panels.open('confirm', {title: button.label, body: button.confirm.replace(/\\n/g, '\n'), confirmText: constant('SR_UI_ConfirmationDialog_0', '确认'),
      cancelText: constant('SR_UI_ConfirmationDialog_1', '取消'), dialogType: 0, onConfirm: act});
  } else act();
}
function planUpdate() {
  if (hud.menuOpen() && menuAnchor?.box) hud.placeMenu(screenOf(menuAnchor));
}

// ---- input ------------------------------------------------------------------
// Mouse buttons follow the original (observed 2026-10-24, investigation/compare-2026-10-23):
// RIGHT click walks to the ground point or to a furniture/NPC and interacts on arrival;
// LEFT click on the world does not interact — it only dismisses an open function bar.
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (planMode) { if (event.button === 0) planClick(event); return; }
  if (event.button === 0) { if (hud.menuOpen()) hud.hideMenu(); return; }
  if (event.button !== 2 || !current || sceneLoading || panels.isOpen() || session.world.dead) return;
  if (hud.menuOpen()) hud.hideMenu();
  const hit = anchorAt(event);
  if (!hit) return;
  if (hit.anchor) {
    const spot = approachPoint(hit.anchor.box);
    player.walkTo(spot.x, spot.z);
    pendingAnchor = {anchor: hit.anchor};
    return;
  }
  if (hit.npc) {
    const spot = approachPoint(hit.npc.box);
    player.walkTo(spot.x, spot.z);
    pendingAnchor = {npc: hit.npc};
    return;
  }
  pendingAnchor = null;
  player.walkTo(hit.ground.x, hit.ground.z);
});

addEventListener('keydown', (event) => {
  if (event.target?.tagName === 'INPUT') return;
  const key = event.key.toLowerCase();
  // ESC: an open panel closes; otherwise in an exploration it asks to leave
  // (OnHotKeyExploreEsc), and anywhere else it opens the PAUSE system menu (original
  // OutSetting page; observed at home 2026-10-24). The furniture function bar is NOT closed
  // by ESC in the original — a left click on the ground dismisses it (observed n80/n81);
  // ESC goes straight to the pause menu and the bar is hidden behind it.
  if (key === 'escape') {
    if (panels.isOpen('pause')) { panels.close(); return; }
    // Plan mode: ESC leaves the move-target selection first, then plan mode (BuildTips 取消).
    if (planMode && !panels.isOpen()) { if (planMove) cancelPlanMove(); else exitPlan(); return; }
    if (panels.isOpen()) { panels.close(); return; }
    if (session.world.dead || travelling || sceneLoading) return;
    if (session.instance) { askGoHome(); return; }
    hud.hideMenu();
    panels.open('pause', {});
    return;
  }
  if (session.world.dead || travelling || sceneLoading) return;
  // N toggles plan mode (CoreUI1 i18n_hotkeyPlanMode default 'N'; observed s2-16).
  if (key === 'n' && !panels.isOpen()) { planMode ? exitPlan() : enterPlan(); return; }
  if (planMode) return;
  // WASD pans the camera (free view); space snaps back to following (SR_Web_CoreUI1_19).
  if ('wasd'.includes(key) && key.length === 1 && !event.ctrlKey) { panKeys.add(key); camFollow = false; syncSideButtons(); return; }
  if (key === ' ') { event.preventDefault(); camFollow = true; syncSideButtons(); return; }
  if (key === 'b' || key === 't') { panels.isOpen('backpack') ? panels.close() : panels.open('backpack', {}); return; }
  if (key === 'm') { panels.isOpen('map') ? panels.close() : openMap(); return; }
  if (key === 'q' && exitArmed) { S.isHomeScene(session, T) ? openMap() : askGoHome(); return; }
  if (key === 'h') { if (!panels.isOpen()) askGoHome(); return; }
  // E runs the bar's hotkey button (the chip shown on it); with no bar open it interacts
  // with the nearest furniture/NPC, as before.
  if (key === 'e') { if (hud.pickHotkey()) return; const a = nearestAnchor(); if (a) openFurniture(a); else { const n = npcs?.nearest(player.position()); if (n) talkTo(n); } return; }
  if (key === 'x') { const r = R.cancelAction(session.world, T); hud.log(r.message); session.pending = null; return; }
  if (key === 'c') { cutaway.uniforms.uEnabled.value = cutaway.uniforms.uEnabled.value ? 0 : 1; hud.toast(cutaway.uniforms.uEnabled.value ? '墙体剖切：开' : '墙体剖切：关'); return; }
  if (key === 'p') { paused = !paused; hud.toast(paused ? '已暂停' : '继续'); return; }
  if (key === '1' || key === '2' || key === '3') { gameSpeed = [1, 2, 4][Number(key) - 1]; session.world.speed = gameSpeed; hud.toast('速度 ×' + gameSpeed); return; }
  if (key === 's' && event.ctrlKey) { event.preventDefault(); save(); return; }
});

addEventListener('keyup', (event) => panKeys.delete(event.key.toLowerCase()));

function save() {
  if (!sceneLoading && player) session.position = player.position();
  localStorage.setItem(SAVE_KEY, S.saveSession(session));
  hud.toast('已保存');
}
addEventListener('beforeunload', () => { if (session && !session.world.dead) save(); });

// Session events from advanceSession (frame loop and the debug advance hook alike).
function handleEvents(evs) {
  for (const e of evs) {
    if (e.type === 'completed') {
      const a = T.action.get(e.actionId);
      hud.log((a?.Name_Local ?? '动作') + '完成' + (e.gained?.length ? '：获得 ' + e.gained.map((id) => T.item.get(id)?.ItemName_Local).join('、') : ''));
      if (e.dropped?.length) hud.toast(constant('ToolTable_59', '放不下的东西放在了脚边'));
      // A finished timed action advances ActionTask / ItemTask progress of live events.
      const done = EVENTS_ON ? events.onAction(session, e.actionId, e.itemConfigId ?? null) : null;
      if (done) showEvent(done);
      afterAction(); panels.refresh();
    }
    if (e.type === 'completed' && e.moved) onMoved(e.moved);
    if (e.type === 'parcel') onParcel(e);
    if (e.type === 'installed') onInstalled(e);
    if (e.type === 'chain' && e.open) panels.open(e.open.panel, {container: e.open.container, shopId: e.open.shopId, mode: e.open.mode, furnitureKey: e.open.furnitureKey});
    if (e.type === 'day') hud.toast('第 ' + (e.day + 1) + ' 天');
    if (e.type === 'plant-mature') { worldUi.say(constant('PlantMature_0', '好像有什么熟了...')); syncPlants(); }
    if (e.type === 'plant-anomaly' || e.type === 'plant-withered') syncPlants();
    if (e.type === 'completed' && e.plant) { if (!e.plant.ok && e.plant.message) hud.toast(e.plant.message); else if (e.plant.message) hud.log(e.plant.message); syncPlants(); }
    if (e.type === 'exposure-alarm') hud.toast('暴露值偏高，小心！');
    if (e.type === 'exposure-full') { hud.toast('被发现了！'); panels.close(); goHome({forced: true}); }
  }
  return evs;
}

// ---- loop -------------------------------------------------------------------
const clock = new THREE.Clock();
let autosave = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  perf.frame(dt);
  if (current && player && !sceneLoading) {
    const w = session.world;
    const acting = !!w.action;
    if (!acting && !planMode) player.update(dt * (1 + R.modifiers(w, T).speed)); // BuffSpeed slows walking
    if (character) {
      const moving = player.isMoving() && !acting;
      const d = player.direction();
      if (moving) character.face(d.x, d.z);
      character.update(dt, moving ? 1 : 0, acting ? w.action.configName : null);
    }
    const p = player.position();
    if (camFollow) camTarget.lerp(new THREE.Vector3(p.x, 0, p.z), Math.min(1, dt * 4));
    else panCamera(dt);
    camera.position.copy(camTarget).add(followOffset.clone().multiplyScalar(zoom));
    camera.lookAt(camTarget.x, 0.8, camTarget.z);
    sun.position.set(p.x + 6, 14, p.z + 4); sun.target.position.set(p.x, 0, p.z);
    cutaway.update(p, camera, 0);

    if (!paused && !planMode && !panels.blocksTime() && !w.dead) {
      const seconds = dt * R.gameRate(w, T);
      handleEvents(S.advanceSession(session, T, seconds));
      const fired = EVENTS_ON ? events.tick(session) : null;
      if (fired) showEvent(fired);
      checkDeath();
      think.tick();
    }
    if (pendingAnchor && !player.isMoving()) {
      const target = pendingAnchor; pendingAnchor = null;
      if (target.anchor) openFurniture(target.anchor);
      if (target.npc) talkTo(target.npc);
    }
    npcs?.update(dt, p);
    hud.render(session, T, nearestAnchor(), EVENTS_ON ? events.activeTasks(session) : []);
    if (hud.menuOpen() && menuAnchor?.box) hud.placeMenu(screenOf(menuAnchor));
    worldUi.update(worldMarkers(), {x: p.x, y: 2.15, z: p.z});
    if (planMode) planUpdate();
    if ((plantSyncAt += dt) > 2) { plantSyncAt = 0; syncPlants(); }
    homeBtn.hidden = S.isHomeScene(session, T) || session.world.dead;
    const cycleText = rebirthTexts().box;
    if (cycleBox.textContent !== cycleText) cycleBox.textContent = cycleText;
    cycleBox.hidden = false;
    exitCheck();
    autosave += dt;
    if (autosave > 30) { autosave = 0; if (!w.dead) save(); }
  }
  renderer.render(scene3, camera);
  requestAnimationFrame(frame);
}

await enterScene(session.scene);
frame();
// The original pops the rebirth notice after loading a save (observed n11, 「这是你第1次重生
// （1/4）· 满仓无忧」). Here: when continuing a saved game at home.
// Web-build help on every entry (user request 2026-10-26): a popup with 右键 移动 / 交互; time
// stays paused until it is closed, then the bottom key bar flashes. Not an original screen.
// The rebirth notice (save continued at home) follows once it is closed.
const welcome = document.getElementById('welcome');
function closeWelcome() {
  if (!welcome.classList.contains('on')) return;
  welcome.classList.remove('on');
  paused = false;
  const tip = document.getElementById('tip');
  tip.classList.remove('flash'); void tip.offsetWidth; tip.classList.add('flash');
  if (loadedFromSave && S.isHomeScene(session, T) && !session.world.dead) showRebirthTips();
}
if (!session.world.dead && (!DEBUG || params.has('help'))) {
  welcome.classList.add('on');
  paused = true;
  document.getElementById('welcomeOk').addEventListener('click', closeWelcome);
  addEventListener('keydown', (e) => { if (welcome.classList.contains('on') && (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape')) { e.preventDefault(); e.stopImmediatePropagation(); closeWelcome(); } }, true);
} else if (loadedFromSave && S.isHomeScene(session, T) && !session.world.dead) showRebirthTips();

if (DEBUG) {
  window.__game = {
    session: () => session, T, tables, R, S, perf,
    enter: (id) => enterScene(id), travel: (id) => travelTo(id), goHome: (opts) => goHome(opts), askGoHome, travelling: () => travelling,
    player: () => player.position(), teleport: (x, z) => player.teleport(x, z),
    anchors: () => current.anchors.map((a) => ({id: a.id, guidanceId: a.guidanceId, name: a.name, box: a.box, parcel: a.parcel ?? null, hidden: !a.object, removed: S.furnitureState(session, session.scene, a).removed})),
    open: (name) => { const a = current.anchors.find((x) => x.name === name && x.object); if (!a) return false; const s = approachPoint(a.box); player.teleport(s.x, s.z); openFurniture(a); return true; },
    buttons: (name) => { const a = current.anchors.find((x) => x.name === name); return a ? S.buttonsFor(session, T, session.scene, a) : null; },
    run: (name, funcId) => { const a = current.anchors.find((x) => x.name === name); return a ? S.runFunction(session, T, session.scene, a, funcId) : null; },
    advance: (sec) => { const out = []; let left = sec; while (left > 0) { const s = Math.min(600, left); out.push(...handleEvents(S.advanceSession(session, T, s))); left -= s; } afterAction(); checkDeath(); return out; },
    walkTo: (x, z) => player.walkTo(x, z), moving: () => player.isMoving(),
    blocked: (x, z) => navigator.blocked(x, z), path: (x, z) => navigator.findPath(player.position(), {x, z}),
    panels, hud, events, npcs: () => npcs, audio, save, scene: () => current.desc, showEvent,
    talk: (i = 0) => { const n = npcs?.nearest({x: current.desc.npcs?.[i]?.x ?? 0, z: current.desc.npcs?.[i]?.z ?? 0}); if (n) talkTo(n); return n?.name ?? null; },
    loadedAt: () => loadedAt, ready: () => Boolean(current && player && !sceneLoading && !loading.classList.contains('on')), loading: () => sceneLoading,
    camera, THREE, renderer, sun, scene3,
    worldUi, think, plan: () => ({on: planMode, move: Boolean(planMove), slots: planSlots.length}), enterPlan, exitPlan, camFollow: () => camFollow,
    planSlotScreen: (node) => { const x = planSlots.find((p) => p.slot.node === node); if (!x) return null; const v = x.mesh.getWorldPosition(new THREE.Vector3()).project(camera); return {x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight}; },
    anchorScreen: (name) => { const a = current.anchors.find((x) => x.name === name && x.box); return a ? screenOf(a) : null; },
    anchorCenter: (name) => { const a = current.anchors.find((x) => x.name === name && x.box); if (!a) return null; const b = a.box; const v = new THREE.Vector3((b.minX + b.maxX) / 2, ((b.minY ?? 0) + (b.maxY ?? 1)) / 2, (b.minZ + b.maxZ) / 2).project(camera); return {x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight}; },
  };
}
