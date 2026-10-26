import {OBJLoader} from '../../world/vendor/OBJLoader.js';
import {MTLLoader} from '../../world/vendor/MTLLoader.js';
import * as THREE from 'three';

const objLoader = new OBJLoader();
const mtlLoader = new MTLLoader();

// Loaded furniture models, one per URL for the page's lifetime. Every placement gets a
// clone that shares geometry, materials and textures, so switching scenes does not
// re-upload them (review-2026-10-22 #5: each home visit re-created ~800 textures that were
// never freed). Shared resources are therefore never disposed by a scene.
const modelCache = new Map();

// OBJ + MTL pair; a missing MTL is not an error, the caller falls back to a flat tint.
// Returns a fresh clone (null when the OBJ is missing).
export async function loadModel(name, base = './assets/') {
  const url = base + name;
  if (!modelCache.has(url)) modelCache.set(url, loadSource(url));
  const source = await modelCache.get(url);
  return source ? source.clone(true) : null;
}

async function loadSource(url) {
  const materials = await new Promise((resolve) => {
    mtlLoader.load(url + '.mtl', (loaded) => { loaded.preload(); resolve(loaded); }, undefined, () => resolve(null));
  });
  const loader = new OBJLoader();
  if (materials) loader.setMaterials(materials);
  const object = await new Promise((resolve) => loader.load(url + '.obj', resolve, undefined, () => resolve(null)));
  if (object) object.traverse((child) => { if (child.isMesh) collapseMaterialGroups(child); });
  return object;
}

// A single exported furniture mesh can carry a long material array — one draw call per
// draw group — while most of those materials are visually identical (the worst market
// prop shipped 311 groups for 29 distinct looks; batch 8 #draw calls). This collapses a
// multi-material mesh to one group per material SIGNATURE: groups that look the same are
// concatenated into one contiguous vertex range sharing one material, so N draws become
// #unique-signatures draws. Only non-indexed triangle geometry is touched (every exported
// furniture OBJ is non-indexed), whole groups are copied so triangles stay intact, and the
// vertex bounds are unchanged — footprints, solids and the walk grid all read Box3 bounds,
// never the draw groups, so collision and navigation are identical. Runs once on the cached
// source; every placement clone shares the collapsed geometry and material array. Any
// failure leaves the mesh exactly as loaded.
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
function materialKey(m) {
  // Texture key shared with scene-loader: URL for MTL <img> textures, source identity for
  // GLB ImageBitmaps.
  const tex = m.map ? textureId(m.map) : 'none';
  return [m.type, tex, m.color?.getHexString?.() ?? '', m.transparent ? 't' : 'o', m.alphaTest ?? 0, m.side,
    m.roughness ?? '', m.metalness ?? '', m.emissive?.getHexString?.() ?? '', m.map?.colorSpace ?? '',
    m.map ? [m.map.repeat?.x, m.map.repeat?.y, m.map.offset?.x, m.map.offset?.y].join(',') : ''].join('|');
}
export function collapseMaterialGroups(mesh) {
  try {
    const geo = mesh.geometry, mats = mesh.material;
    if (!geo || !Array.isArray(mats) || mats.length < 2) return;
    if (geo.index || mesh.isSkinnedMesh || mesh.morphTargetInfluences?.length) return;
    const groups = geo.groups;
    if (!groups || groups.length < 2 || !geo.attributes.position) return;
    // One new material per signature, in first-seen order; each group maps to its slot.
    const slotOf = new Map(); const newMats = []; const groupSlot = [];
    for (const g of groups) {
      const m = mats[g.materialIndex];
      if (!m) return; // malformed material index -> leave untouched
      const key = materialKey(m);
      if (!slotOf.has(key)) { slotOf.set(key, newMats.length); newMats.push(m); }
      groupSlot.push(slotOf.get(key));
    }
    if (newMats.length >= groups.length) return; // nothing to gain
    // Copy each group's vertex range into its slot's run, so a slot becomes one draw group.
    const buckets = newMats.map(() => []);
    groups.forEach((g, i) => buckets[groupSlot[i]].push(g));
    let total = 0; for (const g of groups) total += g.count;
    const names = Object.keys(geo.attributes);
    const src = {}, dst = {}, item = {}, norm = {};
    for (const name of names) { const a = geo.attributes[name]; src[name] = a.array; item[name] = a.itemSize; norm[name] = a.normalized; dst[name] = new a.array.constructor(total * a.itemSize); }
    let cursor = 0; const newGroups = [];
    for (let slot = 0; slot < buckets.length; slot++) {
      const start = cursor;
      for (const g of buckets[slot]) {
        for (const name of names) {
          const is = item[name];
          dst[name].set(src[name].subarray(g.start * is, (g.start + g.count) * is), cursor * is);
        }
        cursor += g.count;
      }
      if (cursor > start) newGroups.push({start, count: cursor - start, materialIndex: slot});
    }
    for (const name of names) geo.setAttribute(name, new THREE.BufferAttribute(dst[name], item[name], norm[name]));
    geo.clearGroups();
    for (const g of newGroups) geo.addGroup(g.start, g.count, g.materialIndex);
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    mesh.material = newMats;
  } catch { /* leave the mesh as loaded */ }
}

// Number of distinct models loaded so far (perf/debug).
export const cachedModels = () => modelCache.size;

// Materials exported from Unity carry colours but often no texture; without a tint the
// props render black, which loses all shape reading. Cached models share their materials,
// so an untextured material is cloned before it is tinted.
export function applyShading(object, tint) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const material = child.material;
    if (!material) return;
    if (Array.isArray(material)) { child.material = material.map((m) => shade(m, tint)); return; }
    child.material = shade(material, tint);
  });
}
function shade(material, tint) {
  if (material.map) { material.map.colorSpace = THREE.SRGBColorSpace; return material; }
  const own = material.clone();
  own.color = tint;
  return own;
}
void objLoader;
