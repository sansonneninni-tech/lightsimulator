// Dalla foto + profondità alla stanza 3D: mesh di profondità, scatola della stanza,
// albedo (foto "senza luce"), finestre e luci lette.
import * as THREE from 'three';
import { DepthResult } from './depth';
import { LightState, makeLight, READ_FIXTURES, rgbToKelvin, newId } from './photometry';

export interface WindowInfo {
  id: string;
  center: [number, number, number];
  normal: [number, number, number]; // verso l'interno della stanza
  right: [number, number, number];
  width: number;
  height: number;
  bbox: [number, number, number, number]; // u0 v0 u1 v1 nella foto (v dall'alto)
}

export interface LightMask { lightId: string; bbox: [number, number, number, number]; pixels: number[] /* indici nella griglia di rilevamento */ }

export interface Reconstruction {
  photo: HTMLCanvasElement;      // foto (sRGB) max 2048
  albedo: HTMLCanvasElement;     // foto con luce attenuata
  gw: number; gh: number;
  world: Float32Array;           // posizioni mondo per vertice della griglia
  camDepth: Float32Array;        // profondità camera per vertice
  camera: { position: [number, number, number]; quaternion: [number, number, number, number]; fov: number; aspect: number };
  room: { min: [number, number, number]; max: [number, number, number] };
  windows: WindowInfo[];
  lights: LightState[];
  masks: { lightId: string; rect: [number, number, number, number]; mask: HTMLCanvasElement }[];
  photoMeanLum: number;          // luminanza lineare media della foto
  depthSource: string;
  depthGrid: { width: number; height: number; data: number[]; metric: boolean };
  focal35: number;
}

const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function sampleBilinear(d: DepthResult, u: number, v: number) {
  const x = Math.min(d.width - 1.001, Math.max(0, u * d.width - 0.5));
  const y = Math.min(d.height - 1.001, Math.max(0, v * d.height - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const i = y0 * d.width + x0;
  const a = d.data[i], b = d.data[i + 1], c = d.data[i + d.width], e = d.data[i + d.width + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}

function percentile(arr: Float32Array | number[], p: number) {
  const a = Array.from(arr).filter((x) => isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.max(0, Math.floor((p / 100) * (a.length - 1))))];
}

export function reconstruct(photo: HTMLCanvasElement, depth: DepthResult, focal35 = 26): Reconstruction {
  const aspect = photo.width / photo.height;
  // campo visivo dal 35 mm equivalente (lato lungo = 36 mm)
  const longFov = 2 * Math.atan(36 / (2 * focal35));
  const tanH = aspect >= 1 ? Math.tan(longFov / 2) : Math.tan(longFov / 2) * aspect;
  const tanV = tanH / aspect;

  // --- griglia ---
  const gw = Math.min(320, Math.max(64, depth.width));
  const gh = Math.max(2, Math.round(gw / aspect));
  const n = gw * gh;
  const z = new Float32Array(n);

  // smussa leggermente la profondità (3x3) preservando i bordi
  const raw = new Float32Array(n);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) raw[j * gw + i] = sampleBilinear(depth, (i + 0.5) / gw, (j + 0.5) / gh);

  if (depth.metric) {
    z.set(raw);
  } else {
    const lo = percentile(raw, 1), hi = percentile(raw, 99.5);
    const zn = 0.9, zf = 7.5;
    for (let k = 0; k < n; k++) {
      const d = Math.min(1, Math.max(0, (raw[k] - lo) / (hi - lo || 1)));
      z[k] = 1 / (d * (1 / zn - 1 / zf) + 1 / zf);
    }
  }
  const zs = new Float32Array(n);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const c = z[j * gw + i];
    let s = 0, w = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = Math.min(gw - 1, Math.max(0, i + di)), jj = Math.min(gh - 1, Math.max(0, j + dj));
      const q = z[jj * gw + ii];
      if (Math.abs(q - c) / c < 0.05) { const ww = di === 0 && dj === 0 ? 2 : 1; s += q * ww; w += ww; }
    }
    zs[j * gw + i] = s / w;
  }
  z.set(zs);

  // punti nello spazio camera (camera guarda -Z, Y in alto)
  const pc = new Float32Array(n * 3);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i;
    const u = i / (gw - 1), v = j / (gh - 1);
    const d = z[k];
    pc[k * 3] = (u * 2 - 1) * tanH * d;
    pc[k * 3 + 1] = (1 - v * 2) * tanV * d;
    pc[k * 3 + 2] = -d;
  }

  // --- pavimento (RANSAC sulla parte bassa dell'immagine) ---
  const cand: number[] = [];
  for (let j = Math.floor(gh * 0.6); j < gh; j += 2) for (let i = 0; i < gw; i += 2) cand.push(j * gw + i);
  let bestN = new THREE.Vector3(0, 1, 0), bestD = 0, bestCount = 0;
  const P = (k: number) => new THREE.Vector3(pc[k * 3], pc[k * 3 + 1], pc[k * 3 + 2]);
  const medZ = percentile(z, 50);
  const tol = 0.025 * medZ;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let it = 0; it < 400 && cand.length > 10; it++) {
    const a = P(cand[Math.floor(rnd() * cand.length)]), b = P(cand[Math.floor(rnd() * cand.length)]), c = P(cand[Math.floor(rnd() * cand.length)]);
    const nn = b.clone().sub(a).cross(c.clone().sub(a));
    if (nn.lengthSq() < 1e-8) continue;
    nn.normalize();
    if (nn.y < 0) nn.negate();
    if (nn.y < 0.7) continue; // deve essere quasi orizzontale
    const dd = -nn.dot(a); // piano: n·p + dd = 0 ; la camera (origine) deve stare sopra: dd > 0
    if (dd <= 0.05) continue;
    let count = 0;
    for (let q = 0; q < cand.length; q += 2) {
      const k = cand[q];
      const dist = nn.x * pc[k * 3] + nn.y * pc[k * 3 + 1] + nn.z * pc[k * 3 + 2] + dd;
      if (Math.abs(dist) < tol) count++;
    }
    if (count > bestCount) { bestCount = count; bestN = nn; bestD = dd; }
  }
  const camHeight = 1.6;
  const rot = new THREE.Quaternion();
  let scale = 1;
  let floorFound = bestCount > cand.length * 0.08;
  if (floorFound) {
    rot.setFromUnitVectors(bestN, new THREE.Vector3(0, 1, 0));
    scale = camHeight / bestD;
    // limiti di plausibilità
    if (scale < 0.25 || scale > 4) { floorFound = false; rot.identity(); scale = 1; }
  }

  const world = new Float32Array(n * 3);
  const tmp = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    tmp.set(pc[k * 3], pc[k * 3 + 1], pc[k * 3 + 2]).multiplyScalar(scale).applyQuaternion(rot);
    world[k * 3] = tmp.x; world[k * 3 + 1] = tmp.y; world[k * 3 + 2] = tmp.z;
  }
  let yOffset = camHeight;
  if (!floorFound) {
    // pavimento = punti più bassi
    const ys = new Float32Array(n);
    for (let k = 0; k < n; k++) ys[k] = world[k * 3 + 1];
    yOffset = -percentile(ys, 1);
    if (yOffset < 0.5 || yOffset > 3) yOffset = camHeight;
  }
  for (let k = 0; k < n; k++) world[k * 3 + 1] += yOffset;
  const camDepth = new Float32Array(n);
  for (let k = 0; k < n; k++) camDepth[k] = z[k] * scale;

  // --- stanza ---
  const xs = new Float32Array(n), ys = new Float32Array(n), zz = new Float32Array(n);
  for (let k = 0; k < n; k++) { xs[k] = world[k * 3]; ys[k] = world[k * 3 + 1]; zz[k] = world[k * 3 + 2]; }
  const clampR = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const room = {
    min: [clampR(percentile(xs, 1) - 0.08, -15, -1.2), 0, clampR(percentile(zz, 1) - 0.08, -30, -2)] as [number, number, number],
    max: [clampR(percentile(xs, 99) + 0.08, 1.2, 15), clampR(Math.max(percentile(ys, 99.5) + 0.05, 2.6), 2.4, 8), 2.5] as [number, number, number],
  };

  const camQuat = rot.clone();

  // --- immagini ---
  const albedo = makeAlbedo(photo);

  // --- rilevamento luci ---
  const det = detectLights(photo, { gw, gh, world, camDepth, tanH, tanV, camQuat, camPos: new THREE.Vector3(0, yOffset, 0) });

  return {
    photo, albedo, gw, gh, world, camDepth,
    camera: { position: [0, yOffset, 0], quaternion: [camQuat.x, camQuat.y, camQuat.z, camQuat.w], fov: THREE.MathUtils.radToDeg(2 * Math.atan(tanV)), aspect },
    room,
    windows: det.windows,
    lights: det.lights,
    masks: det.masks,
    photoMeanLum: det.meanLum,
    depthSource: depth.source,
    depthGrid: { width: depth.width, height: depth.height, data: Array.from(depth.data), metric: depth.metric },
    focal35,
  };
}

// Albedo approssimato: divide la foto per l'illuminazione a bassa frequenza
function makeAlbedo(photo: HTMLCanvasElement) {
  const W = Math.min(2048, photo.width), H = Math.round((W * photo.height) / photo.width);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(photo, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  // illuminazione a bassa frequenza: miniatura sfocata
  const sw = 24, sh = Math.max(2, Math.round((sw * H) / W));
  const s = document.createElement('canvas'); s.width = sw; s.height = sh;
  const sctx = s.getContext('2d', { willReadFrequently: true })!;
  sctx.filter = 'blur(1.5px)';
  sctx.drawImage(photo, 0, 0, sw, sh);
  const small = sctx.getImageData(0, 0, sw, sh).data;
  const lowLum = new Float32Array(sw * sh);
  let mean = 0;
  for (let k = 0; k < sw * sh; k++) {
    const l = 0.2126 * srgbToLin(small[k * 4] / 255) + 0.7152 * srgbToLin(small[k * 4 + 1] / 255) + 0.0722 * srgbToLin(small[k * 4 + 2] / 255);
    lowLum[k] = l; mean += l;
  }
  mean /= sw * sh;
  const d = img.data;
  const strength = 0.65;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(sh - 1.001, Math.max(0, (y / H) * sh - 0.5));
    const y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(sw - 1.001, Math.max(0, (x / W) * sw - 0.5));
      const x0 = Math.floor(fx), tx = fx - x0;
      const a = lowLum[y0 * sw + x0], b = lowLum[y0 * sw + x0 + 1], e = lowLum[(y0 + 1) * sw + x0], f = lowLum[(y0 + 1) * sw + x0 + 1];
      const L = (a * (1 - tx) + b * tx) * (1 - ty) + (e * (1 - tx) + f * tx) * ty;
      const target = 0.32; // riflettanza media tipica di un interno
      const gain = Math.pow(target / Math.max(L, 0.004), strength) * Math.pow(mean / Math.max(mean, 0.001), 0);
      const i = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const lin = srgbToLin(d[i + ch] / 255) * gain;
        d[i + ch] = Math.round(linToSrgb(Math.min(0.85, lin)) * 255);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

interface DetCtx { gw: number; gh: number; world: Float32Array; camDepth: Float32Array; tanH: number; tanV: number; camQuat: THREE.Quaternion; camPos: THREE.Vector3 }

function detectLights(photo: HTMLCanvasElement, g: DetCtx) {
  const W = 256, H = Math.max(2, Math.round((W * photo.height) / photo.width));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(photo, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const luma = new Float32Array(W * H);
  const lin = new Float32Array(W * H * 3);
  let meanLum = 0;
  for (let k = 0; k < W * H; k++) {
    const r = srgbToLin(d[k * 4] / 255), gg = srgbToLin(d[k * 4 + 1] / 255), b = srgbToLin(d[k * 4 + 2] / 255);
    lin[k * 3] = r; lin[k * 3 + 1] = gg; lin[k * 3 + 2] = b;
    luma[k] = (0.2126 * d[k * 4] + 0.7152 * d[k * 4 + 1] + 0.0722 * d[k * 4 + 2]) / 255;
    meanLum += 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  }
  meanLum /= W * H;
  const thr = Math.max(0.9, Math.min(0.97, percentile(luma, 99.6)));
  const label = new Int32Array(W * H).fill(-1);
  const comps: { px: number[]; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let k = 0; k < W * H; k++) {
    if (luma[k] < thr || label[k] >= 0) continue;
    const id = comps.length;
    const comp = { px: [] as number[], x0: W, y0: H, x1: 0, y1: 0 };
    const stack = [k]; label[k] = id;
    while (stack.length) {
      const q = stack.pop()!;
      comp.px.push(q);
      const qx = q % W, qy = (q / W) | 0;
      comp.x0 = Math.min(comp.x0, qx); comp.x1 = Math.max(comp.x1, qx);
      comp.y0 = Math.min(comp.y0, qy); comp.y1 = Math.max(comp.y1, qy);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nk = ny * W + nx;
        if (label[nk] < 0 && luma[nk] >= thr) { label[nk] = id; stack.push(nk); }
      }
    }
    comps.push(comp);
  }
  // unisci componenti vicine
  const merged: typeof comps = [];
  for (const cmp of comps.sort((a, b) => b.px.length - a.px.length)) {
    if (cmp.px.length < 3) continue;
    const m = merged.find((o) => cmp.x0 <= o.x1 + 3 && cmp.x1 >= o.x0 - 3 && cmp.y0 <= o.y1 + 3 && cmp.y1 >= o.y0 - 3);
    if (m) { m.px.push(...cmp.px); m.x0 = Math.min(m.x0, cmp.x0); m.x1 = Math.max(m.x1, cmp.x1); m.y0 = Math.min(m.y0, cmp.y0); m.y1 = Math.max(m.y1, cmp.y1); }
    else merged.push({ ...cmp, px: [...cmp.px] });
  }

  const lights: LightState[] = [];
  const windows: WindowInfo[] = [];
  const masks: Reconstruction['masks'] = [];

  const gridIndex = (u: number, v: number) => {
    const i = Math.min(g.gw - 1, Math.max(0, Math.round(u * (g.gw - 1))));
    const j = Math.min(g.gh - 1, Math.max(0, Math.round(v * (g.gh - 1))));
    return j * g.gw + i;
  };
  const unproject = (u: number, v: number, depth: number) => {
    const p = new THREE.Vector3((u * 2 - 1) * g.tanH * depth, (1 - v * 2) * g.tanV * depth, -depth);
    return p.applyQuaternion(g.camQuat).add(g.camPos);
  };
  const avgColor = (cmp: typeof comps[0]) => {
    // colore dall'alone attorno alla sorgente (non saturo)
    const pad = Math.max(3, Math.round(Math.max(cmp.x1 - cmp.x0, cmp.y1 - cmp.y0)));
    let r = 0, gg = 0, b = 0, cnt = 0;
    for (let y = Math.max(0, cmp.y0 - pad); y <= Math.min(H - 1, cmp.y1 + pad); y++)
      for (let x = Math.max(0, cmp.x0 - pad); x <= Math.min(W - 1, cmp.x1 + pad); x++) {
        const k = y * W + x;
        if (luma[k] > 0.45 && luma[k] < thr) { r += lin[k * 3]; gg += lin[k * 3 + 1]; b += lin[k * 3 + 2]; cnt++; }
      }
    if (!cnt) return 4000;
    return rgbToKelvin(r, gg, b);
  };

  // contrasto: luminanza media dell'anello attorno alla componente
  const ringLuma = (cmp: typeof comps[0]) => {
    const pad = Math.max(2, Math.round(Math.max(cmp.x1 - cmp.x0, cmp.y1 - cmp.y0) * 0.6));
    let sum = 0, cnt = 0;
    for (let y = Math.max(0, cmp.y0 - pad); y <= Math.min(H - 1, cmp.y1 + pad); y++)
      for (let x = Math.max(0, cmp.x0 - pad); x <= Math.min(W - 1, cmp.x1 + pad); x++) {
        if (x >= cmp.x0 && x <= cmp.x1 && y >= cmp.y0 && y <= cmp.y1) continue;
        sum += luma[y * W + x]; cnt++;
      }
    return cnt ? sum / cnt : 1;
  };

  // 1) finestre: grandi zone chiare su superfici verticali
  const windowBoxes: [number, number, number, number][] = [];
  const pointCands: typeof merged = [];
  for (const cmp of merged) {
    const area = cmp.px.length / (W * H);
    const bw = cmp.x1 - cmp.x0 + 1, bh = cmp.y1 - cmp.y0 + 1;
    const fill = cmp.px.length / (bw * bh);
    const u0 = cmp.x0 / W, v0 = cmp.y0 / H, u1 = (cmp.x1 + 1) / W, v1 = (cmp.y1 + 1) / H;
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const big = (area > 0.012 && fill > 0.35) || area > 0.04;
    if (!big) { pointCands.push(cmp); continue; }
    if (windows.length >= 4) continue;
    // profondità del muro attorno alla finestra (anello esterno)
    const ring = (u: number, v: number) => g.camDepth[gridIndex(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v)))];
    const m = 0.02;
    const dl = median([ring(u0 - m, cv), ring(u0 - m, v0), ring(u0 - m, v1)]);
    const dr = median([ring(u1 + m, cv), ring(u1 + m, v0), ring(u1 + m, v1)]);
    const dt = median([ring(cu, v0 - m), ring(u0, v0 - m), ring(u1, v0 - m)]);
    const db = median([ring(cu, v1 + m), ring(u0, v1 + m), ring(u1, v1 + m)]);
    const dAvg = median([dl, dr, dt, db]);
    const tl = unproject(u0, v0, (dl + dt) / 2 || dAvg), tr = unproject(u1, v0, (dr + dt) / 2 || dAvg);
    const bl = unproject(u0, v1, (dl + db) / 2 || dAvg), br = unproject(u1, v1, (dr + db) / 2 || dAvg);
    const center = tl.clone().add(tr).add(bl).add(br).multiplyScalar(0.25);
    const right = tr.clone().sub(tl).add(br.clone().sub(bl)).multiplyScalar(0.5);
    const up = tl.clone().sub(bl).add(tr.clone().sub(br)).multiplyScalar(0.5);
    const width = Math.max(0.3, right.length()), height = Math.max(0.3, up.length());
    up.normalize();
    // riflessi su tavoli e pavimenti: la "finestra" sarebbe orizzontale
    if (Math.abs(up.y) < 0.6 || cv > 0.78 || center.y < 0.3) continue;
    const normal = new THREE.Vector3().subVectors(g.camPos, center);
    normal.y = 0; if (normal.lengthSq() < 1e-4) normal.set(0, 0, 1); normal.normalize();
    // normale del muro dalla direzione orizzontale dei bordi
    const rightH = right.clone(); rightH.y = 0;
    if (rightH.lengthSq() > 1e-4) {
      rightH.normalize();
      const n2 = new THREE.Vector3(0, 1, 0).cross(rightH).normalize();
      if (n2.dot(normal) < 0) n2.negate();
      if (n2.dot(normal) > 0.2) normal.copy(n2);
    }
    const rightDir = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
    const win: WindowInfo = {
      id: newId('w'),
      center: center.toArray() as any, normal: normal.toArray() as any, right: rightDir.toArray() as any,
      width, height, bbox: [u0, v0, u1, v1],
    };
    windows.push(win);
    windowBoxes.push([u0 - 0.03, v0 - 0.03, u1 + 0.03, v1 + 0.03]);
    const kelvin = Math.round(avgColor(cmp) / 100) * 100;
    const pos = center.clone().addScaledVector(normal, 0.03);
    const L = makeLight('panel-120x60', pos.toArray() as any, center.clone().addScaledVector(normal, 2).toArray() as any, {
      name: `Finestra ${windows.length}`, origin: 'finestra', size: [width, height], kelvin: Math.max(5000, kelvin), softness: 1,
    });
    (L as any).windowId = win.id;
    lights.push(L);
    masks.push({ lightId: L.id, rect: [u0, v0, u1, v1], mask: makeMask(cmp, W, H) });
  }

  // 2) sorgenti puntiformi: piccole, isolate, fuori dalle finestre
  const scored = pointCands
    .map((cmp) => ({ cmp, ring: ringLuma(cmp) }))
    .filter(({ cmp, ring }) => {
      const cu = (cmp.x0 + cmp.x1 + 1) / 2 / W, cv = (cmp.y0 + cmp.y1 + 1) / 2 / H;
      if (windowBoxes.some((b) => cu > b[0] && cu < b[2] && cv > b[1] && cv < b[3])) return false;
      return ring < (cv < 0.4 ? 0.75 : 0.55) && cmp.px.length >= 3;
    })
    .sort((a, b) => b.cmp.px.length * (1 - b.ring) - a.cmp.px.length * (1 - a.ring));
  let count = 0;
  for (const { cmp } of scored) {
    if (count >= 5) break;
    const area = cmp.px.length / (W * H);
    const bw = cmp.x1 - cmp.x0 + 1, bh = cmp.y1 - cmp.y0 + 1;
    const u0 = cmp.x0 / W, v0 = cmp.y0 / H, u1 = (cmp.x1 + 1) / W, v1 = (cmp.y1 + 1) / H;
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const kelvin = Math.round(avgColor(cmp) / 100) * 100;
    // sorgente puntiforme: profondità mediana dei suoi pixel
    const depths = cmp.px.map((q) => g.camDepth[gridIndex((q % W + 0.5) / W, (((q / W) | 0) + 0.5) / H)]);
    const dep = Math.max(0.4, median(depths) * 0.97);
    const pos = unproject(cu, cv, dep);
    if (pos.y < 0.8) continue; // riflessi su pavimenti e tavoli
    const isCeiling = cv < 0.25 && pos.y > 1.9;
    const elongated = bw / bh > 4 || bh / bw > 4;
    let fixtureId = isCeiling ? READ_FIXTURES.ceiling : READ_FIXTURES.practical;
    if (elongated) fixtureId = 'tube-120';
    if (area > 0.004 && !elongated) fixtureId = 'bulb-150';
    const target = pos.clone().add(new THREE.Vector3(0, -1, 0));
    const L = makeLight(fixtureId, pos.toArray() as any, target.toArray() as any, {
      name: isCeiling ? 'Plafoniera' : elongated ? 'Neon' : 'Lampada',
      origin: 'letta',
      kelvin: Math.min(6500, Math.max(2200, kelvin)),
    });
    if (elongated) {
      const len = Math.max(0.3, Math.min(2.4, ((Math.max(bw, bh) / W) * 2 * g.tanH) * dep));
      L.size = [len, 0.04];
    }
    lights.push(L);
    masks.push({ lightId: L.id, rect: [u0, v0, u1, v1], mask: makeMask(cmp, W, H) });
    count++;
  }
  // numerazione nomi
  const counts: Record<string, number> = {};
  for (const L of lights) {
    if (L.origin === 'finestra') continue;
    counts[L.name] = (counts[L.name] || 0) + 1;
  }
  const seen: Record<string, number> = {};
  for (const L of lights) {
    if (L.origin === 'finestra' || counts[L.name] < 2) continue;
    seen[L.name] = (seen[L.name] || 0) + 1;
    L.name = `${L.name} ${seen[L.name]}`;
  }

  // nessuna sorgente visibile: luce morbida dal lato più luminoso
  if (!lights.length) {
    let sx = 0, sy = 0, sw = 0;
    for (let k = 0; k < W * H; k++) {
      const w = Math.pow(luma[k], 4);
      sx += (k % W) * w; sy += ((k / W) | 0) * w; sw += w;
    }
    const u = sx / sw / W, v = sy / sw / H;
    const dep = g.camDepth[gridIndex(u, v)] * 0.6;
    const pos = unproject(u, Math.min(v, 0.4), Math.max(1.2, dep));
    pos.y = Math.max(pos.y, 2.0);
    const target = unproject(0.5, 0.55, Math.max(1.5, percentile(g.camDepth, 50) * 0.7));
    lights.push(makeLight(READ_FIXTURES.generic, pos.toArray() as any, target.toArray() as any, { name: 'Luce ambiente', origin: 'letta', kelvin: 4300 }));
  }
  return { lights, windows, masks, meanLum };
}

function makeMask(cmp: { px: number[] }, W: number, H: number) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (const q of cmp.px) { img.data[q * 4 + 3] = 255; img.data[q * 4] = img.data[q * 4 + 1] = img.data[q * 4 + 2] = 255; }
  ctx.putImageData(img, 0, 0);
  // alone morbido
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const o = out.getContext('2d')!;
  o.filter = 'blur(2px)';
  o.drawImage(c, 0, 0); o.drawImage(c, 0, 0);
  return out;
}

function median(a: number[]) {
  const b = a.filter((x) => isFinite(x) && x > 0).sort((x, y) => x - y);
  return b.length ? b[Math.floor(b.length / 2)] : 3;
}
