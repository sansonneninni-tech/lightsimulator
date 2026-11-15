// Esterni: deserto, spiaggia, centro città. Niente pareti né soffitto: un terreno grande che arriva
// all'orizzonte e lo scenario attorno all'area del set (larghezza × profondità della RoomSpec).
// Geometria leggera: poche migliaia di triangoli, materiali condivisi, scatole unite per materiale.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomSpec, OutdoorKind, canvasTex, rng, noise, blotches, worldUV } from './room';

export const OUTDOORS: { id: OutdoorKind; name: string; ground: string }[] = [
  { id: 'deserto', name: 'Deserto', ground: 'Sabbia e dune' },
  { id: 'spiaggia', name: 'Spiaggia', ground: 'Sabbia e mare' },
  { id: 'citta', name: 'Centro città', ground: 'Strada e palazzi' },
];

export const isOutdoor = (r: RoomSpec | null | undefined) => !!r?.outdoor;

// città: mezza carreggiata, filo delle facciate, altezza del marciapiede
export const CITY = { road: 3.5, facade: 7, kerb: 0.15 };
// spiaggia: riva davanti al set (verso -Z, dove guarda la camera) e livello del mare
export const SEA_Y = -0.3;
export const shoreZ = (r: RoomSpec, x = 0) => -r.depth / 2 - 5 + 1.6 * Math.sin(x / 37);
// linea dove l'acqua incontra la sabbia (pendenza del 5%: 3 m dentro la riva)
export const waterlineZ = (r: RoomSpec, x = 0) => shoreZ(r, x) + 3;

// quota del terreno nell'area del set (dove stanno persone, arredi e stativi)
export function groundHeight(r: RoomSpec | null | undefined, x: number, _z: number) {
  if (r?.outdoor === 'citta') return Math.abs(x) < CITY.road ? -CITY.kerb : 0;
  return 0;
}

// lati del set su cui si può appendere qualcosa (solo le facciate in città)
export const hasFacades = (r: RoomSpec | null | undefined) => r?.outdoor === 'citta';

const sstep = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
const smooth = (a: number, b: number, v: number) => sstep((v - a) / (b - a));

// cresta di duna: sopravvento lungo e dolce, sottovento corto e ripido
function ridge(t: number) {
  const f = t - Math.floor(t);
  return f < 0.72 ? sstep(f / 0.72) : sstep((1 - f) / 0.28);
}

function duneH(r: RoomSpec, x: number, z: number) {
  const R0 = Math.hypot(r.width, r.depth) / 2 + 5;
  const d = Math.hypot(x, z);
  const k = smooth(R0, R0 + 45, d);
  if (k <= 0) return 0;
  const a = x * 0.8 + z * 0.6, b = -x * 0.35 + z * 0.94;
  const w1 = ridge(a / 70 + 0.6 * Math.sin(b / 53)), w2 = ridge(b / 115 + 0.8 * Math.sin(a / 90 + 1.3));
  const amp = Math.min(20, 2.5 + d * 0.028);
  return k * (amp * (0.65 * w1 + 0.35 * w2) + 0.35 * Math.sin(x / 7.3 + z / 11.1) * Math.min(1, d / 80));
}

function beachH(r: RoomSpec, x: number, z: number) {
  const dz = z - shoreZ(r, x); // > 0 verso terra
  let h = dz > 9 ? 0 : -(9 - dz) * 0.05;
  h = Math.max(h, -4);
  // dune basse dietro la spiaggia (alle spalle della camera)
  const back = z - (r.depth / 2 + 16);
  if (back > 0) h += Math.min(1, back / 25) * (1.6 + 1.1 * Math.sin(x / 13) + 0.7 * Math.sin(x / 5.3 + z / 7));
  return h;
}

// terreno polare: anelli fitti vicino al set e sempre più radi verso l'orizzonte
function polarGround(R: number, K: number, S: number, h: (x: number, z: number) => number, col?: (x: number, z: number, y: number) => [number, number, number]) {
  const pos: number[] = [], uv: number[] = [], color: number[] = [], idx: number[] = [];
  const push = (x: number, z: number) => {
    const y = h(x, z);
    pos.push(x, y, z); uv.push(x / 4, -z / 4);
    if (col) color.push(...col(x, z, y));
  };
  push(0, 0);
  for (let k = 1; k <= K; k++) {
    const r = R * Math.pow(k / K, 2.4);
    for (let s = 0; s < S; s++) { const a = (s / S) * Math.PI * 2; push(Math.cos(a) * r, Math.sin(a) * r); }
  }
  const ring = (k: number, s: number) => 1 + (k - 1) * S + (s % S);
  for (let s = 0; s < S; s++) idx.push(0, ring(1, s + 1), ring(1, s));
  for (let k = 1; k < K; k++) for (let s = 0; s < S; s++) {
    const a = ring(k, s), b = ring(k, s + 1), c = ring(k + 1, s), d = ring(k + 1, s + 1);
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------- texture ----------------
function sandTex() {
  return canvasTex('sabbia-esterno', 512, (ctx, n) => {
    ctx.fillStyle = '#d9bb8c'; ctx.fillRect(0, 0, n, n);
    blotches(ctx, n, 140, 0.14, 41, '#ead2a8', '#b48f60');
    // increspature del vento
    const r = rng(42);
    for (let i = 0; i < 70; i++) {
      const y = r() * n;
      ctx.strokeStyle = `rgba(120,90,55,${0.04 + r() * 0.06})`;
      ctx.lineWidth = 1 + r() * 2;
      ctx.beginPath();
      for (let x = -4; x <= n + 4; x += 8) ctx.lineTo(x, y + Math.sin(x / 31 + i) * 5);
      ctx.stroke();
    }
    noise(ctx, n, 26, 43);
  });
}

function asphaltTex() {
  return canvasTex('asfalto', 512, (ctx, n) => {
    ctx.fillStyle = '#3d3e40'; ctx.fillRect(0, 0, n, n);
    blotches(ctx, n, 120, 0.12, 51, '#5a5b5d', '#232425');
    noise(ctx, n, 46, 52);
  });
}

function paverTex() {
  // lastre di pietra 50 × 100 cm (la texture copre 4 m)
  return canvasTex('lastre', 512, (ctx, n) => {
    ctx.fillStyle = '#6d6a66'; ctx.fillRect(0, 0, n, n);
    const r = rng(61);
    const cw = n / 4, ch = n / 8;
    for (let j = 0; j < 8; j++) for (let i = -1; i < 4; i++) {
      const off = (j % 2) * cw / 2;
      const v = 0.85 + r() * 0.2;
      ctx.fillStyle = `rgb(${160 * v},${156 * v},${150 * v})`;
      ctx.fillRect(i * cw + off + 2, j * ch + 2, cw - 4, ch - 4);
    }
    blotches(ctx, n, 80, 0.1, 62, '#ddd', '#555');
    noise(ctx, n, 14, 63);
  });
}

function rockTex() {
  return canvasTex('roccia', 512, (ctx, n) => {
    ctx.fillStyle = '#8f6a4f'; ctx.fillRect(0, 0, n, n);
    blotches(ctx, n, 200, 0.2, 71, '#c09a78', '#4a3324');
    noise(ctx, n, 30, 72);
  });
}

// facciata: 4 campate × 4 piani (12,8 m), finestre con persiane; la stessa disposizione per luci accese e lucido dei vetri
const BAY = 3.2;

function facadeWindows(fn: (x: number, y: number, w: number, h: number, i: number, j: number, px: number) => void, n: number) {
  const px = n / (4 * BAY);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const x = (i * BAY + (BAY - 1.2) / 2) * px, y = n - (j * BAY + 0.9 + 1.8) * px;
    fn(x, y, 1.2 * px, 1.8 * px, i, j, px);
  }
}

function facadeTex() {
  return canvasTex('facciata', 1024, (ctx, n) => {
    ctx.fillStyle = '#efebe4'; ctx.fillRect(0, 0, n, n);
    blotches(ctx, n, 160, 0.08, 81, '#fff', '#b7b0a5');
    const px = n / (4 * BAY);
    // marcapiano
    for (let j = 0; j < 4; j++) { ctx.fillStyle = 'rgba(0,0,0,.07)'; ctx.fillRect(0, n - j * BAY * px - 0.12 * px, n, 0.12 * px); }
    facadeWindows((x, y, w, h, i, j, p) => {
      // cornice in pietra, davanzale
      ctx.fillStyle = '#f7f4ee'; ctx.fillRect(x - 0.12 * p, y - 0.12 * p, w + 0.24 * p, h + 0.24 * p);
      ctx.fillStyle = '#d8d2c8'; ctx.fillRect(x - 0.18 * p, y + h, w + 0.36 * p, 0.1 * p);
      // vetro scuro con telaio
      ctx.fillStyle = '#1b1f24'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#d9d4cb'; ctx.fillRect(x + w / 2 - 0.03 * p, y, 0.06 * p, h); ctx.fillRect(x, y + h * 0.3, w, 0.05 * p);
      // persiane aperte ai lati (scure: prendono il tono del palazzo)
      const sh = (i + j * 3) % 5 === 0 ? 'rgba(60,64,58,.9)' : 'rgba(84,90,80,.85)';
      ctx.fillStyle = sh;
      ctx.fillRect(x - 0.62 * p, y, 0.5 * p, h); ctx.fillRect(x + w + 0.12 * p, y, 0.5 * p, h);
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      for (let k = 0; k < 14; k++) { ctx.fillRect(x - 0.62 * p, y + (k / 14) * h, 0.5 * p, 1.5); ctx.fillRect(x + w + 0.12 * p, y + (k / 14) * h, 0.5 * p, 1.5); }
    }, n);
    noise(ctx, n, 8, 82);
  });
}

function facadeRough() {
  return canvasTex('facciata-r', 512, (ctx, n) => {
    ctx.fillStyle = 'rgb(230,230,230)'; ctx.fillRect(0, 0, n, n);
    facadeWindows((x, y, w, h) => { ctx.fillStyle = 'rgb(20,20,20)'; ctx.fillRect(x, y, w, h); }, n);
  }, false);
}

function facadeLit() {
  return canvasTex('facciata-e', 512, (ctx, n) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, n, n);
    const r = rng(91);
    facadeWindows((x, y, w, h) => {
      const v = r();
      if (v > 0.38) return;
      const col = v < 0.28 ? [255, 196, 128] : [170, 196, 255];
      const k = 0.35 + r() * 0.65;
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, `rgb(${col[0] * k * 0.6},${col[1] * k * 0.6},${col[2] * k * 0.6})`);
      g.addColorStop(1, `rgb(${col[0] * k},${col[1] * k},${col[2] * k})`);
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    }, n);
  });
}

// pianterreno: negozi con vetrine e insegne (la texture copre 6,4 m, il negozio è alto 4,2 m)
function shopTex() {
  return canvasTex('negozi', 512, (ctx, n) => {
    const px = n / 6.4;
    ctx.fillStyle = '#c9c2b6'; ctx.fillRect(0, 0, n, n);
    blotches(ctx, n, 80, 0.1, 101, '#eee', '#888');
    for (let i = 0; i < 2; i++) {
      const x0 = i * 3.2 * px;
      ctx.fillStyle = '#2b2b2c'; ctx.fillRect(x0 + 0.3 * px, n - 4.0 * px, 2.6 * px, 0.7 * px); // insegna
      // vetrina: vetro con l'interno appena visibile (scaffali, banco)
      const g = ctx.createLinearGradient(0, n - 3.1 * px, 0, n - 0.3 * px);
      g.addColorStop(0, '#2c3238'); g.addColorStop(1, '#4a4642');
      ctx.fillStyle = g; ctx.fillRect(x0 + 0.4 * px, n - 3.1 * px, 2.4 * px, 2.8 * px);
      ctx.fillStyle = 'rgba(150,130,100,.35)';
      for (let k = 0; k < 3; k++) ctx.fillRect(x0 + 0.5 * px, n - (2.6 - k * 0.6) * px, 2.2 * px, 0.05 * px);
      ctx.fillStyle = 'rgba(120,100,80,.5)'; ctx.fillRect(x0 + 0.6 * px, n - 1.3 * px, 1.0 * px, 1.0 * px);
      ctx.fillStyle = '#3a3a3a'; ctx.fillRect(x0 + 0.4 * px, n - 3.1 * px, 2.4 * px, 0.06 * px); ctx.fillRect(x0 + 1.55 * px, n - 3.1 * px, 0.06 * px, 2.8 * px);
      ctx.fillStyle = '#8c8578'; ctx.fillRect(x0 + 0.3 * px, n - 0.3 * px, 2.6 * px, 0.3 * px); // zoccolo
    }
    noise(ctx, n, 10, 102);
  });
}
function shopRough() {
  return canvasTex('negozi-r', 256, (ctx, n) => {
    const px = n / 6.4;
    ctx.fillStyle = 'rgb(210,210,210)'; ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < 2; i++) { ctx.fillStyle = 'rgb(18,18,18)'; ctx.fillRect(i * 3.2 * px + 0.4 * px, n - 3.1 * px, 2.4 * px, 2.8 * px); }
  }, false);
}
function shopLit() {
  return canvasTex('negozi-e', 256, (ctx, n) => {
    const px = n / 6.4;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = 'rgb(255,214,160)'; ctx.fillRect(0.4 * px, n - 3.1 * px, 2.4 * px, 2.8 * px);
    ctx.fillStyle = 'rgb(120,90,60)'; ctx.fillRect(3.6 * px, n - 3.1 * px, 2.4 * px, 2.8 * px);
  });
}

// mare: normal map di onde (tile da 8 m) e schiuma sulla riva
function waveNormal() {
  return canvasTex('onde-n', 512, (ctx, n) => {
    const img = ctx.createImageData(n, n);
    // tante onde in direzioni diverse (periodiche sul riquadro: interi lungo i due assi)
    const r = rng(121);
    const waves: number[][] = [];
    for (let w = 0; w < 26; w++) {
      const fx = Math.round((r() - 0.5) * (4 + w)), fy = Math.round(2 + r() * (2 + w * 0.8));
      if (!fx && !fy) continue;
      waves.push([fx, fy, r() * 6.28, 1 / Math.pow(Math.hypot(fx, fy), 1.15)]);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let dx = 0, dy = 0;
      for (const [fx, fy, ph, a] of waves) {
        const t = (2 * Math.PI * (fx * i + fy * j)) / n + ph;
        const c = Math.cos(t) * a * 2 * Math.PI;
        dx += fx * c / n * 40; dy += fy * c / n * 40;
      }
      const nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const k = (j * n + i) * 4;
      img.data[k] = (nx / l * 0.5 + 0.5) * 255; img.data[k + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[k + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, false);
}

// ---------------- costruzione ----------------
export interface StreetLamp { pos: [number, number, number]; target: [number, number, number] }
export interface OutdoorBuild {
  group: THREE.Group;
  surfaces: THREE.Mesh[];
  lamps: StreetLamp[];          // lampioni che fanno luce vera (i più vicini al set)
  water: THREE.MeshPhysicalMaterial | null;
  setNight: (f: number) => void; // 0 giorno, 1 notte: finestre e lampioni accesi
  groundRho: number;            // riflettanza media del terreno (luce rimbalzata del cielo in anteprima)
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, name: string, albedo: number, opts: { cast?: boolean } = {}) {
  (g as any).computeBoundsTree?.();
  const x = new THREE.Mesh(g, m);
  x.name = name;
  x.castShadow = opts.cast !== false; x.receiveShadow = true;
  x.userData.albedo = albedo;
  return x;
}

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

function withUV(g: THREE.BufferGeometry, scale: number) {
  worldUV(g, new THREE.Matrix4(), scale);
  return g;
}

function rock(seed: number, sx: number, sy: number, sz: number) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('normal').deleteAttribute('uv'));
  const r = rng(seed);
  const ph = [r() * 6, r() * 6, r() * 6];
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.22 * Math.sin(x * 3.1 + ph[0]) * Math.sin(y * 2.7 + ph[1]) + 0.12 * Math.sin(z * 5.3 + ph[2]) + 0.06 * Math.sin((x + y + z) * 9 + ph[0]);
    p.setXYZ(i, x * k * sx, Math.max(-0.25, y) * k * sy, z * k * sz);
  }
  g.computeVertexNormals();
  return g;
}

export function buildOutdoor(r: RoomSpec): OutdoorBuild {
  const g = new THREE.Group();
  g.name = 'esterno';
  const surfaces: THREE.Mesh[] = [];
  const add = (m: THREE.Mesh) => { g.add(m); surfaces.push(m); return m; };
  let water: THREE.MeshPhysicalMaterial | null = null;
  const lamps: StreetLamp[] = [];
  const nightMats: { m: THREE.MeshStandardMaterial; nits: number }[] = [];
  let groundRho = 0.4;

  if (r.outdoor === 'deserto' || r.outdoor === 'spiaggia') {
    const sandMat = new THREE.MeshStandardMaterial({ map: sandTex(), roughness: 0.95, metalness: 0 });
    if (r.outdoor === 'deserto') {
      const geo = polarGround(3000, 110, 180, (x, z) => duneH(r, x, z));
      add(mesh(geo, sandMat, 'sabbia', 0.42));
      // rocce sparse e qualche mesa lontana
      const rr = rng(7);
      const rockMat = new THREE.MeshStandardMaterial({ map: rockTex(), roughness: 0.9 });
      const parts: THREE.BufferGeometry[] = [];
      const R0 = Math.hypot(r.width, r.depth) / 2 + 3;
      for (let i = 0; i < 16; i++) {
        const a = rr() * Math.PI * 2, d = R0 + rr() * (i < 6 ? 25 : 130);
        const s = i < 6 ? 0.4 + rr() * 0.9 : 1 + rr() * 3;
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        const q = rock(100 + i, s * (1 + rr()), s * (0.5 + rr() * 0.6), s * (1 + rr()));
        q.rotateY(rr() * 6);
        q.translate(x, duneH(r, x, z) - 0.1 * s, z);
        parts.push(q);
      }
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + (i - 1.5) * 0.55 + rr() * 0.2, d = 700 + rr() * 600;
        const s = 40 + rr() * 40;
        const q = rock(200 + i, s * 1.6, s * 0.9, s);
        q.translate(Math.cos(a) * d, duneH(r, Math.cos(a) * d, Math.sin(a) * d) - 4, Math.sin(a) * d);
        parts.push(q);
      }
      const rg = mergeGeometries(parts.map((p) => withUV(p, 3)));
      add(mesh(rg, rockMat, 'rocce', 0.25));
      groundRho = 0.42;
    } else {
      const geo = polarGround(3000, 120, 200, (x, z) => beachH(r, x, z));
      add(mesh(geo, sandMat, 'sabbia', 0.4));
      // mare: dielettrico scuro e lucido (riflette il cielo, più a filo d'orizzonte)
      water = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#0f3c48'), roughness: 0.16, metalness: 0, ior: 1.333, normalMap: waveNormal(), normalScale: new THREE.Vector2(0.09, 0.09) });
      water.normalMap!.repeat.set(1, 1);
      const sea = new THREE.PlaneGeometry(8000, 4000, 1, 1);
      sea.rotateX(-Math.PI / 2);
      const zs = shoreZ(r);
      sea.translate(0, SEA_Y, zs + 30 - 2000);
      // coordinate per le onde: 12 m
      const uv = sea.attributes.uv as THREE.BufferAttribute, p = sea.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 12, -p.getZ(i) / 12);
      add(mesh(sea, water, 'mare', 0.05, { cast: false }));
      // scogli a un lato e un promontorio lontano
      const rr = rng(9);
      const rockMat = new THREE.MeshStandardMaterial({ map: rockTex(), color: new THREE.Color('#9a958c'), roughness: 0.85 });
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 9; i++) {
        const x = r.width / 2 + 9 + rr() * 22, z = shoreZ(r, x) - 6 + rr() * 9;
        const s = 0.6 + rr() * 1.8;
        const q = rock(300 + i, s * (1 + rr()), s * (0.7 + rr() * 0.5), s * (1 + rr()));
        q.translate(x, beachH(r, x, z) - 0.2 * s, z);
        parts.push(q);
      }
      const q = rock(400, 160, 55, 90); q.translate(-650, -6, -900); parts.push(q);
      const q2 = rock(401, 90, 30, 60); q2.translate(-420, -4, -1100); parts.push(q2);
      add(mesh(mergeGeometries(parts.map((p) => withUV(p, 3))), rockMat, 'scogli', 0.2));
      groundRho = 0.3;
    }
  }

  if (r.outdoor === 'citta') {
    const { road, facade, kerb } = CITY;
    const Z0 = -560, Z1 = 220;
    // asfalto (anche oltre i palazzi, fino all'orizzonte)
    const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex(), roughness: 0.92 });
    const ag = new THREE.PlaneGeometry(3000, 3000, 1, 1);
    ag.rotateX(-Math.PI / 2); ag.translate(0, -kerb, 0);
    const auv = ag.attributes.uv as THREE.BufferAttribute, ap = ag.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < auv.count; i++) auv.setXY(i, ap.getX(i) / 4, -ap.getZ(i) / 4);
    add(mesh(ag, asphalt, 'strada', 0.1, { cast: false }));
    // marciapiedi in lastre e cordoli in pietra
    const pav = new THREE.MeshStandardMaterial({ map: paverTex(), roughness: 0.85 });
    const side = [box(road + 0.18, facade + 0.2, -0.6, 0, Z0, Z1), box(-facade - 0.2, -road - 0.18, -0.6, 0, Z0, Z1)];
    add(mesh(mergeGeometries(side.map((b) => withUV(b, 4))), pav, 'marciapiede', 0.3));
    const kerbM = new THREE.MeshStandardMaterial({ color: new THREE.Color('#b4b0a8'), roughness: 0.7 });
    add(mesh(mergeGeometries([box(road, road + 0.18, -0.6, 0.005, Z0, Z1), box(-road - 0.18, -road, -0.6, 0.005, Z0, Z1)]), kerbM, 'cordolo', 0.35));
    // segnaletica: mezzeria tratteggiata e strisce pedonali davanti al set
    const paint = new THREE.MeshStandardMaterial({ color: new THREE.Color('#e8e6df'), roughness: 0.6 });
    const marks: THREE.BufferGeometry[] = [];
    const zx = -r.depth / 2 - 4;
    for (let k = -3; k <= 3; k++) marks.push(box(k * 1.0 - 0.25, k * 1.0 + 0.25, -kerb, -kerb + 0.006, zx - 1.5, zx + 1.5));
    for (let z = Z0; z < Z1; z += 9) if (Math.abs(z - zx) > 4) marks.push(box(-0.06, 0.06, -kerb, -kerb + 0.005, z, z + 3));
    add(mesh(mergeGeometries(marks), paint, 'segnaletica', 0.7, { cast: false }));
    // palazzi: quinta continua sui due lati, altezze e colori diversi, chiusa in fondo
    const COLORS = ['#e2d3b4', '#d4a984', '#ece5d6', '#c4b19a', '#d9b48f', '#b9b6ae'];
    const fac = facadeTex(), facR = facadeRough(), facE = facadeLit();
    const mats = COLORS.map((c) => {
      const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(c), map: fac, roughnessMap: facR, roughness: 1, emissiveMap: facE, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 });
      nightMats.push({ m, nits: 7 });
      return m;
    });
    const shopM = new THREE.MeshStandardMaterial({ map: shopTex(), roughnessMap: shopRough(), roughness: 1, emissiveMap: shopLit(), emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 });
    nightMats.push({ m: shopM, nits: 10 });
    const stone = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d8d2c6'), roughness: 0.75 });
    const parts: THREE.BufferGeometry[][] = COLORS.map(() => []);
    const shops: THREE.BufferGeometry[] = [], corn: THREE.BufferGeometry[] = [];
    const rr = rng(13);
    for (const s of [-1, 1]) {
      let z = Z0 + 10;
      while (z < Z1 - 10) {
        const w = 9 + rr() * 13;
        const floors = 3 + Math.floor(rr() * 5);
        const H = 4.2 + floors * BAY + 0.6;
        const dpt = 12;
        const xa = s < 0 ? -facade - dpt : facade, xb = s < 0 ? -facade : facade + dpt;
        const ci = Math.floor(rr() * COLORS.length);
        parts[ci].push(withUV(box(xa, xb, -0.2, H, z, z + w), 4 * BAY));
        const fx = s < 0 ? -facade : facade;
        shops.push(withUV(box(s < 0 ? fx - 0.1 : fx - 0.03, s < 0 ? fx + 0.03 : fx + 0.1, 0, 4.2, z + 0.15, z + w - 0.15), 6.4));
        corn.push(box(s < 0 ? fx - 0.5 : fx - 0.35, s < 0 ? fx + 0.35 : fx + 0.5, H - 0.4, H, z, z + w));
        corn.push(box(s < 0 ? fx - 0.3 : fx - 0.18, s < 0 ? fx + 0.18 : fx + 0.3, 4.2, 4.45, z, z + w));
        z += w;
      }
    }
    // in fondo alla strada e alle spalle della camera
    parts[2].push(withUV(box(-40, 40, -0.2, 24, Z0 - 14, Z0), 4 * BAY));
    parts[4].push(withUV(box(-40, 40, -0.2, 21, Z1, Z1 + 14), 4 * BAY));
    parts.forEach((p, i) => { if (p.length) add(mesh(mergeGeometries(p), mats[i], 'palazzi', 0.45)); });
    add(mesh(mergeGeometries(shops), shopM, 'negozi', 0.3));
    add(mesh(mergeGeometries(corn), stone, 'cornicioni', 0.5));
    // lampioni: pali sul bordo del marciapiede, braccio sulla strada; luce vera per i più vicini al set
    const poleM = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2d3033'), roughness: 0.5, metalness: 0.6 });
    const glassM = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d8d8d0'), roughness: 0.3, emissive: new THREE.Color(1, 0.9, 0.78), emissiveIntensity: 0 });
    nightMats.push({ m: glassM, nits: 4000 });
    const poles: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
    const LH = 7.2;
    for (const s of [-1, 1]) {
      for (let z = (s < 0 ? -13 : 0) - 26 * 20; z < Z1 - 20; z += 26) {
        const x = s * (road + 0.5);
        const pole = new THREE.CylinderGeometry(0.06, 0.09, LH, 8); pole.translate(x, LH / 2, z);
        poles.push(pole);
        const ax = x - s * 1.3;
        poles.push(box(Math.min(x, ax), Math.max(x, ax), LH - 0.08, LH, z - 0.04, z + 0.04));
        poles.push(box(ax - 0.3, ax + 0.3, LH - 0.2, LH - 0.04, z - 0.15, z + 0.15));
        glass.push(box(ax - 0.24, ax + 0.24, LH - 0.23, LH - 0.2, z - 0.1, z + 0.1));
        if (Math.abs(z) < 38) lamps.push({ pos: [ax, LH - 0.3, z], target: [ax + s * 0.6, -kerb, z] });
      }
    }
    add(mesh(mergeGeometries(poles.map((p) => (p.index ? p.toNonIndexed() : p))), poleM, 'lampioni', 0.1));
    const gm = mesh(mergeGeometries(glass), glassM, 'vetro lampioni', 0.6, { cast: false });
    g.add(gm);
    groundRho = 0.2;
  }

  const setNight = (f: number) => { for (const { m, nits } of nightMats) m.emissiveIntensity = nits * f; };
  setNight(0);
  return { group: g, surfaces, lamps, water, setNight, groundRho };
}

// per la pianta: le linee dello scenario attorno al set (metri, piano XZ)
export function outdoorPlanLines(r: RoomSpec, x0: number, x1: number, z0: number, z1: number): { a: [number, number]; b: [number, number]; kind: 'facciata' | 'cordolo' | 'riva' }[] {
  const out: { a: [number, number]; b: [number, number]; kind: 'facciata' | 'cordolo' | 'riva' }[] = [];
  if (r.outdoor === 'citta') {
    for (const s of [-1, 1]) {
      out.push({ a: [s * CITY.facade, z0], b: [s * CITY.facade, z1], kind: 'facciata' });
      out.push({ a: [s * CITY.road, z0], b: [s * CITY.road, z1], kind: 'cordolo' });
    }
  }
  if (r.outdoor === 'spiaggia') {
    const N = 40;
    for (let i = 0; i < N; i++) {
      const xa = x0 + ((x1 - x0) * i) / N, xb = x0 + ((x1 - x0) * (i + 1)) / N;
      out.push({ a: [xa, waterlineZ(r, xa)], b: [xb, waterlineZ(r, xb)], kind: 'riva' });
    }
  }
  return out;
}

// quota del terreno ovunque (anche fuori dal set: dune, pendio della spiaggia, livello del mare)
export function terrainHeight(r: RoomSpec, x: number, z: number) {
  if (r.outdoor === 'deserto') return duneH(r, x, z);
  if (r.outdoor === 'spiaggia') return Math.max(SEA_Y, beachH(r, x, z));
  return groundHeight(r, x, z);
}
