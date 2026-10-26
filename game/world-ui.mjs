// Labels and markers drawn over the 3D view, following the original home screen
// (observed in 1.1.19131, investigation/compare-2026-10-23 n20/n30/n71/n75, s2-03/s2-04):
//   - hovering a furniture outlines it in yellow and floats its name above it;
//   - furniture carrying an unread "inspect" story shows a white magnifier above it;
//   - furniture with a shown durability (Furniture.isShowHP, the home door) carries a green
//     「700/1000」 bar;
//   - the character's thoughts appear as a short line of text above its head.
// The outline is an inverted-hull copy of the model (a stand-in for the original's
// post-process contour); marker and bubble styling is matched by eye.
import * as THREE from 'three';

// Stencil outline: a mask copy marks the furniture's own pixels (stencil 1, no colour),
// then a slightly grown copy is drawn only where the mask is not set, leaving a rim around
// the silhouette (inner parts such as handles stay unpainted).
const MASK = new THREE.MeshBasicMaterial({colorWrite: false, depthWrite: false, stencilWrite: true, stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp});
const OUTLINE = new THREE.MeshBasicMaterial({color: '#e9d77a', depthWrite: false, stencilWrite: true, stencilRef: 1,
  stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp});

export function createWorldUi({camera, scene3, layer}) {
  const markers = new Map(); // key -> {el, kind}
  let hover = null; // {anchor, outline, label}
  const bubble = document.createElement('div');
  bubble.className = 'wu-say';
  layer.appendChild(bubble);
  const sayQueue = [];
  let sayUntil = 0;

  function project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return {x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, front: v.z < 1};
  }
  const top = (box) => project((box.minX + box.maxX) / 2, box.maxY ?? 1, (box.minZ + box.maxZ) / 2);

  // ---- hover ------------------------------------------------------------------
  function setHover(anchor, name) {
    if (hover?.anchor === anchor) return;
    clearHover();
    if (!anchor?.object) return;
    const outline = anchor.object.clone(true);
    outline.traverse((node) => { if (node.isMesh) { node.material = OUTLINE; node.castShadow = false; node.receiveShadow = false; node.renderOrder = 21; } });
    const mask = anchor.object.clone(true);
    mask.traverse((node) => { if (node.isMesh) { node.material = MASK; node.castShadow = false; node.receiveShadow = false; node.renderOrder = 20; } });
    // Grow the copy around the furniture's centre by a fixed margin (≈3 cm each side).
    const b = anchor.box;
    const size = Math.max(0.2, b.maxX - b.minX, b.maxZ - b.minZ, (b.maxY ?? 1) - (b.minY ?? 0));
    const k = 1 + 0.12 / size;
    const centre = new THREE.Vector3((b.minX + b.maxX) / 2, ((b.minY ?? 0) + (b.maxY ?? 1)) / 2, (b.minZ + b.maxZ) / 2);
    const wrap = new THREE.Group();
    wrap.position.copy(centre);
    outline.position.sub(centre);
    wrap.add(outline);
    wrap.scale.setScalar(k);
    scene3.add(wrap);
    scene3.add(mask);
    wrap.userData.mask = mask;
    const label = document.createElement('div');
    label.className = 'wu-name';
    label.textContent = name;
    layer.appendChild(label);
    hover = {anchor, outline: wrap, label};
  }
  function clearHover() {
    if (!hover) return;
    hover.outline.userData.mask?.removeFromParent();
    hover.outline.removeFromParent();
    hover.label.remove();
    hover = null;
  }

  // ---- markers (magnifier, durability bar) -------------------------------------
  function marker(key, kind) {
    let m = markers.get(key);
    if (!m || m.kind !== kind) {
      m?.el.remove();
      const el = document.createElement('div');
      el.className = 'wu-' + kind;
      if (kind === 'hp') el.innerHTML = '<i></i><span></span>';
      layer.appendChild(el);
      m = {el, kind};
      markers.set(key, m);
    }
    m.seen = true;
    return m;
  }

  // anchors: [{key, box, magnifier: bool, hp: {hp, max} | null}]
  function update(anchors, playerHead) {
    for (const m of markers.values()) m.seen = false;
    for (const a of anchors) {
      if (!a.box) continue;
      const at = top(a.box);
      if (a.magnifier) {
        const m = marker(a.key + ':mag', 'mag');
        m.el.style.transform = 'translate(' + Math.round(at.x - 11) + 'px,' + Math.round(at.y - 30) + 'px)';
        m.el.hidden = !at.front;
      }
      if (a.hp) {
        const m = marker(a.key + ':hp', 'hp');
        m.el.querySelector('i').style.width = (Math.max(0, Math.min(1, a.hp.hp / a.hp.max)) * 100).toFixed(1) + '%';
        m.el.querySelector('span').textContent = Math.round(a.hp.hp) + '/' + a.hp.max;
        m.el.style.transform = 'translate(' + Math.round(at.x - 56) + 'px,' + Math.round(at.y - 18) + 'px)';
        m.el.hidden = !at.front;
      }
    }
    for (const [key, m] of markers) if (!m.seen) { m.el.remove(); markers.delete(key); }
    if (hover) {
      const at = top(hover.anchor.box ?? {minX: 0, maxX: 0, minZ: 0, maxZ: 0});
      hover.label.style.transform = 'translate(' + Math.round(at.x) + 'px,' + Math.round(at.y - 34) + 'px) translateX(-50%)';
    }
    // speech bubble
    const now = performance.now();
    if (now > sayUntil && sayQueue.length) {
      bubble.textContent = sayQueue.shift();
      sayUntil = now + Math.max(3500, bubble.textContent.length * 180);
    }
    bubble.classList.toggle('on', now < sayUntil);
    if (now < sayUntil && playerHead) {
      const at = project(playerHead.x, playerHead.y, playerHead.z);
      bubble.style.transform = 'translate(' + Math.round(at.x) + 'px,' + Math.round(at.y) + 'px) translate(-50%,-100%)';
    }
  }

  function say(text) {
    const t = (text ?? '').replace(/\\n/g, ' ').trim();
    // Skip a line already queued or on screen right now; a finished line may be said again.
    if (t && !sayQueue.includes(t) && !(performance.now() < sayUntil && bubble.textContent === t)) sayQueue.push(t);
  }

  function hide(on) { layer.classList.toggle('off', on); if (on) clearHover(); }
  // Plan mode hides the thought line (the original shows none there, s2-10).
  function quiet(on) { bubble.style.visibility = on ? 'hidden' : ''; }

  return {setHover, clearHover, update, say, hide, quiet, hovered: () => hover?.anchor ?? null, speaking: () => performance.now() < sayUntil ? bubble.textContent : '', queued: () => [bubble.textContent, ...sayQueue]};
}
