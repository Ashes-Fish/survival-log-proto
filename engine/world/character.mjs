import * as THREE from 'three';
import {GLTFLoader} from '../../world/vendor/GLTFLoader.js';

// The shipped clips are Unity muscle (humanoid) animations. tools/assets/export-animations.py
// decodes them into bone quaternion tracks (character-anims.json); when that file is
// missing the rig falls back to the procedural idle sway / walk cycle below.
const WALK_LEG = THREE.MathUtils.degToRad(28);
const WALK_KNEE = THREE.MathUtils.degToRad(32);
const WALK_ARM = THREE.MathUtils.degToRad(22);

export async function loadCharacter(url = './assets/character.glb', {animsUrl = url.replace(/[^/]+\.glb$/, 'character-anims.json'), idleKey = 'idle'} = {}) {
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().load(url, resolve, undefined, reject));
  const root = gltf.scene;
  root.traverse((node) => {
    if (node.isSkinnedMesh) {
      node.frustumCulled = false;
      // Base colour texture embedded by export-character-glb.py --texture (P2.2); without
      // one a neutral clay tone keeps the shape readable.
      const map = node.material?.map ?? null;
      if (map) map.colorSpace = THREE.SRGBColorSpace;
      node.material = new THREE.MeshStandardMaterial({color: map ? '#ffffff' : '#c9b79a', map, roughness: 0.8});
      // 125k skinned vertices are the costliest thing on screen; skip shadow passes.
      node.castShadow = false;
      node.receiveShadow = false;
    }
  });

  const bones = {};
  root.traverse((node) => {
    if (node.isBone) bones[node.name] = node;
  });
  const rest = new Map();
  for (const [name, bone] of Object.entries(bones)) rest.set(name, bone.quaternion.clone());

  const offset = new THREE.Quaternion();
  const axisX = new THREE.Vector3(1, 0, 0);
  const axisZ = new THREE.Vector3(0, 0, 1);
  let phase = 0;

  function bend(name, radians, axis = axisX) {
    const bone = bones[name];
    if (!bone) return;
    bone.quaternion.copy(rest.get(name)).multiply(offset.setFromAxisAngle(axis, radians));
  }

  // pose: Effect.ConfigName of the running action (sleep lies down, others idle-work).
  function update(dt, speed, pose = null) {
    const moving = speed > 0.05;
    if (pose && clips) { playClip(/Sleep/.test(pose) ? 'sleep' : 'work'); mixer.update(dt); return; }
    if (clips) { playClip(moving ? 'walk' : idleKey); mixer.update(dt); return; }
    phase += dt * (moving ? 6.5 : 1.2);
    const swing = Math.sin(phase);
    const breathe = Math.sin(phase * 0.5) * 0.02;

    if (moving) {
      bend('mixamorig:LeftUpLeg', swing * WALK_LEG);
      bend('mixamorig:RightUpLeg', -swing * WALK_LEG);
      bend('mixamorig:LeftLeg', Math.max(0, -swing) * WALK_KNEE);
      bend('mixamorig:RightLeg', Math.max(0, swing) * WALK_KNEE);
      bend('mixamorig:LeftArm', -swing * WALK_ARM, axisZ);
      bend('mixamorig:RightArm', swing * WALK_ARM, axisZ);
      bend('mixamorig:Spine', breathe);
    } else {
      bend('mixamorig:Spine', breathe);
      bend('mixamorig:Spine2', breathe * 1.5);
      bend('mixamorig:LeftArm', Math.sin(phase) * 0.03, axisZ);
      bend('mixamorig:RightArm', -Math.sin(phase) * 0.03, axisZ);
      bend('mixamorig:LeftUpLeg', 0);
      bend('mixamorig:RightUpLeg', 0);
      bend('mixamorig:LeftLeg', 0);
      bend('mixamorig:RightLeg', 0);
    }
  }

  function face(dx, dz) {
    if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return;
    root.rotation.y = Math.atan2(dx, dz);
  }

  // Decoded clips (tools/assets/export-animations.py → character-anims.json), when present.
  let clips = null, mixer = null, active = null;
  try {
    const response = await fetch(animsUrl);
    if (response.ok) {
      const data = await response.json();
      mixer = new THREE.AnimationMixer(root);
      clips = {};
      for (const [key, clip] of Object.entries(data.clips)) {
        // GLTFLoader sanitises node names (mixamorig:Hips -> mixamorigHips); match the same way.
        const bone = (name) => bones[name] ?? bones[THREE.PropertyBinding.sanitizeNodeName(name)];
        const tracks = clip.tracks.filter((track) => bone(track.bone)).map((track) =>
          new THREE.QuaternionKeyframeTrack(bone(track.bone).name + '.quaternion', track.times, track.values));
        if (tracks.length) clips[key] = mixer.clipAction(new THREE.AnimationClip(clip.name, clip.duration, tracks));
      }
      if (!Object.keys(clips).length) clips = null;
    }
  } catch { clips = null; }
  function playClip(key) {
    const next = clips[key] ?? clips[idleKey] ?? clips.idle;
    if (!next || next === active) return;
    next.reset().fadeIn(0.2).play();
    active?.fadeOut(0.2);
    active = next;
  }

  return {root, bones: Object.keys(bones).length, update, face, hasClips: () => Boolean(clips)};
}
