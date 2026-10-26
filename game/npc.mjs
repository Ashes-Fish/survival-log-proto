// NPCs (M6.5): Config_GuidanceNpc rows placed at Config_Map nodes (world/scenes/<id>.json
// `npcs`), drawn with a skinned model exported from the NPC animation package
// (tools/assets/export-character-glb.py → world/assets/npc-*.glb). Bubble lines are the
// ConstantText keys in GuidanceNpc.Msg; an NPC with ShopID opens the shop panel.
// The model comes from Config_Player.SpineName (scene JSON `model`); bubble cadence and
// order are a stand-in (INFERRED).
import * as THREE from 'three';

const TALK_RADIUS = 1.6;

export async function createNpcs({scene3, desc, T, tables, session, hud, loadCharacter}) {
  const group = new THREE.Group();
  group.name = 'npcs';
  scene3.add(group);
  const text = (key) => tables.ConstantText.find((r) => r.ID === key)?.Text_Local ?? '';
  const list = [];
  for (const [i, n] of (desc.npcs ?? []).entries()) {
    const holder = new THREE.Group();
    holder.position.set(n.x, n.y ?? 0, n.z);
    holder.rotation.y = -THREE.MathUtils.degToRad(n.unityYawDeg ?? 0);
    let character = null;
    try {
      if (!n.model) throw new Error('no model');
      character = await loadCharacter('../world/' + n.model.replace(/^\.\//, ''), {animsUrl: '../world/assets/character-anims.json', idleKey: 'npcIdle'});
      holder.add(character.root);
    } catch {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.1, 4, 8), new THREE.MeshStandardMaterial({color: '#8c9aa8'}));
      body.position.y = 0.8;
      holder.add(body);
    }
    const bubble = makeBubble();
    bubble.position.y = 2.05;
    holder.add(bubble);
    group.add(holder);
    const box = {minX: n.x - 0.3, maxX: n.x + 0.3, minZ: n.z - 0.3, maxZ: n.z + 0.3};
    list.push({...n, holder, character, bubble, box, line: 0, shownUntil: 0, nextIdle: 4 + i * 3});
  }

  function say(npc, line, seconds = 4) {
    if (!line) return;
    drawBubble(npc.bubble, line);
    npc.bubble.visible = true;
    npc.shownUntil = performance.now() / 1000 + seconds;
  }

  return {
    list: () => list.map((n) => ({id: n.id, name: n.name, shopId: n.shopId, x: n.x, z: n.z, bubble: n.bubble.visible ? n.bubble.userData.text : ''})),
    pick(ray) {
      const hit = ray.intersectObjects(list.map((n) => n.holder), true)[0];
      if (!hit) return null;
      return list.find((n) => { let o = hit.object; while (o) { if (o === n.holder) return true; o = o.parent; } return false; }) ?? null;
    },
    nearest(p) {
      let best = null, bestD = TALK_RADIUS;
      for (const n of list) { const d = Math.hypot(n.x - p.x, n.z - p.z); if (d < bestD) { bestD = d; best = n; } }
      return best;
    },
    talk(npc) {
      const keys = npc.bubbles;
      const line = keys.length ? text(keys[npc.line % keys.length]) : '……';
      npc.line += 1;
      say(npc, line, 5);
      hud.log(npc.name + '：' + line);
      return {line, shopId: npc.shopId};
    },
    update(dt, p) {
      const now = performance.now() / 1000;
      for (const n of list) {
        n.character?.update(dt, 0, null);
        if (n.bubble.visible && now > n.shownUntil) n.bubble.visible = false;
        // Idle chatter when the player is nearby (INFERRED cadence).
        n.nextIdle -= dt;
        if (n.nextIdle <= 0) {
          n.nextIdle = 9 + Math.random() * 6;
          if (Math.hypot(n.x - p.x, n.z - p.z) < 6 && n.bubbles.length) say(n, text(n.bubbles[Math.floor(Math.random() * n.bubbles.length)]));
        }
      }
    },
    // NPC models (loadCharacter reads the GLB afresh) and bubble canvases belong to this
    // scene: free their GPU resources with it.
    dispose() {
      group.traverse((node) => {
        node.geometry?.dispose?.();
        if (node.isSkinnedMesh) node.skeleton?.dispose?.();
        for (const m of node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []) {
          for (const key of ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap']) m[key]?.dispose?.();
          m.dispose?.();
        }
      });
      group.removeFromParent();
    },
  };
}

function makeBubble() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true}));
  sprite.scale.set(2.4, 0.6, 1);
  sprite.visible = false;
  sprite.renderOrder = 10;
  sprite.userData.canvas = canvas;
  return sprite;
}

function drawBubble(sprite, line) {
  const c = sprite.userData.canvas, g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(20,22,20,0.82)';
  g.beginPath(); g.roundRect(4, 4, c.width - 8, c.height - 24, 18); g.fill();
  g.fillStyle = '#f2ead8';
  g.font = '28px "Microsoft YaHei", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const text = line.length > 18 ? line.slice(0, 17) + '…' : line;
  g.fillText(text, c.width / 2, (c.height - 20) / 2);
  sprite.material.map.needsUpdate = true;
  sprite.userData.text = line;
}
