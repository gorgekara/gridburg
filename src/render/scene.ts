import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GRID } from '../constants';
import { daylight } from './daylight';

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Construction grid, shown only while a build tool is active. */
  grid: THREE.GridHelper;
  /** Call once per frame with seconds elapsed. */
  update(dt: number, seconds: number): void;
  /** While walking, the orbit camera and its keys stand down and the sun follows the walker. */
  setWalking(on: boolean): void;
}

export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc6e4f5);
  scene.fog = new THREE.Fog(0xc6e4f5, 120, 280);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);
  camera.position.set(30, 38, 46);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = false;
  controls.minDistance = 8;
  controls.maxDistance = 170;
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
  sc.left = -58; sc.right = 58; sc.top = 58; sc.bottom = -58;
  sc.near = 10; sc.far = 200;
  // The sun crawls across the sky, so refreshing the shadow map every frame is wasted work.
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  const grid = new THREE.GridHelper(GRID, GRID, 0x5f8a45, 0x5f8a45);
  const gm = grid.material as THREE.LineBasicMaterial;
  gm.transparent = true;
  gm.opacity = 0.3;
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

  let frame = 0;
  let walking = false;
  /**
   * At street level the sun's shadows are drawn from a small box around the camera at four times the
   * resolution, every frame, so a lamp post, a bench or a person casts a crisp shadow that moves with
   * them; the haze comes in closer too, for depth. Back on the map the wide, coarse box returns.
   */
  const STREET_BOX = 9;
  function setWalking(on: boolean): void {
    if (walking === on) { controls.enabled = !on; return; }
    walking = on;
    controls.enabled = !on;
    const box = on ? STREET_BOX : 58;
    sc.left = -box; sc.right = box; sc.top = box; sc.bottom = -box;
    sc.updateProjectionMatrix();
    sun.shadow.mapSize.set(on ? 4096 : 2048, on ? 4096 : 2048);
    sun.shadow.map?.dispose();
    (sun.shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
    sun.shadow.bias = on ? -0.00018 : -0.0008;
    sun.shadow.normalBias = on ? 0.004 : 0.02;
    sun.shadow.autoUpdate = on;
    sun.shadow.needsUpdate = true;
    const fog = scene.fog as THREE.Fog;
    fog.near = on ? 28 : 120; fog.far = on ? 150 : 280;
    if (!on) controls.update();
  }
  function update(dt: number, seconds: number): void {
    if (++frame % 3 === 0) sun.shadow.needsUpdate = true;
    if (walking) {
      // The walker owns the camera; keep the sun's shadow box centred a little ahead of it, snapped to
      // whole shadow texels so the edges of shadows do not crawl as you move.
      const ahead = new THREE.Vector3();
      camera.getWorldDirection(ahead);
      const texel = (STREET_BOX * 2) / sun.shadow.mapSize.x;
      const tx = Math.round((camera.position.x + ahead.x * STREET_BOX * 0.45) / texel) * texel;
      const tz = Math.round((camera.position.z + ahead.z * STREET_BOX * 0.45) / texel) * texel;
      sun.target.position.set(tx, 0, tz);
      light(seconds, sun.target.position);
      return;
    }
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
    // Q / E orbit the camera around the point it is looking at.
    let spin = 0;
    if (keys.has('KeyQ') || keys.has('q')) spin += 1;
    if (keys.has('KeyE') || keys.has('e')) spin -= 1;
    if (spin !== 0) {
      const a = spin * dt * 1.7;
      const ox = camera.position.x - controls.target.x;
      const oz = camera.position.z - controls.target.z;
      const cs = Math.cos(a), sn = Math.sin(a);
      camera.position.x = controls.target.x + ox * cs - oz * sn;
      camera.position.z = controls.target.z + ox * sn + oz * cs;
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
    light(seconds, t);
  }

  function light(seconds: number, t: THREE.Vector3): void {
    const light = daylight(seconds);
    const angle = (light.hour - 6) / 24 * Math.PI * 2;
    sun.position.set(t.x + Math.cos(angle) * 65, 15 + Math.abs(light.sun) * 70, t.z + 25);
    sun.intensity = 0.45 + light.day * (1.5 + Math.max(0, light.sun) * 0.7);
    sun.color.set(0x9bbdff).lerp(new THREE.Color(0xffd6ac), light.day).lerp(new THREE.Color(0xfff1dc), Math.max(0, light.sun));
    hemi.intensity = 0.6 + light.day * 0.25;
    hemi.color.set(0xa1b4de).lerp(new THREE.Color(0xdcefff), light.day);
    const sky = scene.background as THREE.Color;
    sky.set(0x101c38).lerp(new THREE.Color(0xc6e4f5), light.day);
    sky.lerp(new THREE.Color(0xe6aa89), (1 - Math.abs(light.day * 2 - 1)) * 0.35);
    (scene.fog as THREE.Fog).color.copy(sky);
    renderer.toneMappingExposure = 1.12 - light.day * 0.07;
  }

  return { renderer, scene, camera, controls, grid, update, setWalking };
}
