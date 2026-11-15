// Arredi parametrici: costruiti con forme semplici ma proporzioni e materiali veri.
// Il fronte di ogni mobile guarda verso +Z locale; l'origine è a terra al centro dell'ingombro.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { woodMap, worldUV } from './room';
import { CATALOG } from './catalog';

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
  cat?: string;           // categoria nel catalogo
  model?: string;         // modello 3D in public/catalog (altrimenti forma parametrica)
  scale?: number;         // scala del modello
  wall?: number;          // appeso alla parete: altezza da terra del bordo basso
  flat?: boolean;         // a terra e calpestabile (tappeti): non ingombra
  rug?: 'persiano' | 'kilim' | 'berbero' | 'righe' | 'tondo' | 'passatoia';
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

const RUG_ICON = '<rect x="3" y="7" width="18" height="10" rx="1"/><path d="M6 10h12M6 14h12"/>';
FURNITURE.push(
  { id: 'tappeto-persiano', name: 'Tappeto persiano', size: [2.4, 1.7], height: 0.012, finishes: ['ruggine', 'blu', 'verde'], rug: 'persiano', icon: RUG_ICON },
  { id: 'tappeto-kilim', name: 'Kilim', size: [2.0, 1.4], height: 0.01, finishes: ['ruggine', 'blu', 'sabbia'], rug: 'kilim', icon: RUG_ICON },
  { id: 'tappeto-berbero', name: 'Tappeto berbero', size: [2.3, 1.6], height: 0.016, finishes: ['sabbia', 'grigio'], rug: 'berbero', icon: RUG_ICON },
  { id: 'tappeto-righe', name: 'Tappeto a righe', size: [2.0, 1.4], height: 0.01, finishes: ['blu', 'grigio', 'verde', 'ruggine'], rug: 'righe', icon: RUG_ICON },
  { id: 'tappeto-tondo', name: 'Tappeto tondo', size: [1.8, 1.8], height: 0.012, finishes: ['sabbia', 'grigio', 'blu', 'verde'], rug: 'tondo', icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/>' },
  { id: 'tappeto-passatoia', name: 'Passatoia', size: [0.8, 2.6], height: 0.01, finishes: ['ruggine', 'blu', 'grigio'], rug: 'passatoia', icon: '<rect x="8" y="3" width="8" height="18" rx="1"/>' },
);
const BASE_CAT: Record<string, string> = {
  divano: 'divani', poltrona: 'sedute', sedia: 'sedute', tavolo: 'tavoli', tavolino: 'tavoli', scrivania: 'tavoli', letto: 'letti', comodino: 'letti',
  libreria: 'contenitori', armadio: 'contenitori', mobiletv: 'contenitori', cucina: 'cucina', pianta: 'piante', lampadaterra: 'luci', lampadatavolo: 'luci', lampadario: 'luci',
};
for (const f of FURNITURE) { f.cat = f.id.startsWith('tappeto') ? 'tappeti' : BASE_CAT[f.id]; if (f.id.startsWith('tappeto')) f.flat = true; }

// tutto il catalogo: forme parametriche (con finiture) e modelli 3D
export const ALL_FURNITURE: FurnitureKind[] = [...FURNITURE, ...CATALOG];
export const CATEGORIES: { id: string; name: string }[] = [
  { id: 'sedute', name: 'Sedute' }, { id: 'divani', name: 'Divani' }, { id: 'tavoli', name: 'Tavoli' }, { id: 'letti', name: 'Letti' },
  { id: 'contenitori', name: 'Armadi e librerie' }, { id: 'luci', name: 'Lampade' }, { id: 'tappeti', name: 'Tappeti' }, { id: 'pareti', name: 'Quadri e specchi' },
  { id: 'decoro', name: 'Oggetti' }, { id: 'piante', name: 'Piante' }, { id: 'cucina', name: 'Cucina' }, { id: 'bagno', name: 'Bagno' },
];
const byId = new Map(ALL_FURNITURE.map((f) => [f.id, f]));
export const furnitureKind = (id: string) => byId.get(id) || FURNITURE[0];

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
  if (k.model) return buildModel(g, f, k, ceilingY);
  const fin = finishMaterial(f.color);
  const [W, D] = k.size;
  if (k.rug) {
    const geo = k.rug === 'tondo' ? new THREE.CylinderGeometry(W / 2, W / 2, k.height, 64) : new THREE.BoxGeometry(W, k.height, D);
    const m = add(g, geo, rugMaterial(k.rug, f.color, W, D), [0, k.height / 2, 0]);
    m.castShadow = false;
    (geo as any).__uv = 1; // il disegno resta quello della texture
  }
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

// ---------------- modelli 3D ----------------
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const models = new Map<string, Promise<{ scene: THREE.Object3D; box: THREE.Box3 }>>();
const pending = new Set<Promise<unknown>>();
let onLoaded: (() => void) | null = null;
export function onFurnitureLoaded(cb: () => void) { onLoaded = cb; }
// lo scatto aspetta i modelli ancora in arrivo
export function furnitureReady() { return Promise.all([...pending]); }
export function modelUrl(name: string) { return `${import.meta.env.BASE_URL}catalog/${name}.glb`; }
function loadModel(name: string) {
  if (!models.has(name)) {
    models.set(name, loader.loadAsync(modelUrl(name)).then((gl) => {
      const scene = gl.scene;
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      scene.traverse((o: any) => {
        if (!o.isMesh) return;
        // i file sono compressi con attributi quantizzati (interi, interlacciati): il path tracer
        // li leggerebbe male (mobili trasparenti come vetro), quindi si riportano a float semplici
        const geo = o.geometry as THREE.BufferGeometry;
        for (const k of Object.keys(geo.attributes)) {
          const a: any = geo.attributes[k];
          if (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute) continue;
          const n = a.count, s = a.itemSize, f = new Float32Array(n * s);
          for (let i = 0; i < n; i++) for (let j = 0; j < s; j++) f[i * s + j] = a.getComponent(i, j);
          geo.setAttribute(k, new THREE.BufferAttribute(f, s));
        }
        if (geo.attributes.normal) geo.normalizeNormals();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          // vetri dei modelli: trasparenti anche nello scatto
          if (m.transparent && m.opacity < 1) m.depthWrite = false;
          if (m.map) m.map.anisotropy = 4;
        }
      });
      return { scene, box };
    }));
  }
  return models.get(name)!;
}

function buildModel(g: THREE.Group, f: FurnitureState, k: FurnitureKind, ceilingY: number) {
  // segnaposto finché il modello arriva: un ingombro invisibile ma selezionabile
  const ph = new THREE.Mesh(new THREE.BoxGeometry(k.size[0], k.height, k.size[1]), new THREE.MeshBasicMaterial({ visible: false }));
  ph.position.y = k.ceiling ? ceilingY - k.height / 2 : k.height / 2;
  ph.userData.furnitureId = f.id;
  ph.userData.placeholder = true;
  g.add(ph);
  const p = loadModel(k.model!).then(({ scene, box }) => {
    const s = k.scale || 1;
    const c = scene.clone(true);
    c.scale.setScalar(s);
    // base a terra (o in alto al soffitto), centro dell'ingombro sull'origine; il fronte guarda +Z
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    c.position.set(-cx * s, k.ceiling ? ceilingY - box.max.y * s : -box.min.y * s, -cz * s);
    const lit = !!k.light;
    c.traverse((o: any) => {
      if (!o.isMesh) return;
      o.userData.furnitureId = f.id;
      // le lampade non fanno ombra alla propria luce
      o.castShadow = !lit; o.receiveShadow = true;
      // e nemmeno nello scatto finale (lì conta il materiale): paralumi e vetri non spengono la lampadina
      if (lit) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.castShadow = false;
      if (!(o.geometry as any).boundsTree) (o.geometry as any).computeBoundsTree?.();
    });
    g.remove(ph);
    g.add(c);
    if (lit) bulb(g, [k.light!.offset[0], (k.ceiling ? ceilingY : 0) + k.light!.offset[1], k.light!.offset[2]], 0.02);
    g.updateMatrixWorld(true);
    onLoaded?.();
  }).catch((e) => console.warn('modello', k.model, e)).finally(() => pending.delete(p));
  pending.add(p);
  return g;
}

// ---------------- tappeti ----------------
const rugCache = new Map<string, THREE.MeshStandardMaterial>();
function rugMaterial(style: string, finish: string, W: number, D: number) {
  const key = `${style}|${finish}`;
  const hit = rugCache.get(key);
  if (hit) return hit;
  const base = new THREE.Color(FINISHES[finish]?.color || '#9a5136');
  const hsl = { h: 0, s: 0, l: 0 }; base.getHSL(hsl);
  const col = (dl: number, ds = 0, dh = 0) => new THREE.Color().setHSL((hsl.h + dh + 1) % 1, Math.min(1, Math.max(0, hsl.s + ds)), Math.min(0.95, Math.max(0.04, hsl.l + dl))).getStyle();
  const cream = '#e6dcc8', ink = '#2b2420';
  const w = 1024, h = Math.max(64, Math.round((1024 * D) / W));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const x = cv.getContext('2d')!;
  const rnd = mulberry(style.length * 7 + finish.length);
  if (style === 'persiano') {
    x.fillStyle = col(-0.05); x.fillRect(0, 0, w, h);
    const bw = h * 0.12;
    x.fillStyle = col(-0.2, 0, 0.55); x.fillRect(bw * 0.3, bw * 0.3, w - bw * 0.6, h - bw * 0.6);
    x.fillStyle = col(-0.02); x.fillRect(bw, bw, w - bw * 2, h - bw * 2);
    x.strokeStyle = cream; x.lineWidth = 4; x.strokeRect(bw * 0.65, bw * 0.65, w - bw * 1.3, h - bw * 1.3);
    // medaglione centrale e ornamenti
    const cx = w / 2, cy = h / 2;
    for (let i = 5; i > 0; i--) {
      x.fillStyle = i % 2 ? col(-0.22, 0, 0.55) : cream;
      x.beginPath(); x.ellipse(cx, cy, (w * 0.09 * i) / 2.4, (h * 0.09 * i) / 2.4, 0, 0, Math.PI * 2); x.fill();
    }
    for (let i = 0; i < 260; i++) {
      const px = bw + rnd() * (w - bw * 2), py = bw + rnd() * (h - bw * 2);
      x.fillStyle = [cream, col(-0.25, 0, 0.55), col(0.12), ink][i % 4];
      x.beginPath(); x.arc(px, py, 3 + rnd() * 6, 0, Math.PI * 2); x.fill();
    }
    for (const [sx, sy] of [[bw * 1.6, bw * 1.6], [w - bw * 1.6, bw * 1.6], [bw * 1.6, h - bw * 1.6], [w - bw * 1.6, h - bw * 1.6]]) {
      x.fillStyle = col(-0.22, 0, 0.55); x.beginPath(); x.ellipse(sx, sy, w * 0.07, h * 0.1, 0, 0, Math.PI * 2); x.fill();
    }
  } else if (style === 'kilim') {
    x.fillStyle = col(0); x.fillRect(0, 0, w, h);
    const n = 6, cw = w / n;
    for (let r = 0; r < 3; r++) for (let i = 0; i < n; i++) {
      const cx = cw * (i + 0.5), cy = (h / 3) * (r + 0.5), a = cw * 0.42, b = (h / 3) * 0.42;
      x.fillStyle = (i + r) % 2 ? cream : ink;
      x.beginPath(); x.moveTo(cx, cy - b); x.lineTo(cx + a, cy); x.lineTo(cx, cy + b); x.lineTo(cx - a, cy); x.closePath(); x.fill();
      x.fillStyle = col(0.08, 0, 0.08);
      x.beginPath(); x.moveTo(cx, cy - b * 0.5); x.lineTo(cx + a * 0.5, cy); x.lineTo(cx, cy + b * 0.5); x.lineTo(cx - a * 0.5, cy); x.closePath(); x.fill();
    }
    x.fillStyle = ink; x.fillRect(0, 0, w, h * 0.04); x.fillRect(0, h * 0.96, w, h * 0.04);
  } else if (style === 'berbero') {
    x.fillStyle = col(0.18, -0.15); x.fillRect(0, 0, w, h);
    x.strokeStyle = ink; x.lineWidth = 6;
    const n = 5;
    for (let i = -n; i <= n * 2; i++) {
      x.beginPath(); x.moveTo((i * w) / n, 0); x.lineTo(((i + 1.5) * w) / n, h); x.stroke();
      x.beginPath(); x.moveTo((i * w) / n, 0); x.lineTo(((i - 1.5) * w) / n, h); x.stroke();
    }
  } else if (style === 'righe' || style === 'passatoia') {
    const horiz = style === 'righe';
    const L = horiz ? w : h, n = horiz ? 14 : 10;
    for (let i = 0; i < n; i++) {
      x.fillStyle = [col(0), cream, col(-0.15), cream, col(0.1)][i % 5];
      if (horiz) x.fillRect((i * L) / n, 0, L / n + 1, h); else x.fillRect(0, (i * L) / n, w, L / n + 1);
    }
  } else if (style === 'tondo') {
    x.fillStyle = col(0); x.fillRect(0, 0, w, h);
    for (let i = 7; i > 0; i--) { x.fillStyle = i % 2 ? col(0.06 * (i % 3)) : cream; x.beginPath(); x.arc(w / 2, h / 2, (w / 2) * (i / 7) * 0.98, 0, Math.PI * 2); x.fill(); }
  }
  // trama del tessuto
  const img = x.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 1 });
  rugCache.set(key, m);
  return m;
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
