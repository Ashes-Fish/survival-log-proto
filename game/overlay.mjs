// Non-modal original WebUI pages layered over the 3D view (plan-mode bottom bar BuildTips,
// the plan-mode exit button PlanModeBtn). Unlike panels.mjs (one full-screen modal page
// at a time), these pages stay up while the world is clicked, so each iframe only takes
// the pointer inside the rectangles its page reports through webui-core's clickThrough
// (window.parent.syncInteractiveRects(pageId, rects) with fractions of the viewport — the
// role the original Root page plays). Everywhere else the pointer reaches the canvas.
const pages = new Map(); // pageId -> {frame, rects, ready, queue}

// webui-core calls these on the parent window (same origin). Pages that are not overlays
// (the modal panels) report rects too; those are ignored.
window.syncInteractiveRects = (pageId, rects) => {
  const p = pages.get(pageId);
  if (p) p.rects = Array.isArray(rects) ? rects : [];
};

function inside(p, x, y) {
  const fx = x / innerWidth, fy = y / innerHeight;
  return p.rects.some((r) => fx >= r.x && fx <= r.x + r.w && fy >= r.y && fy <= r.y + r.h);
}
function gate(x, y) {
  for (const p of pages.values()) p.frame.style.pointerEvents = inside(p, x, y) ? 'auto' : 'none';
}
addEventListener('pointermove', (e) => gate(e.clientX, e.clientY), true);

addEventListener('message', (event) => {
  for (const [pageId, p] of pages) {
    if (event.source !== p.frame.contentWindow) continue;
    const m = event.data;
    if (!m || typeof m.type !== 'string') return;
    if (m.type === '__PAGE_READY__') { p.ready = true; const q = p.queue; p.queue = []; q.forEach((x) => post(pageId, x.type, x.data)); return; }
    if (m.type.startsWith('__') || m.type.startsWith('SFX_')) return;
    p.onEvent?.(m.type, m.data ?? {});
    return;
  }
});

export function openOverlay(pageId, src, {onEvent, messages = []} = {}) {
  closeOverlay(pageId);
  const frame = document.createElement('iframe');
  frame.src = src;
  frame.className = 'overlay-frame';
  frame.dataset.overlay = pageId;
  frame.style.pointerEvents = 'none';
  document.body.appendChild(frame);
  const p = {frame, rects: [], ready: false, queue: [], onEvent};
  pages.set(pageId, p);
  // The pointer leaving a rect over the iframe is only seen by the iframe's own window.
  frame.addEventListener('load', () => frame.contentWindow.addEventListener('pointermove', (e) => gate(e.clientX, e.clientY)));
  messages.forEach((m) => post(pageId, m.type, m.data));
  return p;
}
export function post(pageId, type, data) {
  const p = pages.get(pageId);
  if (!p) return;
  if (!p.ready) { p.queue.push({type, data}); return; }
  p.frame.contentWindow.postMessage({type, data, sourcePageId: 'game'}, '*');
}
export function closeOverlay(pageId) {
  const p = pages.get(pageId);
  if (!p) return;
  p.frame.remove();
  pages.delete(pageId);
  window.focus(); // keyboard focus may have been inside the removed page
}
export const overlayOpen = (pageId) => pages.has(pageId);
export const overlayReady = (pageId) => Boolean(pages.get(pageId)?.ready);
