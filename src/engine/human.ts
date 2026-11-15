// Personaggi personalizzabili: maglia MakeHuman (asset CC0) deformata da forme di corpo e viso,
// con capelli, abiti, scarpe, occhi e sopracciglia agganciati alla pelle e uno scheletro che il
// manichino muove. I file vengono da tools/makehuman/convert.py (cartella public/human).
import * as THREE from 'three';

export interface Look {
  age: number;      // 0 = 25 anni, 1 = 90
  muscle: number;   // 0..1 (0,5 nella media)
  weight: number;   // 0..1 (0,5 nella media)
  breast: number;   // -1..1 (solo donna)
  race: [number, number, number]; // tratti africani, asiatici, europei (somma 1)
  form: string;     // forma del viso ('' = libera)
  s: Record<string, number>; // cursori del viso e del corpo, -1..1
  hair: string;     // '' = rasato
  hairColor: string;
  brows: string;
  eyes: string;
  outfit: string;   // abito completo (vecchi progetti); ora valgono top e bottom
  top?: string;     // abito da cui si prende la parte di sopra ('' = nudo sopra)
  bottom?: string;  // abito da cui si prende la parte di sotto ('' = nudo sotto)
  under?: string;   // intimo: '' nessuno, oppure il colore (nero, bianco, carne)
  outfitHue: number;   // gradi
  outfitLight: number; // -1..1
  shoes: string;
  hat: string;
  expr: string;
  skinLight: number; // -1..1, ritocco della carnagione
}

export const HAIR_COLORS = [
  { id: '#1b1714', name: 'Nero' }, { id: '#3b2a20', name: 'Castano scuro' }, { id: '#6a4a33', name: 'Castano' },
  { id: '#8e5a35', name: 'Ramato' }, { id: '#b98d5c', name: 'Biondo scuro' }, { id: '#dcc08e', name: 'Biondo' },
  { id: '#8d8a86', name: 'Grigio' }, { id: '#e3e0da', name: 'Bianco' },
];

export const EXPRESSIONS: { id: string; name: string; u: Record<string, number> }[] = [
  { id: 'neutra', name: 'Neutra', u: {} },
  { id: 'sorriso', name: 'Sorriso', u: { 'mouth-corner-puller': 0.75, 'eye-left-slit': 0.25, 'eye-right-slit': 0.25 } },
  { id: 'risata', name: 'Risata', u: { 'mouth-corner-puller': 1, 'mouth-open': 0.16, 'mouth-parling': 0.45, 'eye-left-slit': 0.45, 'eye-right-slit': 0.45 } },
  { id: 'parla', name: 'Parla', u: { 'mouth-open': 0.1, 'mouth-parling': 0.3 } },
  { id: 'sorpresa', name: 'Sorpresa', u: { 'eyebrows-left-up': 0.9, 'eyebrows-right-up': 0.9, 'eye-left-opened-up': 0.7, 'eye-right-opened-up': 0.7, 'mouth-open': 0.22 } },
  { id: 'triste', name: 'Triste', u: { 'eyebrows-left-inner-up': 0.9, 'eyebrows-right-inner-up': 0.9, 'mouth-depression': 0.7 } },
  { id: 'arrabbiata', name: 'Arrabbiata', u: { 'eyebrows-left-down': 0.9, 'eyebrows-right-down': 0.9, 'mouth-compression': 0.6, 'nose-left-elevation': 0.4, 'nose-right-elevation': 0.4 } },
  { id: 'pensosa', name: 'Pensosa', u: { 'mouth-pursing': 0.4, 'eyebrows-left-down': 0.35, 'eyebrows-right-inner-up': 0.4, 'eye-left-slit': 0.2, 'eye-right-slit': 0.2 } },
  { id: 'occhichiusi', name: 'Occhi chiusi', u: { 'eye-left-closure': 1, 'eye-right-closure': 1 } },
];

export function defaultLook(figure: 'uomo' | 'donna' = 'uomo', skin = 'media'): Look {
  const race: [number, number, number] = skin === 'scura' ? [0.8, 0.05, 0.15] : skin === 'chiara' ? [0.05, 0.05, 0.9] : [0.25, 0.25, 0.5];
  return {
    age: 0.1, muscle: 0.5, weight: 0.5, breast: 0, race, form: '', s: {},
    hair: figure === 'donna' ? 'long01' : 'short02', hairColor: '#3b2a20', brows: figure === 'donna' ? 'eyebrow010' : 'eyebrow001', eyes: 'brown',
    outfit: figure === 'donna' ? 'female_casualsuit01' : 'male_casualsuit01', top: figure === 'donna' ? 'female_casualsuit01' : 'male_casualsuit01', bottom: figure === 'donna' ? 'female_casualsuit01' : 'male_casualsuit01', under: '', outfitHue: 0, outfitLight: 0, shoes: figure === 'donna' ? 'shoes02' : 'shoes01', hat: '', expr: 'neutra', skinLight: 0,
  };
}

type Item = { part?: 'top' | 'bottom'; kind: string; name: string; nv: number; nr: number; ni: number; refs: number; w: number; off: number; vert: number; uv: number; idx: number; scale: Record<string, [number, number, number]>; del?: [number, number][]; map?: string; normal?: string; transparent: boolean };
type Manifest = {
  nv: number; nr: number; ni: number; pos: number; bodyVert: number; bodyUV: number; bodyIdx: number; skinIdx: number; skinW: number;
  bones: { name: string; parent: number; head: number[]; tail: number[] }[];
  packs: Record<string, Record<string, [number, number, number]>>;
  sliders: Record<string, [string[], string[]]>; forms: string[]; items: Item[]; eyes: Record<string, string>; skins: Record<string, string>;
};

const BASE = () => `${import.meta.env.BASE_URL}human/`;
let man: Manifest | null = null;
let baseBuf: ArrayBuffer | null = null;
let basePromise: Promise<void> | null = null;
const packBufs = new Map<string, Promise<ArrayBuffer>>();
const itemBufs = new Map<string, Promise<ArrayBuffer>>();
const texCache = new Map<string, Promise<THREE.Texture>>();

// i .bin sono compressi con gzip (tools/makehuman/pack.py): il sito di pubblicazione non li comprime da sé
const getBin = (f: string) => fetch(BASE() + f).then((r) => { if (!r.ok) throw new Error(f); return r.arrayBuffer(); }).then((b) => {
  const h = new Uint8Array(b, 0, 2);
  if (h[0] !== 0x1f || h[1] !== 0x8b) return b;
  return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
});

export function humanManifest() { return man; }

export function loadBase() {
  if (!basePromise) basePromise = Promise.all([fetch(BASE() + 'base.json').then((r) => r.json()), getBin('base.bin')]).then(([m, b]) => { man = m; baseBuf = b; });
  return basePromise;
}
const pack = (name: string) => { if (!packBufs.has(name)) packBufs.set(name, getBin(`t-${name}.bin`)); return packBufs.get(name)!; };
const itemBin = (it: Item) => { const k = `${it.kind}-${it.name}`; if (!itemBufs.has(k)) itemBufs.set(k, getBin(`p-${k}.bin`)); return itemBufs.get(k)!; };

function loadTex(file: string, srgb = true) {
  const k = file + (srgb ? '' : ':lin');
  if (!texCache.has(k)) {
    texCache.set(k, new THREE.TextureLoader().loadAsync(BASE() + file).then((t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.flipY = true;
      t.anisotropy = 4;
      return t;
    }));
  }
  return texCache.get(k)!;
}

// abito ricolorato: rotazione della tinta e chiarezza fatte sui pixel (vale anche nello scatto)
const recolored = new Map<string, Promise<THREE.Texture>>();
function recolor(file: string, hue: number, light: number) {
  if (!hue && !light) return loadTex(file);
  const k = `${file}|${hue}|${light}`;
  if (!recolored.has(k)) {
    recolored.set(k, loadTex(file).then((t) => {
      const img = t.image as HTMLImageElement | ImageBitmap;
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img as any, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      const a = d.data;
      const h = THREE.MathUtils.degToRad(hue);
      // rotazione della tinta in YIQ, poi chiarezza
      const cosA = Math.cos(h), sinA = Math.sin(h);
      const m = [
        0.299 + 0.701 * cosA + 0.168 * sinA, 0.587 - 0.587 * cosA + 0.330 * sinA, 0.114 - 0.114 * cosA - 0.497 * sinA,
        0.299 - 0.299 * cosA - 0.328 * sinA, 0.587 + 0.413 * cosA + 0.035 * sinA, 0.114 - 0.114 * cosA + 0.292 * sinA,
        0.299 - 0.300 * cosA + 1.250 * sinA, 0.587 - 0.588 * cosA - 1.050 * sinA, 0.114 + 0.886 * cosA - 0.203 * sinA,
      ];
      const L = light >= 0 ? 1 + light * 1.2 : 1 + light * 0.75;
      for (let i = 0; i < a.length; i += 4) {
        const r = a[i], gg = a[i + 1], b = a[i + 2];
        a[i] = Math.min(255, (m[0] * r + m[1] * gg + m[2] * b) * L);
        a[i + 1] = Math.min(255, (m[3] * r + m[4] * gg + m[5] * b) * L);
        a[i + 2] = Math.min(255, (m[6] * r + m[7] * gg + m[8] * b) * L);
      }
      g.putImageData(d, 0, 0);
      const nt = new THREE.CanvasTexture(c);
      nt.colorSpace = THREE.SRGBColorSpace;
      nt.anisotropy = 4;
      return nt;
    }));
  }
  return recolored.get(k)!;
}

function addTarget(pos: Float32Array, buf: ArrayBuffer, e: [number, number, number] | undefined, w: number) {
  if (!e || Math.abs(w) < 1e-4 || !e[2]) return;
  const idx = new Uint16Array(buf, e[0], e[2]);
  const d = new Int16Array(buf, e[1], e[2] * 3);
  const k = w * 1e-5;
  for (let i = 0; i < idx.length; i++) {
    const j = idx[i] * 3;
    pos[j] += d[i * 3] * k; pos[j + 1] += d[i * 3 + 1] * k; pos[j + 2] += d[i * 3 + 2] * k;
  }
}

// i cursori del viso di MakeHuman sono timidi: si spingono un po' (la fronte invece stirava i capelli)
const GAIN: Record<string, number> = { spalle: 1, torace: 1, fianchi: 1, pancia: 1, glutei: 1, collo: 1, fronte: 0.6, zigomi: 1, guance: 1.2, guanceTesta: 1.2, testa: 1.2 };

const tri3 = (x: number) => [Math.max(0, 1 - 2 * x), 1 - Math.abs(2 * x - 1), Math.max(0, 2 * x - 1)]; // min, media, max

// posizioni della maglia base per un aspetto
async function morph(look: Look, gender: 'uomo' | 'donna') {
  const m = man!;
  const [gp, dp] = await Promise.all([pack(gender), pack('dettagli')]);
  const pos = new Float32Array(new Float32Array(baseBuf!, m.pos, m.nv * 3));
  const G = m.packs[gender], D = m.packs.dettagli;
  const ages: [string, number][] = [['young', 1 - look.age], ['old', look.age]];
  const mus = tri3(look.muscle), wei = tri3(look.weight);
  const MU = ['minmuscle', 'averagemuscle', 'maxmuscle'], WE = ['minweight', 'averageweight', 'maxweight'];
  for (const [a, wa] of ages) {
    if (wa < 1e-4) continue;
    // le forme estreme di MakeHuman sono timide: si spingono oltre perché il cursore si veda davvero
    const amp = (i: number, j: number) => (i === 1 && j !== 1 ? 2.8 : i !== 1 && j === 1 ? 1.4 : 1);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) addTarget(pos, gp, G[`u-${a}-${MU[i]}-${WE[j]}`], wa * mus[i] * wei[j] * amp(i, j));
    const rs = look.race[0] + look.race[1] + look.race[2] || 1;
    (['african', 'asian', 'caucasian'] as const).forEach((r, i) => addTarget(pos, gp, G[`r-${r}-${a}`], (wa * look.race[i]) / rs));
  }
  if (gender === 'donna') addTarget(pos, gp, G[look.breast >= 0 ? 'breast-max' : 'breast-min'], Math.abs(look.breast));
  for (const k in look.s) {
    const v = look.s[k], sl = m.sliders[k];
    if (!sl || !v) continue;
    for (const t of sl[v < 0 ? 0 : 1]) addTarget(pos, dp, D[t], Math.abs(v) * (GAIN[k] ?? 1.5));
  }
  if (look.form) addTarget(pos, dp, D['head/head-' + look.form], 0.8);
  const ex = EXPRESSIONS.find((e) => e.id === look.expr);
  if (ex) for (const u in ex.u) addTarget(pos, dp, D['x/' + u], ex.u[u]);
  // piedi a terra
  const bv = new Uint16Array(baseBuf!, m.bodyVert, m.nr);
  let minY = Infinity;
  for (let i = 0; i < bv.length; i++) minY = Math.min(minY, pos[bv[i] * 3 + 1]);
  for (let i = 1; i < pos.length; i += 3) pos[i] -= minY;
  return pos;
}

// normali lisce calcolate sui vertici veri (le cuciture delle UV non si vedono)
function smoothNormals(pos: Float32Array, rv: ArrayLike<number>, idx: ArrayLike<number>, nBase: number, posOf: (r: number) => number) {
  const acc = new Float32Array(nBase * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = posOf(idx[t]), i1 = posOf(idx[t + 1]), i2 = posOf(idx[t + 2]);
    a.fromArray(pos, i0 * 3); b.fromArray(pos, i1 * 3); c.fromArray(pos, i2 * 3);
    c.sub(b); a.sub(b); c.cross(a); // area pesata
    for (const i of [i0, i1, i2]) { acc[i * 3] += c.x; acc[i * 3 + 1] += c.y; acc[i * 3 + 2] += c.z; }
  }
  const out = new Float32Array(rv.length * 3);
  for (let r = 0; r < rv.length; r++) {
    const i = posOf(r);
    const x = acc[i * 3], y = acc[i * 3 + 1], z = acc[i * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    out[r * 3] = x / l; out[r * 3 + 1] = y / l; out[r * 3 + 2] = z / l;
  }
  return out;
}

const MAT = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, ...o });

export type HumanTemplate = { scene: THREE.Group; hipsH: number; rest: Map<string, THREE.Quaternion>; map: Record<string, string>; arms: [string, string, string][] };

export const HUMAN_MAP: Record<string, string> = {
  hips: 'root', spine: 'spine04', chest: 'spine02', neck: 'neck01', head: 'head',
  shoulder_l: 'upperarm01.L', elbow_l: 'lowerarm01.L', wrist_l: 'wrist.L',
  shoulder_r: 'upperarm01.R', elbow_r: 'lowerarm01.R', wrist_r: 'wrist.R',
  hip_l: 'upperleg01.L', knee_l: 'lowerleg01.L', ankle_l: 'foot.L',
  hip_r: 'upperleg01.R', knee_r: 'lowerleg01.R', ankle_r: 'foot.R',
};

// costruisce il personaggio a riposo (posa ad A) con scheletro e pelle
// abiti in un pezzo solo: si scelgono come "sopra" e coprono anche il sotto
export const UNDER_COLORS: Record<string, string> = { nero: '#161616', bianco: '#e9e6e0', carne: '#c9a58c' };
export const WHOLE_SUITS = ['male_worksuit01'];

// un oggetto agganciato: posizione di ogni vertice dai tre vertici della pelle (e i loro pesi sulle ossa).
// Di un abito diviso tiene solo le isole di stoffa sopra o sotto la vita.
function fitItem(it: Item, b: ArrayBuffer, pos: Float32Array, skinI: Uint8Array, skinW: Uint8Array, waistY: number) {
  const v3 = new THREE.Vector3();
  const refs = new Uint16Array(b, it.refs, it.nv * 3), w = new Float32Array(b, it.w, it.nv * 3), off = new Float32Array(b, it.off, it.nv * 3);
    const sc = (ax: 'x' | 'y' | 'z', k: number) => {
      const s = it.scale[ax];
      if (!s) return 1;
      return Math.abs(pos[s[0] * 3 + k] - pos[s[1] * 3 + k]) / (s[2] * 0.1);
    };
    const sx = sc('x', 0) * 0.1, sy = sc('y', 1) * 0.1, sz = sc('z', 2) * 0.1;
    const pp = new Float32Array(it.nv * 3);
    const bw: Map<number, number>[] = [];
    for (let i = 0; i < it.nv; i++) {
      v3.set(0, 0, 0);
      const acc = new Map<number, number>();
      for (let k = 0; k < 3; k++) {
        const r = refs[i * 3 + k], ww = w[i * 3 + k];
        v3.x += pos[r * 3] * ww; v3.y += pos[r * 3 + 1] * ww; v3.z += pos[r * 3 + 2] * ww;
        if (ww > 0) for (let q = 0; q < 4; q++) { const bi = skinI[r * 4 + q], bwv = skinW[r * 4 + q] / 255 * ww; if (bwv > 0) acc.set(bi, (acc.get(bi) || 0) + bwv); }
      }
      pp[i * 3] = v3.x + off[i * 3] * sx; pp[i * 3 + 1] = v3.y + off[i * 3 + 1] * sy; pp[i * 3 + 2] = v3.z + off[i * 3 + 2] * sz;
      bw.push(acc);
    }
    // gli abiti stanno un filo sopra la pelle: niente pelle che affiora a colletto e spalle
    if (it.kind === 'abito') {
      const nn = smoothNormals(pp, new Uint16Array(b, it.vert, it.nr), new Uint32Array(b, it.idx, it.ni), it.nv, (r) => new Uint16Array(b, it.vert, it.nr)[r]);
      const vm = new Uint16Array(b, it.vert, it.nr);
      const done = new Uint8Array(it.nv);
      for (let r = 0; r < it.nr; r++) { const i = vm[r]; if (done[i]) continue; done[i] = 1; for (let k = 0; k < 3; k++) pp[i * 3 + k] += nn[r * 3 + k] * 0.004; }
    }
  const vm = new Uint16Array(b, it.vert, it.nr);
  let idx = new Uint32Array(b, it.idx, it.ni);
  if (it.part) {
    // isole della stoffa (collegate anche nella mappa UV): ognuna va sopra o sotto secondo il suo centro
    const par = new Int32Array(it.nr).map((_, i) => i);
    const find = (a: number): number => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    for (let t = 0; t < idx.length; t += 3) { const a = find(idx[t]); par[find(idx[t + 1])] = a; par[find(idx[t + 2])] = a; }
    const sum = new Map<number, number[]>();
    for (let r = 0; r < it.nr; r++) { const k = find(r), e = sum.get(k) || [0, 0, 0, 0]; for (let q = 0; q < 3; q++) e[q] += pp[vm[r] * 3 + q]; e[3]++; sum.set(k, e); }
    // le isole piccole (bottoni, rivetti, passanti) seguono l'isola grande più vicina, non la propria altezza:
    // su un corpo diverso il bottone dei jeans può finire sopra la vita e restare sospeso sulla maglia
    const below = new Map<number, boolean>(), big: [number[], boolean][] = [];
    for (const [k, e] of sum) { const c = [e[0] / e[3], e[1] / e[3], e[2] / e[3]]; below.set(k, c[1] < waistY); if (e[3] >= it.nr * 0.02) big.push([c, c[1] < waistY]); }
    for (const [k, e] of sum) {
      if (e[3] >= it.nr * 0.02 || !big.length) continue;
      const c = [e[0] / e[3], e[1] / e[3], e[2] / e[3]];
      let bd = Infinity;
      for (const [g, bl] of big) { const d = (g[0] - c[0]) ** 2 + (g[1] - c[1]) ** 2 + (g[2] - c[2]) ** 2; if (d < bd) { bd = d; below.set(k, bl); } }
    }
    const keep: number[] = [];
    for (let t = 0; t < idx.length; t += 3) if (below.get(find(idx[t])) === (it.part === 'bottom')) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    idx = new Uint32Array(keep);
    // la parte di sopra un poco più fuori: la camicia sta sopra la cintura dei pantaloni
    if (it.part === 'top') {
      const nn = smoothNormals(pp, vm, idx, it.nv, (r) => vm[r]);
      const done = new Uint8Array(it.nv);
      for (let r = 0; r < it.nr; r++) { const i = vm[r]; if (done[i]) continue; done[i] = 1; for (let k = 0; k < 3; k++) pp[i * 3 + k] += nn[r * 3 + k] * 0.003; }
    }
  }
  const usedM = new Uint8Array(it.nv);
  for (let t = 0; t < idx.length; t++) usedM[vm[idx[t]]] = 1;
  const used: number[] = [];
  usedM.forEach((u, i) => { if (u) used.push(i); });
  // pelle coperta: a meno di 2 cm da un vertice della parte scelta
  let near: ((x: number, y: number, z: number) => boolean) | null = null;
  if (it.part) {
    const C = 0.02, grid = new Map<string, number[]>();
    const key = (a: number, c: number, d: number) => `${a},${c},${d}`;
    // la griglia si fa alla prima domanda: l'orlo della maglia può essere stato allungato nel frattempo
    const fill = () => { for (const i of used) { const k = key(Math.floor(pp[i * 3] / C), Math.floor(pp[i * 3 + 1] / C), Math.floor(pp[i * 3 + 2] / C)); const l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]); } };
    // vicino all'orlo aperto (vita dei pantaloni, fondo della maglia) la pelle resta, altrimenti si
    // aprono buchi: è coperta solo se la stoffa continua oltre di lei (sopra per i pantaloni, sotto per la maglia)
    const up = it.part === 'bottom' ? 1 : -1;
    near = (x, y, z) => {
      if (!grid.size) fill();
      const cx = Math.floor(x / C), cy = Math.floor(y / C), cz = Math.floor(z / C);
      let close = false, beyond = false;
      for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) for (let d = -2; d <= 2; d++) {
        const l = grid.get(key(cx + a, cy + c, cz + d));
        if (l) for (const i of l) {
          const dx = pp[i * 3] - x, dy = pp[i * 3 + 1] - y, dz = pp[i * 3 + 2] - z, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < C * C) close = true;
          if (d2 < 0.035 * 0.035 && dy * up > 0.012) beyond = true;
          if (close && beyond) return true;
        }
      }
      return false;
    };
  }
  return { pp, bw, idx, used, near };
}

export async function buildHuman(look: Look, gender: 'uomo' | 'donna', skin: string): Promise<THREE.Group> {
  await loadBase();
  const m = man!;
  const pos = await morph(look, gender);
  // scheletro dalle posizioni dei giunti
  const mean = (list: number[]) => { const v = new THREE.Vector3(); for (const i of list) v.x += pos[i * 3], v.y += pos[i * 3 + 1], v.z += pos[i * 3 + 2]; return v.multiplyScalar(1 / list.length); };
  const heads = m.bones.map((b) => mean(b.head));
  const bones = m.bones.map((b, i) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.position.copy(heads[i]).sub(b.parent >= 0 ? heads[b.parent] : new THREE.Vector3());
    return bone;
  });
  m.bones.forEach((b, i) => { if (b.parent >= 0) bones[b.parent].add(bones[i]); });
  const root = bones[0];
  const group = new THREE.Group();
  group.add(root);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones); // inverse calcolate con le ossa già al loro posto

  const skinI = new Uint8Array(baseBuf!, m.skinIdx, m.nv * 4), skinW = new Uint8Array(baseBuf!, m.skinW, m.nv * 4);
  const skinned = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
    const s = new THREE.SkinnedMesh(geo, mat);
    s.name = name;
    group.add(s);
    s.bind(skeleton, new THREE.Matrix4());
    s.castShadow = true; s.receiveShadow = true; s.frustumCulled = false;
    return s;
  };

  const armBones = new Set(m.bones.map((x, i) => (/arm|wrist|finger|metacarpal|clavicle|shoulder|hand/.test(x.name) ? i : -1)).filter((i) => i >= 0));
  type Fit = ReturnType<typeof fitItem>;
  const extendHem = (top: Fit, bot: Fit) => {
    const sp = heads[m.bones.findIndex((b) => b.name === 'spine04')], cx = sp.x, cz = sp.z;
    const S = 48, L = 0.1, MAXD = 0.09;
    const armW = (f: Fit, i: number) => { let w = 0; for (const [bi, ww] of f.bw[i]) if (armBones.has(bi)) w += ww; return w; };
    const ang = (x: number, z: number) => ((Math.atan2(z - cz, x - cx) / (2 * Math.PI) + 1) % 1) * S;
    const hem = new Array(S).fill(Infinity), btop = new Array(S).fill(-Infinity);
    const torso = top.used.filter((i) => armW(top, i) < 0.3);
    for (const i of torso) { const s = Math.floor(ang(top.pp[i * 3], top.pp[i * 3 + 2])); hem[s] = Math.min(hem[s], top.pp[i * 3 + 1]); }
    for (const i of bot.used) { const s = Math.floor(ang(bot.pp[i * 3], bot.pp[i * 3 + 2])); btop[s] = Math.max(btop[s], bot.pp[i * 3 + 1]); }
    let dy = hem.map((h, s) => (isFinite(h) && isFinite(btop[s]) ? Math.min(MAXD, Math.max(0, h - (btop[s] - 0.03))) : 0));
    for (let k = 0; k < 2; k++) dy = dy.map((d, s) => Math.max(d, (dy[(s + S - 1) % S] + dy[(s + 1) % S]) / 2));
    if (Math.max(...dy) < 0.003) return;
    const at = (arr: number[], a: number) => { const s0 = Math.floor(a) % S, t = a - Math.floor(a); return arr[s0] * (1 - t) + arr[(s0 + 1) % S] * t; };
    // quanto è largo il corpo (e i pantaloni) a ogni altezza e angolo: la stoffa allungata ci resta sopra
    const RS = 64, YB = 0.01, rad = new Map<number, number>();
    const put = (x: number, y: number, z: number, add: number) => { const k = Math.floor(y / YB) * RS + Math.floor(ang(x, z) / S * RS), r = Math.hypot(x - cx, z - cz) + add; if (r > (rad.get(k) ?? 0)) rad.set(k, r); };
    const ylo = Math.min(...hem.filter(isFinite)) - MAXD - 0.02, yhi = waistY + 0.05;
    for (let i = 0; i < m.nv; i++) {
      const y = pos[i * 3 + 1]; if (y < ylo || y > yhi) continue;
      let w = 0; for (let q = 0; q < 4; q++) if (armBones.has(skinI[i * 4 + q])) w += skinW[i * 4 + q] / 255;
      if (w < 0.3) put(pos[i * 3], y, pos[i * 3 + 2], 0.011);
    }
    for (const i of bot.used) put(bot.pp[i * 3], bot.pp[i * 3 + 1], bot.pp[i * 3 + 2], 0.005);
    const need = (a: number, y: number) => { let r = 0; const yb = Math.floor(y / YB), ab = Math.floor(a / S * RS); for (let dy2 = -1; dy2 <= 1; dy2++) for (let da = -1; da <= 1; da++) r = Math.max(r, rad.get((yb + dy2) * RS + ((ab + da + RS) % RS)) ?? 0); return r; };
    for (const i of torso) {
      const x = top.pp[i * 3], y = top.pp[i * 3 + 1], z = top.pp[i * 3 + 2], a = ang(x, z);
      const h = y - at(hem.map((v) => (isFinite(v) ? v : y)), a);
      if (h > L) continue;
      const ny = y - at(dy, a) * (1 - Math.max(0, h) / L);
      const r0 = Math.hypot(x - cx, z - cz), r1 = Math.max(r0, need(a, ny));
      top.pp[i * 3] = cx + (x - cx) * r1 / r0; top.pp[i * 3 + 1] = ny; top.pp[i * 3 + 2] = cz + (z - cz) * r1 / r0;
    }
  };
  // oggetti scelti
  const want: Item[] = [];
  const pick = (kind: string, name: string) => { const it = m.items.find((x) => x.kind === kind && x.name === name); if (it) want.push(it); };
  pick('occhi', 'high-poly'); pick('ciglia', 'eyelashes01'); pick('denti', 'teeth_base');
  if (look.brows) pick('sopracciglia', look.brows);
  if (look.hair) pick('capelli', look.hair);
  // abiti: sopra e sotto possono venire da abiti diversi; la salopette è un pezzo unico
  const topId = look.top ?? look.outfit ?? '', botId = look.bottom ?? look.outfit ?? '';
  const pickPart = (name: string, part?: 'top' | 'bottom') => { const it = m.items.find((x) => x.kind === 'abito' && x.name === name); if (it) want.push(part ? { ...it, part } : it); };
  if (topId && (WHOLE_SUITS.includes(topId) || topId === botId)) pickPart(topId);
  else { if (topId) pickPart(topId, 'top'); if (botId && !WHOLE_SUITS.includes(botId)) pickPart(botId, 'bottom'); }
  if (look.shoes) pick('scarpe', look.shoes);
  if (look.hat) pick('cappello', look.hat);
  const ord = (k: string) => (k === 'cappello' ? 0 : k === 'scarpe' ? 2 : 1); // cappello prima dei capelli, orlo dei pantaloni prima delle scarpe
  want.sort((a, b) => ord(a.kind) - ord(b.kind));
  const bins = await Promise.all(want.map(itemBin));
  let hemY = Infinity, hatY = Infinity;
  const waistY = heads[m.bones.findIndex((b) => b.name === 'spine04')].y;
  const fits = want.map((it, n) => fitItem(it, bins[n], pos, skinI, skinW, waistY));
  {
    // maglia di un abito e pantaloni di un altro: se tra i due resta pelle, l'orlo della maglia scende a coprirla
    // (il top sportivo resta corto: lì la pancia scoperta è voluta)
    const ti = want.findIndex((x) => x.part === 'top'), bj = want.findIndex((x) => x.part === 'bottom');
    if (ti >= 0 && bj >= 0 && want[ti].name !== 'female_sportsuit01') extendHem(fits[ti], fits[bj]);
  }

  // pelle: niente sotto gli abiti (non buca il tessuto); di un abito diviso, solo sotto la parte scelta
  const hidden = new Uint8Array(m.nv);
  want.forEach((it, n) => {
    const f = fits[n];
    for (const [a, b] of it.del || []) for (let i = a; i <= b; i++) if (!f.near || f.near(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])) hidden[i] = 1;
  });
  const rv = new Uint16Array(baseBuf!, m.bodyVert, m.nr);
  const allIdx = new Uint32Array(baseBuf!, m.bodyIdx, m.ni);
  const keep: number[] = [];
  for (let t = 0; t < allIdx.length; t += 3) if (!hidden[rv[allIdx[t]]] && !hidden[rv[allIdx[t + 1]]] && !hidden[rv[allIdx[t + 2]]]) keep.push(allIdx[t], allIdx[t + 1], allIdx[t + 2]);
  {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(m.nr * 3), si = new Uint16Array(m.nr * 4), sw = new Float32Array(m.nr * 4);
    for (let r = 0; r < m.nr; r++) {
      const i = rv[r];
      p[r * 3] = pos[i * 3]; p[r * 3 + 1] = pos[i * 3 + 1]; p[r * 3 + 2] = pos[i * 3 + 2];
      for (let k = 0; k < 4; k++) { si[r * 4 + k] = skinI[i * 4 + k]; sw[r * 4 + k] = skinW[i * 4 + k] / 255; }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(smoothNormals(pos, rv, allIdx, m.nv, (r) => rv[r]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(baseBuf!, m.bodyUV, m.nr * 2).slice(), 2));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geo.setIndex(keep);
    const tone = ['chiara', 'media', 'scura'].includes(skin) ? skin : 'media';
    const ageK = look.age < 0.3 ? 'young' : look.age < 0.65 ? 'middleage' : 'old';
    const skinFile = m.skins[`${gender}-${tone}-${ageK}`];
    const L = look.skinLight || 0;
    const mat = MAT({ roughness: 0.52, color: new THREE.Color().setScalar(L >= 0 ? 1 : 1 + L * 0.5) });
    if (L > 0) mat.color.setRGB(1 + L * 0.35, 1 + L * 0.33, 1 + L * 0.3);
    mat.map = await loadTex(skinFile);
    skinned(geo, mat, 'pelle');
  }

  // intimo: una fascia aderente ricavata dalla pelle stessa (slip; per la donna anche la fascia sul seno),
  // solo dove non c'è già un abito
  if (look.under) {
    const hasTop = want.some((x) => x.kind === 'abito' && x.part !== 'bottom');
    const hasBot = want.some((x) => x.kind === 'abito' && x.part !== 'top');
    const bi = (n: string) => m.bones.findIndex((x) => x.name === n);
    const arm = new Set(m.bones.map((x, i) => (/arm|wrist|finger|metacarpal|clavicle|shoulder/.test(x.name) ? i : -1)).filter((i) => i >= 0));
    const breast = new Set([bi('breast.L'), bi('breast.R')]);
    const dom = (i: number) => { let best = 0, bw = -1; for (let q = 0; q < 4; q++) if (skinW[i * 4 + q] > bw) { bw = skinW[i * 4 + q]; best = skinI[i * 4 + q]; } return best; };
    const hipY = heads[bi('upperleg01.L')].y, waist = heads[bi('spine04')].y, H = heads[bi('head')].y - hipY;
    const bands: [number, number][] = [];
    if (!hasBot) bands.push([hipY - 0.1 * H, waist - 0.02 * H]);
    if (!hasTop && gender === 'donna') {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < m.nv; i++) { let w = 0; for (let q = 0; q < 4; q++) if (breast.has(skinI[i * 4 + q])) w += skinW[i * 4 + q] / 255; if (w > 0.35) { lo = Math.min(lo, pos[i * 3 + 1]); hi = Math.max(hi, pos[i * 3 + 1]); } }
      if (lo < hi) bands.push([lo - 0.012 * H, lo + (hi - lo) * 0.7]);
    }
    // triangoli della pelle tagliati sui bordi delle fasce: orli dritti, non a scalini
    const nn = smoothNormals(pos, rv, allIdx, m.nv, (r) => rv[r]);
    type V = { p: number[]; n: number[]; y: number; r: number };
    const vert = (r: number): V => { const i = rv[r]; return { p: [0, 1, 2].map((k) => pos[i * 3 + k] + nn[r * 3 + k] * 0.0025), n: [nn[r * 3], nn[r * 3 + 1], nn[r * 3 + 2]], y: pos[i * 3 + 1], r }; };
    const lerp = (a: V, b: V, t: number): V => ({ p: a.p.map((x, k) => x + (b.p[k] - x) * t), n: a.n.map((x, k) => x + (b.n[k] - x) * t), y: a.y + (b.y - a.y) * t, r: t < 0.5 ? a.r : b.r });
    const clip = (poly: V[], keepIn: (v: V) => number) => {
      const out: V[] = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length], da = keepIn(a), db = keepIn(b);
        if (da >= 0) out.push(a);
        if ((da >= 0) !== (db >= 0)) out.push(lerp(a, b, da / (da - db)));
      }
      return out;
    };
    const P: number[] = [], N: number[] = [], SI: number[] = [], SW: number[] = [];
    for (let t = 0; t < keep.length; t += 3) {
      const tri = [keep[t], keep[t + 1], keep[t + 2]];
      if (tri.some((r) => hidden[rv[r]] || arm.has(dom(rv[r])))) continue;
      for (const [a, c] of bands) {
        const ys = tri.map((r) => pos[rv[r] * 3 + 1]);
        if (Math.max(...ys) < a || Math.min(...ys) > c) continue;
        let poly = clip(tri.map(vert), (v) => v.y - a);
        if (poly.length >= 3) poly = clip(poly, (v) => c - v.y);
        for (let k = 1; k + 1 < poly.length; k++) for (const v of [poly[0], poly[k], poly[k + 1]]) {
          P.push(...v.p); N.push(...v.n);
          const i = rv[v.r];
          for (let q = 0; q < 4; q++) { SI.push(skinI[i * 4 + q]); SW.push(skinW[i * 4 + q] / 255); }
        }
      }
    }
    if (P.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
      skinned(geo, MAT({ color: new THREE.Color(UNDER_COLORS[look.under] || UNDER_COLORS.nero), roughness: 0.68, side: THREE.DoubleSide }), 'intimo');
    }
  }

  // oggetti agganciati: ogni vertice segue tre vertici della pelle (con il loro peso sulle ossa)
  for (let n = 0; n < want.length; n++) {
    const it = want[n], b = bins[n];
    const { pp, bw } = fits[n];
    if (it.kind === 'abito') for (const i of fits[n].used) hemY = Math.min(hemY, pp[i * 3 + 1]);
    const vmap = new Uint16Array(b, it.vert, it.nr);
    let idx = fits[n].idx;
    // calze e gambali dentro i pantaloni lunghi: si tolgono, altrimenti bucano l'orlo
    if (it.kind === 'scarpe' && hemY < 0.25) {
      const keep: number[] = [];
      for (let t = 0; t < idx.length; t += 3) {
        const lo = Math.min(pp[vmap[idx[t]] * 3 + 1], pp[vmap[idx[t + 1]] * 3 + 1], pp[vmap[idx[t + 2]] * 3 + 1]);
        if (lo < hemY + 0.015) keep.push(idx[t], idx[t + 1], idx[t + 2]);
      }
      idx = new Uint32Array(keep);
    }
    if (it.kind === 'cappello') for (let i = 0; i < it.nv; i++) hatY = Math.min(hatY, pp[i * 3 + 1]);
    // sotto il cappello i capelli non si vedono: si tolgono, altrimenti bucano la cupola
    if (it.kind === 'capelli' && hatY < Infinity) {
      const keep: number[] = [];
      for (let t = 0; t < idx.length; t += 3) {
        const lo = Math.min(pp[vmap[idx[t]] * 3 + 1], pp[vmap[idx[t + 1]] * 3 + 1], pp[vmap[idx[t + 2]] * 3 + 1]);
        if (lo < hatY + 0.012) keep.push(idx[t], idx[t + 1], idx[t + 2]);
      }
      idx = new Uint32Array(keep);
    }
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(it.nr * 3), si = new Uint16Array(it.nr * 4), sw = new Float32Array(it.nr * 4);
    const top = bw.map((acc) => { const l = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4); const t = l.reduce((s, e) => s + e[1], 0) || 1; return l.map(([bi, x]) => [bi, x / t] as [number, number]); });
    for (let r = 0; r < it.nr; r++) {
      const i = vmap[r];
      p[r * 3] = pp[i * 3]; p[r * 3 + 1] = pp[i * 3 + 1]; p[r * 3 + 2] = pp[i * 3 + 2];
      top[i].forEach(([bi, x], k) => { si[r * 4 + k] = bi; sw[r * 4 + k] = x; });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(smoothNormals(pp, vmap, idx, it.nv, (r) => vmap[r]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b, it.uv, it.nr * 2).slice(), 2));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geo.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
    let mat: THREE.MeshStandardMaterial;
    if (it.kind === 'capelli') {
      mat = MAT({ color: new THREE.Color(look.hairColor), roughness: 0.62, alphaTest: 0.45, side: THREE.DoubleSide });
      mat.map = await loadTex(it.map!);
    } else if (it.kind === 'sopracciglia' || it.kind === 'ciglia') {
      mat = MAT({ color: new THREE.Color(it.kind === 'ciglia' ? '#ffffff' : look.hairColor).lerp(new THREE.Color('#ffffff'), 0.35), alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.7 });
      if (it.map) mat.map = await loadTex(it.map);
    } else if (it.kind === 'occhi') {
      mat = MAT({ roughness: 0.12, alphaTest: 0.5 });
      mat.map = await loadTex(m.eyes[look.eyes] || m.eyes.brown);
    } else if (it.kind === 'abito') {
      // due facce: dentro il colletto o le maniche si vede la stoffa, non il vuoto
      mat = MAT({ roughness: 0.82, alphaTest: 0.5, side: THREE.DoubleSide });
      if (it.map) mat.map = await recolor(it.map, look.outfitHue || 0, look.outfitLight || 0);
      if (it.normal) { mat.normalMap = await loadTex(it.normal, false); mat.normalScale.set(0.8, 0.8); }
    } else {
      mat = MAT({ roughness: it.kind === 'denti' ? 0.35 : 0.6, alphaTest: 0.5 });
      if (it.map) mat.map = await loadTex(it.map);
      if (it.normal) mat.normalMap = await loadTex(it.normal, false);
    }
    skinned(geo, mat, it.kind);
  }
  group.userData.human = true;
  return group;
}
