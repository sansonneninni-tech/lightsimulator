// Arredi parametrici: costruiti con forme semplici ma proporzioni e materiali veri.
// Il fronte di ogni mobile guarda verso +Z locale; l'origine è a terra al centro dell'ingombro.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { woodMap, worldUV } from './room';

export interface FurnitureState {
  id: string;
  kind: string;
  position: [number, number, number]; // y = quota d'appoggio (0 a terra, piano del mobile sotto)
  rotationY: number; // gradi
  color: string;     // id della finitura
}

export interface FurnitureKind {
  id: string;
  name: string;
  size: [number, number]; // ingombro a terra (x, z)
  height: number;
  finishes: string[];     // la prima è quella di partenza
  light?: { offset: [number, number, number]; fixture: string; kelvin: number; name: string };
  onTop?: boolean;        // si appoggia sui mobili sotto (lampada da tavolo)
  ceiling?: boolean;      // appeso al soffitto
  surface?: number;       // altezza del piano d'appoggio
  icon: string;
}

export const FINISHES: Record<string, { name: string; color: string; kind: 'tessuto' | 'legno' | 'laccato' | 'metallo' | 'pelle' }> = {
  grigio: { name: 'Grigio', color: '#8b8a87', kind: 'tessuto' },
  sabbia: { name: 'Sabbia', color: '#c9b9a0', kind: 'tessuto' },
  blu: { name: 'Blu', color: '#3d4f6b', kind: 'tessuto' },
  verde: { name: 'Verde', color: '#56624a', kind: 'tessuto' },
  ruggine: { name: 'Ruggine', color: '#9a5136', kind: 'tessuto' },
  cuoio: { name: 'Cuoio', color: '#7a4a2a', kind: 'pelle' },
  rovere: { name: 'Rovere', color: '#ffffff', kind: 'legno' },
  noce: { name: 'Noce', color: '#ffffff', kind: 'legno' },
  bianco: { name: 'Bianco', color: '#e9e7e2', kind: 'laccato' },
  nero: { name: 'Nero', color: '#1e1e1e', kind: 'laccato' },
  ottone: { name: 'Ottone', color: '#b08d57', kind: 'metallo' },
  acciaio: { name: 'Acciaio', color: '#9a9c9e', kind: 'metallo' },
};

const FABRIC = ['grigio', 'sabbia', 'blu', 'verde', 'ruggine', 'cuoio'];
const WOOD = ['rovere', 'noce', 'bianco', 'nero'];
const LAMP = ['bianco', 'nero', 'ottone'];

export const FURNITURE: FurnitureKind[] = [
  { id: 'divano', name: 'Divano', size: [2.1, 0.92], height: 0.82, finishes: FABRIC, surface: 0.44, icon: '<path d="M3 11v6h18v-6M5 11V8h14v3M3 11h3v3h12v-3h3M5 17v2M19 17v2"/>' },
  { id: 'poltrona', name: 'Poltrona', size: [0.86, 0.86], height: 0.8, finishes: FABRIC, surface: 0.44, icon: '<path d="M5 11v6h14v-6M7 11V7h10v4M5 11h2v3h10v-3h2M6 17v2M18 17v2"/>' },
  { id: 'sedia', name: 'Sedia', size: [0.46, 0.5], height: 0.84, finishes: WOOD, surface: 0.46, icon: '<path d="M8 3v18M8 12h9v9M8 12v-0M17 12v9"/>' },
  { id: 'tavolo', name: 'Tavolo', size: [1.6, 0.9], height: 0.75, finishes: WOOD, surface: 0.75, icon: '<path d="M3 8h18M5 8v12M19 8v12"/>' },
  { id: 'tavolino', name: 'Tavolino', size: [1.1, 0.6], height: 0.4, finishes: WOOD, surface: 0.4, icon: '<path d="M3 12h18M6 12v6M18 12v6"/>' },
  { id: 'scrivania', name: 'Scrivania', size: [1.4, 0.7], height: 0.75, finishes: WOOD, surface: 0.75, icon: '<path d="M3 8h18M4 8v12M14 8v12h6V8M14 13h6"/>' },
  { id: 'letto', name: 'Letto', size: [1.7, 2.1], height: 1.0, finishes: ['sabbia', 'grigio', 'blu', 'verde', 'bianco'], surface: 0.55, icon: '<path d="M3 20V8M21 20v-6H3M6 14v-3h5v3"/>' },
  { id: 'comodino', name: 'Comodino', size: [0.5, 0.4], height: 0.55, finishes: WOOD, surface: 0.55, icon: '<rect x="6" y="8" width="12" height="11"/><path d="M6 13h12M11 10.5h2"/>' },
  { id: 'libreria', name: 'Libreria', size: [1.0, 0.35], height: 2.0, finishes: WOOD, icon: '<rect x="5" y="3" width="14" height="18"/><path d="M5 9h14M5 15h14M8 9V5M10 9V6"/>' },
  { id: 'armadio', name: 'Armadio', size: [1.2, 0.6], height: 2.2, finishes: WOOD, icon: '<rect x="5" y="3" width="14" height="18"/><path d="M12 3v18M10 12h0M14 12h0"/>' },
  { id: 'mobiletv', name: 'Mobile TV', size: [1.8, 0.45], height: 1.25, finishes: WOOD, surface: 0.5, icon: '<rect x="4" y="4" width="16" height="9"/><path d="M3 15h18v4H3z"/>' },
  { id: 'cucina', name: 'Cucina', size: [2.4, 0.62], height: 0.92, finishes: ['bianco', 'nero', 'rovere', 'noce'], surface: 0.92, icon: '<rect x="3" y="9" width="18" height="11"/><path d="M3 12h18M9 12v8M15 12v8M14 6v3"/>' },
  { id: 'tappeto', name: 'Tappeto', size: [2.4, 1.7], height: 0.012, finishes: ['sabbia', 'grigio', 'blu', 'ruggine', 'verde'], icon: '<rect x="3" y="7" width="18" height="10" rx="1"/><path d="M6 10h12M6 14h12"/>' },
  { id: 'pianta', name: 'Pianta', size: [0.5, 0.5], height: 1.4, finishes: ['bianco', 'nero', 'ruggine'], icon: '<path d="M8 15h8l-1 6H9zM12 15V7M12 11c-3 0-5-2-5-5 3 0 5 2 5 5zM12 9c3 0 5-2 5-5-3 0-5 2-5 5z"/>' },
  { id: 'lampadaterra', name: 'Lampada da terra', size: [0.4, 0.4], height: 1.7, finishes: LAMP, light: { offset: [0, 1.5, 0], fixture: 'bulb-60', kelvin: 2700, name: 'Lampada da terra' }, icon: '<path d="M9 3h6l2 5H7zM12 8v12M8 21h8"/>' },
  { id: 'lampadatavolo', name: 'Lampada da tavolo', size: [0.3, 0.3], height: 0.5, finishes: LAMP, onTop: true, light: { offset: [0, 0.36, 0], fixture: 'bulb-60', kelvin: 2700, name: 'Lampada da tavolo' }, icon: '<path d="M8 6h8l2 6H6zM12 12v6M9 19h6"/>' },
  { id: 'lampadario', name: 'Lampadario', size: [0.5, 0.5], height: 0.8, finishes: LAMP, ceiling: true, light: { offset: [0, -0.62, 0], fixture: 'bulb-150', kelvin: 2700, name: 'Lampadario' }, icon: '<path d="M12 2v8M6 16a6 6 0 0 1 12 0zM10 19h4"/>' },
];

export const furnitureKind = (id: string) => FURNITURE.find((f) => f.id === id) || FURNITURE[0];

// ---------------- materiali ----------------
const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function finishMaterial(id: string) {
  const hit = matCache.get(id);
  if (hit) return hit;
  const f = FINISHES[id] || FINISHES.grigio;
  let m: THREE.MeshStandardMaterial;
  if (f.kind === 'legno') m = new THREE.MeshStandardMaterial({ map: woodMap(id === 'noce' ? 'noce' : 'rovere'), roughness: 0.5 });
  else if (f.kind === 'metallo') m = new THREE.MeshStandardMaterial({ color: new THREE.Color(f.color), roughness: 0.3, metalness: 1 });
  else if (f.kind === 'laccato') m = new THREE.MeshStandardMaterial({ color: new THREE.Color(f.color), roughness: 0.35 });
  else if (f.kind === 'pelle') m = new THREE.MeshStandardMaterial({ color: new THREE.Color(f.color), roughness: 0.55 });
  else m = new THREE.MeshStandardMaterial({ color: new THREE.Color(f.color), roughness: 0.97 });
  matCache.set(id, m);
  return m;
}
const M = {
  legno: () => finishMaterial('rovere'),
  noce: () => finishMaterial('noce'),
  nero: () => cached('nero-opaco', { color: '#1b1b1b', roughness: 0.6 }),
  metallo: () => cached('metallo-scuro', { color: '#2b2b2c', roughness: 0.35, metalness: 1 }),
  bianco: () => cached('bianco-tessuto', { color: '#ecebe7', roughness: 0.95 }),
  cuscino: () => cached('cuscino', { color: '#dedbd4', roughness: 0.95 }),
  schermo: () => cached('schermo', { color: '#050506', roughness: 0.08 }),
  foglia: () => cached('foglia', { color: '#3d5a2c', roughness: 0.7 }),
  terra: () => cached('terra', { color: '#3a2a1e', roughness: 1 }),
  piano: () => cached('piano-pietra', { color: '#d4d1ca', roughness: 0.25 }),
  inox: () => cached('inox', { color: '#c0c2c4', roughness: 0.3, metalness: 1 }),
};
function cached(k: string, p: { color: string; roughness: number; metalness?: number }) {
  const hit = matCache.get(k);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color), roughness: p.roughness, metalness: p.metalness || 0 });
  matCache.set(k, m);
  return m;
}

// ---------------- forme ----------------
type V3 = [number, number, number];
function add(g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, pos: V3, rot?: V3) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return m;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const soft = (w: number, h: number, d: number, r = 0.04) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
const cyl = (r0: number, r1: number, h: number, seg = 20, open = false) => new THREE.CylinderGeometry(r0, r1, h, seg, 1, open);

function legs4(g: THREE.Group, w: number, d: number, h: number, inset: number, mat: THREE.Material, r = 0.02) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, cyl(r, r * 0.8, h, 10), mat, [sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset)]);
}

export function buildFurniture(f: FurnitureState, ceilingY = 2.8) {
  const k = furnitureKind(f.kind);
  const g = new THREE.Group();
  g.name = 'arredo';
  const fin = finishMaterial(f.color);
  const [W, D] = k.size;
  switch (k.id) {
    case 'divano': {
      add(g, soft(W, 0.22, D - 0.05, 0.03), fin, [0, 0.2, 0]);
      for (const sx of [-1, 1]) add(g, soft(0.2, 0.62, D, 0.06), fin, [sx * (W / 2 - 0.1), 0.38, 0]);
      add(g, soft(W - 0.1, 0.5, 0.22, 0.06), fin, [0, 0.55, -D / 2 + 0.13]);
      const n = W > 1.6 ? 3 : 2, cw = (W - 0.4) / n;
      for (let i = 0; i < n; i++) {
        const x = -W / 2 + 0.2 + cw * (i + 0.5);
        add(g, soft(cw - 0.01, 0.14, D - 0.32, 0.06), fin, [x, 0.38, 0.08]);
        add(g, soft(cw - 0.03, 0.4, 0.16, 0.07), fin, [x, 0.6, -D / 2 + 0.3], [-0.18, 0, 0]);
      }
      legs4(g, W, D, 0.09, 0.08, M.noce(), 0.018);
      break;
    }
    case 'poltrona': {
      add(g, soft(W, 0.2, D - 0.05, 0.03), fin, [0, 0.22, 0]);
      for (const sx of [-1, 1]) add(g, soft(0.16, 0.6, D, 0.06), fin, [sx * (W / 2 - 0.08), 0.4, 0]);
      add(g, soft(W - 0.06, 0.58, 0.18, 0.06), fin, [0, 0.56, -D / 2 + 0.11], [-0.12, 0, 0]);
      add(g, soft(W - 0.34, 0.13, D - 0.28, 0.06), fin, [0, 0.38, 0.08]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, cyl(0.018, 0.012, 0.12, 10), M.noce(), [sx * (W / 2 - 0.07), 0.06, sz * (D / 2 - 0.07)]);
      break;
    }
    case 'sedia': {
      add(g, soft(W, 0.035, D, 0.01), fin, [0, 0.45, 0]);
      legs4(g, W, D, 0.44, 0.03, fin, 0.016);
      for (const sx of [-1, 1]) add(g, box(0.03, 0.4, 0.03), fin, [sx * (W / 2 - 0.03), 0.66, -D / 2 + 0.03]);
      add(g, soft(W - 0.02, 0.14, 0.025, 0.01), fin, [0, 0.76, -D / 2 + 0.03]);
      break;
    }
    case 'tavolo': case 'tavolino': case 'scrivania': {
      const H = k.height, top = 0.04;
      add(g, soft(W, top, D, 0.008), fin, [0, H - top / 2, 0]);
      const legMat = f.color === 'rovere' || f.color === 'noce' ? fin : M.metallo();
      if (k.id === 'scrivania') {
        legs4(g, W, D, H - top, 0.05, legMat, 0.018);
        add(g, box(0.42, 0.16, D - 0.08), fin, [W / 2 - 0.27, H - top - 0.08, 0]);
        add(g, box(0.1, 0.012, 0.012), M.inox(), [W / 2 - 0.27, H - top - 0.08, D / 2 - 0.035]);
      } else legs4(g, W, D, H - top, k.id === 'tavolino' ? 0.06 : 0.08, legMat, k.id === 'tavolino' ? 0.02 : 0.025);
      break;
    }
    case 'letto': {
      const frame = f.color === 'bianco' ? finishMaterial('bianco') : M.noce();
      add(g, soft(W, 0.3, D, 0.02), frame, [0, 0.2, 0]);
      add(g, soft(W + 0.04, 1.0, 0.08, 0.03), frame, [0, 0.5, -D / 2 + 0.04]);
      add(g, soft(W - 0.06, 0.22, D - 0.12, 0.06), M.bianco(), [0, 0.45, 0.03]);
      add(g, soft(W - 0.02, 0.07, D * 0.66, 0.035), fin, [0, 0.58, D * 0.15]);
      for (const sx of [-1, 1]) add(g, soft(W / 2 - 0.12, 0.13, 0.4, 0.06), M.cuscino(), [sx * (W / 4 - 0.02), 0.63, -D / 2 + 0.33], [-0.35, 0, 0]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, box(0.05, 0.06, 0.05), frame, [sx * (W / 2 - 0.06), 0.03, sz * (D / 2 - 0.06)]);
      break;
    }
    case 'comodino': {
      add(g, soft(W, 0.42, D, 0.01), fin, [0, 0.34, 0]);
      add(g, box(W - 0.04, 0.005, 0.005), M.nero(), [0, 0.38, D / 2 + 0.001]);
      add(g, box(0.08, 0.012, 0.012), M.inox(), [0, 0.46, D / 2 + 0.006]);
      legs4(g, W, D, 0.13, 0.04, fin, 0.014);
      break;
    }
    case 'libreria': {
      const H = k.height, t = 0.025;
      for (const sx of [-1, 1]) add(g, box(t, H, D), fin, [sx * (W / 2 - t / 2), H / 2, 0]);
      add(g, box(W, H, 0.01), fin, [0, H / 2, -D / 2 + 0.005]);
      const shelves = 5;
      const rnd = mulberry(7);
      const bookCols = ['#7b2f25', '#2e4057', '#d9c8a9', '#3f5e3a', '#c47a3d', '#1f1f1f', '#e8e3d8', '#8a6d9a'];
      for (let i = 0; i <= shelves; i++) {
        const y = 0.06 + (i * (H - 0.08)) / shelves;
        add(g, box(W - 2 * t, t, D), fin, [0, y, 0]);
        if (i === shelves) break;
        let x = -W / 2 + t + 0.02;
        const end = W / 2 - t - 0.02 - rnd() * 0.25;
        while (x < end) {
          const bw = 0.02 + rnd() * 0.035, bh = 0.18 + rnd() * 0.12, bd = D - 0.06 - rnd() * 0.05;
          if (x + bw > end) break;
          const col = bookCols[Math.floor(rnd() * bookCols.length)];
          add(g, box(bw, bh, bd), cached('libro' + col, { color: col, roughness: 0.7 }), [x + bw / 2, y + t / 2 + bh / 2, 0.01]);
          x += bw + 0.002;
        }
      }
      break;
    }
    case 'armadio': {
      const H = k.height;
      add(g, soft(W, H - 0.06, D, 0.01), fin, [0, H / 2 + 0.03, 0]);
      add(g, box(0.004, H - 0.12, 0.004), M.nero(), [0, H / 2 + 0.03, D / 2 + 0.001]);
      for (const sx of [-1, 1]) add(g, box(0.012, 0.3, 0.012), M.inox(), [sx * 0.05, 1.05, D / 2 + 0.012]);
      add(g, box(W - 0.04, 0.06, D - 0.04), M.nero(), [0, 0.03, 0]);
      break;
    }
    case 'mobiletv': {
      add(g, soft(W, 0.42, D, 0.01), fin, [0, 0.29, 0]);
      for (const sx of [-1, 1]) add(g, box(0.004, 0.38, 0.004), M.nero(), [sx * W / 6, 0.29, D / 2 + 0.001]);
      legs4(g, W, D, 0.08, 0.05, M.metallo(), 0.012);
      // televisore 55"
      add(g, box(0.4, 0.015, 0.22), M.metallo(), [0, 0.508, 0]);
      add(g, box(0.06, 0.08, 0.04), M.metallo(), [0, 0.55, -0.02]);
      add(g, box(1.23, 0.71, 0.03), M.nero(), [0, 0.95, -0.02]);
      add(g, box(1.21, 0.69, 0.002), M.schermo(), [0, 0.95, -0.004]);
      break;
    }
    case 'cucina': {
      add(g, box(W, 0.82, D - 0.04), fin, [0, 0.46, -0.02]);
      add(g, box(W, 0.1, D - 0.1), M.nero(), [0, 0.05, -0.05]);
      add(g, box(W + 0.02, 0.04, D + 0.02), M.piano(), [0, 0.9, 0]);
      const n = Math.max(2, Math.round(W / 0.6));
      for (let i = 1; i < n; i++) add(g, box(0.004, 0.78, 0.004), M.nero(), [-W / 2 + (i * W) / n, 0.46, D / 2 - 0.039]);
      for (let i = 0; i < n; i++) add(g, box(0.16, 0.012, 0.014), M.inox(), [-W / 2 + ((i + 0.5) * W) / n, 0.8, D / 2 - 0.03]);
      add(g, box(0.5, 0.012, 0.4), M.inox(), [W * 0.18, 0.925, 0]);
      add(g, cyl(0.012, 0.012, 0.3, 10), M.inox(), [W * 0.18, 1.07, -0.2]);
      add(g, cyl(0.01, 0.01, 0.18, 10), M.inox(), [W * 0.18, 1.21, -0.13], [Math.PI / 2, 0, 0]);
      break;
    }
    case 'tappeto': {
      const m = add(g, box(W, 0.012, D), fin, [0, 0.006, 0]);
      m.castShadow = false;
      break;
    }
    case 'pianta': {
      add(g, cyl(0.17, 0.13, 0.36, 24), fin, [0, 0.18, 0]);
      add(g, cyl(0.16, 0.16, 0.02, 24), M.terra(), [0, 0.35, 0]);
      add(g, cyl(0.012, 0.016, 0.7, 8), M.noce(), [0, 0.7, 0]);
      const rnd = mulberry(3);
      for (let i = 0; i < 26; i++) {
        const a = rnd() * Math.PI * 2, h = 0.6 + rnd() * 0.75, rr = 0.06 + rnd() * 0.26 * (1 - Math.abs(h - 1.0) * 0.8);
        const leaf = new THREE.SphereGeometry(0.1, 10, 6);
        leaf.scale(1, 0.22, 0.55);
        add(g, leaf, M.foglia(), [Math.cos(a) * rr, h, Math.sin(a) * rr], [rnd() * 0.8 - 0.4, -a, 0.3 + rnd() * 0.6]);
      }
      break;
    }
    case 'lampadaterra': {
      add(g, cyl(0.15, 0.16, 0.025, 28), fin, [0, 0.0125, 0]);
      add(g, cyl(0.011, 0.011, 1.42, 10), fin, [0, 0.72, 0]);
      shade(g, 0.13, 0.2, 0.3, 1.52);
      bulb(g, [0, 1.5, 0], 0.035);
      break;
    }
    case 'lampadatavolo': {
      add(g, cyl(0.07, 0.085, 0.16, 24), fin, [0, 0.08, 0]);
      add(g, cyl(0.008, 0.008, 0.18, 8), fin, [0, 0.24, 0]);
      shade(g, 0.1, 0.15, 0.2, 0.39);
      bulb(g, [0, 0.36, 0], 0.025);
      break;
    }
    case 'lampadario': {
      // appeso al soffitto: l'origine resta a terra, la forma sta sotto il soffitto
      const yTop = ceilingY;
      const cord = 0.55;
      add(g, cyl(0.06, 0.06, 0.03, 20), fin, [0, yTop - 0.015, 0]);
      add(g, cyl(0.003, 0.003, cord, 6), M.nero(), [0, yTop - cord / 2, 0]);
      const dome = new THREE.SphereGeometry(0.24, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2.3);
      const dm = add(g, dome, fin, [0, yTop - cord - 0.14, 0]);
      (dm.material as THREE.Material).side = THREE.DoubleSide;
      bulb(g, [0, yTop + k.light!.offset[1], 0], 0.04);
      break;
    }
  }
  g.traverse((o: any) => { if (o.isMesh) { o.userData.furnitureId = f.id; (o.geometry as any).computeBoundsTree?.(); } });
  // texture del legno in coordinate di mondo locali (venature coerenti tra i pezzi)
  g.updateMatrixWorld(true);
  g.traverse((o: any) => { if (o.isMesh && (o.material as any).map && !(o.geometry as any).__uv) { worldUV(o.geometry, o.matrixWorld, 1.5); (o.geometry as any).__uv = 1; } });
  return g;
}

function shade(g: THREE.Group, rTop: number, rBot: number, h: number, y: number) {
  const geo = cyl(rTop, rBot, h, 32, true);
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color('#efe7d6'), roughness: 1, side: THREE.DoubleSide, emissive: new THREE.Color(1, 0.8, 0.6), emissiveIntensity: 0 });
  const mesh = add(g, geo, m, [0, y, 0]);
  mesh.name = 'paralume';
  // in anteprima il paralume non ferma la luce (sarebbe un'ombra totale); nello scatto sì, ed esce sopra e sotto
  mesh.castShadow = false;
  mesh.userData.glow = true;
}

function bulb(g: THREE.Group, p: V3, r: number) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(1, 0.8, 0.6), emissiveIntensity: 0, roughness: 0.2 });
  const mesh = add(g, new THREE.SphereGeometry(r, 16, 12), m, p);
  mesh.name = 'lampadina';
  mesh.castShadow = false;
  mesh.userData.bulb = true;
}

function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ingombro a terra ruotato (mezze dimensioni lungo x e z)
export function footprint(f: FurnitureState) {
  const k = furnitureKind(f.kind);
  const a = THREE.MathUtils.degToRad(f.rotationY);
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return { hx: (k.size[0] * c + k.size[1] * s) / 2, hz: (k.size[0] * s + k.size[1] * c) / 2 };
}

// posizione mondo della lampadina di un arredo luminoso
export function lampWorld(f: FurnitureState, ceilingY: number): [number, number, number] | null {
  const k = furnitureKind(f.kind);
  if (!k.light) return null;
  const o = new THREE.Vector3(...k.light.offset).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(f.rotationY));
  const y = k.ceiling ? ceilingY + k.light.offset[1] : f.position[1] + k.light.offset[1];
  return [f.position[0] + o.x, y, f.position[2] + o.z];
}
