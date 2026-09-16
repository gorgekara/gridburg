import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GRID } from '../constants';

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Call once per frame with seconds elapsed. */
  update(dt: number): void;
}

export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc6e4f5);
  scene.fog = new THREE.Fog(0xc6e4f5, 90, 220);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);
  camera.position.set(28, 34, 42);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = false;
  controls.minDistance = 8;
  controls.maxDistance = 130;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI / 2.25;
  controls.zoomSpeed = 1.2;
  controls.mouseButtons = {
    LEFT: null as unknown as THREE.MOUSE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.target.set(0, 0, 0);

  // Lights
  const hemi = new THREE.HemisphereLight(0xdcefff, 0x6f8f52, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(45, 70, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48;
  sc.near = 10; sc.far = 200;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID, GRID),
    new THREE.MeshStandardMaterial({ color: 0x8cbf68, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const outer = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID * 6, GRID * 6),
    new THREE.MeshStandardMaterial({ color: 0x74a655, roughness: 1 }),
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.03;
  outer.receiveShadow = true;
  scene.add(outer);

  const grid = new THREE.GridHelper(GRID, GRID, 0x5f8a45, 0x5f8a45);
  const gm = grid.material as THREE.LineBasicMaterial;
  gm.transparent = true;
  gm.opacity = 0.18;
  grid.position.y = 0.012;
  scene.add(grid);

  // Resize
  function resize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // Keyboard pan
  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    keys.add(e.code || e.key.toLowerCase());
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); keys.delete(e.key.toLowerCase()); });
  window.addEventListener('blur', () => keys.clear());

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();
  const half = GRID / 2;

  function update(dt: number): void {
    let mx = 0;
    let mz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp') || keys.has('w')) mz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown') || keys.has('s')) mz -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight') || keys.has('d')) mx += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft') || keys.has('a')) mx -= 1;
    if (mx !== 0 || mz !== 0) {
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      right.crossVectors(fwd, new THREE.Vector3(0, 1, 0));
      const dist = camera.position.distanceTo(controls.target);
      const s = dt * (0.35 * dist + 6);
      move.set(0, 0, 0).addScaledVector(fwd, mz * s).addScaledVector(right, mx * s);
      camera.position.add(move);
      controls.target.add(move);
    }
    // Clamp the orbit target to the map.
    const t = controls.target;
    const cx = Math.max(-half, Math.min(half, t.x));
    const cz = Math.max(-half, Math.min(half, t.z));
    if (cx !== t.x || cz !== t.z) {
      camera.position.x += cx - t.x;
      camera.position.z += cz - t.z;
      t.x = cx;
      t.z = cz;
    }
    t.y = 0;
    controls.update();
    sun.target.position.copy(t);
    sun.position.set(t.x + 45, 70, t.z + 25);
  }

  return { renderer, scene, camera, controls, update };
}
