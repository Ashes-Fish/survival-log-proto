// HUD owns the DOM: clock, attributes, quest counter, nearest anchor, event log.
const ATTRIBUTE_LABELS = {Satiety: '饱腹', Morale: '心态', Stamina: '精力', Health: '健康', Vitality: '生命'};
// The rules clock starts at 0; the original prologue HUD opens at 06:10. The HUD/GameTime
// mapping is still unverified, so this is an explicit display offset (see m5-audit).
export const CLOCK_OFFSET_SECONDS = 6 * 3600 + 10 * 60;

export function createHud({maxLog = 60} = {}) {
  const day = document.getElementById('day');
  const time = document.getElementById('time');
  const speed = document.getElementById('speed');
  const attrs = document.getElementById('attrs');
  const quest = document.getElementById('quest');
  const pos = document.getElementById('pos');
  const near = document.getElementById('near');
  const prompt = document.getElementById('prompt');
  const logBox = document.getElementById('log');
  const capNote = document.getElementById('capnote');
  let timer = 0;

  function log(text) {
    const row = document.createElement('div');
    row.textContent = text;
    logBox.prepend(row);
    while (logBox.children.length > maxLog) logBox.lastChild.remove();
  }

  function renderReading(reading, questDone, objective) {
    day.textContent = 'DAY ' + (reading.day + 1);
    const shown = reading.gameSeconds + CLOCK_OFFSET_SECONDS;
    time.textContent = String(Math.floor(shown / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(shown / 60) % 60).padStart(2, '0');
    speed.textContent = reading.speedScale > 1.01 ? '×' + reading.speedScale : '';
    attrs.innerHTML = Object.entries(reading.attributes).map(([key, value]) =>
      '<div><span>' + (ATTRIBUTE_LABELS[key] ?? key) + '</span><span>' + Math.round(value.value) + ' / ' + Math.round(value.maximum) + '</span></div>').join('');
    quest.textContent = objective ? '任务：' + objective : '教程 ' + questDone + ' 步（已完成）';
  }

  function renderNear(anchor) {
    if (anchor) {
      prompt.textContent = 'E · ' + anchor.name;
      prompt.classList.add('on');
      near.textContent = anchor.name;
    } else {
      prompt.classList.remove('on');
      near.textContent = '—';
    }
  }

  function renderPosition(position) {
    pos.textContent = position.x.toFixed(1) + ', ' + position.z.toFixed(1);
  }

  function throttle(dt) {
    timer -= dt;
    if (timer > 0) return false;
    timer = 0.15;
    return true;
  }

  function showCapNote() { if (capNote) capNote.style.display = 'block'; }

  return {log, renderReading, renderNear, renderPosition, throttle, showCapNote};
}
