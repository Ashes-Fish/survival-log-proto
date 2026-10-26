// Top-down prologue room driven by the existing component-integration probe.
// Room positions come from configuration; motion, interaction radius and the
// wall-clock-to-game-frame rate are browser-side parameters, not observations.
import {createPrologueRoom, stepPlayer, nearestAnchor, clampToBounds} from './prologue-room.mjs';
import {createPrologueProbe, advancePrologueProbe, probeReading, probeTutorialEvent, startProbeNap, startProbeMeal, PROBE_COVERAGE} from './prologue-probe.mjs';
import {tutorialRows} from './tutorial.mjs';
import {performAction} from './game/interactions.mjs';

const $ = (id) => document.getElementById(id);
const CONFIG_NAMES = ['GuidanceFurniture','Furniture','Bag','Item','Player','PlayAttribute','Guide','Chapter','Effect','Action','FurnitureFunc'];
const tables = Object.fromEntries(await Promise.all(CONFIG_NAMES.map(async (name) => {
  const response = await fetch('/data/Config_' + name + '.json');
  if (!response.ok) throw new Error('缺少原版配置 ' + name);
  return [name, await response.json()];
})));
tables.PrologueMap = await (await fetch('/data/PrologueMap.json')).json();

const room = createPrologueRoom(tables);
let probe = createPrologueProbe(tables);
const player = {x: room.spawn.x, z: room.spawn.z, tx: null, tz: null};

const ATTRIBUTE_LABELS = [['Satiety','饱腹'],['Morale','心态'],['Stamina','精力'],['Health','健康'],['Vitality','生命']];
const canvas = $('room');
const context = canvas.getContext('2d');
const log = [];
let frameDebt = 14;
let exhausted = null;

function focusBox() {
  const xs = room.anchors.map((a) => a.x).concat(player.x);
  const zs = room.anchors.map((a) => a.z).concat(player.z);
  const pad = 2.4;
  return {minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minZ: Math.min(...zs) - pad, maxZ: Math.max(...zs) + pad};
}

// Isometric projection (technique borrowed from IsoCity, MIT): a world cell maps to
// screen ((x-z)*TILE_W/2, (x+z)*TILE_H/2). Depth is x+z, so painter order is a sort.
const TILE_W = 64, TILE_H = 38.4;
const ISO_X = (x, z) => x - z;
const ISO_Y = (x, z) => x + z;

function project(box) {
  const halfW = TILE_W / 2, halfH = TILE_H / 2;
  const isoMinX = ISO_X(box.minX, box.maxZ), isoMaxX = ISO_X(box.maxX, box.minZ);
  const isoMinY = ISO_Y(box.minX, box.minZ), isoMaxY = ISO_Y(box.maxX, box.maxZ);
  const scale = Math.min(
    canvas.clientWidth / ((isoMaxX - isoMinX) * halfW),
    canvas.clientHeight / ((isoMaxY - isoMinY) * halfH),
  ) * 0.92;
  const offsetX = (canvas.clientWidth - (isoMaxX - isoMinX) * halfW * scale) / 2;
  const offsetY = (canvas.clientHeight - (isoMaxY - isoMinY) * halfH * scale) / 2;
  return {
    scale,
    toScreen: (x, z) => ({
      x: offsetX + (ISO_X(x, z) - isoMinX) * halfW * scale,
      y: offsetY + (ISO_Y(x, z) - isoMinY) * halfH * scale,
    }),
    toWorld: (sx, sy) => {
      const ix = (sx - offsetX) / (halfW * scale) + isoMinX;
      const iy = (sy - offsetY) / (halfH * scale) + isoMinY;
      return {x: (ix + iy) / 2, z: (iy - ix) / 2};
    },
  };
}

function resize() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(canvas.clientWidth * ratio);
  canvas.height = Math.floor(canvas.clientHeight * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

const icons = new Map();
function iconFor(anchor) {
  if (!anchor.icon) return null;
  if (!icons.has(anchor.icon)) { const image = new Image(); image.src = anchor.icon; icons.set(anchor.icon, image); }
  return icons.get(anchor.icon);
}

const removed = () => probe.tutorial.completedIds.includes(401);

function visibleAnchors() {
  return room.anchors.filter((anchor) => !(anchor.furnitureId === 9114 && removed()));
}

function draw() {
  const box = focusBox();
  const view = project(box);
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  // Diamond floor cells; the checker pattern makes the isometric grid readable.
  const x0 = Math.floor(box.minX), x1 = Math.ceil(box.maxX);
  const z0 = Math.floor(box.minZ), z1 = Math.ceil(box.maxZ);
  for (let gz = z0; gz < z1; gz++) for (let gx = x0; gx < x1; gx++) {
    const a = view.toScreen(gx, gz), b = view.toScreen(gx + 1, gz), c = view.toScreen(gx + 1, gz + 1), d = view.toScreen(gx, gz + 1);
    context.beginPath();
    context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.lineTo(c.x, c.y); context.lineTo(d.x, d.y); context.closePath();
    context.fillStyle = ((gx + gz) % 2 === 0) ? '#191d18' : '#1c211b';
    context.fill();
    context.strokeStyle = '#222722';
    context.lineWidth = 1;
    context.stroke();
  }
  const corners = [[box.minX, box.minZ], [box.maxX, box.minZ], [box.maxX, box.maxZ], [box.minX, box.maxZ]].map(([x, z]) => view.toScreen(x, z));
  context.beginPath();
  context.moveTo(corners[0].x, corners[0].y);
  for (const corner of corners.slice(1)) context.lineTo(corner.x, corner.y);
  context.closePath();
  context.strokeStyle = '#4e5541';
  context.lineWidth = 3;
  context.stroke();
  // Depth order: everything shares the same x+z axis, so a single sort hides correctly.
  const drawables = visibleAnchors().map((anchor) => ({kind: 'anchor', anchor, depth: anchor.x + anchor.z}));
  drawables.push({kind: 'player', depth: player.x + player.z});
  drawables.sort((left, right) => left.depth - right.depth);
  for (const item of drawables) {
    if (item.kind === 'player') {
      const me = view.toScreen(player.x, player.z);
      context.fillStyle = '#f4e8c3';
      context.beginPath(); context.arc(me.x, me.y - 14, 9, 0, Math.PI * 2); context.fill();
      context.strokeStyle = '#1b1f18'; context.lineWidth = 2; context.stroke();
      context.fillStyle = 'rgba(0,0,0,0.35)';
      context.beginPath(); context.ellipse(me.x, me.y, 10, 5, 0, 0, Math.PI * 2); context.fill();
      continue;
    }
    const anchor = item.anchor;
    const point = view.toScreen(anchor.x, anchor.z);
    const image = iconFor(anchor);
    if (image && image.complete && image.naturalWidth) context.drawImage(image, point.x - 20, point.y - 36, 40, 40);
    else { context.fillStyle = '#59654c'; context.beginPath(); context.arc(point.x, point.y - 16, 12, 0, Math.PI * 2); context.fill(); }
    context.fillStyle = '#cfd3c4';
    context.font = '13px system-ui';
    context.textAlign = 'center';
    context.fillText(anchor.name, point.x, point.y + 18);
  }
}

function renderHud() {
  const reading = probeReading(probe, tables);
  $('day').textContent = String(reading.day + 1);
  const hours = Math.floor(reading.gameSeconds / 3600), minutes = Math.floor(reading.gameSeconds / 60) % 60;
  $('time').textContent = String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
  $('attrs').replaceChildren(...ATTRIBUTE_LABELS.map(([key, label]) => {
    const row = document.createElement('div'); row.className = 'attr';
    const name = document.createElement('span'); name.textContent = label;
    const value = document.createElement('b'); value.textContent = Math.floor(reading.attributes[key].value) + ' / ' + reading.attributes[key].maximum;
    row.append(name, value); return row;
  }));
  const parts = [];
  if (reading.hunger) parts.push('饥饿');
  if (reading.meal?.status === 'active') parts.push('进食中');
  if (reading.nap === 'active') parts.push('小睡中');
  if (reading.speedScale !== 1) parts.push('时间倍率 ×' + reading.speedScale);
  $('status').textContent = parts.join(' · ') || ('时间倍率 ×' + reading.speedScale);
}

function renderTasks() {
  const rows = tutorialRows(tables.Guide, probe.tutorial);
  if (!rows.length) {
    const done = document.createElement('li');
    done.textContent = probe.tutorial.completed ? '本章教程已完成' : '当前没有进行中的任务';
    $('tasks').replaceChildren(done);
    return;
  }
  $('tasks').replaceChildren(...rows.map((row) => {
    const item = document.createElement('li');
    item.textContent = (row.completed ? '✓ ' : row.priority ? '▶ ' : '○ ') + row.text;
    item.className = row.completed ? 'done' : row.priority ? 'priority' : '';
    return item;
  }));
}

function addLog(text) {
  log.unshift(text);
  $('log').replaceChildren(...log.slice(0, 60).map((line) => { const item = document.createElement('div'); item.textContent = line; return item; }));
}

function renderWardrobe() {
  const cells = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
    const cell = document.createElement('div');
    cell.className = 'slot';
    const item = probe.wardrobe.find((entry) => entry.x === x && entry.y === y);
    if (item) {
      const config = tables.Item.find((row) => row.ID === item.configId);
      const image = document.createElement('img');
      image.src = '/WebUI/' + String(config.WebIcon).replace('../../', '');
      image.alt = config.ItemName_Local;
      cell.title = config.ItemName_Local + '（点击进食）';
      cell.classList.add('item');
      cell.append(image);
      cell.addEventListener('click', () => eat(item.configId));
    }
    cells.push(cell);
  }
  $('wardrobe').replaceChildren(...cells);
}

function eat(configId) {
  try {
    probe = startProbeMeal(probe, tables, configId);
    addLog('开始进食 ' + tables.Item.find((row) => row.ID === configId).ItemName_Local + '。');
    renderWardrobe();
  } catch (error) {
    addLog('无法进食：' + error.message + '（当前页面只接了金枪鱼和薯片的动作路径）');
  }
}

const state = {near: null};
function interact(anchor) {
  if (!anchor) return;
  try {
    const action = anchor.furnitureId === 9111 ? 'wardrobe'
      : anchor.kind === 'sleep' ? 'nap'
      : anchor.furnitureId === 9114 ? 'obstacle'
      : anchor.kind === 'openDoor' ? 'door' : null;
    if (action) {
      const result = performAction(probe, action, tables);
      if (result.ok) probe = result.state;
      if (action === 'wardrobe') { addLog('搜索衣柜：5×3，' + probe.wardrobe.length + ' 件食物。'); renderWardrobe(); }
      else if (action === 'nap') addLog('开始小睡（Action200，3 小时）。');
      else if (action === 'obstacle') addLog(result.ok ? '查看门口的障碍物。' : result.message);
      else if (action === 'door') addLog(result.ok ? '打开房门，可以出门探索了。' : '房门被障碍物挡住，先移除障碍物。');
    } else if (anchor.kind === 'openBag') {
      addLog('查看 ' + anchor.name + '：容器尚未接入本页面。');
    } else {
      addLog('查看 ' + anchor.name + '。');
    }
  } catch (error) {
    addLog('无法执行：' + error.message);
  }
  renderTasks(); renderHud();
}

function updatePrompt() {
  const found = nearestAnchor({...room, anchors: visibleAnchors()}, player);
  state.near = found ? found.anchor : null;
  const prompt = $('prompt');
  if (state.near) { prompt.textContent = '交互：' + state.near.verb + '（' + state.near.name + '）'; prompt.classList.add('on'); }
  else prompt.classList.remove('on');
}

function step(dt) {
  const moved = stepPlayer(room, player, dt);
  player.x = moved.x; player.z = moved.z; player.tx = moved.tx; player.tz = moved.tz;
  if (exhausted) return;
  frameDebt += dt * 30;
  const whole = Math.min(Math.floor(frameDebt), PROBE_COVERAGE.maximumFrames - probe.frame);
  if (whole < 1) return;
  frameDebt -= whole;
  try { probe = advancePrologueProbe(probe, whole, tables); }
  catch (error) { exhausted = error.message; addLog('对照停止：' + error.message); }
  if (probe.frame >= PROBE_COVERAGE.maximumFrames && !exhausted) { exhausted = '已到本次对照的帧数上限'; addLog('已到本次对照的时间上限（' + PROBE_COVERAGE.maximumFrames + ' 帧）。'); }
  renderWardrobe();
}

canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect();
  const world = project(focusBox()).toWorld(event.clientX - rect.left, event.clientY - rect.top);
  const target = clampToBounds(room, world.x, world.z);
  player.tx = target.x; player.tz = target.z;
});
$('prompt').addEventListener('click', () => interact(state.near));
window.addEventListener('keydown', (event) => { if (event.key === 'f' || event.key === 'F') interact(state.near); });
window.addEventListener('resize', () => resize());

window.__prologueRoom = {
  room, interact, walkTo: (x, z) => { const t = clampToBounds(room, x, z); player.tx = t.x; player.tz = t.z; },
  position: () => ({x: player.x, z: player.z}),
  log: () => [...log],
  probe: () => probe,
  eat,
  // Test hook: fast-forward the probe so browser checks need not wait in real time.
  advance: (frames) => { probe = advancePrologueProbe(probe, frames, tables); renderTasks(); renderHud(); renderWardrobe(); },
  tutorial: () => tutorialRows(tables.Guide, probe.tutorial),
  reading: () => probeReading(probe, tables),
};

let previous = performance.now();
function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - previous) / 1000));
  previous = now;
  step(dt);
  draw();
  renderHud();
  renderTasks();
  updatePrompt();
  requestAnimationFrame(frame);
}

resize();
renderWardrobe();
renderTasks();
renderHud();
addLog('进入序章房间：' + room.anchors.length + ' 个家具锚点，坐标取自 Config_Map。');
requestAnimationFrame(frame);
