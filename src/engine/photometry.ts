// Fotometria, temperatura colore, gel, diffusioni e libreria di apparecchi generici.
import * as THREE from 'three';

export type LightKind = 'spot' | 'area' | 'point';

export interface Fixture {
  id: string;
  name: string;          // nome mostrato (lessico da set)
  family: string;        // Fresnel, Pannello, Lampadina, Tubo, HMI...
  kind: LightKind;
  watts: number;         // potenza elettrica nominale
  lumens: number;        // flusso luminoso in uscita (lm)
  kelvinFixed?: number;  // temperatura fissa (tungsteno, HMI)
  kelvinRange?: [number, number];
  beamRange?: [number, number]; // angolo di fascio (spot/flood) in gradi
  size?: [number, number];      // dimensioni della superficie emittente in metri (area)
  radius?: number;              // raggio della sorgente (point/spot) in metri
  cri: number;
}

export const FIXTURES: Fixture[] = [
  { id: 'fresnel-led-60', name: 'Fresnel LED 60W', family: 'Fresnel', kind: 'spot', watts: 60, lumens: 5200, kelvinRange: [2700, 6500], beamRange: [15, 50], radius: 0.04, cri: 96 },
  { id: 'fresnel-led-300', name: 'Fresnel LED 300W', family: 'Fresnel', kind: 'spot', watts: 300, lumens: 24000, kelvinRange: [2700, 6500], beamRange: [14, 55], radius: 0.08, cri: 96 },
  { id: 'fresnel-tung-650', name: 'Fresnel tungsteno 650W', family: 'Fresnel', kind: 'spot', watts: 650, lumens: 16000, kelvinFixed: 3200, beamRange: [15, 60], radius: 0.06, cri: 100 },
  { id: 'fresnel-tung-2k', name: 'Fresnel tungsteno 2K', family: 'Fresnel', kind: 'spot', watts: 2000, lumens: 52000, kelvinFixed: 3200, beamRange: [12, 55], radius: 0.1, cri: 100 },
  { id: 'hmi-1200', name: 'HMI 1.2K', family: 'HMI', kind: 'spot', watts: 1200, lumens: 108000, kelvinFixed: 5600, beamRange: [12, 60], radius: 0.1, cri: 92 },
  { id: 'hmi-4k', name: 'HMI 4K PAR', family: 'HMI', kind: 'spot', watts: 4000, lumens: 380000, kelvinFixed: 5600, beamRange: [8, 50], radius: 0.18, cri: 92 },
  { id: 'panel-1x1', name: 'Pannello LED 30×30', family: 'Pannello', kind: 'area', watts: 100, lumens: 7000, kelvinRange: [2700, 10000], size: [0.3, 0.3], cri: 96 },
  { id: 'panel-120x60', name: 'Pannello LED 120×60', family: 'Pannello', kind: 'area', watts: 450, lumens: 26000, kelvinRange: [2700, 10000], size: [1.2, 0.6], cri: 97 },
  { id: 'softbox-120', name: 'Softbox 120 cm', family: 'Pannello', kind: 'area', watts: 600, lumens: 38000, kelvinRange: [2700, 6500], size: [1.2, 1.2], cri: 96 },
  { id: 'tube-120', name: 'Tubo LED 120 cm', family: 'Tubo', kind: 'area', watts: 50, lumens: 2400, kelvinRange: [2000, 10000], size: [1.2, 0.04], cri: 95 },
  { id: 'tube-60', name: 'Tubo LED 60 cm', family: 'Tubo', kind: 'area', watts: 25, lumens: 1200, kelvinRange: [2000, 10000], size: [0.6, 0.04], cri: 95 },
  { id: 'bulb-60', name: 'Lampadina 60W', family: 'Lampadina', kind: 'point', watts: 60, lumens: 800, kelvinRange: [2200, 6500], radius: 0.03, cri: 95 },
  { id: 'bulb-150', name: 'Lampadina 150W', family: 'Lampadina', kind: 'point', watts: 150, lumens: 2200, kelvinRange: [2200, 6500], radius: 0.04, cri: 95 },
  { id: 'lantern', name: 'Pallone cinese', family: 'Lampadina', kind: 'point', watts: 500, lumens: 11000, kelvinFixed: 3200, radius: 0.3, cri: 100 },
];

// Apparecchi usati per le luci "lette" dalla foto
export const READ_FIXTURES = {
  practical: 'bulb-60',
  ceiling: 'bulb-150',
  window: 'panel-120x60',
  generic: 'softbox-120',
};

export function fixtureById(id: string): Fixture {
  return FIXTURES.find((f) => f.id === id) || FIXTURES[0];
}

export interface Gel { id: string; name: string; mired: number; tint: [number, number, number]; transmission: number }
// mired > 0 scalda (CTO), < 0 raffredda (CTB). tint moltiplica il colore (verde/magenta e colori).
export const GELS: Gel[] = [
  { id: 'none', name: 'Nessuna', mired: 0, tint: [1, 1, 1], transmission: 1 },
  { id: 'cto-full', name: 'CTO', mired: 159, tint: [1, 1, 1], transmission: 0.55 },
  { id: 'cto-half', name: '½ CTO', mired: 81, tint: [1, 1, 1], transmission: 0.71 },
  { id: 'cto-quarter', name: '¼ CTO', mired: 42, tint: [1, 1, 1], transmission: 0.81 },
  { id: 'ctb-full', name: 'CTB', mired: -131, tint: [1, 1, 1], transmission: 0.36 },
  { id: 'ctb-half', name: '½ CTB', mired: -68, tint: [1, 1, 1], transmission: 0.52 },
  { id: 'ctb-quarter', name: '¼ CTB', mired: -30, tint: [1, 1, 1], transmission: 0.74 },
  { id: 'plus-green', name: 'Plus Green', mired: 0, tint: [0.86, 1, 0.82], transmission: 0.76 },
  { id: 'minus-green', name: 'Minus Green', mired: 0, tint: [1, 0.8, 0.95], transmission: 0.62 },
  { id: 'red', name: 'Rosso', mired: 0, tint: [1, 0.08, 0.06], transmission: 0.12 },
  { id: 'blue', name: 'Blu', mired: 0, tint: [0.1, 0.3, 1], transmission: 0.1 },
  { id: 'teal', name: 'Teal', mired: 0, tint: [0.2, 0.85, 0.8], transmission: 0.3 },
  { id: 'amber', name: 'Ambra', mired: 0, tint: [1, 0.6, 0.15], transmission: 0.45 },
  { id: 'magenta', name: 'Magenta', mired: 0, tint: [1, 0.25, 0.8], transmission: 0.25 },
];

export interface Diffusion { id: string; name: string; transmission: number; spread: number }
// spread: quanto allarga il fascio / ammorbidisce (0-1)
export const DIFFUSIONS: Diffusion[] = [
  { id: 'none', name: 'Nessuna', transmission: 1, spread: 0 },
  { id: 'opal', name: 'Opal', transmission: 0.82, spread: 0.2 },
  { id: 'quarter-grid', name: '¼ Grid', transmission: 0.7, spread: 0.4 },
  { id: 'half-grid', name: '½ Grid', transmission: 0.55, spread: 0.6 },
  { id: 'full-grid', name: 'Full Grid', transmission: 0.4, spread: 0.85 },
  { id: 'silk', name: 'Silk', transmission: 0.5, spread: 1 },
];

export const gelById = (id: string) => GELS.find((g) => g.id === id) || GELS[0];
export const diffusionById = (id: string) => DIFFUSIONS.find((d) => d.id === id) || DIFFUSIONS[0];

// Temperatura colore -> RGB lineare (approssimazione di Planck, normalizzata)
export function kelvinToRGB(k: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, k)) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v: number) => {
    const s = Math.min(255, Math.max(0, v)) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const rgb: [number, number, number] = [c(r), c(g), c(b)];
  // normalizza la luminanza a 1 così l'intensità resta fotometrica
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return [rgb[0] / lum, rgb[1] / lum, rgb[2] / lum];
}

// Stima della temperatura colore da un RGB lineare (ricerca per minimo errore di cromaticità)
export function rgbToKelvin(r: number, g: number, b: number): number {
  const s = r + g + b || 1;
  const cr = r / s, cb = b / s;
  let best = 4000, bestErr = Infinity;
  for (let k = 1800; k <= 12000; k += 50) {
    const [kr, kg, kb] = kelvinToRGB(k);
    const ks = kr + kg + kb;
    const err = (kr / ks - cr) ** 2 + (kb / ks - cb) ** 2;
    if (err < bestErr) { bestErr = err; best = k; }
  }
  return best;
}

export function lightColor(kelvin: number, gelId: string): THREE.Color {
  const gel = gelById(gelId);
  let k = kelvin;
  if (gel.mired !== 0) k = 1e6 / (1e6 / kelvin + gel.mired);
  const [r, g, b] = kelvinToRGB(k);
  const tr = r * gel.tint[0], tg = g * gel.tint[1], tb = b * gel.tint[2];
  const lum = 0.2126 * tr + 0.7152 * tg + 0.0722 * tb || 1;
  return new THREE.Color(tr / lum, tg / lum, tb / lum);
}

export function effectiveKelvin(kelvin: number, gelId: string) {
  const gel = gelById(gelId);
  return gel.mired !== 0 ? Math.round(1e6 / (1e6 / kelvin + gel.mired)) : kelvin;
}

// Flusso effettivo dopo dimmer, gel e diffusione
export function effectiveLumens(L: LightState, skyLux = 10000) {
  const fx = fixtureById(L.fixtureId);
  const base = L.origin === 'finestra' ? skyLux * L.size[0] * L.size[1] * 0.5 : fx.lumens;
  return base * Math.pow(2, L.stops) * gelById(L.gel).transmission * diffusionById(L.diffusion).transmission;
}

// Intensità in candela al centro del fascio per uno spot
export function spotCandela(lumens: number, beamDeg: number) {
  const half = THREE.MathUtils.degToRad(beamDeg) / 2;
  // ~70% del flusso nel fascio utile
  return (0.7 * lumens) / (2 * Math.PI * (1 - Math.cos(half)));
}

export interface LightState {
  id: string;
  name: string;
  fixtureId: string;
  position: [number, number, number];
  target: [number, number, number];
  stops: number;         // regolazione in stop rispetto al pieno (0 = 100%)
  kelvin: number;
  gel: string;
  diffusion: string;
  beam: number;          // gradi (spot)
  softness: number;      // 0-1 morbidezza (dimensione apparente della sorgente)
  size: [number, number];// dimensioni (area)
  barnDoors: { top: number; bottom: number; left: number; right: number }; // gradi di chiusura 0-90
  on: boolean;
  origin: 'letta' | 'aggiunta' | 'finestra';
  attached?: string;     // id dell'arredo (lampada) a cui appartiene
  windowId?: string;     // id dell'apertura (finestre della stanza costruita)
}

let _id = 0;
export const newId = (p = 'l') => `${p}${Date.now().toString(36)}${(_id++).toString(36)}`;

export function makeLight(fixtureId: string, position: [number, number, number], target: [number, number, number], extra: Partial<LightState> = {}): LightState {
  const fx = fixtureById(fixtureId);
  return {
    id: newId(),
    name: fx.name,
    fixtureId,
    position,
    target,
    stops: 0,
    kelvin: fx.kelvinFixed || (fx.family === 'Lampadina' ? 2700 : 5600),
    gel: 'none',
    diffusion: 'none',
    beam: fx.beamRange ? Math.round((fx.beamRange[0] + fx.beamRange[1]) / 2) : 60,
    softness: 0.3,
    size: fx.size ? [...fx.size] as [number, number] : [0.3, 0.3],
    barnDoors: { top: 0, bottom: 0, left: 0, right: 0 },
    on: true,
    origin: 'aggiunta',
    ...extra,
  };
}

// Illuminamento (lux) di una luce su un punto con normale n (senza occlusione)
export function illuminanceAt(L: LightState, p: THREE.Vector3, n: THREE.Vector3, skyLux = 10000): number {
  if (!L.on) return 0;
  const fx = fixtureById(L.fixtureId);
  const lm = effectiveLumens(L, skyLux);
  const pos = new THREE.Vector3(...L.position);
  const toL = pos.clone().sub(p);
  const d2 = Math.max(toL.lengthSq(), 0.01);
  toL.normalize();
  const cosI = Math.max(0, toL.dot(n));
  if (cosI <= 0) return 0;
  const aim = new THREE.Vector3(...L.target).sub(pos).normalize();
  const cosE = -toL.dot(aim);
  if (fx.kind === 'point') return (lm / (4 * Math.PI)) * cosI / d2;
  if (fx.kind === 'area' || L.origin === 'finestra') {
    if (cosE <= 0) return 0;
    return (lm / Math.PI) * cosE * cosI / d2; // emettitore lambertiano
  }
  const { beam, field } = spotAngles(L);
  const ang = Math.acos(Math.min(1, Math.max(-1, cosE)));
  const halfField = THREE.MathUtils.degToRad(field) / 2;
  const halfBeam = THREE.MathUtils.degToRad(beam) / 2;
  if (ang > halfField) return 0;
  let f = 1;
  if (ang > halfBeam) f = 1 - (ang - halfBeam) / (halfField - halfBeam);
  return spotCandela(lm, beam) * f * cosI / d2;
}

export function spotAngles(L: LightState) {
  const dif = diffusionById(L.diffusion);
  const beam = Math.min(120, L.beam * (1 + dif.spread * 0.8));
  const field = Math.min(150, beam * (1.35 + dif.spread * 0.6 + L.softness * 0.3));
  return { beam, field };
}

// --- Esposizione ---
// EV100 dalle impostazioni camera
export function ev100(fStop: number, shutter: number, iso: number) {
  return Math.log2((fStop * fStop) / shutter) - Math.log2(iso / 100);
}
// fattore di esposizione per la radianza in nits (Frostbite/Lagarde)
export function exposureFromEV100(ev: number) {
  return 1 / (1.2 * Math.pow(2, ev));
}
// diaframma consigliato per un esposimetro a luce incidente (C = 250)
export function fStopForLux(lux: number, shutter: number, iso: number) {
  return Math.sqrt((lux * shutter * iso) / 250);
}

export const ISO_VALUES = [100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1280, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800];
export const FSTOPS = [1, 1.2, 1.4, 1.8, 2, 2.2, 2.8, 3.2, 4, 4.5, 5.6, 6.3, 8, 9, 11, 13, 16, 22];
export const SHUTTERS = [1 / 25, 1 / 30, 1 / 48, 1 / 50, 1 / 60, 1 / 96, 1 / 100, 1 / 120, 1 / 250, 1 / 500, 1 / 1000];
export const FOCALS = [14, 18, 21, 24, 28, 32, 35, 40, 50, 65, 75, 85, 100, 135];
export const SENSORS = [
  { id: 's35', name: 'Super 35', width: 24.89, height: 18.66 },
  { id: 'ff', name: 'Full Frame', width: 36, height: 24 },
  { id: 'lf', name: 'Large Format', width: 36.7, height: 25.54 },
  { id: 'm43', name: 'Micro 4/3', width: 17.3, height: 13 },
  { id: '65', name: '65 mm', width: 54.12, height: 25.58 },
];
export const ASPECTS = [
  { id: 'free', name: 'Intera', ratio: 0 },
  { id: '1.78', name: '16:9', ratio: 16 / 9 },
  { id: '1.85', name: '1.85', ratio: 1.85 },
  { id: '2.39', name: '2.39', ratio: 2.39 },
  { id: '1.33', name: '4:3', ratio: 4 / 3 },
  { id: '0.56', name: '9:16', ratio: 9 / 16 },
];

export const fmtShutter = (s: number) => `1/${Math.round(1 / s)}`;
export const fmtStop = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, ''));
export function nearestStop(n: number) {
  return FSTOPS.reduce((a, b) => (Math.abs(Math.log2(b / n)) < Math.abs(Math.log2(a / n)) ? b : a));
}
