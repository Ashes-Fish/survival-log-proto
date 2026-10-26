// In-game HUD for the full game (game/index.html). Plain DOM over the canvas: clock,
// five attribute bars with buff chips, current action progress, nearest-object prompt,
// furniture action menu, story popup, toasts, black-screen interstitial, event log.
// Layout follows the original HUD (top-right clock/day, bottom-right attribute bars,
// top-left objectives); visuals are a stand-in, not the original CoreUI1 page.
const ATTR = [['Satiety', '饱腹', '#c9a54a'], ['Morale', '心态', '#c46aa6'], ['Stamina', '精力', '#d0524a'], ['Health', '健康', '#5fa36b'], ['Vitality', '生命', '#5a86c8']];
const DAYLIGHT = [[5, 10, '清晨'], [10, 15, '日间'], [15, 20, '傍晚'], [20, 29, '夜间']];

export function createGameHud() {
  const $ = (id) => document.getElementById(id);
  const logBox = $('log');
  let menuOpen = false;
  let menuPick = null;
  let gameOver = false;
  let lastRender = 0;

  function log(text) {
    const row = document.createElement('div');
    row.textContent = text;
    logBox.prepend(row);
    while (logBox.children.length > 40) logBox.lastChild.remove();
  }

  let toastTimer = null;
  function toast(text) {
    const box = $('toast');
    box.textContent = text;
    box.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('on'), 2200);
  }

  function render(session, T, near, tasks = []) {
    const now = performance.now();
    if (now - lastRender < 120) return;
    lastRender = now;
    const w = session.world;
    const hour = Math.floor(w.time.seconds / 3600), minute = Math.floor((w.time.seconds % 3600) / 60);
    $('day').textContent = 'DAY ' + (w.time.day + 1);
    $('time').textContent = String(hour).padStart(2, '0') + ':' + String(Math.floor(minute / 10) * 10).padStart(2, '0');
    const h = hour < 5 ? hour + 24 : hour;
    $('phase').textContent = (DAYLIGHT.find(([s, e]) => h >= s && h < e) ?? DAYLIGHT[3])[2] + (w.speed > 1 ? ' ×' + w.speed : '');
    $('money').textContent = '💰 ' + w.money;
    const bars = ATTR.map(([key, label, color]) => {
      const value = w.values[key];
      const max = Math.max(1, T.attr.get(w.attributeId)['Max' + key] + (key ? 0 : 0));
      const pct = Math.max(0, Math.min(1, value / max));
      return '<div class="bar' + (pct <= 0.2 ? ' low' : '') + '"><span class="label">' + label + '</span><span class="track"><i style="width:' + (pct * 100).toFixed(1) + '%;background:' + color + '"></i></span><span class="num">' + Math.round(value) + '/' + max + '</span></div>';
    }).join('');
    $('bars').innerHTML = bars;
    const buffs = w.buffs.map((b) => T.buff.get(b.id)).filter((b) => b && !b.IsHide && b.Name_Local);
    $('buffs').innerHTML = buffs.map((b) => '<span class="buff ' + (b.IsGood ? 'good' : 'bad') + '" title="' + (b.Des_Local ?? '').replace(/\\n/g, '\n').replace(/"/g, '&quot;') + '">' + b.Name_Local + '</span>').join('');
    const a = w.action;
    const box = $('action');
    if (a) {
      const action = T.action.get(a.actionId);
      box.classList.add('on');
      box.querySelector('.name').textContent = action?.NameDoing_Local || action?.Name_Local || '行动中';
      box.querySelector('.fill').style.width = (a.during ? Math.min(100, a.elapsed / a.during * 100) : 100).toFixed(1) + '%';
    } else box.classList.remove('on');
    $('near').textContent = near ? 'E · ' + near.name : '';
    $('near').classList.toggle('on', Boolean(near));
    if (session.instance) {
      const inst = T.raw.Instance.find((r) => r.ID === session.instance.id);
      $('exposure').classList.add('on');
      $('exposure').querySelector('i').style.width = Math.min(100, w.exposure / inst.ExposureLimit * 100).toFixed(1) + '%';
    } else $('exposure').classList.remove('on');
    // Active dynamic-event tasks (top-left under the log), like the original CoreUI1 list.
    $('tasks').innerHTML = tasks.map((t) => '<div class="task"><div class="t">' + t.title + '</div>' + (t.info ? '<div class="i">' + t.info + '</div>' : '') + '</div>').join('');
  }

  // Furniture function bar, laid out like the original (observed 2026-10-24,
  // compare-2026-10-23 n52/n75/n76): the furniture name floats above it, the functions sit
  // in ONE row next to the furniture, the first available one carries the E hotkey chip,
  // unavailable ones are greyed and show their reason as a tooltip on hover (no costs or
  // reasons written inline). Icons are the FurnitureFunc.BtnIcon files.
  // opts.plan: the plan-mode slot menu — buttons stacked vertically, no title and no E chip
  // (observed s2-12: 「拆除 / 移动」 one per row beside the slot).
  function showMenu(anchor, buttons, onPick, at = null, opts = {}) {
    const box = $('menu');
    box.innerHTML = '';
    box.classList.toggle('plan', Boolean(opts.plan));
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = anchor.name;
    box.appendChild(title);
    const row = document.createElement('div');
    row.className = 'row';
    box.appendChild(row);
    let hotkeyGiven = false;
    for (const b of buttons) {
      const item = document.createElement('button');
      item.className = 'item' + (b.enabled ? '' : ' disabled');
      item.dataset.funcId = b.id;
      const icon = b.icon ? '../WebUI/Res/icon/' + b.icon.split('/').pop() : '';
      item.innerHTML = (icon ? '<img class="ico" alt="">' : '') + '<span class="label"></span>';
      if (icon) item.querySelector('.ico').src = icon;
      item.querySelector('.label').textContent = b.label;
      if (b.enabled && !hotkeyGiven && !opts.plan) { hotkeyGiven = true; item.classList.add('hot'); item.insertAdjacentHTML('beforeend', '<span class="key">E</span>'); }
      const why = b.enabled ? b.tip : (b.tip || b.lacks.join('，'));
      if (why) item.dataset.tip = why;
      item.addEventListener('mouseenter', () => showTip(item));
      item.addEventListener('mouseleave', hideTip);
      item.addEventListener('pointerdown', (e) => e.stopPropagation());
      item.addEventListener('click', (e) => { e.stopPropagation(); if (!b.enabled) return; hideMenu(); onPick(b); });
      row.appendChild(item);
    }
    const tip = document.createElement('div');
    tip.className = 'tipbox';
    box.appendChild(tip);
    box.classList.add('on');
    if (at) { box.classList.add('anchored'); place(at); }
    else { box.style.left = box.style.top = ''; box.classList.remove('anchored'); }
    menuOpen = true;
    menuPick = () => { const hot = row.querySelector('.item.hot'); if (hot) hot.click(); };
  }
  function showTip(item) {
    const tip = $('menu').querySelector('.tipbox');
    if (!tip || !item.dataset.tip) return;
    tip.textContent = item.dataset.tip;
    tip.classList.add('on');
    // Original n76: the reason box sits to the left of the bar, level with it.
    const r = $('menu').querySelector('.row').getBoundingClientRect();
    tip.style.transform = 'translate(' + Math.round(Math.max(8, r.left - tip.offsetWidth - 10)) + 'px,' + Math.round(r.top + (r.height - tip.offsetHeight) / 2) + 'px)';
  }
  // Anchored layout (original n52/n76): the title floats above the furniture's top centre,
  // the row sits left of the furniture, vertically centred on it; the plan menu stacks
  // beside the slot. Kept on screen.
  function place(at) {
    const box = $('menu');
    const title = box.querySelector('.title'), row = box.querySelector('.row');
    box.style.left = '0px'; box.style.top = '0px';
    const rw = row.offsetWidth, rh = row.offsetHeight;
    let rx = (at.left ?? at.x) - rw - 10, ry = (at.midY ?? at.y) - rh / 2;
    // Right edge keeps clear of the side buttons (60 px + 25 px margin).
    if (rx < 8) rx = Math.min(innerWidth - rw - 100, (at.right ?? at.x) + 10);
    rx = Math.max(8, rx);
    ry = Math.max(8, Math.min(innerHeight - rh - 8, ry));
    row.style.transform = 'translate(' + Math.round(rx) + 'px,' + Math.round(ry) + 'px)';
    title.style.transform = 'translate(' + Math.round(at.x) + 'px,' + Math.round((at.top ?? at.y) - 26) + 'px) translateX(-50%)';
  }
  function hideTip() { $('menu').querySelector('.tipbox')?.classList.remove('on'); }
  function hideMenu() { $('menu').classList.remove('on'); menuOpen = false; menuPick = null; }

  function showStory(story, onConfirm) {
    const box = $('story');
    box.querySelector('.title').textContent = story.StoryName_Local;
    box.querySelector('.body').textContent = story.Des1_Local ?? '';
    box.querySelector('.quote').textContent = (story.Des2_Local ?? '').replace(/\\n/g, '\n');
    const button = box.querySelector('button');
    button.textContent = story.ButtonDes_Local || '确定';
    button.onclick = () => { box.classList.remove('on'); onConfirm(); };
    box.classList.add('on');
  }

  return {
    log, toast, render, showMenu, hideMenu, showStory,
    menuOpen: () => menuOpen,
    // Keep the bar pinned above its furniture while the follow camera moves.
    placeMenu: (at) => { if (!menuOpen || !at || !$('menu').classList.contains('anchored')) return; place(at); },
    pickHotkey: () => { if (menuPick) { menuPick(); return true; } return false; },
    prompt: (text) => { $('exitPrompt').textContent = text; $('exitPrompt').classList.toggle('on', Boolean(text)); },
    setScene: (name) => { $('scene').textContent = name; },
    blackScreen: (text) => { $('black').querySelector('.text').textContent = text; $('black').classList.add('on'); },
    hideBlackScreen: () => $('black').classList.remove('on'),
    gameOver: () => { gameOver = true; },
    isGameOver: () => gameOver,
  };
}
