import * as THREE from 'three';

const AZIMUTH = Math.PI / 4;
const ELEVATION = Math.PI / 4;
const DISTANCE = 24;

export function createCamera({width, depth}) {
  let view = Math.max(width, depth) * 0.8 + 4;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const target = new THREE.Vector3();

  function resize() {
    const aspect = innerWidth / innerHeight;
    camera.left = -view * aspect / 2;
    camera.right = view * aspect / 2;
    camera.top = view / 2;
    camera.bottom = -view / 2;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  function follow(position, dt) {
    target.lerp(new THREE.Vector3(position.x, 0.9, position.z), Math.min(1, dt * 4));
    camera.position.set(
      target.x + DISTANCE * Math.cos(ELEVATION) * Math.cos(AZIMUTH),
      target.y + DISTANCE * Math.sin(ELEVATION),
      target.z + DISTANCE * Math.cos(ELEVATION) * Math.sin(AZIMUTH),
    );
    camera.lookAt(target);
  }

  function snapTo(position) { target.set(position.x, 0.9, position.z); follow(position, 1); }

  return {camera, resize, follow, snapTo, viewSize: () => view};
}
