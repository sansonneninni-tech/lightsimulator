// Più foto dello stesso luogo: ogni foto in più viene allineata alla prima (punti in comune
// tra le due foto + profondità), poi aggiunge alla stanza le parti che la prima foto non vede.
import * as THREE from 'three';
import type { DepthResult } from './depth';
import { cameraDepth, makeAlbedo, detectLights, Reconstruction } from './reconstruct';
import type { LightState } from './photometry';

export interface ExtraView {
  photo: HTMLCanvasElement;
  albedo: HTMLCanvasElement;
  gw: number; gh: number;
  world: Float32Array;       // posizioni mondo per vertice
  index: number[];           // triangoli che aggiungono qualcosa alla prima foto
  pose: number[];            // matrice camera -> mondo (16)
  tanH: number; tanV: number;
  gain: number;              // esposizione rispetto alla prima foto
  inliers: number;
  // per salvare e riaprire senza rifare l'allineamento
  depthGrid: { width: number; height: number; data: number[]; metric: boolean };
  focal35: number;
  alpha: number; beta: number;
}

// ---------------------------------------------------------------- punti caratteristici
interface Feat { x: number; y: number; desc: Float32Array }

const PATCH = 15; // raggio del descrittore
function grayOf(cv: HTMLCanvasElement, W: number) {
  const H = Math.max(2, Math.round((W * cv.height) / cv.width));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(cv, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return { g, W, H };
}

function boxBlur(src: Float32Array, W: number, H: number, r: number) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < W) { s += src[y * W + xx]; n++; } }
    tmp[y * W + x] = s / n;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < H) { s += tmp[yy * W + x]; n++; } }
    out[y * W + x] = s / n;
  }
  return out;
}

function resample(g: Float32Array, W: number, H: number, s: number) {
  const w = Math.max(8, Math.round(W * s)), h = Math.max(8, Math.round(H * s));
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = Math.min(W - 1.001, (x + 0.5) / s - 0.5), fy = Math.min(H - 1.001, (y + 0.5) / s - 0.5);
    const x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy)), tx = fx - x0, ty = fy - y0;
    const i = y0 * W + x0;
    out[y * w + x] = (g[i] * (1 - tx) + g[i + 1] * tx) * (1 - ty) + (g[i + W] * (1 - tx) + g[i + W + 1] * tx) * ty;
  }
  return { g: out, W: w, H: h };
}

// angoli di Harris su più scale, descrittore binario orientato (stile ORB)
function features(cv: HTMLCanvasElement, perLevel = 1500): { feats: Feat[]; W: number; H: number } {
  const base = grayOf(cv, 640);
  const feats: Feat[] = [];
  for (const sc of [1, 0.75, 0.56, 0.42]) {
    const L = sc === 1 ? base : resample(base.g, base.W, base.H, sc);
    const { W, H } = L;
    const g = L.g;
    const ixx = new Float32Array(W * H), iyy = new Float32Array(W * H), ixy = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = (g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1]) - (g[i - W - 1] + 2 * g[i - 1] + g[i + W - 1]);
      const gy = (g[i + W - 1] + 2 * g[i + W] + g[i + W + 1]) - (g[i - W - 1] + 2 * g[i - W] + g[i - W + 1]);
      ixx[i] = gx * gx; iyy[i] = gy * gy; ixy[i] = gx * gy;
    }
    const sxx = boxBlur(ixx, W, H, 2), syy = boxBlur(iyy, W, H, 2), sxy = boxBlur(ixy, W, H, 2);
    const R = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) R[i] = sxx[i] * syy[i] - sxy[i] * sxy[i] - 0.04 * (sxx[i] + syy[i]) ** 2;
    // massimi locali, distribuiti su una griglia per coprire tutta la foto
    const m = PATCH + 2;
    const cells = 8, cw = W / cells, ch = H / cells;
    const buckets: { i: number; r: number }[][] = Array.from({ length: cells * cells }, () => []);
    for (let y = m; y < H - m; y++) for (let x = m; x < W - m; x++) {
      const i = y * W + x, r = R[i];
      if (r <= 1e3) continue;
      let max = true;
      for (let dy = -2; dy <= 2 && max; dy++) for (let dx = -2; dx <= 2; dx++) if ((dx || dy) && R[i + dy * W + dx] >= r) { max = false; break; }
      if (max) buckets[Math.min(cells - 1, Math.floor(y / ch)) * cells + Math.min(cells - 1, Math.floor(x / cw))].push({ i, r });
    }
    const per = Math.ceil(perLevel / (cells * cells));
    for (const b of buckets) {
      b.sort((p, q) => q.r - p.r);
      for (const { i } of b.slice(0, per)) {
        const x = i % W, y = (i / W) | 0;
        // descrittore a istogrammi di gradienti (stile SIFT), dritto: le foto a mano sono in piedi
        const desc = new Float32Array(128);
        const step = (PATCH * 2) / 16;
        for (let sy = 0; sy < 16; sy++) for (let sx = 0; sx < 16; sx++) {
          const px = Math.round(x + (sx - 7.5) * step), py = Math.round(y + (sy - 7.5) * step);
          const i2 = py * W + px;
          const gx = g[i2 + 1] - g[i2 - 1], gy = g[i2 + W] - g[i2 - W];
          const mag = Math.hypot(gx, gy) * Math.exp(-((sx - 7.5) ** 2 + (sy - 7.5) ** 2) / 64);
          let o = (Math.atan2(gy, gx) + Math.PI) / (2 * Math.PI) * 8;
          const o0 = Math.floor(o) % 8, fo = o - Math.floor(o);
          const cell = ((sy >> 2) * 4 + (sx >> 2)) * 8;
          desc[cell + o0] += mag * (1 - fo); desc[cell + ((o0 + 1) % 8)] += mag * fo;
        }
        let nrm = 0; for (let k = 0; k < 128; k++) nrm += desc[k] * desc[k];
        nrm = Math.sqrt(nrm) || 1;
        let n2 = 0; for (let k = 0; k < 128; k++) { desc[k] = Math.min(0.2, desc[k] / nrm); n2 += desc[k] * desc[k]; }
        n2 = Math.sqrt(n2) || 1; for (let k = 0; k < 128; k++) desc[k] /= n2;
        feats.push({ x: (x + 0.5) / W, y: (y + 0.5) / H, desc });
      }
    }
  }
  return { feats, W: base.W, H: base.H };
}

function dist2(a: Float32Array, b: Float32Array) {
  let d = 0;
  for (let k = 0; k < 128; k++) { const t = a[k] - b[k]; d += t * t; }
  return d;
}

function match(A: Feat[], B: Feat[], ratio = 0.9) {
  const best = (f: Feat, list: Feat[]) => {
    let b1 = 9, b2 = 9, bi = -1;
    for (let j = 0; j < list.length; j++) {
      const d = dist2(f.desc, list[j].desc);
      if (d < b1) { b2 = b1; b1 = d; bi = j; } else if (d < b2) b2 = d;
    }
    return { bi, b1, b2 };
  };
  const out: [number, number][] = [];
  const back = B.map((f) => best(f, A).bi);
  for (let i = 0; i < A.length; i++) {
    const { bi, b1, b2 } = best(A[i], B);
    if (bi >= 0 && b1 < ratio * ratio * b2 && back[bi] === i) out.push([i, bi]);
  }
  return out;
}

// ---------------------------------------------------------------- geometria
// similitudine P = s R Q + t (Umeyama) da punti corrispondenti
function umeyama(P: THREE.Vector3[], Q: THREE.Vector3[]) {
  const n = P.length;
  const mp = new THREE.Vector3(), mq = new THREE.Vector3();
  P.forEach((p) => mp.add(p)); Q.forEach((q) => mq.add(q));
  mp.multiplyScalar(1 / n); mq.multiplyScalar(1 / n);
  // matrice di covarianza
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let vq = 0;
  for (let i = 0; i < n; i++) {
    const a = P[i].clone().sub(mp), b = Q[i].clone().sub(mq);
    const aa = [a.x, a.y, a.z], bb = [b.x, b.y, b.z];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] += aa[r] * bb[c];
    vq += b.lengthSq();
  }
  // rotazione ottimale con il quaternione di Horn
  // Horn: S_ab = somma di Q_a * P_b (C contiene P_r * Q_c, quindi si traspone)
  const [Sxx, Syx, Szx, Sxy, Syy, Szy, Sxz, Syz, Szz] = C;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  // autovettore principale per iterazione di potenza (con spostamento per renderla positiva)
  const shift = Math.abs(Sxx) + Math.abs(Syy) + Math.abs(Szz) + Math.abs(Sxy) + Math.abs(Sxz) + Math.abs(Syx) + Math.abs(Syz) + Math.abs(Szx) + Math.abs(Szy) + 1e-9;
  let v = [1, 0.1, 0.1, 0.1];
  for (let it = 0; it < 60; it++) {
    const w = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) w[r] += (N[r][c] + (r === c ? shift : 0)) * v[c];
    const l = Math.hypot(...w) || 1;
    v = w.map((x) => x / l);
  }
  const q = new THREE.Quaternion(v[1], v[2], v[3], v[0]).normalize();
  let num = 0;
  for (let i = 0; i < n; i++) num += P[i].clone().sub(mp).dot(Q[i].clone().sub(mq).applyQuaternion(q));
  const s = vq > 1e-12 ? num / vq : 1;
  const t = mp.clone().sub(mq.clone().applyQuaternion(q).multiplyScalar(s));
  return { q, s, t };
}

// proiezione di un punto del mondo nella foto in più (u, v in [0,1], v dall'alto)
function projectTo(p: THREE.Vector3, qInv: THREE.Quaternion, t: THREE.Vector3, tanH: number, tanV: number) {
  const c = p.clone().sub(t).applyQuaternion(qInv);
  if (c.z > -0.05) return null;
  return [(c.x / (-c.z * tanH) + 1) / 2, (1 - c.y / (-c.z * tanV)) / 2, -c.z];
}

function sampleGrid(arr: Float32Array, gw: number, gh: number, u: number, v: number, stride = 1, off = 0) {
  const i = Math.min(gw - 1, Math.max(0, Math.round(u * (gw - 1))));
  const j = Math.min(gh - 1, Math.max(0, Math.round(v * (gh - 1))));
  return arr[(j * gw + i) * stride + off];
}

// salto di profondità attorno al punto: lì la corrispondenza 3D non è affidabile
function nearEdge(z: Float32Array, gw: number, gh: number, u: number, v: number) {
  const i = Math.min(gw - 2, Math.max(1, Math.round(u * (gw - 1))));
  const j = Math.min(gh - 2, Math.max(1, Math.round(v * (gh - 1))));
  const c = z[j * gw + i];
  let mx = c, mn = c;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const q = z[(j + dj) * gw + i + di]; mx = Math.max(mx, q); mn = Math.min(mn, q); }
  return mx / mn > 1.06;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function registerExtra(recon: Reconstruction, photo: HTMLCanvasElement, depth: DepthResult, focal35: number, saved?: Partial<ExtraView>): Promise<ExtraView | null> {
  const cd = cameraDepth(photo, depth, focal35);
  const { gw, gh, tanH, tanV } = cd;
  const zRaw = cd.z;
  // camera principale
  const mainPos = new THREE.Vector3(...recon.camera.position);
  const mainQ = new THREE.Quaternion(...recon.camera.quaternion);
  const mainQInv = mainQ.clone().invert();
  const mTanV = Math.tan(THREE.MathUtils.degToRad(recon.camera.fov) / 2), mTanH = mTanV * recon.camera.aspect;

  let q: THREE.Quaternion, t: THREE.Vector3, alpha = 1, beta = 0, gain = 1, inl = 0;
  if (saved?.pose) {
    const m = new THREE.Matrix4().fromArray(saved.pose);
    q = new THREE.Quaternion().setFromRotationMatrix(m); t = new THREE.Vector3().setFromMatrixPosition(m);
    alpha = saved.alpha ?? 1; beta = saved.beta ?? 0; gain = saved.gain ?? 1; inl = saved.inliers ?? 0;
  } else {
    const fa = features(recon.photo);
    await sleep(0);
    const fb = features(photo);
    await sleep(0);
    const pairs = match(fa.feats, fb.feats);
    await sleep(0);
    // corrispondenze: punto 3D della stanza (prima foto) <-> pixel e profondità della foto in più
    const corr: { P: THREE.Vector3; Q: THREE.Vector3; uv: [number, number]; ua: [number, number] }[] = [];
    for (const [ia, ib] of pairs) {
      const a = fa.feats[ia], b = fb.feats[ib];
      if (nearEdge(recon.camDepth, recon.gw, recon.gh, a.x, a.y) || nearEdge(zRaw, gw, gh, b.x, b.y)) continue;
      const P = new THREE.Vector3(
        sampleGrid(recon.world, recon.gw, recon.gh, a.x, a.y, 3, 0),
        sampleGrid(recon.world, recon.gw, recon.gh, a.x, a.y, 3, 1),
        sampleGrid(recon.world, recon.gw, recon.gh, a.x, a.y, 3, 2));
      const z = sampleGrid(zRaw, gw, gh, b.x, b.y);
      const Q = new THREE.Vector3((b.x * 2 - 1) * tanH * z, (1 - b.y * 2) * tanV * z, -z);
      corr.push({ P, Q, uv: [b.x, b.y], ua: [a.x, a.y] });
    }
    (globalThis as any).__reg = { pairs: pairs.length, corr: corr.length };
    if (corr.length < 12) return null;
    // RANSAC: ipotesi dalla profondità (3 punti), verifica sulla riproiezione nella foto
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const thr = 0.03;
    let best: { q: THREE.Quaternion; t: THREE.Vector3; s: number; inl: number[] } | null = null;
    for (let it = 0; it < 1500; it++) {
      const ids = [0, 1, 2].map(() => Math.floor(rnd() * corr.length));
      if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
      const P = ids.map((i) => corr[i].P), Q = ids.map((i) => corr[i].Q);
      // triangolo non degenere
      if (P[1].clone().sub(P[0]).cross(P[2].clone().sub(P[0])).length() < 0.05) continue;
      const h = umeyama(P, Q);
      if (!(h.s > 0.1 && h.s < 10)) continue;
      const qi = h.q.clone().invert();
      const inl: number[] = [];
      corr.forEach((c, i) => {
        const pr = projectTo(c.P, qi, h.t, tanH, tanV);
        if (pr && Math.hypot(pr[0] - c.uv[0], pr[1] - c.uv[1]) < thr) inl.push(i);
      });
      if (!best || inl.length > best.inl.length) best = { q: h.q, t: h.t, s: h.s, inl };
      if (it % 300 === 299) await sleep(0);
    }
    (globalThis as any).__reg.best = best?.inl.length;
    if (!best || best.inl.length < Math.max(10, corr.length * 0.12)) return null;
    // rifinitura: posa che minimizza l'errore di riproiezione sui punti buoni
    q = best.q.clone(); t = best.t.clone();
    let inlIds = best.inl;
    for (let round = 0; round < 3; round++) {
      const cost = (qq: THREE.Quaternion, tt: THREE.Vector3) => {
        const qi = qq.clone().invert();
        let e = 0;
        for (const i of inlIds) {
          const pr = projectTo(corr[i].P, qi, tt, tanH, tanV);
          if (!pr) { e += 0.01; continue; }
          const d2 = (pr[0] - corr[i].uv[0]) ** 2 + (pr[1] - corr[i].uv[1]) ** 2;
          e += d2 / (d2 + 0.0004); // robusto
        }
        return e;
      };
      // discesa per coordinate su rotazione (piccoli angoli) e traslazione
      let step = [0.02, 0.02, 0.02, 0.05, 0.05, 0.05];
      let cur = cost(q, t);
      for (let it = 0; it < 200; it++) {
        let improved = false;
        for (let k = 0; k < 6; k++) for (const sg of [1, -1]) {
          const q2 = q.clone(), t2 = t.clone();
          if (k < 3) { const ax = new THREE.Vector3(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0); q2.premultiply(new THREE.Quaternion().setFromAxisAngle(ax, sg * step[k])); }
          else t2.setComponent(k - 3, t2.getComponent(k - 3) + sg * step[k]);
          const c2 = cost(q2, t2);
          if (c2 < cur) { cur = c2; q = q2; t = t2; improved = true; }
        }
        if (!improved) { step = step.map((x) => x * 0.5); if (step[0] < 1e-4) break; }
      }
      const qi = q.clone().invert();
      inlIds = corr.map((c, i) => [c, i] as const).filter(([c]) => { const pr = projectTo(c.P, qi, t, tanH, tanV); return pr && Math.hypot(pr[0] - c.uv[0], pr[1] - c.uv[1]) < thr; }).map(([, i]) => i);
    }
    inl = inlIds.length;
    // profondità della foto in più nella scala della stanza: 1/z = alpha/z_letta + beta
    const qi = q.clone().invert();
    const xs: number[] = [], ys: number[] = [];
    for (const i of inlIds) {
      const pr = projectTo(corr[i].P, qi, t, tanH, tanV);
      if (!pr) continue;
      xs.push(1 / -corr[i].Q.z); ys.push(1 / pr[2]);
    }
    const fit = robustLine(xs, ys);
    alpha = fit.a; beta = fit.b;
    if (!(alpha > 0.05)) { alpha = median(ys.map((y, i) => y / xs[i])); beta = 0; }
    // esposizione: rapporto di luminanza tra le due foto nei punti in comune
    gain = exposureGain(recon.photo, photo, inlIds.map((i) => [corr[i].ua, corr[i].uv]));
  }

  // punti della foto in più nel mondo
  const n = gw * gh;
  const world = new Float32Array(n * 3);
  const zc = new Float32Array(n);
  const tmp = new THREE.Vector3();
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i;
    const inv = alpha / zRaw[k] + beta;
    const z = inv > 1e-3 ? Math.min(40, 1 / inv) : 40;
    zc[k] = z;
    const u = i / (gw - 1), v = j / (gh - 1);
    tmp.set((u * 2 - 1) * tanH * z, (1 - v * 2) * tanV * z, -z).applyQuaternion(q).add(t);
    world[k * 3] = tmp.x; world[k * 3 + 1] = tmp.y; world[k * 3 + 2] = tmp.z;
  }
  // triangoli: niente salti di profondità, e solo ciò che la prima foto non vede già
  const index: number[] = [];
  const camE = t.clone();
  const ta = new THREE.Vector3(), tb = new THREE.Vector3(), tc = new THREE.Vector3(), tn = new THREE.Vector3(), tv = new THREE.Vector3();
  const seenByMain = (p: THREE.Vector3) => {
    const c = p.clone().sub(mainPos).applyQuaternion(mainQInv);
    if (c.z > -0.05) return false;
    const u = (c.x / (-c.z * mTanH) + 1) / 2, v = (1 - c.y / (-c.z * mTanV)) / 2;
    if (u < 0.01 || u > 0.99 || v < 0.01 || v > 0.99) return false;
    const dm = sampleGrid(recon.camDepth, recon.gw, recon.gh, u, v);
    // dietro la superficie vista dalla prima foto (nascosto) di almeno il 12%: è nuovo
    return -c.z < dm * 1.12;
  };
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
    const a = j * gw + i, b = a + 1, c = a + gw, d = c + 1;
    for (const [p, qq, r] of [[a, c, b], [b, c, d]]) {
      const mx = Math.max(zc[p], zc[qq], zc[r]), mn = Math.min(zc[p], zc[qq], zc[r]);
      if (mx / mn > 1.08 + 0.012 * mn) continue;
      ta.fromArray(world, p * 3); tb.fromArray(world, qq * 3); tc.fromArray(world, r * 3);
      tn.subVectors(tb, ta).cross(tv.subVectors(tc, ta));
      const ln = tn.length();
      const cen = ta.clone().add(tb).add(tc).multiplyScalar(1 / 3);
      if (ln > 1e-9 && Math.abs(tn.dot(cen.clone().sub(camE).normalize()) / ln) < 0.06) continue;
      if (seenByMain(cen)) continue;
      index.push(p, qq, r);
    }
  }
  const pose = new THREE.Matrix4().compose(t, q, new THREE.Vector3(1, 1, 1)).toArray();
  return {
    photo, albedo: makeAlbedo(photo), gw, gh, world, index, pose, tanH, tanV, gain, inliers: inl,
    depthGrid: { width: depth.width, height: depth.height, data: Array.from(depth.data), metric: depth.metric },
    focal35, alpha, beta,
  };
}

// luci che si vedono solo nella foto in più (lampade fuori dalla prima inquadratura)
export function extraLights(recon: Reconstruction, ex: ExtraView): LightState[] {
  const m = new THREE.Matrix4().fromArray(ex.pose);
  const q = new THREE.Quaternion().setFromRotationMatrix(m), t = new THREE.Vector3().setFromMatrixPosition(m);
  const camDepth = new Float32Array(ex.gw * ex.gh);
  for (let k = 0; k < camDepth.length; k++) {
    const p = new THREE.Vector3().fromArray(ex.world, k * 3).sub(t).applyQuaternion(q.clone().invert());
    camDepth[k] = Math.max(0.05, -p.z);
  }
  const det = detectLights(ex.photo, { gw: ex.gw, gh: ex.gh, world: ex.world, camDepth, tanH: ex.tanH, tanV: ex.tanV, camQuat: q, camPos: t });
  const out: LightState[] = [];
  const known = [...recon.lights, ...out];
  for (const L of det.lights) {
    if (L.origin === 'finestra' || L.name === 'Luce ambiente') continue;
    const p = new THREE.Vector3(...L.position);
    if (known.some((k) => p.distanceTo(new THREE.Vector3(...k.position)) < 0.9)) continue;
    // fuori dalla stanza ricostruita: non affidabile
    const { min, max } = recon.room;
    if (p.x < min[0] - 0.5 || p.x > max[0] + 0.5 || p.z < min[2] - 0.5 || p.z > max[2] + 0.5) continue;
    out.push(L); known.push(L);
  }
  return out;
}

function robustLine(xs: number[], ys: number[]) {
  let idx = xs.map((_, i) => i);
  let a = 1, b = 0;
  for (let it = 0; it < 4; it++) {
    const n = idx.length;
    if (n < 4) break;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const i of idx) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    const den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-12) break;
    a = (n * sxy - sx * sy) / den; b = (sy - a * sx) / n;
    const res = idx.map((i) => Math.abs(ys[i] - (a * xs[i] + b)));
    const cut = [...res].sort((p, q) => p - q)[Math.floor(res.length * 0.75)];
    idx = idx.filter((_, k) => res[k] <= cut);
  }
  return { a, b };
}

function median(a: number[]) {
  const b = a.filter(isFinite).sort((x, y) => x - y);
  return b.length ? b[Math.floor(b.length / 2)] : 1;
}

function exposureGain(a: HTMLCanvasElement, b: HTMLCanvasElement, pts: [number, number][][]) {
  const lum = (cv: HTMLCanvasElement) => {
    const W = 160, H = Math.round((W * cv.height) / cv.width);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.filter = 'blur(2px)';
    x.drawImage(cv, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data;
    return (u: number, v: number) => {
      const i = (Math.min(H - 1, Math.floor(v * H)) * W + Math.min(W - 1, Math.floor(u * W))) * 4;
      const l = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * l(d[i]) + 0.7152 * l(d[i + 1]) + 0.0722 * l(d[i + 2]);
    };
  };
  const la = lum(a), lb = lum(b);
  const r = pts.map(([pa, pb]) => { const x = la(pa[0], pa[1]), y = lb(pb[0], pb[1]); return x > 0.01 && y > 0.01 && x < 0.9 && y < 0.9 ? x / y : NaN; });
  const g = median(r);
  return Math.min(4, Math.max(0.25, g));
}
