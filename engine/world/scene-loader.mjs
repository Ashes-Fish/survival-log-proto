// Loads a scene description (world/scenes/<id>.json, built by scripts/build-scenes.mjs)
// into a three.js group: the exported shell GLB, furniture models at their Config_Map
// anchors, and the collision data the navigator needs. Disposing the returned handle
// removes everything it added, so scenes can be swapped in one renderer.
import * as THREE from 'three';
import {GLTFLoader} from '../../world/vendor/GLTFLoader.js';
import {mergeGeometries} from '../../world/vendor/BufferGeometryUtils.js';
import {loadModel} from './assets.mjs';

const gltfLoader = new GLTFLoader();
const shellCache = new Map();

// Cut-away: fragments above `cutHeight` on the camera side of the player are dropped, so
// the walls and roofs between the camera and the player stay out of the way (the
// original lowers its front walls the same way; the exact rule is INFERRED). Only a
// corridor toward the camera (uReach long, uWidth half-wide) is cut, so walls elsewhere
// keep their full height.
export function createCutaway() {
  const uniforms = {uPlayer: {value: new THREE.Vector3()}, uCamDir: {value: new THREE.Vector3(1, 0, 0)}, uCut: {value: 0.9}, uFloor: {value: 0}, uEnabled: {value: 1}, uReach: {value: 4.5}, uWidth: {value: 1.4}};
  function patch(material) {
    if (material.userData.cutaway) return;
    material.userData.cutaway = true;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;\nuniform vec3 uPlayer;\nuniform vec3 uCamDir;\nuniform float uCut;\nuniform float uFloor;\nuniform float uEnabled;\nuniform float uReach;\nuniform float uWidth;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (uEnabled > 0.5 && vCutWorld.y > uFloor + uCut) { vec2 d = vCutWorld.xz - uPlayer.xz; float along = dot(d, uCamDir.xz); float side = length(d - uCamDir.xz * along); if (along > 0.35 && along < uReach && side < uWidth) discard; }');
    };
    material.needsUpdate = true;
  }
  function update(player, camera, floor = 0) {
    uniforms.uPlayer.value.set(player.x, 0, player.z);
    const dir = new THREE.Vector3().subVectors(camera.position, new THREE.Vector3(player.x, camera.position.y, player.z));
    dir.y = 0; dir.normalize();
    uniforms.uCamDir.value.copy(dir);
    uniforms.uFloor.value = floor;
  }
  return {patch, update, uniforms};
}

async function loadShell(url) {
  if (!shellCache.has(url)) shellCache.set(url, gltfLoader.loadAsync(url).then((gltf) => { mergeShellDraws(gltf.scene); return gltf; }));
  const gltf = await shellCache.get(url);
  return gltf.scene.clone(true);
}

// Collapse the shell's static meshes to cut draw calls (the market/home shells ship ~1
// material per mesh — 220 meshes / 218 materials for home — so merging by material identity
// does nothing; batch 8 #draw calls). Meshes are grouped by a material SIGNATURE (texture
// image + colour + alpha/side + key PBR params); every group reuses one shared material and
// one merged geometry, so visually identical sub-meshes become a single draw. This only
// touches rendering — the walk grid comes from desc.occupancy and furniture solids, never
// the shell topology, so navigation is unchanged. Skinned/morph/multi-material meshes (none
// in the static shells) are left alone; any merge failure leaves the shell untouched.
const textureIds = new WeakMap();
let nextTextureId = 0;
function textureId(texture) {
  // MTL textures are <img> elements: one texture object per material even for the same file,
  // so their URL is the identity. GLB textures are ImageBitmaps (no URL); GLTFLoader shares
  // one source per image, so the source object is the identity there.
  const src = texture.image?.src || texture.image?.currentSrc;
  if (src) return src;
  const source = texture.source ?? texture.image ?? texture;
  if (!textureIds.has(source)) textureIds.set(source, ++nextTextureId);
  return textureIds.get(source);
}
function materialSignature(m) {
  // Keyed by textureId, not image.src alone: GLB textures are ImageBitmaps with no src, so a
  // src-only key made every textured shell material look identical and the merge painted
  // walls, doors and tiles with the floor texture (regression found 2026-10-23).
  const tex = m.map ? textureId(m.map) : 'none';
  return [m.type, tex, m.color?.getHexString?.() ?? '', m.transparent ? 't' : 'o', m.alphaTest ?? 0, m.side,
    m.roughness ?? '', m.metalness ?? '', m.emissive?.getHexString?.() ?? '', m.map?.colorSpace ?? '',
    m.map ? [m.map.repeat?.x, m.map.repeat?.y, m.map.offset?.x, m.map.offset?.y].join(',') : ''].join('|');
}
function mergeShellDraws(sceneRoot) {
  sceneRoot.updateMatrixWorld(true);
  const groups = new Map(); // signature -> {material, geometries}
  const toRemove = [];
  sceneRoot.traverse((node) => {
    if (!node.isMesh || node.isSkinnedMesh || node.morphTargetInfluences?.length || Array.isArray(node.material)) return;
    const geo = node.geometry?.clone();
    if (!geo || !node.material) return;
    geo.applyMatrix4(node.matrixWorld);
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    const sig = materialSignature(node.material);
    const bucket = groups.get(sig) ?? groups.set(sig, {material: node.material, geometries: []}).get(sig);
    bucket.geometries.push(geo);
    toRemove.push(node);
  });
  if (groups.size === 0) return;
  const merged = new THREE.Group();
  merged.name = 'shell-merged';
  for (const {material, geometries} of groups.values()) {
    try {
      const geo = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
      if (!geo) continue;
      // All sources share one material, so drop any inherited draw groups — a geometry with
      // N groups renders as N draw calls even with a single material (the market shell had a
      // 311-group mesh, i.e. 311 draws for one material).
      geo.clearGroups();
      const mesh = new THREE.Mesh(geo, material);
      mesh.matrixAutoUpdate = false; // geometry already baked into world space
      merged.add(mesh);
    } catch { return; } // leave the shell untouched if any group fails to merge
  }
  for (const node of toRemove) node.removeFromParent();
  sceneRoot.add(merged);
}

export async function fetchScene(id, base = './scenes/') {
  const response = await fetch(base + id + '.json');
  if (!response.ok) throw new Error('场景描述不存在：' + id);
  return response.json();
}

// options.anchorFilter(anchor) -> false hides that furniture (removed/disabled state).
// base: directory the scene JSON paths are relative to ('./' from world/, '../world/' from game/).
export async function loadScene(desc, {cutaway, anchorFilter = () => true, onProgress = () => {}, base = './'} = {}) {
  const group = new THREE.Group();
  group.name = 'scene-' + desc.id;
  onProgress(0.1, '外壳');
  const shell = await loadShell(base + desc.shell.replace(/^\.\//, ''));
  shell.position.y = -(desc.floorY ?? 0);
  shell.traverse((node) => {
    if (!node.isMesh) return;
    node.receiveShadow = true;
    node.castShadow = false;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const m of list) {
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      m.side = THREE.DoubleSide;
      cutaway?.patch(m);
    }
  });
  group.add(shell);

  const handle = {desc, group, anchors: [], solids: [], bounds: desc.bounds, grid: desc.occupancy ? {...desc.occupancy, floorY: 0} : null};
  let done = 0;
  for (const a of desc.anchors) {
    done += 1;
    if (!anchorFilter(a)) { handle.anchors.push({...a, object: null, box: null, solid: null, hidden: true}); continue; }
    onProgress(0.2 + 0.7 * done / desc.anchors.length, a.name);
    await placeModel(handle, a, {base});
  }
  const {anchors, solids} = handle;
  for (const c of desc.colliders ?? []) {
    // Shell colliders are in the exported (x-negated) frame already.
    solids.push({minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ, name: c.name || 'collider'});
  }
  onProgress(1, '完成');
  return Object.assign(handle, {
    dispose() {
      // The shell and the furniture models are cached and shared between visits
      // (shellCache, assets.mjs); only what this scene created itself is freed here.
      group.traverse((node) => {
        if (!node.userData.owned) return;
        node.geometry?.dispose?.();
        for (const m of Array.isArray(node.material) ? node.material : [node.material]) m?.dispose?.();
      });
      group.removeFromParent();
    },
  });
}

// Loads one furniture model at an anchor and registers it with a scene handle: its
// object, footprint box and walk-blocking solid. Used for the scene's own anchors and for
// furniture added at runtime (door parcels, installed furniture, re-shown guidance rows).
export async function placeModel(handle, a, {base = './'} = {}) {
  let object = a.model ? await loadModel(a.model, base + 'assets/') : null;
  if (!object) {
    object = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({color: '#6a6250'}));
    object.userData.owned = true;
    object.position.y = 0.25;
    const wrap = new THREE.Group(); wrap.add(object); object = wrap;
  }
  object.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true; node.receiveShadow = true;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const m of list) if (m?.map) m.map.colorSpace = THREE.SRGBColorSpace;
  });
  object.position.set(a.x, a.y ?? 0, a.z);
  // Exported meshes and anchors share the x-negated frame; a Unity yaw becomes -yaw.
  const yaw = -THREE.MathUtils.degToRad(a.unityYawDeg ?? 0);
  object.userData.anchorId = a.id;
  object.userData.guidanceId = a.guidanceId;
  // Footprint in the model's own frame, before the yaw: walking is blocked by this
  // oriented box, not by the world-axis box of a rotated model (a cart turned 107° in the
  // repair hut otherwise sealed the doorway to the exit).
  object.rotation.y = 0;
  const local = new THREE.Box3().setFromObject(object);
  object.rotation.y = yaw;
  handle.group.add(object);
  const b3 = new THREE.Box3().setFromObject(object);
  const box = {minX: b3.min.x, maxX: b3.max.x, minZ: b3.min.z, maxZ: b3.max.z, minY: b3.min.y, maxY: b3.max.y};
  // Small, flat or raised (on a table / wall-mounted) items do not block walking.
  const height = box.maxY - box.minY;
  const blocks = (a.y ?? 0) < 0.4 && height > 0.3 && (box.maxX - box.minX) * (box.maxZ - box.minZ) > 0.04;
  let solid = null;
  if (blocks) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const lx = (local.min.x + local.max.x) / 2 - a.x, lz = (local.min.z + local.max.z) / 2 - a.z;
    const obb = {cx: a.x + lx * c + lz * s, cz: a.z - lx * s + lz * c, hx: Math.max(0.02, (local.max.x - local.min.x) / 2 - 0.05), hz: Math.max(0.02, (local.max.z - local.min.z) / 2 - 0.05), cos: c, sin: s};
    solid = {minX: box.minX + 0.05, maxX: box.maxX - 0.05, minZ: box.minZ + 0.05, maxZ: box.maxZ - 0.05, name: a.name, obb};
  }
  if (solid) handle.solids.push(solid);
  const record = {...a, object, box, solid, point: new THREE.Vector3(a.x, 0, a.z)};
  const at = handle.anchors.findIndex((x) => x === a);
  if (at >= 0) handle.anchors[at] = record; else handle.anchors.push(record);
  return record;
}
