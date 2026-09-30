import * as THREE from 'three';

/** A full lighting/sky/fog preset. Everything is interpolated between keyframes. */
export interface Env {
  top: THREE.Color;
  mid: THREE.Color;
  hor: THREE.Color;
  fog: THREE.Color;
  fogNear: number;
  fogFar: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiI: number;
  sun: THREE.Color;
  sunI: number;
  sunDir: THREE.Vector3;
  ocean: THREE.Color;
  cloud: THREE.Color;
  cloudEm: number;
  stars: number;
  night: number; // 0 day -> 1 night (drives headlights, emissive glow)
}

const c = (h: string) => new THREE.Color(h);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();

const DAY: Env = {
  top: c('#0a63d8'), mid: c('#49b8ff'), hor: c('#cdf3ff'), fog: c('#cdf3ff'), fogNear: 50, fogFar: 250,
  hemiSky: c('#e6f8ff'), hemiGround: c('#5fb878'), hemiI: 2.1, sun: c('#ffffff'), sunI: 2.6, sunDir: v(-0.35, 0.28, -1),
  ocean: c('#ffffff'), cloud: c('#ffffff'), cloudEm: 0.7, stars: 0, night: 0,
};
const DUSK: Env = {
  top: c('#3b2a8a'), mid: c('#ff8a5b'), hor: c('#ffd9a0'), fog: c('#ffc9a6'), fogNear: 45, fogFar: 230,
  hemiSky: c('#ffd0b0'), hemiGround: c('#5a4a90'), hemiI: 1.5, sun: c('#ffb070'), sunI: 2.3, sunDir: v(-0.55, 0.05, -1),
  ocean: c('#ffb08a'), cloud: c('#ffd2c0'), cloudEm: 0.45, stars: 0.15, night: 0.3,
};
const NIGHT: Env = {
  top: c('#020818'), mid: c('#0b1a4a'), hor: c('#1c3f80'), fog: c('#12295a'), fogNear: 35, fogFar: 200,
  hemiSky: c('#7090d0'), hemiGround: c('#102040'), hemiI: 0.9, sun: c('#9ab8ff'), sunI: 1.0, sunDir: v(0.45, 0.55, -1),
  ocean: c('#4a6fb8'), cloud: c('#6a80b8'), cloudEm: 0.08, stars: 1, night: 1,
};
const DAWN: Env = {
  top: c('#4a4aa8'), mid: c('#ff9ab8'), hor: c('#ffe4b8'), fog: c('#ffdcc6'), fogNear: 45, fogFar: 230,
  hemiSky: c('#ffe0d0'), hemiGround: c('#607098'), hemiI: 1.6, sun: c('#ffc898'), sunI: 2.1, sunDir: v(0.55, 0.08, -1),
  ocean: c('#ffc0c8'), cloud: c('#ffe0e8'), cloudEm: 0.5, stars: 0.1, night: 0.25,
};

/** keyframes over one cycle t in [0,1) */
const KEYS: { t: number; e: Env }[] = [
  { t: 0.0, e: DAY },
  { t: 0.24, e: DAY },
  { t: 0.36, e: DUSK },
  { t: 0.48, e: NIGHT },
  { t: 0.74, e: NIGHT },
  { t: 0.86, e: DAWN },
  { t: 1.0, e: DAY },
];

const smooth = (x: number) => x * x * (3 - 2 * x);

export function cloneEnv(e: Env): Env {
  return {
    ...e,
    top: e.top.clone(), mid: e.mid.clone(), hor: e.hor.clone(), fog: e.fog.clone(), hemiSky: e.hemiSky.clone(), hemiGround: e.hemiGround.clone(),
    sun: e.sun.clone(), sunDir: e.sunDir.clone(), ocean: e.ocean.clone(), cloud: e.cloud.clone(),
  };
}

export function sampleEnv(t: number, out: Env) {
  t = ((t % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const k = smooth((t - a.t) / (b.t - a.t));
  out.top.lerpColors(a.e.top, b.e.top, k);
  out.mid.lerpColors(a.e.mid, b.e.mid, k);
  out.hor.lerpColors(a.e.hor, b.e.hor, k);
  out.fog.lerpColors(a.e.fog, b.e.fog, k);
  out.hemiSky.lerpColors(a.e.hemiSky, b.e.hemiSky, k);
  out.hemiGround.lerpColors(a.e.hemiGround, b.e.hemiGround, k);
  out.sun.lerpColors(a.e.sun, b.e.sun, k);
  out.ocean.lerpColors(a.e.ocean, b.e.ocean, k);
  out.cloud.lerpColors(a.e.cloud, b.e.cloud, k);
  out.sunDir.lerpVectors(a.e.sunDir, b.e.sunDir, k).normalize();
  out.fogNear = THREE.MathUtils.lerp(a.e.fogNear, b.e.fogNear, k);
  out.fogFar = THREE.MathUtils.lerp(a.e.fogFar, b.e.fogFar, k);
  out.hemiI = THREE.MathUtils.lerp(a.e.hemiI, b.e.hemiI, k);
  out.sunI = THREE.MathUtils.lerp(a.e.sunI, b.e.sunI, k);
  out.cloudEm = THREE.MathUtils.lerp(a.e.cloudEm, b.e.cloudEm, k);
  out.stars = THREE.MathUtils.lerp(a.e.stars, b.e.stars, k);
  out.night = THREE.MathUtils.lerp(a.e.night, b.e.night, k);
}

export const ENV_DAY = DAY;

export function phaseName(t: number): string {
  t = ((t % 1) + 1) % 1;
  if (t < 0.3) return 'Día';
  if (t < 0.44) return 'Atardecer';
  if (t < 0.8) return 'Noche';
  if (t < 0.93) return 'Amanecer';
  return 'Día';
}
