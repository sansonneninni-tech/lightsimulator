// Stanza costruita a mano: pareti con finestre e porte, pavimento, soffitto, materiali.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type WallId = 'fondo' | 'destra' | 'davanti' | 'sinistra';
export const WALLS: { id: WallId; name: string }[] = [
  { id: 'fondo', name: 'Fondo' },
  { id: 'sinistra', name: 'Sinistra' },
  { id: 'destra', name: 'Destra' },
  { id: 'davanti', name: 'Davanti' },
];

export interface Opening {
  id: string;
  kind: 'finestra' | 'porta' | 'portafinestra';
  wall: WallId;
  offset: number;  // centro lungo la parete (m, dal centro della parete, verso destra guardandola da dentro)
  width: number;
  height: number;
  sill: number;    // altezza del davanzale (0 per porte)
}

export interface RoomSpec {
  width: number;   // x
  depth: number;   // z
  height: number;  // y
  wall: string;
  floor: string;
  openings: Opening[];
}

export interface WindowInfoLite {
  id: string;
  center: [number, number, number];
  normal: [number, number, number]; // verso l'interno
  right: [number, number, number];
  width: number;
  height: number;
}

export const WALL_FINISHES: { id: string; name: string; color: string; texture?: 'mattoni' | 'intonaco' }[] = [
  { id: 'bianco', name: 'Bianco', color: '#ebe8e1', texture: 'intonaco' },
  { id: 'grigio', name: 'Grigio', color: '#b9b7b2', texture: 'intonaco' },
  { id: 'sabbia', name: 'Sabbia', color: '#d6c6ab', texture: 'intonaco' },
  { id: 'salvia', name: 'Salvia', color: '#9aa58e', texture: 'intonaco' },
  { id: 'terracotta', name: 'Terracotta', color: '#b06a4f', texture: 'intonaco' },
  { id: 'notte', name: 'Blu notte', color: '#2f3a48', texture: 'intonaco' },
  { id: 'nero', name: 'Nero', color: '#222222', texture: 'intonaco' },
  { id: 'mattoni', name: 'Mattoni', color: '#ffffff', texture: 'mattoni' },
];

export const FLOORS: { id: string; name: string; roughness: number }[] = [
  { id: 'rovere', name: 'Rovere', roughness: 0.55 },
  { id: 'noce', name: 'Noce', roughness: 0.5 },
  { id: 'cemento', name: 'Cemento', roughness: 0.8 },
  { id: 'piastrelle', name: 'Piastrelle', roughness: 0.35 },
  { id: 'marmo', name: 'Marmo', roughness: 0.2 },
  { id: 'moquette', name: 'Moquette', roughness: 1 },
];

export const OPENING_KINDS: { id: Opening['kind']; name: string; width: number; height: number; sill: number }[] = [
  { id: 'finestra', name: 'Finestra', width: 1.2, height: 1.4, sill: 0.9 },
  { id: 'portafinestra', name: 'Portafinestra', width: 1.4, height: 2.3, sill: 0 },
  { id: 'porta', name: 'Porta', width: 0.9, height: 2.1, sill: 0 },
];

export const T_WALL = 0.15;

export function roomBounds(r: RoomSpec): { min: [number, number, number]; max: [number, number, number] } {
  return { min: [-r.width / 2, 0, -r.depth / 2], max: [r.width / 2, r.height, r.depth / 2] };
}

export function wallFrame(r: RoomSpec, wall: WallId) {
  const W = r.width, D = r.depth;
  switch (wall) {
    case 'fondo': return { origin: new THREE.Vector3(0, 0, -D / 2), normal: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(1, 0, 0), length: W };
    case 'davanti': return { origin: new THREE.Vector3(0, 0, D / 2), normal: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(-1, 0, 0), length: W };
    case 'sinistra': return { origin: new THREE.Vector3(-W / 2, 0, 0), normal: new THREE.Vector3(1, 0, 0), right: new THREE.Vector3(0, 0, -1), length: D };
    default: return { origin: new THREE.Vector3(W / 2, 0, 0), normal: new THREE.Vector3(-1, 0, 0), right: new THREE.Vector3(0, 0, 1), length: D };
  }
}

// tiene l'apertura dentro la parete e lontana dalle altre
export function fitOpening(r: RoomSpec, o: Opening, others: Opening[]): Opening {
  const L = wallFrame(r, o.wall).length;
  const width = Math.min(o.width, L - 0.3);
  const height = Math.min(o.height, r.height - 0.15 - (o.kind === 'finestra' ? 0.3 : 0));
  const sill = o.kind === 'finestra' ? Math.max(0.2, Math.min(o.sill, r.height - height - 0.1)) : 0;
  let offset = Math.max(-L / 2 + width / 2 + 0.12, Math.min(L / 2 - width / 2 - 0.12, o.offset));
  // spinge via dalle altre aperture sulla stessa parete
  const same = others.filter((x) => x.id !== o.id && x.wall === o.wall);
  for (let it = 0; it < 4; it++) {
    for (const x of same) {
      const gap = (x.width + width) / 2 + 0.15;
      if (Math.abs(offset - x.offset) < gap) offset = offset >= x.offset ? x.offset + gap : x.offset - gap;
    }
    offset = Math.max(-L / 2 + width / 2 + 0.12, Math.min(L / 2 - width / 2 - 0.12, offset));
  }
  return { ...o, width, height, sill, offset };
}

export function windowInfos(r: RoomSpec): WindowInfoLite[] {
  return r.openings.filter((o) => o.kind !== 'porta').map((o) => {
    const f = wallFrame(r, o.wall);
    const c = f.origin.clone().addScaledVector(f.right, o.offset).setY(o.sill + o.height / 2);
    return { id: o.id, center: c.toArray() as any, normal: f.normal.toArray() as any, right: f.right.toArray() as any, width: o.width, height: o.height };
  });
}

// ---------------- texture procedurali ----------------
const texCache = new Map<string, THREE.Texture>();

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvasTex(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, n: number) => void, srgb = true) {
  const k = key + size;
  const hit = texCache.get(k);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  texCache.set(k, t);
  return t;
}

function noise(ctx: CanvasRenderingContext2D, n: number, amount: number, seed: number, scale = 1) {
  const r = rng(seed);
  const img = ctx.getImageData(0, 0, n, n);
  const d = img.data;
  for (let i = 0; i < n * n; i++) {
    const v = (r() - 0.5) * amount * scale;
    d[i * 4] += v; d[i * 4 + 1] += v; d[i * 4 + 2] += v;
  }
  ctx.putImageData(img, 0, 0);
}

function blotches(ctx: CanvasRenderingContext2D, n: number, count: number, alpha: number, seed: number, light = '#fff', dark = '#000') {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * n, y = r() * n, rad = (0.03 + r() * 0.12) * n;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const col = r() > 0.5 ? light : dark;
    g.addColorStop(0, col); g.addColorStop(1, 'transparent');
    ctx.globalAlpha = alpha * r();
    ctx.fillStyle = g;
    for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) { ctx.save(); ctx.translate(dx, dy); ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); ctx.restore(); }
  }
  ctx.globalAlpha = 1;
}

// parquet: 2 m × 2 m
function woodTex(id: 'rovere' | 'noce' | 'legno') {
  const base = id === 'noce' ? [92, 60, 38] : id === 'legno' ? [150, 108, 70] : [182, 146, 104];
  return canvasTex('wood-' + id, 1024, (ctx, n) => {
    const r = rng(id === 'noce' ? 7 : 3);
    const planks = 11; // ~18 cm
    const pw = n / planks;
    for (let i = 0; i < planks; i++) {
      let y = -r() * n;
      while (y < n) {
        const len = n * (0.35 + r() * 0.5);
        const k = 0.82 + r() * 0.3;
        ctx.fillStyle = `rgb(${base[0] * k},${base[1] * k},${base[2] * k})`;
        ctx.fillRect(i * pw, y, pw, len);
        // venature
        ctx.save();
        ctx.beginPath(); ctx.rect(i * pw, y, pw, len); ctx.clip();
        for (let g = 0; g < 14; g++) {
          const gx = i * pw + r() * pw;
          ctx.strokeStyle = `rgba(${base[0] * 0.55},${base[1] * 0.5},${base[2] * 0.45},${0.08 + r() * 0.14})`;
          ctx.lineWidth = 0.6 + r() * 1.6;
          ctx.beginPath();
          ctx.moveTo(gx, y);
          for (let t = 0; t <= 1; t += 0.1) ctx.lineTo(gx + Math.sin(t * 6 + g) * (1 + r() * 2), y + t * len);
          ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.fillRect(i * pw, y, pw, 1.2);
        y += len;
      }
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fillRect(i * pw, 0, 1.2, n);
    }
    noise(ctx, n, 10, 11);
  });
}

function concreteTex() {
  return canvasTex('cemento', 512, (ctx, n) => {
    ctx.fillStyle = '#9b9893'; ctx.fillRect(0, 0, n, n);
    blotches(ctx, n, 160, 0.18, 5, '#c4c0b8', '#6f6c68');
    noise(ctx, n, 18, 9);
  });
}

function tilesTex() {
  return canvasTex('piastrelle', 1024, (ctx, n) => {
    ctx.fillStyle = '#8f8a83'; ctx.fillRect(0, 0, n, n);
    const r = rng(4);
    const k = 5; // 2 m / 5 = 40 cm... (texture copre 2 m)
    const s = n / k;
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      const v = 0.93 + r() * 0.1;
      ctx.fillStyle = `rgb(${226 * v},${221 * v},${212 * v})`;
      ctx.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
    }
    blotches(ctx, n, 60, 0.06, 2, '#fff', '#777');
    noise(ctx, n, 6, 3);
  });
}

function marbleTex() {
  return canvasTex('marmo', 1024, (ctx, n) => {
    ctx.fillStyle = '#ece9e4'; ctx.fillRect(0, 0, n, n);
    const r = rng(8);
    blotches(ctx, n, 50, 0.12, 6, '#fff', '#b8b4ad');
    for (let v = 0; v < 26; v++) {
      ctx.strokeStyle = `rgba(110,105,100,${0.05 + r() * 0.2})`;
      ctx.lineWidth = 0.5 + r() * 2.2;
      ctx.beginPath();
      let x = r() * n, y = r() * n;
      ctx.moveTo(x, y);
      for (let t = 0; t < 40; t++) { x += (r() - 0.3) * 30; y += (r() - 0.5) * 30; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // fughe 60 cm
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    const s = n / (2 / 0.6);
    for (let i = 0; i < n; i += s) { ctx.fillRect(i, 0, 1.5, n); ctx.fillRect(0, i, n, 1.5); }
  });
}

function carpetTex() {
  return canvasTex('moquette', 512, (ctx, n) => {
    ctx.fillStyle = '#6c6a66'; ctx.fillRect(0, 0, n, n);
    noise(ctx, n, 40, 12);
    blotches(ctx, n, 80, 0.06, 13);
  });
}

function plasterTex() {
  return canvasTex('intonaco', 512, (ctx, n) => {
    ctx.fillStyle = '#f2f2f2'; ctx.fillRect(0, 0, n, n);
    blotches(ctx, n, 120, 0.05, 21, '#fff', '#d0d0d0');
    noise(ctx, n, 7, 22);
  });
}

function brickTex() {
  return canvasTex('mattoni', 1024, (ctx, n) => {
    ctx.fillStyle = '#b9b2a6'; ctx.fillRect(0, 0, n, n);
    const r = rng(31);
    const rows = 26, bh = n / rows; // 2 m / 26 ≈ 7.7 cm
    const cols = 8, bw = n / cols;  // 25 cm
    for (let j = 0; j < rows; j++) {
      const off = (j % 2) * bw / 2;
      for (let i = -1; i < cols; i++) {
        const v = 0.75 + r() * 0.35;
        const red = [150, 74, 52];
        ctx.fillStyle = `rgb(${red[0] * v},${red[1] * v * (0.9 + r() * 0.2)},${red[2] * v})`;
        ctx.fillRect(i * bw + off + 3, j * bh + 3, bw - 6, bh - 6);
      }
    }
    blotches(ctx, n, 100, 0.12, 30, '#e0c9b5', '#3a2018');
    noise(ctx, n, 16, 33);
  });
}

export function floorMaterial(id: string) {
  const f = FLOORS.find((x) => x.id === id) || FLOORS[0];
  const map = id === 'noce' ? woodTex('noce') : id === 'cemento' ? concreteTex() : id === 'piastrelle' ? tilesTex() : id === 'marmo' ? marbleTex() : id === 'moquette' ? carpetTex() : woodTex('rovere');
  return new THREE.MeshStandardMaterial({ map, roughness: f.roughness, metalness: 0 });
}

export function wallMaterial(id: string) {
  const w = WALL_FINISHES.find((x) => x.id === id) || WALL_FINISHES[0];
  const map = w.texture === 'mattoni' ? brickTex() : plasterTex();
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(w.color), map, roughness: w.texture === 'mattoni' ? 0.95 : 0.88, metalness: 0 });
}

export const woodMap = (id: 'rovere' | 'noce' | 'legno') => woodTex(id);

// coordinate di texture dalla posizione nel mondo (1 unità = 2 m), proiezione per faccia
export function worldUV(geo: THREE.BufferGeometry, m: THREE.Matrix4, scale = 2) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(m);
    n.fromBufferAttribute(nor, i).applyMatrix3(nm);
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    let u: number, v: number;
    if (ay >= ax && ay >= az) { u = p.x; v = p.z; } else if (ax >= az) { u = p.z; v = p.y; } else { u = p.x; v = p.y; }
    uv[i * 2] = u / scale; uv[i * 2 + 1] = v / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function slab(w: number, h: number, d: number, basis: THREE.Matrix4, mat: THREE.Material, name: string) {
  const g = new THREE.BoxGeometry(w, h, d);
  // nella mappa d'ombra conta la faccia esterna: le facce interne restano ben dietro (niente fessure di sole)
  (mat as THREE.Material).shadowSide = THREE.FrontSide;
  const mesh = new THREE.Mesh(g, mat);
  mesh.applyMatrix4(basis);
  mesh.updateMatrixWorld();
  worldUV(g, mesh.matrixWorld);
  (g as any).computeBoundsTree?.();
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.name = name;
  return mesh;
}

const frameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#e9e7e2'), roughness: 0.5, metalness: 0 });
const darkFrameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2a2a'), roughness: 0.45, metalness: 0.3 });
const doorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d8d3ca'), roughness: 0.55 });
const handleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#b8b8b8'), roughness: 0.25, metalness: 1 });

// costruisce la stanza; ogni mesh ha userData.openingId se appartiene a un'apertura
export function buildRoom(r: RoomSpec) {
  const g = new THREE.Group();
  g.name = 'stanza costruita';
  const W = r.width, D = r.depth, H = r.height, T = T_WALL;
  const wm = wallMaterial(r.wall);
  const fm = floorMaterial(r.floor);
  const cm = new THREE.MeshStandardMaterial({ color: new THREE.Color('#f1f0ec'), map: plasterTex(), roughness: 0.92 });
  const surfaces: THREE.Mesh[] = [];
  const picks: THREE.Mesh[] = [];
  const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  // solette spesse e pareti che le attraversano: il sole non filtra dagli spigoli
  const floor = slab(W + 2 * T, 0.4, D + 2 * T, at(0, -0.2, 0), fm, 'pavimento');
  floor.castShadow = false;
  const ceil = slab(W + 2 * T, 0.4, D + 2 * T, at(0, H + 0.2, 0), cm, 'soffitto');
  g.add(floor, ceil);
  surfaces.push(floor, ceil);
  const dark = ['notte', 'nero', 'mattoni', 'terracotta'].includes(r.wall);
  for (const wall of ['fondo', 'davanti', 'sinistra', 'destra'] as WallId[]) {
    const f = wallFrame(r, wall);
    const ext = T; // chiude gli angoli (i pezzi si sovrappongono)
    const L = f.length;
    const up = new THREE.Vector3(0, 1, 0);
    const rect = (u0: number, u1: number, v0: number, v1: number) => {
      if (u1 - u0 < 0.005 || v1 - v0 < 0.005) return;
      // i pezzi a filo di pavimento e soffitto entrano un po' nelle solette: niente fessure di luce
      if (v0 <= 0) v0 = -0.4;
      if (v1 >= H) v1 = H + 0.4;
      const c = f.origin.clone().addScaledVector(f.right, (u0 + u1) / 2).setY((v0 + v1) / 2).addScaledVector(f.normal, -T / 2);
      const basis = new THREE.Matrix4().makeBasis(f.right, up, f.normal).setPosition(c);
      const m = slab(u1 - u0, v1 - v0, T, basis, wm, 'parete');
      g.add(m); surfaces.push(m);
    };
    const ops = r.openings.filter((o) => o.wall === wall).sort((a, b) => a.offset - b.offset);
    let cur = -L / 2 - ext;
    for (const o of ops) {
      const a = Math.max(cur, o.offset - o.width / 2), b = Math.min(L / 2, o.offset + o.width / 2);
      if (b <= a) continue;
      rect(cur, a, 0, H);
      if (o.sill > 0.005) rect(a, b, 0, o.sill);
      rect(a, b, o.sill + o.height, H);
      cur = b;
      // telaio
      const { group: og, pick } = buildOpening(o, f, dark);
      og.traverse((x) => { x.userData.openingId = o.id; });
      g.add(og);
      og.traverse((x: any) => { if (x.isMesh) surfaces.push(x); });
      pick.userData.openingId = o.id;
      pick.updateMatrixWorld(true);
      picks.push(pick);
    }
    rect(cur, L / 2 + ext, 0, H);
  }
  // battiscopa
  const bm = new THREE.MeshStandardMaterial({ color: new THREE.Color(dark ? '#2b2b2b' : '#efede8'), roughness: 0.5 });
  for (const wall of ['fondo', 'davanti', 'sinistra', 'destra'] as WallId[]) {
    const f = wallFrame(r, wall);
    const ops = r.openings.filter((o) => o.wall === wall && o.sill < 0.1).sort((a, b) => a.offset - b.offset);
    let cur = -f.length / 2;
    const seg = (u0: number, u1: number) => {
      if (u1 - u0 < 0.02) return;
      const c = f.origin.clone().addScaledVector(f.right, (u0 + u1) / 2).setY(0.04).addScaledVector(f.normal, 0.006);
      const basis = new THREE.Matrix4().makeBasis(f.right, new THREE.Vector3(0, 1, 0), f.normal).setPosition(c);
      const m = slab(u1 - u0, 0.08, 0.012, basis, bm, 'battiscopa');
      m.castShadow = false;
      g.add(m);
    };
    for (const o of ops) { seg(cur, o.offset - o.width / 2 - 0.06); cur = o.offset + o.width / 2 + 0.06; }
    seg(cur, f.length / 2);
  }
  return { group: g, surfaces, picks };
}

function buildOpening(o: Opening, f: ReturnType<typeof wallFrame>, dark: boolean) {
  const g = new THREE.Group();
  g.name = o.kind;
  const up = new THREE.Vector3(0, 1, 0);
  const T = T_WALL;
  const base = f.origin.clone().addScaledVector(f.right, o.offset);
  const basis = new THREE.Matrix4().makeBasis(f.right, up, f.normal);
  const place = (mesh: THREE.Mesh, u: number, v: number, n: number) => {
    const p = base.clone().addScaledVector(f.right, u).setY(v).addScaledVector(f.normal, n);
    mesh.applyMatrix4(new THREE.Matrix4().copy(basis).setPosition(p));
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const w = o.width, h = o.height, s = o.sill;
  const mat = dark ? darkFrameMat : frameMat;
  if (o.kind === 'porta') {
    // stipiti e anta chiusa
    const fw = 0.06;
    place(new THREE.Mesh(new THREE.BoxGeometry(fw, h + fw, T + 0.02), mat), -w / 2 + fw / 2, (h + fw) / 2, -T / 2);
    place(new THREE.Mesh(new THREE.BoxGeometry(fw, h + fw, T + 0.02), mat), w / 2 - fw / 2, (h + fw) / 2, -T / 2);
    place(new THREE.Mesh(new THREE.BoxGeometry(w, fw, T + 0.02), mat), 0, h - fw / 2 + fw, -T / 2);
    const leaf = place(new THREE.Mesh(new RoundedBoxGeometry(w - 2 * fw, h - 0.005, 0.045, 2, 0.006), doorMat), 0, h / 2, -T * 0.55);
    leaf.name = 'anta';
    const knob = place(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 12), handleMat), w / 2 - fw - 0.09, 1.02, -T * 0.55 + 0.045);
    knob.rotation.z = Math.PI / 2;
    const pick = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ visible: false }));
    pick.applyMatrix4(new THREE.Matrix4().copy(basis).setPosition(base.clone().setY(h / 2).addScaledVector(f.normal, 0.01)));
    return { group: g, pick };
  }
  // finestra / portafinestra: telaio, montante e traverso; niente vetro (la luce passa pulita)
  const fw = 0.055, depth = 0.07, n = -T * 0.4;
  place(new THREE.Mesh(new THREE.BoxGeometry(fw, h, depth), mat), -w / 2 + fw / 2, s + h / 2, n);
  place(new THREE.Mesh(new THREE.BoxGeometry(fw, h, depth), mat), w / 2 - fw / 2, s + h / 2, n);
  place(new THREE.Mesh(new THREE.BoxGeometry(w, fw, depth), mat), 0, s + h - fw / 2, n);
  place(new THREE.Mesh(new THREE.BoxGeometry(w, fw, depth), mat), 0, s + fw / 2, n);
  place(new THREE.Mesh(new THREE.BoxGeometry(fw * 0.8, h, depth * 0.8), mat), 0, s + h / 2, n);
  if (o.kind === 'finestra' && h > 1.1) place(new THREE.Mesh(new THREE.BoxGeometry(w, fw * 0.8, depth * 0.8), mat), 0, s + h * 0.62, n);
  if (o.kind === 'portafinestra') place(new THREE.Mesh(new THREE.BoxGeometry(w, fw * 0.8, depth * 0.8), mat), 0, s + 0.95, n);
  // davanzale interno
  if (s > 0.1) place(new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.03, 0.12), new THREE.MeshStandardMaterial({ color: new THREE.Color('#d9d6cf'), roughness: 0.4 })), 0, s - 0.015, 0.03);
  // superficie (fuori dalla scena) per selezionare l'apertura toccando il vano
  const pick = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ visible: false }));
  pick.name = 'vano';
  pick.applyMatrix4(new THREE.Matrix4().copy(basis).setPosition(base.clone().setY(s + h / 2).addScaledVector(f.normal, -T / 2)));
  return { group: g, pick };
}

// cielo e terreno esterni (radianza lineare in nits), mappa equirettangolare
export function skyTexture(skyNits: number, skyColor: THREE.Color, groundNits: number, tex?: THREE.DataTexture) {
  const w = 64, h = 32;
  const data = tex ? (tex.image.data as Float32Array) : new Float32Array(w * h * 4);
  const ground = new THREE.Color(0.55, 0.5, 0.42);
  for (let j = 0; j < h; j++) {
    const el = ((j + 0.5) / h - 0.5) * Math.PI; // -90..90
    for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4;
      if (el >= 0) {
        // più chiaro verso l'orizzonte
        const f = skyNits * (0.75 + 0.5 * Math.pow(1 - Math.sin(el), 3));
        data[k] = skyColor.r * f; data[k + 1] = skyColor.g * f; data[k + 2] = skyColor.b * f;
      } else {
        data[k] = ground.r * groundNits; data[k + 1] = ground.g * groundNits; data[k + 2] = ground.b * groundNits;
      }
      data[k + 3] = 1;
    }
  }
  if (tex) { tex.needsUpdate = true; return tex; }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
