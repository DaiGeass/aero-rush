import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { audio } from './audio';
import { CAR_MODELS, DEFAULT_COLOR, type CarModel, type CarStats } from './cars';
import { cloneEnv, ENV_DAY, sampleEnv, type Env } from './environment';
import { DEFAULT_SETTINGS, getDifficulty, qualityTier, type DifficultyId, type GameMode, type Settings } from './settings';

export type Phase = 'menu' | 'playing' | 'paused' | 'over';

export interface Hud {
  score: number;
  speed: number;
  mult: number;
  combo: number;
  comboT: number;
  boost: number;
  lives: number;
  distance: number;
  boosting: boolean;
  /** 0 = pleno día, 1 = plena noche */
  night: number;
  /** posición dentro del ciclo (0..1) */
  cycle: number;
  /** modo de juego en curso */
  mode: GameMode;
  /** segundos restantes (sólo contrarreloj) */
  timeLeft: number;
  /** puntuación objetivo (sólo cuota) */
  target: number;
}

export interface GameOverInfo {
  score: number;
  distance: number;
  orbs: number;
  smashes: number;
  nearMisses: number;
  mode: GameMode;
  /** true si se cumplió el objetivo (o récord de cuota) */
  won: boolean;
  target: number;
}

export interface EngineCallbacks {
  onHud: (h: Hud) => void;
  onGameOver: (info: GameOverInfo) => void;
  onPhase: (p: Phase) => void;
}

// ---------- constants ----------
const ROAD_W = 14;
const LANES = [-4.67, 0, 4.67];
const CAR_LIMIT = 5.55;
const SPAWN_Z = -250;
const DESPAWN_Z = 18;
const ROAD_LEN = 620;
const MAX_ORBS = 90;
const MAX_LIVES = 3;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

/** Longitud de un ciclo completo día → atardecer → noche → amanecer, en metros. */
const CYCLE_LEN = 2600;

// ---------- world-bend shader (curvy road illusion) ----------
const bend = { uBendX: { value: 0 }, uBendY: { value: 0 } };
function patch<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (s) => {
    s.uniforms.uBendX = bend.uBendX;
    s.uniforms.uBendY = bend.uBendY;
    s.vertexShader =
      'uniform float uBendX;\nuniform float uBendY;\n' +
      s.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        float bzz = clamp(-mvPosition.z, 0.0, 300.0);
        mvPosition.x += uBendX * bzz * bzz;
        mvPosition.y += uBendY * bzz * bzz;
        gl_Position = projectionMatrix * mvPosition;`
      );
  };
  m.customProgramCacheKey = () => 'aero-bend';
  return m;
}

// ---------- geometry helpers ----------
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
function xf(geo: THREE.BufferGeometry, p: [number, number, number], r: [number, number, number] = [0, 0, 0], s: [number, number, number] = [1, 1, 1]) {
  const g = geo.clone();
  _q.setFromEuler(_e.set(r[0], r[1], r[2]));
  _m.compose(new THREE.Vector3(...p), _q, new THREE.Vector3(...s));
  g.applyMatrix4(_m);
  return g;
}
function merge(list: THREE.BufferGeometry[]) {
  const nonIdx = list.map((g) => (g.index ? g.toNonIndexed() : g));
  // keep only position/normal/uv
  nonIdx.forEach((g) => {
    Object.keys(g.attributes).forEach((k) => {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    });
  });
  return mergeGeometries(nonIdx, false)!;
}

// ---------- canvas textures ----------
function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeRoadTex() {
  const t = canvasTex(256, 512, (c) => {
    const g = c.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, '#bfeeff');
    g.addColorStop(0.5, '#f4fcff');
    g.addColorStop(1, '#bfeeff');
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 512);
    // subtle grid shimmer
    c.fillStyle = 'rgba(80,190,255,0.10)';
    for (let y = 0; y < 512; y += 64) c.fillRect(0, y, 256, 3);
    // edges
    c.fillStyle = '#6fd64a';
    c.fillRect(0, 0, 14, 512);
    c.fillRect(242, 0, 14, 512);
    c.fillStyle = '#ffffff';
    c.fillRect(14, 0, 5, 512);
    c.fillRect(237, 0, 5, 512);
    // alternating edge kerbs
    c.fillStyle = '#2fb6ff';
    for (let y = 0; y < 512; y += 128) {
      c.fillRect(0, y, 14, 64);
      c.fillRect(242, y, 14, 64);
    }
    // lane dashes
    const lx = [256 / 3, (256 * 2) / 3];
    lx.forEach((x) => {
      const dg = c.createLinearGradient(x - 4, 0, x + 4, 0);
      dg.addColorStop(0, 'rgba(0,170,255,0.2)');
      dg.addColorStop(0.5, 'rgba(0,170,255,1)');
      dg.addColorStop(1, 'rgba(0,170,255,0.2)');
      c.fillStyle = dg;
      c.fillRect(x - 4, 40, 8, 200);
      c.fillRect(x - 4, 296, 8, 200);
    });
  });
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeWaterTex() {
  const t = canvasTex(256, 256, (c) => {
    c.fillStyle = '#1eb2ea';
    c.fillRect(0, 0, 256, 256);
    c.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const r = rnd(8, 30);
      c.strokeStyle = `rgba(255,255,255,${rnd(0.08, 0.3)})`;
      c.lineWidth = rnd(1.5, 4);
      for (const ox of [-256, 0, 256])
        for (const oy of [-256, 0, 256]) {
          c.beginPath();
          c.arc(x + ox, y + oy, r, rnd(0, Math.PI), rnd(Math.PI, Math.PI * 2));
          c.stroke();
        }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeGlowTex() {
  return canvasTex(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
}

function makeChevronTex() {
  const t = canvasTex(128, 256, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#fff45c');
    g.addColorStop(1, '#6cff8c');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 256);
    c.fillStyle = 'rgba(255,255,255,0.95)';
    for (let i = 0; i < 2; i++) {
      const y = i * 128 + 20;
      c.beginPath();
      c.moveTo(14, y + 70);
      c.lineTo(64, y + 20);
      c.lineTo(114, y + 70);
      c.lineTo(114, y + 100);
      c.lineTo(64, y + 50);
      c.lineTo(14, y + 100);
      c.closePath();
      c.fill();
    }
    c.strokeStyle = 'rgba(255,255,255,1)';
    c.lineWidth = 8;
    c.strokeRect(4, -10, 120, 276);
  });
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------- particles ----------
class Particles {
  max: number;
  geo = new THREE.BufferGeometry();
  points: THREE.Points;
  pos: Float32Array;
  col: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  grav: Float32Array;
  base: Float32Array;
  cursor = 0;
  /** multiplicador de partículas según el preset de calidad */
  fxScale = 1;
  mat: THREE.ShaderMaterial;

  constructor(max: number) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.base = new Float32Array(max);
    const dyn = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3));
    this.geo.setAttribute('pcolor', dyn(this.col, 3));
    this.geo.setAttribute('psize', dyn(this.size, 1));
    this.geo.setAttribute('palpha', dyn(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uBendX: bend.uBendX, uBendY: bend.uBendY, uScale: { value: 500 } },
      vertexShader: `
        attribute vec3 pcolor; attribute float psize; attribute float palpha;
        uniform float uBendX; uniform float uBendY; uniform float uScale;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          float bz = clamp(-mv.z, 0.0, 300.0);
          mv.x += uBendX*bz*bz; mv.y += uBendY*bz*bz;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = psize * uScale / max(0.5, -mv.z);
          vColor = pcolor; vAlpha = palpha;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.15, d) * vAlpha;
          vec3 col = vColor + vec3(0.6) * smoothstep(0.25, 0.0, d);
          gl_FragColor = vec4(col, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, spread: number, color: THREE.Color, size: number, life: number, n: number, grav = 0) {
    const count = Math.max(1, Math.round(n * this.fxScale));
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const i3 = i * 3;
      this.pos[i3] = x;
      this.pos[i3 + 1] = y;
      this.pos[i3 + 2] = z;
      // random direction in sphere
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u) * spread * (0.4 + Math.random() * 0.6);
      this.vel[i3] = vx + Math.cos(th) * r;
      this.vel[i3 + 1] = vy + u * spread * (0.4 + Math.random() * 0.6);
      this.vel[i3 + 2] = vz + Math.sin(th) * r;
      this.col[i3] = color.r;
      this.col[i3 + 1] = color.g;
      this.col[i3 + 2] = color.b;
      const l = life * (0.6 + Math.random() * 0.6);
      this.life[i] = l;
      this.maxLife[i] = l;
      this.base[i] = size * (0.6 + Math.random() * 0.7);
      this.grav[i] = grav;
    }
  }

  update(dt: number, scroll: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      const i3 = i * 3;
      this.vel[i3 + 1] -= this.grav[i] * dt;
      const drag = 1 - Math.min(1, dt * 1.5);
      this.vel[i3] *= drag;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt + scroll;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, t * 1.5);
      this.size[i] = this.base[i] * (0.3 + 0.7 * t);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.pcolor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.psize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.palpha as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
  }
}

// ---------- entity types ----------
interface Flyer {
  flying: boolean;
  vx: number;
  vy: number;
  vz: number;
  sx: number;
  sy: number;
  sz: number;
  flyT: number;
}
interface TrafficCar extends Flyer {
  group: THREE.Group;
  active: boolean;
  x: number;
  z: number;
  tSpeed: number;
  targetX: number;
  willChange: boolean;
  changed: boolean;
  passed: boolean;
  appear: number;
  /** altura de flotación del modelo */
  hover: number;
}
interface Barrier extends Flyer {
  group: THREE.Group;
  active: boolean;
  x: number;
  z: number;
}
interface Pad {
  mesh: THREE.Mesh;
  active: boolean;
  x: number;
  z: number;
  used: boolean;
}
interface Deco {
  obj: THREE.Object3D;
  x: number;
  y: number;
  z: number;
  factor: number;
}

const C = {
  cyan: new THREE.Color('#5fe3ff'),
  white: new THREE.Color('#ffffff'),
  lime: new THREE.Color('#8dff5a'),
  orange: new THREE.Color('#ff9a3c'),
  coral: new THREE.Color('#ff5a5a'),
  yellow: new THREE.Color('#fff16a'),
  blue: new THREE.Color('#3aa0ff'),
  pink: new THREE.Color('#ff7ad9'),
  black: new THREE.Color('#000000'),
  // pares día → noche de la decoración, para teñirla en updateEnvironment
  grassDay: new THREE.Color('#5fd13f'),
  grassNight: new THREE.Color('#1b5340'),
  sandDay: new THREE.Color('#f7e8b5'),
  sandNight: new THREE.Color('#3d5a7c'),
  trunkDay: new THREE.Color('#f3efe6'),
  trunkNight: new THREE.Color('#7b93b4'),
  railNight: new THREE.Color('#9dc0e2'),
  barrierNight: new THREE.Color('#a8c6e4'),
  bubbleDay: new THREE.Color('#dffaff'),
  bubbleNight: new THREE.Color('#a9e4ff'),
  skyBubbleDay: new THREE.Color('#b8f4ff'),
  skyBubbleNight: new THREE.Color('#8fe0ff'),
  skyBubbleEmissive: new THREE.Color('#1d7cc0'),
};

// ================================================================
export class Engine {
  container: HTMLElement;
  overlay: HTMLElement;
  cb: EngineCallbacks;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  clock = new THREE.Clock();
  raf = 0;
  disposed = false;

  phase: Phase = 'menu';
  dying = false;
  deathT = 0;

  // player state
  carX = 0;
  carVX = 0;
  speed = 30;
  distance = 0;
  score = 0;
  lives = MAX_LIVES;
  combo = 0;
  comboT = 0;
  boost = 0.35;
  padT = 0;
  invuln = 0;
  hitStop = 0;
  trauma = 0;
  elapsed = 0;
  time = 0;
  boostVis = 0;
  wasBoosting = false;
  orbsCollected = 0;
  smashes = 0;
  nearMisses = 0;
  spawnDist = 0;
  nextGap = 40;
  hudT = 0;
  fovBase = 64;
  camBack = 0;
  deathVel = new THREE.Vector3();
  deathSpin = new THREE.Vector3();

  // input
  keys = new Set<string>();
  pointers = new Map<number, { x: number; y: number; sy: number; st: number; boost: boolean }>();
  boostBtn = false;

  // car selection
  carModel: CarModel = CAR_MODELS[0];
  carColor = DEFAULT_COLOR;
  playerBodyMat!: THREE.MeshPhongMaterial;
  playerHeadGlow!: THREE.Mesh;
  sharedCarMats: { glass: THREE.MeshPhongMaterial; white: THREE.MeshPhongMaterial; dark: THREE.MeshPhongMaterial } | null = null;
  headMat!: THREE.MeshBasicMaterial;
  tailMat!: THREE.MeshBasicMaterial;
  poolMat!: THREE.MeshBasicMaterial;
  trafficBodyMats: THREE.MeshPhongMaterial[] = [];

  // curvatura actual del trazado (afecta a la física y a la cámara)
  curve = 0;

  // environment (day/night)
  env: Env = cloneEnv(ENV_DAY);
  cycleT = 0;
  hemi!: THREE.HemisphereLight;
  sun!: THREE.DirectionalLight;
  skyMat!: THREE.ShaderMaterial;
  oceanMat!: THREE.MeshPhongMaterial;
  roadMat!: THREE.MeshPhongMaterial;
  slabMat!: THREE.MeshPhongMaterial;
  postMat!: THREE.MeshPhongMaterial;
  railMat2!: THREE.MeshPhongMaterial;
  orbInnerMat!: THREE.MeshPhongMaterial;
  orbOuterMat!: THREE.MeshPhongMaterial;
  cloudMat!: THREE.MeshLambertMaterial;
  padMat!: THREE.MeshBasicMaterial;
  bubbleMat!: THREE.MeshPhongMaterial;
  skyBubbleMat!: THREE.MeshPhongMaterial;
  grassMat!: THREE.MeshPhongMaterial;
  sandMat!: THREE.MeshPhongMaterial;
  trunkMat!: THREE.MeshPhongMaterial;
  barrierCoralMat!: THREE.MeshPhongMaterial;
  barrierWhiteMat!: THREE.MeshPhongMaterial;
  railMat!: THREE.MeshPhongMaterial;
  moon!: THREE.Mesh;

  // objects
  player!: THREE.Group;
  flames: THREE.Mesh[] = [];
  underGlow!: THREE.Mesh;
  exhaust: THREE.Vector3[] = [];
  traffic: TrafficCar[] = [];
  barriers: Barrier[] = [];
  pads: Pad[] = [];
  islands: Deco[] = [];
  clouds: Deco[] = [];
  bigBubbles: Deco[] = [];
  orbOuter!: THREE.InstancedMesh;
  orbInner!: THREE.InstancedMesh;
  orbShine!: THREE.InstancedMesh;
  orbX = new Float32Array(MAX_ORBS);
  orbY = new Float32Array(MAX_ORBS);
  orbZ = new Float32Array(MAX_ORBS);
  orbPh = new Float32Array(MAX_ORBS);
  orbOn = new Uint8Array(MAX_ORBS);
  posts!: THREE.InstancedMesh;
  bubbles!: THREE.InstancedMesh;
  bubbleData: { x: number; y: number; z: number; s: number; v: number }[] = [];
  lines!: THREE.InstancedMesh;
  lineData: { x: number; y: number; z: number }[] = [];
  linesMat!: THREE.MeshBasicMaterial;
  particles: Particles;
  roadTex!: THREE.CanvasTexture;
  waterTex!: THREE.CanvasTexture;
  chevronTex!: THREE.CanvasTexture;
  sky!: THREE.Mesh;
  dummy = new THREE.Object3D();
  zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  tmpV = new THREE.Vector3();

  // perf
  frameAcc = 0;
  frameN = 0;
  pr = 1;
  /** tope de pixel ratio según el preset de calidad */
  prCap = 2;
  /** devicePixelRatio de la pantalla */
  dpr = 1;
  /** ajustes activos (volumen aparte: lo gestiona audio.ts) */
  settings: Settings = { ...DEFAULT_SETTINGS };
  /** modo de juego en curso */
  mode: GameMode = 'survival';
  /** dificultad elegida */
  difficulty: DifficultyId = 'normal';
  /** segundos restantes en contrarreloj */
  timeLeft = 0;
  /** puntos objetivo en el modo cuota (0 si no aplica) */
  target = 0;
  ro: ResizeObserver;

  constructor(container: HTMLElement, overlay: HTMLElement, cb: EngineCallbacks, car?: { model: number; color: string }) {
    this.container = container;
    this.overlay = overlay;
    this.cb = cb;
    if (car) {
      this.carModel = CAR_MODELS[Math.max(0, Math.min(CAR_MODELS.length - 1, car.model))];
      this.carColor = car.color;
    }
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
    this.prCap = Math.min(dpr, mobile ? 1.5 : 2);
    this.pr = this.prCap;
    this.renderer = new THREE.WebGLRenderer({ antialias: dpr < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pr);
    this.renderer.setClearColor('#cdf3ff');
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.camera = new THREE.PerspectiveCamera(64, 1, 0.1, 1200);
    this.camera.position.set(0, 4, 9);
    this.scene.fog = new THREE.Fog('#cdf3ff', 50, 250);

    this.particles = new Particles(1000);
    this.scene.add(this.particles.points);

    this.buildWorld();
    this.resetRun();
    this.prefill(true);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.bindInput();
    this.clock.start();
    this.loop();
  }

  // ------------------------------------------------ world building
  buildWorld() {
    const s = this.scene;
    // lights
    this.hemi = new THREE.HemisphereLight('#e6f8ff', '#5fb878', 2.1);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.6);
    this.sun.position.set(-30, 60, -50);
    s.add(this.sun);
    const fill = new THREE.DirectionalLight('#9fe4ff', 0.9);
    fill.position.set(20, 10, 40);
    s.add(fill);

    // shared car light materials (opacity driven by night factor)
    this.headMat = new THREE.MeshBasicMaterial({ map: GLOW(), color: '#fff6c8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.tailMat = new THREE.MeshBasicMaterial({ map: GLOW(), color: '#ff3050', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.poolMat = new THREE.MeshBasicMaterial({ map: GLOW(), color: '#ffe9a8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    patch(this.headMat);
    patch(this.tailMat);
    patch(this.poolMat);

    // sky
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#0a63d8') },
        mid: { value: new THREE.Color('#49b8ff') },
        hor: { value: new THREE.Color('#cdf3ff') },
        sunDir: { value: new THREE.Vector3(-0.35, 0.28, -1).normalize() },
        sunCol: { value: new THREE.Color('#ffffff') },
        uStars: { value: 0 },
        uNight: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol;
        uniform float uStars; uniform float uNight; uniform float uTime; varying vec3 vP;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        void main(){
          vec3 d = normalize(vP);
          float h = d.y;
          vec3 c = mix(mid, top, smoothstep(0.05, 0.7, h));
          c = mix(hor, c, smoothstep(-0.02, 0.22, h));
          float s = max(0.0, dot(d, sunDir));
          // sun (day) fades into a moon (night)
          float sunGlow = pow(s, 400.0)*1.2 + pow(s, 40.0)*0.35 + pow(s, 6.0)*0.12;
          float moonDisc = smoothstep(0.9985, 0.9992, s) * 1.6 + pow(s, 80.0) * 0.25;
          c += sunCol * mix(sunGlow, moonDisc, uNight);
          // stars
          if (h > 0.0 && uStars > 0.01) {
            vec3 p = d * 260.0;
            vec3 ip = floor(p); vec3 fp = fract(p) - 0.5;
            float r = hash(ip);
            if (r > 0.975) {
              float dist = length(fp);
              float tw = 0.7 + 0.3 * sin(uTime * (2.0 + r * 4.0) + r * 60.0);
              float st = smoothstep(0.32, 0.0, dist) * (r - 0.975) / 0.025 * 3.0 * tw;
              c += vec3(0.9, 0.95, 1.0) * st * uStars * smoothstep(0.0, 0.25, h);
            }
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const skyMat = this.skyMat;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    s.add(this.sky);

    // moon glow sprite-plane (placed along sunDir at night)
    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 140),
      new THREE.MeshBasicMaterial({ map: GLOW(), color: '#dfe9ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    );
    this.moon.renderOrder = -9;
    this.moon.frustumCulled = false;
    s.add(this.moon);

    // ocean
    this.waterTex = makeWaterTex();
    this.waterTex.repeat.set(70, 70);
    this.oceanMat = patch(new THREE.MeshPhongMaterial({ map: this.waterTex, color: '#ffffff', specular: '#ffffff', shininess: 90 }));
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000, 40, 80).rotateX(-Math.PI / 2), this.oceanMat);
    ocean.position.set(0, -6, -600);
    ocean.frustumCulled = false;
    s.add(ocean);

    // road
    this.roadTex = makeRoadTex();
    this.roadTex.repeat.set(1, ROAD_LEN / 18);
    this.roadMat = patch(new THREE.MeshPhongMaterial({ map: this.roadTex, specular: '#ffffff', shininess: 70, emissive: '#3aa0ff', emissiveIntensity: 0 }));
    const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, ROAD_LEN, 1, 160).rotateX(-Math.PI / 2), this.roadMat);
    road.position.z = -ROAD_LEN / 2 + 30;
    road.frustumCulled = false;
    s.add(road);
    this.slabMat = patch(new THREE.MeshPhongMaterial({ color: '#48d2ff', transparent: true, opacity: 0.55, specular: '#ffffff', shininess: 120, emissive: '#1a80d0', emissiveIntensity: 0 }));
    const slab = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 0.6, 1.4, ROAD_LEN, 1, 1, 160), this.slabMat);
    slab.position.set(0, -0.72, road.position.z);
    slab.frustumCulled = false;
    s.add(slab);

    // rails
    const railGeo = new THREE.CylinderGeometry(0.16, 0.16, ROAD_LEN, 8, 160).rotateX(Math.PI / 2);
    const railMat = patch(new THREE.MeshPhongMaterial({ color: '#ffffff', specular: '#ffffff', shininess: 150 }));
    const railMat2 = patch(new THREE.MeshPhongMaterial({ color: '#7be34f', emissive: '#2a7a10', specular: '#ffffff', shininess: 150 }));
    this.railMat = railMat;
    this.railMat2 = railMat2;
    for (const sx of [-1, 1]) {
      const r1 = new THREE.Mesh(railGeo, railMat);
      r1.position.set(sx * 7.15, 0.95, road.position.z);
      r1.frustumCulled = false;
      const r2 = new THREE.Mesh(railGeo, railMat2);
      r2.position.set(sx * 7.15, 0.45, road.position.z);
      r2.scale.set(0.8, 1, 0.8);
      r2.frustumCulled = false;
      s.add(r1, r2);
    }
    this.postMat = patch(new THREE.MeshPhongMaterial({ color: '#e8f8ff', emissive: '#1a90c0', specular: '#ffffff', shininess: 150 }));
    this.posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.13, 1.1, 8), this.postMat, 80);
    this.posts.frustumCulled = false;
    s.add(this.posts);

    // orbs
    const orbOuterMat = patch(new THREE.MeshPhongMaterial({ color: '#8ff0ff', transparent: true, opacity: 0.42, specular: '#ffffff', shininess: 220, depthWrite: false, emissive: '#2fb0ff', emissiveIntensity: 0 }));
    const orbInnerMat = patch(new THREE.MeshPhongMaterial({ color: '#5dff9e', emissive: '#1bd46a', specular: '#ffffff', shininess: 120 }));
    this.orbOuterMat = orbOuterMat;
    this.orbInnerMat = orbInnerMat;
    const orbShineMat = patch(new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    this.orbOuter = new THREE.InstancedMesh(new THREE.SphereGeometry(0.72, 20, 14), orbOuterMat, MAX_ORBS);
    this.orbInner = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.34, 1), orbInnerMat, MAX_ORBS);
    this.orbShine = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6).scale(1, 0.6, 1), orbShineMat, MAX_ORBS);
    for (const im of [this.orbOuter, this.orbInner, this.orbShine]) {
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < MAX_ORBS; i++) im.setMatrixAt(i, this.zeroM);
      s.add(im);
    }
    this.orbOuter.renderOrder = 2;

    // player
    this.spawnPlayerMesh();

    // traffic: los 8 modelos circulan por la pista, uno de cada
    const tColors = ['#7ed957', '#ff5fa2', '#ffa630', '#a77bff', '#ffe14d', '#f6fbff', '#3fe0d0', '#30415e'];
    for (let i = 0; i < CAR_MODELS.length; i++) {
      const built = this.buildCar(tColors[i % tColors.length], false, CAR_MODELS[i]);
      const g = built.group;
      // de noche la carrocería del tráfico emite un halo de su propio color
      built.bodyMat.emissive.set(tColors[i % tColors.length]).multiplyScalar(0.42);
      this.trafficBodyMats.push(built.bodyMat);
      g.visible = false;
      s.add(g);
      this.traffic.push({
        group: g,
        active: false,
        x: 0,
        z: 0,
        tSpeed: 0,
        targetX: 0,
        willChange: false,
        changed: false,
        passed: false,
        appear: 1,
        hover: CAR_MODELS[i].hover,
        flying: false,
        vx: 0,
        vy: 0,
        vz: 0,
        sx: 0,
        sy: 0,
        sz: 0,
        flyT: 0,
      });
    }

    // barriers
    const capsule = new THREE.CapsuleGeometry(0.45, 3.0, 6, 14).rotateZ(Math.PI / 2);
    const coralMat = patch(new THREE.MeshPhongMaterial({ color: '#ff6a4d', specular: '#ffffff', shininess: 160, emissive: '#5a0d00' }));
    const whiteMat = patch(new THREE.MeshPhongMaterial({ color: '#ffffff', specular: '#ffffff', shininess: 160 }));
    this.barrierCoralMat = coralMat;
    this.barrierWhiteMat = whiteMat;
    const ring = new THREE.CylinderGeometry(0.48, 0.48, 0.32, 16).rotateZ(Math.PI / 2);
    const post = new THREE.CylinderGeometry(0.12, 0.12, 0.9, 8);
    const whiteParts = merge([xf(ring, [-0.9, 1.0, 0]), xf(ring, [0.9, 1.0, 0]), xf(post, [-1.4, 0.45, 0]), xf(post, [1.4, 0.45, 0])]);
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      const m1 = new THREE.Mesh(capsule, coralMat);
      m1.position.y = 1.0;
      const m2 = new THREE.Mesh(whiteParts, whiteMat);
      g.add(m1, m2);
      g.traverse((o) => (o.frustumCulled = false));
      g.visible = false;
      s.add(g);
      this.barriers.push({ group: g, active: false, x: 0, z: 0, flying: false, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, sz: 0, flyT: 0 });
    }

    // boost pads
    this.chevronTex = makeChevronTex();
    const padMat = patch(new THREE.MeshBasicMaterial({ map: this.chevronTex, transparent: true, opacity: 0.95 }));
    this.padMat = padMat;
    const padGeo = new THREE.PlaneGeometry(3.4, 6).rotateX(-Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(padGeo, padMat);
      m.position.y = 0.03;
      m.visible = false;
      m.frustumCulled = false;
      s.add(m);
      this.pads.push({ mesh: m, active: false, x: 0, z: 0, used: false });
    }

    // islands
    const grassMat = patch(new THREE.MeshPhongMaterial({ color: '#5fd13f', specular: '#d8ffd0', shininess: 60 }));
    const sandMat = patch(new THREE.MeshPhongMaterial({ color: '#f7e8b5', specular: '#ffffff', shininess: 30 }));
    const trunkMat = patch(new THREE.MeshPhongMaterial({ color: '#f3efe6', specular: '#ffffff', shininess: 40 }));
    this.grassMat = grassMat;
    this.sandMat = sandMat;
    this.trunkMat = trunkMat;
    const dome = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const ball = new THREE.SphereGeometry(1, 14, 10);
    const cyl = new THREE.CylinderGeometry(1, 1.12, 1, 20);
    const trunk = new THREE.CylinderGeometry(0.12, 0.18, 1, 6);
    for (let i = 0; i < 18; i++) {
      const r = rnd(5, 13);
      const h = rnd(2, 6);
      const greens: THREE.BufferGeometry[] = [xf(dome, [0, 0.2, 0], [0, 0, 0], [r, h, r])];
      const trunks: THREE.BufferGeometry[] = [];
      const nt = 1 + Math.floor(Math.random() * 3);
      for (let t = 0; t < nt; t++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * r * 0.45;
        const ts = rnd(2.5, 4.5);
        const tx = Math.cos(a) * d;
        const tz = Math.sin(a) * d;
        const base = h * Math.sqrt(Math.max(0, 1 - (d / r) ** 2));
        trunks.push(xf(trunk, [tx, base + ts * 0.9, tz], [0, 0, 0], [ts * 0.6, ts * 1.8, ts * 0.6]));
        greens.push(xf(ball, [tx, base + ts * 1.9, tz], [0, 0, 0], [ts * 0.8, ts * 0.72, ts * 0.8]));
      }
      const g = new THREE.Group();
      g.add(new THREE.Mesh(merge(greens), grassMat));
      g.add(new THREE.Mesh(merge(trunks), trunkMat));
      const sand = new THREE.Mesh(xf(cyl, [0, 0, 0], [0, 0, 0], [r * 1.1, 0.5, r * 1.1]), sandMat);
      g.add(sand);
      g.traverse((o) => (o.frustumCulled = false));
      s.add(g);
      const side = Math.random() < 0.5 ? -1 : 1;
      this.islands.push({ obj: g, x: side * rnd(22, 90), y: -6, z: rnd(-640, 20), factor: 1 });
    }

    // clouds
    const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#d4ecff', emissiveIntensity: 0.7, fog: false });
    this.cloudMat = cloudMat;
    for (let i = 0; i < 10; i++) {
      const parts: THREE.BufferGeometry[] = [];
      const n = 5 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const sc = rnd(6, 13);
        parts.push(xf(ball, [(k - n / 2) * rnd(6, 9), rnd(-2, 4), rnd(-4, 4)], [0, 0, 0], [sc, sc * 0.8, sc]));
      }
      const m = new THREE.Mesh(merge(parts), cloudMat);
      m.frustumCulled = false;
      s.add(m);
      const side = Math.random() < 0.5 ? -1 : 1;
      this.clouds.push({ obj: m, x: side * rnd(60, 260), y: rnd(35, 90), z: rnd(-700, -150), factor: 0.12 });
    }

    // big decorative sky bubbles
    const bbMat = new THREE.MeshPhongMaterial({ color: '#b8f4ff', emissive: '#000000', transparent: true, opacity: 0.3, specular: '#ffffff', shininess: 250, depthWrite: false });
    this.skyBubbleMat = bbMat;
    const bbGeo = new THREE.SphereGeometry(1, 24, 16);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(bbGeo, bbMat);
      const sc = rnd(3, 9);
      m.scale.setScalar(sc);
      m.frustumCulled = false;
      s.add(m);
      const side = Math.random() < 0.5 ? -1 : 1;
      this.bigBubbles.push({ obj: m, x: side * rnd(20, 70), y: rnd(10, 35), z: rnd(-500, -50), factor: 0.55 });
    }

    // small ambient bubbles
    this.bubbleMat = patch(new THREE.MeshPhongMaterial({ color: '#dffaff', transparent: true, opacity: 0.5, specular: '#ffffff', shininess: 200, depthWrite: false }));
    this.bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), this.bubbleMat, 60);
    this.bubbles.frustumCulled = false;
    this.bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 60; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.bubbleData.push({ x: side * rnd(8.5, 40), y: rnd(-6, 20), z: rnd(-300, 15), s: rnd(0.15, 0.6), v: rnd(0.8, 2.5) });
    }
    s.add(this.bubbles);

    // speed lines
    this.linesMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.lines = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.05, 7), this.linesMat, 40);
    this.lines.frustumCulled = false;
    this.lines.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 40; i++) this.lineData.push(this.randLine(rnd(-120, 10)));
    s.add(this.lines);
  }

  randLine(z: number) {
    const side = Math.random() < 0.5 ? -1 : 1;
    return { x: side * rnd(2.5, 11), y: rnd(0.3, 7), z };
  }

  carMats() {
    if (!this.sharedCarMats) {
      this.sharedCarMats = {
        glass: patch(new THREE.MeshPhongMaterial({ color: '#b5f6ff', transparent: true, opacity: 0.6, specular: '#ffffff', shininess: 250 })),
        white: patch(new THREE.MeshPhongMaterial({ color: '#ffffff', specular: '#ffffff', shininess: 160 })),
        dark: patch(new THREE.MeshPhongMaterial({ color: '#2a3a4a', specular: '#9fe8ff', shininess: 100 })),
      };
    }
    return this.sharedCarMats;
  }

  /**
   * Construye cualquiera de los 8 modelos. Devuelve el grupo más las referencias
   * que hacen falta para los efectos (llamas, halo, focos y puntos de escape).
   */
  buildCar(color: string, isPlayer: boolean, model: CarModel) {
    const group = new THREE.Group();
    const bodyMat = patch(new THREE.MeshPhongMaterial({ color, specular: '#ffffff', shininess: 160 }));
    const { glass: glassMat, white: whiteMat, dark: darkMat } = this.carMats();

    const box = new THREE.BoxGeometry(1, 1, 1);
    const ball = new THREE.SphereGeometry(1, 16, 12);
    const pod = new THREE.SphereGeometry(0.32, 12, 8);
    const wheel = new THREE.CylinderGeometry(1, 1, 1, 14).rotateZ(Math.PI / 2);
    const cap = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 5, 14).rotateX(Math.PI / 2);
    const dome = (r: number, arc = 0.62) => new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI * arc);

    let bodyGeo: THREE.BufferGeometry;
    let glassGeo: THREE.BufferGeometry;
    let whiteGeo: THREE.BufferGeometry;
    let darkGeo: THREE.BufferGeometry;
    let thrusters: [number, number, number][];
    let glowSize: [number, number] = [3.4, 5];
    let thrR = 0.2;
    let headY = 0.85;
    let headX = 0.62;
    let frontZ = -1.95;
    let backZ = 1.95;

    switch (model.id) {
      // ---------- 0 · Aero GT: cápsula pulida con alerón ----------
      case 0: {
        bodyGeo = xf(cap(0.85, 1.9), [0, 0.8, 0], [0, 0, 0], [1.25, 0.6, 1]);
        glassGeo = xf(ball, [0, 1.18, -0.05], [0, 0, 0], [0.75, 0.54, 1.12]);
        whiteGeo = merge([
          xf(box, [0, 1.42, 1.55], [0, 0, 0], [2.3, 0.09, 0.55]),
          xf(box, [-0.62, 1.2, 1.55], [0, 0, 0], [0.09, 0.4, 0.22]),
          xf(box, [0.62, 1.2, 1.55], [0, 0, 0], [0.09, 0.4, 0.22]),
          xf(pod, [-1.05, 0.45, -1.1], [0, 0, 0], [1, 0.6, 1.5]),
          xf(pod, [1.05, 0.45, -1.1], [0, 0, 0], [1, 0.6, 1.5]),
          xf(pod, [-1.05, 0.45, 1.1], [0, 0, 0], [1, 0.6, 1.5]),
          xf(pod, [1.05, 0.45, 1.1], [0, 0, 0], [1, 0.6, 1.5]),
          xf(box, [0, 0.82, -1.95], [0, 0, 0], [1.2, 0.12, 0.1]),
        ]);
        darkGeo = merge([xf(box, [-0.42, 0.62, 1.62], [0, 0, 0], [0.34, 0.22, 0.3]), xf(box, [0.42, 0.62, 1.62], [0, 0, 0], [0.34, 0.22, 0.3])]);
        thrusters = [
          [-0.5, 0.78, 1.85],
          [0.5, 0.78, 1.85],
        ];
        headY = 0.85;
        headX = 0.62;
        frontZ = -1.95;
        backZ = 1.95;
        break;
      }
      // ---------- 1 · Pod Burbuja: esfera con anillo flotante ----------
      case 1: {
        bodyGeo = merge([
          xf(ball, [0, 0.88, 0], [0, 0, 0], [1.34, 0.9, 1.46]),
          xf(new THREE.TorusGeometry(1.42, 0.17, 8, 28).rotateX(Math.PI / 2), [0, 0.44, 0], [0, 0, 0], [1, 1.3, 1]),
          xf(new THREE.CylinderGeometry(0.52, 0.66, 0.4, 16), [0, 0.3, 0]),
        ]);
        glassGeo = xf(dome(0.9, 0.58), [0, 1.0, 0], [0, 0, 0], [1, 1.15, 1.15]);
        whiteGeo = merge([
          xf(ball, [-0.56, 0.95, -1.28], [0, 0, 0], [0.18, 0.18, 0.1]),
          xf(ball, [0.56, 0.95, -1.28], [0, 0, 0], [0.18, 0.18, 0.1]),
          xf(box, [0, 2.14, 0.3], [-0.35, 0, 0], [0.09, 0.5, 0.8]),
          xf(box, [0, 0.66, 1.5], [0, 0, 0], [1.6, 0.1, 0.42]),
          xf(ball, [-1.3, 0.5, 0.5], [0, 0, 0], [0.2, 0.2, 0.34]),
          xf(ball, [1.3, 0.5, 0.5], [0, 0, 0], [0.2, 0.2, 0.34]),
        ]);
        darkGeo = merge([xf(box, [-0.8, 0.6, 1.1], [0, 0, 0], [0.3, 0.2, 0.3]), xf(box, [0.8, 0.6, 1.1], [0, 0, 0], [0.3, 0.2, 0.3])]);
        thrusters = [
          [-0.8, 0.6, 1.28],
          [0.8, 0.6, 1.28],
        ];
        thrR = 0.17;
        glowSize = [3.8, 4.4];
        headY = 0.95;
        headX = 0.56;
        frontZ = -1.5;
        backZ = 1.5;
        break;
      }
      // ---------- 2 · Hoja Racer: cuña baja con alerones ----------
      case 2: {
        bodyGeo = merge([
          xf(box, [0, 0.62, 0], [0, 0, 0], [2.35, 0.42, 4.1]),
          xf(new THREE.ConeGeometry(0.78, 1.9, 4).rotateY(Math.PI / 4).rotateX(-Math.PI / 2), [0, 0.6, -2.75], [0, 0, 0], [1.75, 0.55, 1]),
          xf(box, [0, 0.84, 2.15], [0, 0, 0], [2.1, 0.3, 0.95]),
        ]);
        glassGeo = xf(ball, [0, 0.98, -0.2], [0, 0, 0], [0.72, 0.36, 1.35]);
        whiteGeo = merge([
          xf(box, [0, 0.34, -2.3], [0, 0, 0], [3.5, 0.08, 0.78]),
          xf(box, [-1.7, 0.52, -2.3], [0, 0, 0], [0.09, 0.4, 0.7]),
          xf(box, [1.7, 0.52, -2.3], [0, 0, 0], [0.09, 0.4, 0.7]),
          xf(box, [0, 1.5, 2.42], [0.18, 0, 0], [3.0, 0.09, 0.62]),
          xf(box, [-1.42, 1.2, 2.4], [0, 0, 0], [0.08, 0.62, 0.5]),
          xf(box, [1.42, 1.2, 2.4], [0, 0, 0], [0.08, 0.62, 0.5]),
          xf(box, [-1.28, 0.95, 0.9], [0, 0.2, 0], [0.1, 0.45, 1.7]),
          xf(box, [1.28, 0.95, 0.9], [0, -0.2, 0], [0.1, 0.45, 1.7]),
          xf(box, [0, 0.72, -3.5], [0, 0, 0], [0.6, 0.09, 0.09]),
        ]);
        darkGeo = merge([xf(box, [-0.62, 0.7, 2.45], [0, 0, 0], [0.36, 0.26, 0.32]), xf(box, [0.62, 0.7, 2.45], [0, 0, 0], [0.36, 0.26, 0.32])]);
        thrusters = [
          [-0.62, 0.7, 2.6],
          [0.62, 0.7, 2.6],
        ];
        glowSize = [3.2, 6.4];
        headY = 0.72;
        headX = 0.8;
        frontZ = -3.5;
        backZ = 2.6;
        break;
      }
      // ---------- 3 · Escarabajo Aqua: caparazón redondo con patas ----------
      case 3: {
        bodyGeo = merge([
          xf(ball, [0, 0.92, -0.1], [0, 0, 0], [1.3, 0.95, 1.5]),
          xf(ball, [0, 1.0, 1.5], [0, 0, 0], [0.84, 0.55, 0.72]),
          xf(cap(0.28, 1.25), [-1.3, 0.62, 0.3]),
          xf(cap(0.28, 1.25), [1.3, 0.62, 0.3]),
        ]);
        glassGeo = merge([xf(ball, [0, 1.62, -0.3], [0, 0, 0], [0.7, 0.62, 0.8]), xf(ball, [0.42, 2.5, 0.78], [0, 0, 0], [0.2, 0.2, 0.2])]);
        whiteGeo = merge([
          xf(ball, [-1.12, 0.34, -1.0], [0, 0, 0], [0.3, 0.21, 0.45]),
          xf(ball, [1.12, 0.34, -1.0], [0, 0, 0], [0.3, 0.21, 0.45]),
          xf(ball, [-1.12, 0.34, 1.4], [0, 0, 0], [0.3, 0.21, 0.45]),
          xf(ball, [1.12, 0.34, 1.4], [0, 0, 0], [0.3, 0.21, 0.45]),
          xf(new THREE.CylinderGeometry(0.045, 0.045, 1.05, 8), [0.42, 2.0, 0.78], [0.25, 0, 0.15]),
          xf(ball, [-0.5, 0.98, -1.3], [0, 0, 0], [0.19, 0.19, 0.1]),
          xf(ball, [0.5, 0.98, -1.3], [0, 0, 0], [0.19, 0.19, 0.1]),
        ]);
        darkGeo = merge([xf(box, [-0.52, 0.85, 2.0], [0, 0, 0], [0.34, 0.24, 0.3]), xf(box, [0.52, 0.85, 2.0], [0, 0, 0], [0.34, 0.24, 0.3])]);
        thrusters = [
          [-0.52, 0.85, 2.2],
          [0.52, 0.85, 2.2],
        ];
        glowSize = [3.7, 5.2];
        headY = 0.98;
        headX = 1.12;
        frontZ = -1.3;
        backZ = 2.2;
        break;
      }
      // ---------- 4 · Bala: cuchilla con turbo instantáneo ----------
      case 4: {
        bodyGeo = merge([
          xf(ball, [0, 0.62, 0], [0, 0, 0], [1.1, 0.42, 2.5]),
          xf(box, [-0.95, 0.55, -0.4], [0, 0, 0], [0.5, 0.35, 2.4]),
          xf(box, [0.95, 0.55, -0.4], [0, 0, 0], [0.5, 0.35, 2.4]),
          xf(box, [0, 0.55, -2.3], [0, 0, 0], [2.3, 0.14, 0.5]),
        ]);
        glassGeo = xf(ball, [0, 0.98, 0.15], [0, 0, 0], [0.62, 0.42, 1.25]);
        whiteGeo = merge([
          xf(box, [0, 1.45, 1.75], [0, 0, 0], [2.5, 0.08, 0.5]),
          xf(box, [-0.9, 1.15, 1.75], [0, 0, 0], [0.08, 0.55, 0.3]),
          xf(box, [0.9, 1.15, 1.75], [0, 0, 0], [0.08, 0.55, 0.3]),
          xf(box, [0, 0.7, 0.4], [0, 0, 0], [0.18, 0.02, 2.6]),
          xf(box, [-0.3, 0.7, 0.4], [0, 0, 0], [0.08, 0.02, 2.6]),
          xf(box, [0.3, 0.7, 0.4], [0, 0, 0], [0.08, 0.02, 2.6]),
        ]);
        darkGeo = merge([
          xf(wheel, [-1.1, 0.42, -1.3], [0, 0, 0], [0.34, 0.42, 0.42]),
          xf(wheel, [1.1, 0.42, -1.3], [0, 0, 0], [0.34, 0.42, 0.42]),
          xf(wheel, [-1.1, 0.46, 1.35], [0, 0, 0], [0.4, 0.46, 0.46]),
          xf(wheel, [1.1, 0.46, 1.35], [0, 0, 0], [0.4, 0.46, 0.46]),
          xf(box, [-0.45, 0.65, 2.25], [0, 0, 0], [0.34, 0.3, 0.36]),
          xf(box, [0, 0.65, 2.25], [0, 0, 0], [0.3, 0.26, 0.32]),
          xf(box, [0.45, 0.65, 2.25], [0, 0, 0], [0.34, 0.3, 0.36]),
        ]);
        thrusters = [
          [-0.45, 0.65, 2.45],
          [0, 0.65, 2.45],
          [0.45, 0.65, 2.45],
        ];
        glowSize = [3.2, 5.4];
        headY = 0.7;
        headX = 0.75;
        frontZ = -2.45;
        backZ = 2.3;
        break;
      }
      // ---------- 5 · Titán: todoterreno de acero ----------
      case 5: {
        bodyGeo = merge([
          xf(box, [0, 1.0, 0], [0, 0, 0], [2.3, 0.9, 4.0]),
          xf(box, [0, 1.6, -0.15], [0, 0, 0], [2.0, 0.45, 2.3]),
          xf(ball, [0, 1.0, -2.0], [0, 0, 0], [1.15, 0.45, 0.3]),
          xf(ball, [0, 1.0, 2.0], [0, 0, 0], [1.15, 0.45, 0.3]),
        ]);
        glassGeo = xf(box, [0, 1.95, -0.15], [0, 0, 0], [1.9, 0.5, 2.1]);
        whiteGeo = merge([
          xf(box, [0, 2.25, -0.15], [0, 0, 0], [2.0, 0.1, 2.2]),
          xf(box, [0, 2.38, -0.9], [0, 0, 0], [1.6, 0.18, 0.25]),
          xf(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 8).rotateZ(Math.PI / 2), [0, 0.75, -2.15]),
          xf(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8).rotateX(Math.PI / 2), [-0.9, 0.75, -2.0]),
          xf(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8).rotateX(Math.PI / 2), [0.9, 0.75, -2.0]),
          xf(wheel, [-1.2, 0.58, -1.35], [0, 0, 0], [0.2, 0.3, 0.3]),
          xf(wheel, [1.2, 0.58, -1.35], [0, 0, 0], [0.2, 0.3, 0.3]),
          xf(wheel, [-1.2, 0.58, 1.35], [0, 0, 0], [0.2, 0.3, 0.3]),
          xf(wheel, [1.2, 0.58, 1.35], [0, 0, 0], [0.2, 0.3, 0.3]),
        ]);
        darkGeo = merge([
          xf(wheel, [-1.15, 0.58, -1.35], [0, 0, 0], [0.5, 0.58, 0.58]),
          xf(wheel, [1.15, 0.58, -1.35], [0, 0, 0], [0.5, 0.58, 0.58]),
          xf(wheel, [-1.15, 0.58, 1.35], [0, 0, 0], [0.5, 0.58, 0.58]),
          xf(wheel, [1.15, 0.58, 1.35], [0, 0, 0], [0.5, 0.58, 0.58]),
          xf(box, [-0.7, 0.7, 2.05], [0, 0, 0], [1.1, 1.0, 0.3]),
          xf(box, [0.7, 0.7, 2.05], [0, 0, 0], [1.1, 1.0, 0.3]),
        ]);
        thrusters = [
          [-0.7, 0.7, 2.25],
          [0.7, 0.7, 2.25],
        ];
        glowSize = [3.8, 5.6];
        headY = 1.05;
        headX = 0.8;
        frontZ = -2.15;
        backZ = 2.15;
        break;
      }
      // ---------- 6 · Hover: cápsula levitante con anillo ----------
      case 6: {
        bodyGeo = merge([xf(ball, [0, 1.05, 0], [0, 0, 0], [1.1, 0.7, 1.45]), xf(ball, [0, 0.95, 1.4], [0, 0, 0], [0.55, 0.35, 0.6])]);
        glassGeo = xf(ball, [0, 1.5, -0.15], [0, 0, 0], [0.8, 0.55, 0.95]);
        whiteGeo = merge([
          xf(new THREE.TorusGeometry(1.55, 0.17, 10, 32).rotateX(Math.PI / 2), [0, 0.8, 0], [0, 0, 0], [1, 1, 1.15]),
          xf(box, [0, 0.8, 0], [0, 0, 0], [3.0, 0.08, 0.5]),
          xf(box, [0, 0.8, 0], [0, 0, 0], [0.5, 0.08, 3.2]),
        ]);
        darkGeo = merge([
          xf(pod, [-1.0, 0.5, -0.8], [0, 0, 0], [1, 0.7, 1]),
          xf(pod, [1.0, 0.5, -0.8], [0, 0, 0], [1, 0.7, 1]),
          xf(pod, [0, 0.5, 1.1], [0, 0, 0], [1, 0.7, 1]),
          xf(box, [-0.35, 1.0, 1.35], [0, 0, 0], [0.34, 0.28, 0.32]),
          xf(box, [0.35, 1.0, 1.35], [0, 0, 0], [0.34, 0.28, 0.32]),
        ]);
        thrusters = [
          [-0.35, 1.0, 1.55],
          [0.35, 1.0, 1.55],
        ];
        glowSize = [3.8, 4.4];
        headY = 1.0;
        headX = 0.45;
        frontZ = -1.75;
        backZ = 1.7;
        break;
      }
      // ---------- 7 · Aurora: alas de cristal, puro frontal ----------
      default: {
        bodyGeo = merge([
          xf(ball, [0, 0.78, 0.1], [0, 0, 0], [1.0, 0.5, 2.3]),
          xf(box, [0, 0.7, -1.7], [0, 0, 0], [1.5, 0.34, 1.4]),
          xf(box, [0, 0.66, 1.7], [0, 0, 0], [1.7, 0.4, 1.2]),
        ]);
        glassGeo = merge([xf(ball, [0, 1.16, -0.25], [0, 0, 0], [0.72, 0.54, 1.0]), xf(ball, [0, 1.06, 0.75], [0, 0, 0], [0.58, 0.4, 0.6])]);
        whiteGeo = merge([
          // alas barridas hacia atrás
          xf(box, [-1.55, 0.98, 0.45], [0, 0, 0.22], [1.9, 0.09, 0.95]),
          xf(box, [1.55, 0.98, 0.45], [0, 0, -0.22], [1.9, 0.09, 0.95]),
          // puntal del alerón
          xf(box, [0, 1.42, 2.05], [0.16, 0, 0], [2.6, 0.09, 0.55]),
          xf(box, [-1.15, 1.18, 2.02], [0, 0, 0], [0.08, 0.55, 0.42]),
          xf(box, [1.15, 1.18, 2.02], [0, 0, 0], [0.08, 0.55, 0.42]),
          // rieles laterales
          xf(box, [-1.08, 0.86, 0.3], [0, 0.06, 0], [0.1, 0.16, 2.6]),
          xf(box, [1.08, 0.86, 0.3], [0, -0.06, 0], [0.1, 0.16, 2.6]),
          // cuña del morro
          xf(box, [0, 0.62, -2.45], [0, 0, 0], [1.2, 0.12, 0.5]),
          xf(ball, [-0.6, 0.82, -1.9], [0, 0, 0], [0.16, 0.14, 0.5]),
          xf(ball, [0.6, 0.82, -1.9], [0, 0, 0], [0.16, 0.14, 0.5]),
        ]);
        darkGeo = merge([
          xf(box, [-1.02, 0.5, -0.5], [0, 0, 0], [0.3, 0.26, 1.9]),
          xf(box, [1.02, 0.5, -0.5], [0, 0, 0], [0.3, 0.26, 1.9]),
          xf(box, [-0.72, 0.72, 2.0], [0, 0, 0], [0.4, 0.34, 0.34]),
          xf(box, [0.72, 0.72, 2.0], [0, 0, 0], [0.4, 0.34, 0.34]),
        ]);
        thrusters = [
          [-0.72, 0.72, 2.2],
          [0.72, 0.72, 2.2],
        ];
        glowSize = [3.6, 5.4];
        headY = 0.8;
        headX = 0.62;
        frontZ = -2.6;
        backZ = 2.2;
        break;
      }
    }

    // toberas de escape, como en la build original
    const thr = new THREE.CylinderGeometry(thrR, thrR * 1.35, 0.45, 12).rotateX(Math.PI / 2);
    const nozzles = merge(thrusters.map(([x, y, z]) => xf(thr, [x, y, z - 0.2])));
    darkGeo = merge([darkGeo, nozzles]);

    const body = new THREE.Mesh(bodyGeo, bodyMat);
    const canopy = new THREE.Mesh(glassGeo, glassMat);
    const whites = new THREE.Mesh(whiteGeo, whiteMat);
    const darks = new THREE.Mesh(darkGeo, darkMat);

    const glowCol = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.25);
    const glowMat = patch(new THREE.MeshBasicMaterial({ map: GLOW(), color: glowCol, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(glowSize[0], glowSize[1]).rotateX(-Math.PI / 2), glowMat);
    glow.position.y = 0.05 - (isPlayer ? model.hover : 0);

    // luces nocturnas: focos delante, pilotos detrás y charco de luz sobre el asfalto
    const lightPlane = new THREE.PlaneGeometry(0.9, 0.9);
    const heads = new THREE.Mesh(merge([xf(lightPlane, [-headX, headY, frontZ - 0.1]), xf(lightPlane, [headX, headY, frontZ - 0.1])]), this.headMat);
    const tails = new THREE.Mesh(merge([xf(lightPlane, [-headX, headY, backZ + 0.1], [0, 0, 0], [0.7, 0.5, 1]), xf(lightPlane, [headX, headY, backZ + 0.1], [0, 0, 0], [0.7, 0.5, 1])]), this.tailMat);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.5, isPlayer ? 16 : 9).rotateX(-Math.PI / 2), this.poolMat);
    pool.position.set(0, 0.04 - (isPlayer ? model.hover : 0), frontZ - (isPlayer ? 7 : 4));

    group.add(body, canopy, whites, darks, glow, heads, tails, pool);
    const flames: THREE.Mesh[] = [];
    if (isPlayer) {
      const flameGeo = new THREE.ConeGeometry(0.2, 1.3, 10).translate(0, 0.65, 0).rotateX(Math.PI / 2);
      const flameMat = patch(new THREE.MeshBasicMaterial({ color: '#7ff4ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      for (const [x, y, z] of thrusters) {
        const f = new THREE.Mesh(flameGeo, flameMat);
        f.position.set(x, y, z);
        flames.push(f);
        group.add(f);
      }
    }
    group.traverse((o) => (o.frustumCulled = false));
    const exhaust = thrusters.map(([x, y, z]) => new THREE.Vector3(x, y, z + 0.22));
    return { group, flames, glow, bodyMat, heads, exhaust };
  }

  /** Libera sólo la geometría de un subárbol; los materiales compartidos se quedan. */
  disposeGeometries(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }

  spawnPlayerMesh() {
    const old = this.player;
    if (old) {
      this.scene.remove(old);
      this.disposeGeometries(old);
      // sólo los materiales propios del coche: glass/white/dark son compartidos
      this.playerBodyMat?.dispose();
      (this.underGlow?.material as THREE.Material | undefined)?.dispose();
      for (const f of this.flames) (f.material as THREE.Material | undefined)?.dispose();
    }
    const pc = this.buildCar(this.carColor, true, this.carModel);
    this.player = pc.group;
    this.flames = pc.flames;
    this.underGlow = pc.glow;
    this.exhaust = pc.exhaust;
    this.playerBodyMat = pc.bodyMat;
    this.playerBodyMat.emissive.set(this.carColor).multiplyScalar(0.42);
    this.playerBodyMat.emissiveIntensity = this.env.night * 0.42;
    this.playerHeadGlow = pc.heads;
    this.player.position.set(this.carX, this.carModel.hover, 0);
    this.scene.add(this.player);
  }

  /** Cambia modelo y/o color del coche del jugador en caliente. */
  setCar(modelId: number, color: string) {
    const model = CAR_MODELS.find((m) => m.id === modelId) ?? CAR_MODELS[0];
    const modelChanged = model.id !== this.carModel.id;
    const colorChanged = color !== this.carColor;
    if (!modelChanged && !colorChanged && this.player) return;
    this.carModel = model;
    this.carColor = color;
    const at = this.phase === 'menu' ? [0, 0.6 + this.carModel.hover, 0] : [this.carX, 1 + this.carModel.hover * 0.5, 0];
    if (modelChanged) {
      this.spawnPlayerMesh();
      this.particles.emit(at[0], at[1], at[2], 0, 3, 0, 6, C.white, 0.8, 0.6, 30);
      this.particles.emit(at[0], at[1], at[2], 0, 3, 0, 4, new THREE.Color(color), 0.7, 0.7, 20);
    } else {
      this.playerBodyMat.color.set(color);
      this.playerBodyMat.emissive.set(color).multiplyScalar(0.42);
      (this.underGlow.material as THREE.MeshBasicMaterial).color.set(color).lerp(new THREE.Color('#ffffff'), 0.25);
      this.particles.emit(at[0], at[1], at[2], 0, 2, 0, 3, new THREE.Color(color), 0.6, 0.5, 16);
    }
  }

  // ------------------------------------------------ run lifecycle
  resetRun() {
    this.carX = 0;
    this.carVX = 0;
    this.speed = 30;
    this.distance = 0;
    this.score = 0;
    this.lives = MAX_LIVES;
    this.combo = 0;
    this.comboT = 0;
    this.boost = 0.35;
    this.padT = 0;
    this.invuln = 0;
    this.hitStop = 0;
    this.trauma = 0;
    this.elapsed = 0;
    this.wasBoosting = false;
    this.boostVis = 0;
    this.orbsCollected = 0;
    this.smashes = 0;
    this.nearMisses = 0;
    this.dying = false;
    this.deathT = 0;
    this.spawnDist = 0;
    this.nextGap = 40;
    // condiciones del modo elegido
    this.timeLeft = this.diffInfo.time;
    this.target = this.mode === 'quota' ? this.diffInfo.goal : 0;
    this.player.visible = true;
    this.player.rotation.set(0, 0, 0);
    this.player.position.set(0, this.carModel.hover, 0);
    // cada carrera arranca de día
    this.cycleT = 0;
  }

  clearEntities() {
    for (const t of this.traffic) {
      t.active = false;
      t.group.visible = false;
    }
    for (const b of this.barriers) {
      b.active = false;
      b.group.visible = false;
    }
    for (const p of this.pads) {
      p.active = false;
      p.mesh.visible = false;
    }
    this.orbOn.fill(0);
    for (const im of [this.orbOuter, this.orbInner, this.orbShine]) {
      for (let i = 0; i < MAX_ORBS; i++) im.setMatrixAt(i, this.zeroM);
      im.instanceMatrix.needsUpdate = true;
    }
  }

  prefill(menu: boolean) {
    this.clearEntities();
    if (menu) return;
    let z = -40;
    while (z > SPAWN_Z) {
      this.spawnPattern(z, z > -100);
      z -= rnd(34, 44);
    }
  }

  start() {
    audio.ensure();
    audio.startMusic();
    this.resetRun();
    this.particles.clear();
    this.prefill(false);
    this.setPhase('playing');
    this.popup('¡YA!', 'pop-go', 0, 1.2);
    this.flash('rgba(255,255,255,0.6)');
    this.pushHud();
  }

  pause() {
    if (this.phase !== 'playing' || this.dying) return;
    this.setPhase('paused');
    audio.engine(0, false, false);
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.clock.getDelta();
    this.setPhase('playing');
  }

  toMenu() {
    this.resetRun();
    this.particles.clear();
    this.prefill(true);
    this.setPhase('menu');
    audio.engine(0, false, false);
  }

  setPhase(p: Phase) {
    this.phase = p;
    this.cb.onPhase(p);
  }

  setBoostButton(on: boolean) {
    this.boostBtn = on;
  }

  /** Aplica ajustes de calidad/accesibilidad en caliente. */
  applySettings(s: Settings) {
    this.settings = s;
    const tier = qualityTier(s.quality);
    this.prCap = Math.min(this.dpr, tier.cap);
    this.pr = this.prCap;
    this.renderer.setPixelRatio(this.pr);
    this.particles.fxScale = tier.fx;
    this.resize();
  }

  /** Elige modo y dificultad (se aplican al reiniciar la carrera). */
  setMode(mode: GameMode, difficulty: DifficultyId) {
    this.mode = mode;
    this.difficulty = difficulty;
  }

  get diffInfo() {
    return getDifficulty(this.difficulty);
  }

  /** Termina la partida sin animación de choque (tiempo agotado u objetivo cumplido). */
  finish(won: boolean) {
    if (this.phase !== 'playing' || this.dying) return;
    this.setPhase('over');
    audio.engine(0, false, false);
    if (won) {
      this.popup('¡MISIÓN CUMPLIDA!', 'pop-go', 0, 1);
      this.flash('rgba(150,255,190,0.5)');
      this.shake(0.3);
      audio.record();
    } else {
      this.popup('¡TIEMPO!', 'pop-go', 0, 1);
      this.flash('rgba(255,90,120,0.4)');
      audio.gameOver();
    }
    this.cb.onGameOver({
      score: Math.floor(this.score),
      distance: Math.floor(this.distance),
      orbs: this.orbsCollected,
      smashes: this.smashes,
      nearMisses: this.nearMisses,
      mode: this.mode,
      won,
      target: this.target,
    });
  }

  // ------------------------------------------------ spawning
  spawnOrb(x: number, z: number, y = 1.3) {
    for (let i = 0; i < MAX_ORBS; i++) {
      if (!this.orbOn[i]) {
        this.orbOn[i] = 1;
        this.orbX[i] = x;
        this.orbY[i] = y;
        this.orbZ[i] = z;
        this.orbPh[i] = Math.random() * 6.28;
        return;
      }
    }
  }

  orbLine(lane: number, z0: number, n = 6, sp = 5) {
    for (let k = 0; k < n; k++) this.spawnOrb(LANES[lane], z0 - k * sp);
  }

  spawnTraffic(lane: number, z0: number, diff: number) {
    const t = this.traffic.find((c) => !c.active);
    if (!t) return;
    const f = rnd(0.35, 0.55);
    t.active = true;
    t.flying = false;
    t.passed = false;
    t.x = LANES[lane];
    t.targetX = t.x;
    t.tSpeed = f * this.speed;
    // spawn so that it arrives roughly in sync with static objects
    t.z = z0 * (1 - f);
    t.willChange = diff > 0.15 && Math.random() < 0.25 + diff * 0.3;
    t.changed = false;
    t.appear = t.z < -120 ? 0 : 1;
    t.group.visible = true;
    t.group.rotation.set(0, 0, 0);
    t.group.scale.setScalar(1);
  }

  spawnBarrier(lane: number, z: number) {
    const b = this.barriers.find((c) => !c.active);
    if (!b) return;
    b.active = true;
    b.flying = false;
    b.x = LANES[lane];
    b.z = z;
    b.group.visible = true;
    b.group.rotation.set(0, 0, 0);
    b.group.scale.setScalar(1);
  }

  spawnPad(lane: number, z: number) {
    const p = this.pads.find((c) => !c.active);
    if (!p) return;
    p.active = true;
    p.used = false;
    p.x = LANES[lane];
    p.z = z;
    p.mesh.visible = true;
  }

  spawnPattern(z0: number, safe = false) {
    const diff = Math.min(1, this.elapsed / 110);
    const free = Math.floor(Math.random() * 3);
    const others = [0, 1, 2].filter((l) => l !== free);
    const r = Math.random();
    if (safe) {
      if (Math.random() < 0.5) this.orbLine(free, z0, 6, 5);
      else this.orbWave(z0);
      return;
    }
    if (r < 0.3) {
      // traffic
      const n = diff > 0.25 && Math.random() < 0.35 + diff * 0.3 ? 2 : 1;
      const lanes = others.sort(() => Math.random() - 0.5).slice(0, n);
      lanes.forEach((l) => this.spawnTraffic(l, z0, diff));
      this.orbLine(free, z0 + 6, 5, 5);
    } else if (r < 0.52) {
      // barriers
      const n = Math.random() < 0.35 + diff * 0.4 ? 2 : 1;
      const lanes = others.sort(() => Math.random() - 0.5).slice(0, n);
      lanes.forEach((l) => this.spawnBarrier(l, z0));
      this.orbLine(free, z0 + 10, 5, 4);
    } else if (r < 0.66) {
      this.orbWave(z0);
      if (diff > 0.4 && Math.random() < 0.5) this.spawnBarrier(pick([0, 2]), z0 - 44);
    } else if (r < 0.76) {
      this.spawnPad(free, z0);
      this.orbLine(free, z0 - 8, 7, 4);
      if (Math.random() < 0.6) this.spawnTraffic(pick(others), z0 - 30, diff);
    } else {
      // mixed
      this.spawnTraffic(others[0], z0, diff);
      this.spawnBarrier(others[1], z0 - 14);
      this.orbLine(free, z0, 6, 5);
    }
  }

  orbWave(z0: number) {
    const ph = Math.random() * 6.28;
    for (let k = 0; k < 10; k++) this.spawnOrb(Math.sin(ph + k * 0.55) * 4.4, z0 - k * 4);
  }

  // ------------------------------------------------ feedback helpers
  shake(a: number) {
    if (this.settings.reduceMotion) a *= 0.3;
    this.trauma = Math.min(1, this.trauma + a);
  }

  popup(text: string, cls: string, dx = 0, scale = 1) {
    if (this.overlay.childElementCount > 14) this.overlay.firstElementChild?.remove();
    this.tmpV.set(this.carX, 2.8, 0).project(this.camera);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const el = document.createElement('div');
    el.className = 'popup ' + cls;
    el.textContent = text;
    el.style.left = `${(this.tmpV.x * 0.5 + 0.5) * w + dx}px`;
    el.style.top = `${(-this.tmpV.y * 0.5 + 0.5) * h}px`;
    el.style.setProperty('--s', String(scale));
    el.addEventListener('animationend', () => el.remove());
    this.overlay.appendChild(el);
  }

  flash(color: string) {
    const el = document.createElement('div');
    el.className = 'screen-flash';
    el.style.background = color;
    el.addEventListener('animationend', () => el.remove());
    this.overlay.appendChild(el);
  }

  get mult() {
    return Math.min(10, 1 + Math.floor(this.combo / 5));
  }

  /** estadísticas del modelo de coche elegido */
  get spec(): CarStats {
    return this.carModel.stats;
  }

  /** ritmo al que se vacía el turbo (inverso de su duración) */
  get drainRate(): number {
    return 1 / this.carModel.stats.boost;
  }

  addCombo() {
    const before = this.mult;
    this.combo++;
    this.comboT = 3;
    if (this.mult > before) {
      this.popup(`COMBO x${this.mult}`, 'pop-combo', 0, 1.1);
    }
  }

  // ------------------------------------------------ gameplay events
  collectOrb(i: number) {
    this.orbOn[i] = 0;
    this.orbsCollected++;
    this.addCombo();
    const pts = 25 * this.mult;
    this.score += pts;
    this.boost = Math.min(1, this.boost + 0.07);
    if (this.mode === 'time') this.timeLeft = Math.min(this.diffInfo.time + 30, this.timeLeft + this.diffInfo.timeOrb);
    const x = this.orbX[i];
    const y = this.orbY[i];
    const z = this.orbZ[i];
    this.particles.emit(x, y, z, 0, 2, -this.speed * 0.3, 7, C.cyan, 0.7, 0.5, 10);
    this.particles.emit(x, y, z, 0, 2, -this.speed * 0.3, 4, C.lime, 0.5, 0.6, 6);
    this.particles.emit(x, y, z, 0, 0, -this.speed * 0.2, 1, C.white, 2.4, 0.18, 1);
    audio.pickup(this.combo);
    if (this.combo % 3 === 0) this.popup(`+${pts}`, 'pop-orb', rnd(-30, 30));
  }

  hitPlayer(x: number, z: number) {
    this.invuln = 1.8;
    this.hitStop = 0.12;
    this.shake(0.85);
    this.speed *= 0.55;
    this.combo = 0;
    this.comboT = 0;
    this.carVX = (this.carX - x >= 0 ? 1 : -1) * 14;
    this.particles.emit(this.carX, 1, z * 0.3, 0, 5, -8, 14, C.coral, 1, 0.8, 30, 12);
    this.particles.emit(this.carX, 1, z * 0.3, 0, 5, -8, 10, C.white, 0.7, 0.6, 20, 12);
    this.flash('rgba(255,70,90,0.45)');
    audio.crash();
    if (this.mode === 'time') {
      // en contrarreloj un golpe cuesta segundos, no vidas
      this.timeLeft = Math.max(0, this.timeLeft - this.diffInfo.timeCost);
      if (this.timeLeft <= 0) {
        this.finish(false);
      } else {
        this.popup(`-${this.diffInfo.timeCost}s`, 'pop-hit', 0, 1.2);
      }
      return;
    }
    this.lives--;
    if (this.lives <= 0) {
      this.die();
    } else {
      this.popup('¡AUCH!', 'pop-hit', 0, 1.2);
    }
  }

  die() {
    this.dying = true;
    this.deathT = 0;
    this.hitStop = 0.2;
    this.shake(1);
    this.deathVel.set(this.carVX * 0.5, 14, -6);
    this.deathSpin.set(rnd(4, 8), rnd(-6, 6), rnd(-8, 8));
    for (const c of [C.coral, C.orange, C.yellow, C.white, C.cyan]) {
      this.particles.emit(this.carX, 1, 0, 0, 6, -4, 18, c, 1.3, 1.2, 30, 14);
    }
    audio.gameOver();
  }

  knock(fl: Flyer, x: number) {
    fl.flying = true;
    fl.flyT = 0;
    const dir = x - this.carX >= 0 ? 1 : -1;
    fl.vx = dir * rnd(6, 12);
    fl.vy = rnd(10, 16);
    fl.vz = -this.speed * 0.6;
    fl.sx = rnd(-6, 6);
    fl.sy = rnd(-6, 6);
    fl.sz = rnd(-8, 8);
  }

  smash(fl: Flyer, x: number, z: number, isCar: boolean) {
    fl.flying = true;
    fl.flyT = 0;
    const dir = x - this.carX >= 0 ? 1 : -1;
    fl.vx = dir * rnd(8, 16);
    fl.vy = rnd(12, 20);
    fl.vz = -this.speed * 0.9;
    fl.sx = rnd(-8, 8);
    fl.sy = rnd(-8, 8);
    fl.sz = rnd(-10, 10);
    this.smashes++;
    this.addCombo();
    const pts = (isCar ? 250 : 150) * this.mult;
    this.score += pts;
    this.shake(0.45);
    this.hitStop = 0.06;
    this.particles.emit(x, 1.2, z, 0, 6, -this.speed * 0.5, 14, C.yellow, 1.1, 0.7, 26, 10);
    this.particles.emit(x, 1.2, z, 0, 6, -this.speed * 0.5, 10, C.orange, 0.9, 0.7, 18, 10);
    this.popup(`¡SMASH! +${pts}`, 'pop-smash', 0, 1.15);
    audio.smash();
  }

  // ------------------------------------------------ input
  onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    if (this.phase === 'playing' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  };
  onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  onBlur = () => {
    this.keys.clear();
    this.pointers.clear();
    this.boostBtn = false;
    this.pause();
  };
  onVis = () => {
    if (document.hidden) this.onBlur();
  };
  onPointerDown = (e: PointerEvent) => {
    if (this.phase !== 'playing') return;
    audio.ensure();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sy: e.clientY, st: performance.now(), boost: false });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  onPointerMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!p.boost && p.sy - p.y > 60) p.boost = true; // swipe up = boost while held
  };
  onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
  };

  bindInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVis);
    const el = this.container;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
  }

  readSteer() {
    let s = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) s -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) s += 1;
    if (this.pointers.size) {
      const rect = this.container.getBoundingClientRect();
      let l = 0;
      let r = 0;
      this.pointers.forEach((p) => {
        if (p.boost) return;
        if (p.x - rect.left < rect.width / 2) l = 1;
        else r = 1;
      });
      s += r - l;
    }
    let out = clamp(s, -1, 1) * this.settings.steerSensitivity;
    if (this.settings.invertSteer) out = -out;
    return clamp(out, -1, 1);
  }

  readBoost() {
    if (this.boostBtn) return true;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW') || this.keys.has('Space') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) return true;
    let b = false;
    this.pointers.forEach((p) => {
      if (p.boost) b = true;
    });
    return b;
  }

  // ------------------------------------------------ main loop
  loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const rawDt = Math.min(0.05, this.clock.getDelta());
    this.perf(rawDt);
    if (this.phase !== 'paused') this.update(rawDt);
    this.renderer.render(this.scene, this.camera);
  };

  perf(dt: number) {
    this.frameAcc += dt;
    this.frameN++;
    if (this.frameAcc > 2) {
      const avg = this.frameAcc / this.frameN;
      if (this.settings.autoQuality) {
        if (avg > 1 / 45 && this.pr > 0.75) {
          this.pr = Math.max(0.75, this.pr - 0.25);
          this.renderer.setPixelRatio(this.pr);
          this.resize();
        } else if (avg < 1 / 58 && this.pr < this.prCap) {
          this.pr = Math.min(this.prCap, this.pr + 0.25);
          this.renderer.setPixelRatio(this.pr);
          this.resize();
        }
      }
      this.frameAcc = 0;
      this.frameN = 0;
    }
  }

  update(rawDt: number) {
    let dt = rawDt;
    if (this.hitStop > 0) {
      this.hitStop -= rawDt;
      dt *= 0.1;
    }
    this.time += dt;
    const playing = this.phase === 'playing' && !this.dying;

    // ---------- player & speed
    let boosting = false;
    if (playing) {
      this.elapsed += dt;
      const diff = Math.min(1, this.elapsed / 110);
      const base = (32 + diff * 38) * this.diffInfo.speed;
      // contrarreloj: el reloj corre
      if (this.mode === 'time' && this.timeLeft > 0) {
        this.timeLeft = Math.max(0, this.timeLeft - dt);
      }
      const wantBoost = this.readBoost();
      if (this.padT > 0) {
        this.padT -= dt;
        boosting = true;
      } else if (wantBoost && this.boost > 0.01) {
        boosting = true;
        this.boost = Math.max(0, this.boost - dt * 0.38 * this.drainRate);
      }
      if (boosting && !this.wasBoosting) {
        audio.boost();
        this.shake(0.2);
        this.flash('rgba(160,255,255,0.35)');
      }
      this.wasBoosting = boosting;
      const target = base * this.spec.top + (boosting ? 30 : 0);
      this.speed += (target - this.speed) * damp(boosting ? 4 : 1.2, dt);

      const steer = this.readSteer();
      const maxVX = (17 + this.speed * 0.1) * this.spec.steer;
      this.carVX += (steer * maxVX - this.carVX) * damp((steer === 0 ? 10 : 13) * (0.75 + this.spec.steer * 0.25), dt);
      // fuerza centrífuga: las curvas te empujan hacia fuera, hay que contravolante
      this.carVX -= this.curve * dt * Math.min(1.35, this.speed / 52);
      this.carX += this.carVX * dt;
      if (Math.abs(this.carX) > CAR_LIMIT) {
        const sgn = Math.sign(this.carX);
        this.carX = sgn * CAR_LIMIT;
        if (Math.abs(this.carVX) > 7) {
          this.shake(0.18);
          audio.bump();
          this.particles.emit(sgn * 6.9, 0.9, 0.5, -sgn * 4, 3, 4, 5, C.yellow, 0.35, 0.35, 12, 10);
        }
        this.carVX = -this.carVX * 0.25;
      }
      this.distance += this.speed * dt;
      this.score += this.speed * dt * 0.5 * this.mult;
      if (this.comboT > 0) {
        this.comboT -= dt;
        if (this.comboT <= 0) this.combo = 0;
      }
      if (this.invuln > 0) this.invuln -= dt;
    } else if (this.phase === 'menu') {
      this.speed += (34 - this.speed) * damp(1, dt);
      const tx = Math.sin(this.time * 0.45) * 3.2;
      this.carVX = (tx - this.carX) * 2;
      this.carX = tx;
    } else if (this.dying) {
      this.deathT += dt;
      this.speed *= Math.exp(-dt * 1.8);
      this.player.position.addScaledVector(this.deathVel, dt);
      this.deathVel.y -= 30 * dt;
      if (this.player.position.y < 0) {
        this.player.position.y = 0;
        this.deathVel.y = Math.abs(this.deathVel.y) * 0.35;
        this.deathVel.x *= 0.6;
      }
      this.player.rotation.x += this.deathSpin.x * dt;
      this.player.rotation.y += this.deathSpin.y * dt;
      this.player.rotation.z += this.deathSpin.z * dt;
      this.deathSpin.multiplyScalar(Math.exp(-dt * 1.2));
      if (Math.random() < 0.5) this.particles.emit(this.player.position.x, this.player.position.y + 1, this.player.position.z, 0, 3, 0, 2, C.white, 0.9, 0.8, 1, -2);
      if (this.deathT > 1.5 && this.phase === 'playing') {
        this.setPhase('over');
        this.cb.onGameOver({ score: Math.floor(this.score), distance: Math.floor(this.distance), orbs: this.orbsCollected, smashes: this.smashes, nearMisses: this.nearMisses, mode: this.mode, won: false, target: this.target });
      }
    } else if (this.phase === 'over') {
      this.speed *= Math.exp(-dt * 1.5);
    }

    const scroll = this.speed * dt;
    const speedN = clamp((this.speed - 30) / 60, 0, 1);
    this.boostVis += ((boosting ? 1 : 0) - this.boostVis) * damp(5, dt);

    // ---------- trazado: curvas y rasantes que cambian de forma continua ----------
    const bt = this.distance * 0.0019 + this.time * 0.02;
    bend.uBendX.value = (Math.sin(bt) * 0.75 + Math.sin(bt * 2.7 + 1.3) * 0.35 + Math.sin(bt * 0.43 + 2.1) * 0.5) * 0.00062;
    bend.uBendY.value = (Math.sin(bt * 1.7 + 0.5) * 0.7 + Math.sin(bt * 0.6 + 2.7) * 0.5) * 0.00022 - 0.00006;
    this.curve = bend.uBendX.value * 2600;

    // ciclo día/noche: avanza con la distancia pilotando, y despacio en el menú
    if (this.phase === 'menu') this.cycleT += dt / 90;
    else this.cycleT += scroll / CYCLE_LEN;
    this.updateEnvironment(dt);

    // textures
    this.roadTex.offset.y = (this.roadTex.offset.y + scroll / 18) % 1;
    this.waterTex.offset.y = (this.waterTex.offset.y + scroll / (3000 / 70)) % 1;
    this.waterTex.offset.x = Math.sin(this.time * 0.2) * 0.05;
    this.chevronTex.offset.y = (this.chevronTex.offset.y - dt * 1.5) % 1;

    // ---------- player visuals
    if (!this.dying) {
      const hov = this.carModel.hover;
      this.player.position.set(this.carX, Math.sin(this.time * (hov ? 3 : 7)) * (0.06 + hov * 0.3) + 0.05 + hov, 0);
      this.player.rotation.z = -this.carVX * 0.02;
      this.player.rotation.y = -this.carVX * 0.012;
      this.player.rotation.x = -this.boostVis * 0.06;
      this.player.visible = this.invuln > 0 ? Math.floor(this.invuln * 14) % 2 === 0 : true;
    }
    const fl = this.dying ? 0 : boosting ? 1.8 + Math.random() * 0.6 : 0.55 + speedN * 0.4 + Math.random() * 0.15;
    for (const f of this.flames) f.scale.set(1 + this.boostVis * 0.5, 1 + this.boostVis * 0.5, fl);
    (this.underGlow.material as THREE.MeshBasicMaterial).opacity = Math.min(1, 0.55 + Math.sin(this.time * 10) * 0.12 + this.boostVis * 0.3 + this.env.night * 0.35);

    // exhaust: sale de las toberas reales del modelo elegido
    if (!this.dying && this.phase !== 'over') {
      const n = boosting ? 3 : Math.random() < 0.6 ? 1 : 0;
      for (let k = 0; k < n; k++) {
        const ex = this.exhaust.length ? this.exhaust[(Math.random() * this.exhaust.length) | 0] : { x: -0.5, y: 0.8, z: 2.2 };
        const ey = ex.y + this.carModel.hover;
        this.particles.emit(
          this.carX + ex.x,
          ey,
          ex.z,
          this.carVX * 0.2,
          0.5,
          6,
          0.8,
          boosting ? (Math.random() < 0.5 ? C.cyan : C.white) : C.cyan,
          boosting ? 0.8 : 0.4 + this.env.night * 0.2,
          0.35,
          1
        );
      }
      if (boosting && Math.random() < 0.5) this.particles.emit(this.carX + rnd(-1, 1), 0.2, 1.5, 0, 1, 4, 1, C.lime, 0.5, 0.4, 1);
    }

    // ---------- orbs
    const magnet = (boosting ? 7 : 2.6) * this.spec.magnet;
    const d = this.dummy;
    for (let i = 0; i < MAX_ORBS; i++) {
      if (!this.orbOn[i]) continue;
      this.orbZ[i] += scroll;
      if (playing) {
        const dx = this.carX - this.orbX[i];
        const dz = -this.orbZ[i];
        if (Math.abs(dz) < magnet && Math.abs(dx) < magnet) {
          const k = damp(10, dt);
          this.orbX[i] += dx * k;
          this.orbZ[i] += dz * k;
        }
        if (Math.abs(dz) < 2.3 && Math.abs(dx) < 1.8) {
          this.collectOrb(i);
        }
      }
      if (this.orbZ[i] > DESPAWN_Z) this.orbOn[i] = 0;
      if (!this.orbOn[i]) {
        this.orbOuter.setMatrixAt(i, this.zeroM);
        this.orbInner.setMatrixAt(i, this.zeroM);
        this.orbShine.setMatrixAt(i, this.zeroM);
        continue;
      }
      const y = this.orbY[i] + Math.sin(this.time * 3 + this.orbPh[i]) * 0.22;
      const sc = 1 + Math.sin(this.time * 5 + this.orbPh[i]) * 0.06;
      d.position.set(this.orbX[i], y, this.orbZ[i]);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(sc);
      d.updateMatrix();
      this.orbOuter.setMatrixAt(i, d.matrix);
      d.rotation.set(this.time * 2 + this.orbPh[i], this.time * 3, 0);
      d.updateMatrix();
      this.orbInner.setMatrixAt(i, d.matrix);
      d.position.set(this.orbX[i] - 0.28, y + 0.36, this.orbZ[i] + 0.3);
      d.rotation.set(0, 0, 0.5);
      d.updateMatrix();
      this.orbShine.setMatrixAt(i, d.matrix);
    }
    this.orbOuter.instanceMatrix.needsUpdate = true;
    this.orbInner.instanceMatrix.needsUpdate = true;
    this.orbShine.instanceMatrix.needsUpdate = true;

    // ---------- traffic
    for (const t of this.traffic) {
      if (!t.active) continue;
      if (t.flying) {
        this.updateFlyer(t, t.group, dt, scroll);
        t.z = t.group.position.z;
        if (t.flyT > 1.6) {
          t.active = false;
          t.group.visible = false;
        }
        continue;
      }
      t.z += scroll - t.tSpeed * dt;
      if (t.appear < 1) t.appear = Math.min(1, t.appear + dt * 3);
      if (t.willChange && !t.changed && t.z > -80) {
        t.changed = true;
        const li = LANES.indexOf(t.targetX);
        const opts = [li - 1, li + 1].filter((l) => l >= 0 && l <= 2);
        t.targetX = LANES[pick(opts)];
      }
      const pdx = t.targetX - t.x;
      t.x += pdx * damp(2.2, dt);
      const ea = t.appear;
      t.group.scale.setScalar(ea < 1 ? 1 - Math.pow(1 - ea, 3) : 1);
      t.group.position.set(t.x, Math.sin(this.time * (t.hover ? 3 : 6) + t.tSpeed) * (0.06 + t.hover * 0.3) + 0.05 + t.hover, t.z);
      t.group.rotation.z = -pdx * 0.08;
      t.group.rotation.y = -pdx * 0.05;

      if (playing) {
        const dx = t.x - this.carX;
        const dz = t.z;
        if (Math.abs(dz) < 3.3 && Math.abs(dx) < 1.95) {
          if (boosting) this.smash(t, t.x, t.z, true);
          else if (this.invuln <= 0) {
            this.hitPlayer(t.x, t.z);
            this.knock(t, t.x);
          }
        } else if (!t.passed && dz > 2.5) {
          t.passed = true;
          if (Math.abs(dx) < 3.7 && this.invuln <= 0) {
            this.nearMisses++;
            this.addCombo();
            const pts = 100 * this.mult;
            this.score += pts;
            this.boost = Math.min(1, this.boost + 0.06);
            this.popup(`¡CASI! +${pts}`, 'pop-near', dx > 0 ? -40 : 40);
            audio.nearMiss();
            this.shake(0.08);
            this.particles.emit((t.x + this.carX) / 2, 1, 1, 0, 2, 5, 5, C.lime, 0.5, 0.4, 12);
          }
        }
      }
      if (t.z > DESPAWN_Z + 10) {
        t.active = false;
        t.group.visible = false;
      }
    }

    // ---------- barriers
    for (const b of this.barriers) {
      if (!b.active) continue;
      if (b.flying) {
        this.updateFlyer(b, b.group, dt, scroll);
        if (b.flyT > 1.6) {
          b.active = false;
          b.group.visible = false;
        }
        continue;
      }
      b.z += scroll;
      b.group.position.set(b.x, 0, b.z);
      if (playing && Math.abs(b.z) < 2.2 && Math.abs(b.x - this.carX) < 2.55) {
        if (boosting) this.smash(b, b.x, b.z, false);
        else if (this.invuln <= 0) {
          this.hitPlayer(b.x, b.z);
          this.knock(b, b.x);
        }
      }
      if (b.z > DESPAWN_Z) {
        b.active = false;
        b.group.visible = false;
      }
    }

    // ---------- pads
    for (const p of this.pads) {
      if (!p.active) continue;
      p.z += scroll;
      p.mesh.position.set(p.x, 0.03, p.z);
      if (playing && !p.used && Math.abs(p.z) < 4.5 && Math.abs(p.x - this.carX) < 2.4) {
        p.used = true;
        this.padT = 1.5 + this.spec.boost * 0.55;
        this.score += 50 * this.mult;
        this.popup('¡TURBO!', 'pop-boost', 0, 1.15);
        audio.pad();
        this.shake(0.3);
        this.particles.emit(this.carX, 0.5, 0, 0, 4, -6, 9, C.yellow, 0.8, 0.6, 24, 6);
      }
      if (p.z > DESPAWN_Z) {
        p.active = false;
        p.mesh.visible = false;
      }
    }

    // ---------- spawn
    if (playing) {
      this.spawnDist += scroll;
      if (this.spawnDist >= this.nextGap) {
        this.spawnDist = 0;
        const diff = Math.min(1, this.elapsed / 110);
        this.nextGap = (44 - diff * 16 + rnd(0, 10)) * this.diffInfo.gap;
        this.spawnPattern(SPAWN_Z);
      }
    }

    // ---------- condiciones de fin del modo (al cerrar la frame, ya sin colisiones)
    if (playing && this.phase === 'playing' && !this.dying) {
      if (this.mode === 'time' && this.timeLeft <= 0) this.finish(false);
      else if (this.mode === 'quota' && this.target > 0 && this.score >= this.target) this.finish(true);
    }

    // ---------- scenery
    for (let i = 0; i < 40; i++) {
      const z = -590 + ((i * 15 + this.distance) % 600);
      for (const sx of [-1, 1]) {
        d.position.set(sx * 7.15, 0.55, z);
        d.rotation.set(0, 0, 0);
        d.scale.setScalar(1);
        d.updateMatrix();
        this.posts.setMatrixAt(i * 2 + (sx > 0 ? 1 : 0), d.matrix);
      }
    }
    this.posts.instanceMatrix.needsUpdate = true;

    for (const is of this.islands) {
      is.z += scroll;
      if (is.z > 40) {
        is.z -= 680;
        is.x = (Math.random() < 0.5 ? -1 : 1) * rnd(22, 90);
      }
      is.obj.position.set(is.x, is.y, is.z);
    }
    for (const c of this.clouds) {
      c.z += scroll * c.factor;
      if (c.z > 0) {
        c.z = rnd(-750, -650);
        c.x = (Math.random() < 0.5 ? -1 : 1) * rnd(60, 260);
      }
      c.obj.position.set(c.x, c.y, c.z);
    }
    for (const b of this.bigBubbles) {
      b.z += scroll * b.factor;
      b.y += dt * 0.8;
      if (b.z > 30 || b.y > 45) {
        b.z = rnd(-520, -400);
        b.y = rnd(6, 25);
        b.x = (Math.random() < 0.5 ? -1 : 1) * rnd(20, 70);
      }
      b.obj.position.set(b.x, b.y + Math.sin(this.time + b.x) * 0.8, b.z);
    }
    for (let i = 0; i < this.bubbleData.length; i++) {
      const b = this.bubbleData[i];
      b.z += scroll;
      b.y += b.v * dt;
      if (b.z > 15 || b.y > 22) {
        b.z = rnd(-300, -150);
        b.y = rnd(-6, 8);
        b.x = (Math.random() < 0.5 ? -1 : 1) * rnd(8.5, 40);
      }
      d.position.set(b.x + Math.sin(this.time * 2 + i) * 0.4, b.y, b.z);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(b.s);
      d.updateMatrix();
      this.bubbles.setMatrixAt(i, d.matrix);
    }
    this.bubbles.instanceMatrix.needsUpdate = true;

    // speed lines
    const lineOp = clamp(speedN * 0.35 + this.boostVis * 0.6, 0, 0.8);
    this.linesMat.opacity = lineOp;
    this.lines.visible = lineOp > 0.02;
    if (this.lines.visible) {
      for (let i = 0; i < this.lineData.length; i++) {
        const l = this.lineData[i];
        l.z += scroll * 1.8 + dt * 20;
        if (l.z > 12) this.lineData[i] = this.randLine(rnd(-120, -60));
        const ll = this.lineData[i];
        d.position.set(ll.x + this.carX * 0.5, ll.y, ll.z);
        d.rotation.set(0, 0, 0);
        d.scale.set(1, 1, 0.6 + this.boostVis * 1.2);
        d.updateMatrix();
        this.lines.setMatrixAt(i, d.matrix);
      }
      this.lines.instanceMatrix.needsUpdate = true;
    }

    this.particles.update(dt, scroll);

    // ---------- camera
    this.updateCamera(rawDt, dt, speedN);

    // audio
    audio.engine(speedN, this.phase === 'playing' && !this.dying, boosting);

    // HUD (también en el menú, para que el ciclo día/noche siga vivo)
    this.hudT -= rawDt;
    if (this.hudT <= 0 && (this.phase === 'playing' || this.phase === 'menu')) {
      this.hudT = this.phase === 'playing' ? 0.08 : 0.2;
      this.pushHud(boosting);
    }
  }

  updateEnvironment(dt: number) {
    const e = this.env;
    sampleEnv(this.cycleT, e);
    const n = e.night;
    // sky
    const u = this.skyMat.uniforms;
    (u.top.value as THREE.Color).copy(e.top);
    (u.mid.value as THREE.Color).copy(e.mid);
    (u.hor.value as THREE.Color).copy(e.hor);
    (u.sunDir.value as THREE.Vector3).copy(e.sunDir);
    (u.sunCol.value as THREE.Color).copy(e.sun).lerp(C.white, 0.4);
    u.uStars.value = e.stars;
    u.uNight.value = n;
    u.uTime.value = this.time;
    // fog / clear
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(e.fog);
    fog.near = e.fogNear;
    fog.far = e.fogFar;
    this.renderer.setClearColor(e.fog);
    // lights
    this.hemi.color.copy(e.hemiSky);
    this.hemi.groundColor.copy(e.hemiGround);
    this.hemi.intensity = e.hemiI;
    this.sun.color.copy(e.sun);
    this.sun.intensity = e.sunI;
    this.sun.position.copy(e.sunDir).multiplyScalar(80);
    this.sun.position.y = Math.max(12, this.sun.position.y);
    // materials
    this.oceanMat.color.copy(e.ocean);
    this.cloudMat.color.copy(e.cloud);
    this.cloudMat.emissiveIntensity = e.cloudEm;
    this.roadMat.emissiveIntensity = n * 0.35;
    this.slabMat.emissiveIntensity = n * 0.6;
    this.postMat.emissiveIntensity = 1 + n * 2.5;
    this.railMat2.emissiveIntensity = 1 + n * 2;
    this.orbInnerMat.emissiveIntensity = 1 + n * 1.5;
    this.orbOuterMat.emissiveIntensity = n * 0.5;
    this.padMat.opacity = 0.95;
    this.padMat.color.setScalar(1 + n * 0.4);
    // islas, barreras y burbujas: pierden saturación y se apagan de noche
    this.grassMat.color.lerpColors(C.grassDay, C.grassNight, n);
    this.grassMat.emissive.lerpColors(C.black, C.grassNight, n * 0.35);
    this.sandMat.color.lerpColors(C.sandDay, C.sandNight, n);
    this.sandMat.emissive.lerpColors(C.black, C.sandNight, n * 0.25);
    this.trunkMat.color.lerpColors(C.trunkDay, C.trunkNight, n);
    this.railMat.color.lerpColors(C.white, C.railNight, n);
    this.barrierWhiteMat.color.lerpColors(C.white, C.barrierNight, n);
    this.barrierCoralMat.emissiveIntensity = 1 + n * 0.6;
    this.bubbleMat.color.lerpColors(C.bubbleDay, C.bubbleNight, n);
    this.bubbleMat.opacity = 0.5 + n * 0.18;
    this.skyBubbleMat.color.lerpColors(C.skyBubbleDay, C.skyBubbleNight, n);
    this.skyBubbleMat.opacity = 0.3 + n * 0.12;
    this.skyBubbleMat.emissive.copy(C.skyBubbleEmissive).multiplyScalar(n);
    // el tráfico se ve de noche gracias al halo de su propia carrocería
    const glow = n * 0.42;
    for (const m of this.trafficBodyMats) m.emissiveIntensity = glow;
    this.playerBodyMat.emissiveIntensity = glow;
    // car lights
    this.headMat.opacity = n * 0.95;
    this.tailMat.opacity = n * 0.9;
    this.poolMat.opacity = n * 0.55;
    this.moon.visible = n > 0.05;
    (this.moon.material as THREE.MeshBasicMaterial).opacity = n;
    void dt;
  }

  updateFlyer(f: Flyer, g: THREE.Object3D, dt: number, scroll: number) {
    f.flyT += dt;
    f.vy -= 32 * dt;
    g.position.x += f.vx * dt;
    g.position.y += f.vy * dt;
    g.position.z += f.vz * dt + scroll;
    g.rotation.x += f.sx * dt;
    g.rotation.y += f.sy * dt;
    g.rotation.z += f.sz * dt;
    if (f.flyT > 1.2) g.scale.multiplyScalar(0.85);
  }

  updateCamera(rawDt: number, dt: number, speedN: number) {
    const cam = this.camera;
    if (this.phase === 'menu') {
      const a = Math.sin(this.time * 0.22) * 1.0 + 0.35;
      const hov = this.carModel.hover;
      const tp = this.tmpV.set(this.carX + Math.sin(a) * 8.5, 2.6 + hov + Math.sin(this.time * 0.3) * 0.6, Math.cos(a) * 8.5);
      cam.position.lerp(tp, damp(3, rawDt));
      cam.lookAt(this.carX * 0.9, 0.9 + hov * 0.6, -2.5);
      cam.fov += (this.fovBase + 2 - cam.fov) * damp(3, rawDt);
    } else {
      const back = 8.8 + this.boostVis * 1.4 + this.camBack;
      const height = 4.1 + this.camBack * 0.35;
      // la cámara se inclina y mira hacia dentro de la curva
      const bank = clamp(this.curve / 2.4, -1, 1);
      const tp = this.tmpV.set(this.carX * 0.55 - bank * 0.55, height, back);
      if (this.dying) tp.set(this.player.position.x * 0.5, 5.5, 12);
      cam.position.lerp(tp, damp(this.phase === 'playing' ? 7 : 2, rawDt));
      cam.lookAt(this.carX * 0.72 + bank * 1.5, 1.2, -14);
      cam.rotation.z += -this.carVX * 0.0035 - bank * 0.055;
      const fovT = this.fovBase + speedN * 12 + this.boostVis * 10;
      cam.fov += (fovT - cam.fov) * damp(4, rawDt);
    }
    // shake (trauma^2)
    this.trauma = Math.max(0, this.trauma - rawDt * 1.6);
    const sh = this.trauma * this.trauma;
    if (sh > 0.0001) {
      const t = this.time * 40;
      cam.position.x += (Math.sin(t * 1.1) + Math.sin(t * 2.7)) * 0.5 * sh;
      cam.position.y += (Math.sin(t * 1.7 + 2) + Math.sin(t * 3.1)) * 0.4 * sh;
      cam.rotation.z += Math.sin(t * 1.3 + 4) * 0.06 * sh;
    }
    // boost micro shake
    if (this.boostVis > 0.1) {
      cam.position.x += (Math.random() - 0.5) * 0.05 * this.boostVis;
      cam.position.y += (Math.random() - 0.5) * 0.05 * this.boostVis;
    }
    void dt;
    cam.updateProjectionMatrix();
    this.sky.position.copy(cam.position);
    this.moon.position.copy(cam.position).addScaledVector(this.env.sunDir, 800);
    this.moon.lookAt(cam.position);
  }

  pushHud(boosting = false) {
    this.cb.onHud({
      score: Math.floor(this.score),
      speed: Math.round(this.speed * 3.6),
      mult: this.mult,
      combo: this.combo,
      comboT: clamp(this.comboT / 3, 0, 1),
      boost: this.boost,
      lives: this.lives,
      distance: Math.floor(this.distance),
      boosting,
      night: this.env.night,
      cycle: ((this.cycleT % 1) + 1) % 1,
      mode: this.mode,
      timeLeft: Math.max(0, this.timeLeft),
      target: this.target,
    });
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    const aspect = w / h;
    this.camera.aspect = aspect;
    // keep the road readable on portrait screens
    this.fovBase = aspect < 1 ? Math.min(92, 64 + (1 - aspect) * 42) : 64;
    this.camBack = aspect < 1 ? (1 - aspect) * 3 : 0;
    this.camera.updateProjectionMatrix();
    this.particles.mat.uniforms.uScale.value = (h * this.pr) / 2 / Math.tan(THREE.MathUtils.degToRad(this.fovBase / 2));
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVis);
    const el = this.container;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    audio.engine(0, false, false);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    for (const t of [this.roadTex, this.waterTex, this.chevronTex]) t?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

let _glow: THREE.CanvasTexture | null = null;
function GLOW() {
  if (!_glow) _glow = makeGlowTex();
  return _glow;
}
