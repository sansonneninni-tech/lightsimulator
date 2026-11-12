// Stanza costruita a mano: modelli di partenza, modifica della stanza, arredi e aperture.
import * as THREE from 'three';
import { useStore, defaultCam } from './store';
import { eng } from './engineRef';
import { RoomSpec, Opening, WallId, fitOpening, windowInfos, wallFrame, OPENING_KINDS, roomBounds } from './engine/room';
import { FurnitureState, furnitureKind, footprint, lampWorld, FURNITURE } from './engine/furniture';
import { LightState, makeLight, newId, illuminanceAt } from './engine/photometry';
import { defaultSun, sunAngles } from './engine/sun';
import { PersonState, poseJoints } from './engine/mannequin';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type F = [string, number, number, number, string?, number?]; // tipo, x, z, rotazione, finitura, quota

export interface Template {
  id: string;
  name: string;
  room: Omit<RoomSpec, 'openings'> & { openings: Omit<Opening, 'id'>[] };
  furniture: F[];
  people?: { pose: PersonState['pose']; x: number; z: number; rot: number }[];
  lights?: { type: string; pos: [number, number, number]; target: [number, number, number] }[];
  hour?: number;
}

const win = (wall: WallId, offset: number, width = 1.2, height = 1.4, sill = 0.9): Omit<Opening, 'id'> => ({ kind: 'finestra', wall, offset, width, height, sill });
const french = (wall: WallId, offset: number, width = 1.4): Omit<Opening, 'id'> => ({ kind: 'portafinestra', wall, offset, width, height: 2.3, sill: 0 });
const door = (wall: WallId, offset: number): Omit<Opening, 'id'> => ({ kind: 'porta', wall, offset, width: 0.9, height: 2.1, sill: 0 });

export const TEMPLATES: Template[] = [
  {
    id: 'soggiorno', name: 'Soggiorno',
    room: { width: 5.6, depth: 4.6, height: 2.8, wall: 'bianco', floor: 'rovere', openings: [win('fondo', -1.4, 1.4, 1.5, 0.85), french('sinistra', 0.2), door('destra', 1.3)] },
    furniture: [
      ['tappeto', 0.45, -0.6, 0, 'sabbia'],
      ['divano', 0.5, -1.81, 0, 'grigio'],
      ['tavolino', 0.5, -0.6, 0, 'noce'],
      ['poltrona', -1.45, -0.2, 60, 'ruggine'],
      ['lampadaterra', 1.95, -1.9, 0, 'ottone'],
      ['libreria', 2.6, -0.4, -90, 'noce'],
      ['pianta', -2.45, -1.95, 0, 'bianco'],
    ],
  },
  {
    id: 'camera', name: 'Camera da letto',
    room: { width: 4.2, depth: 4.2, height: 2.7, wall: 'salvia', floor: 'rovere', openings: [win('sinistra', 0.2, 1.2, 1.4, 0.9), door('destra', 1.4)] },
    furniture: [
      ['tappeto', 0, -0.2, 0, 'grigio'],
      ['letto', 0, -1.03, 0, 'sabbia'],
      ['comodino', -1.17, -1.88, 0, 'noce'],
      ['comodino', 1.17, -1.88, 0, 'noce'],
      ['lampadatavolo', -1.17, -1.9, 0, 'bianco', 0.55],
      ['lampadatavolo', 1.17, -1.9, 0, 'bianco', 0.55],
      ['armadio', 1.78, -0.55, -90, 'bianco'],
      ['poltrona', -1.45, 1.1, 150, 'sabbia'],
    ],
    hour: 18.5,
  },
  {
    id: 'cucina', name: 'Cucina',
    room: { width: 5, depth: 4.2, height: 2.8, wall: 'bianco', floor: 'piastrelle', openings: [win('fondo', 0.9, 1.2, 1.1, 1.1), french('sinistra', 0), door('destra', 1.4)] },
    furniture: [
      ['cucina', 0.9, -1.77, 0, 'bianco'],
      ['tavolo', -0.4, 0.15, 0, 'noce'],
      ['sedia', -0.8, -0.5, 0, 'noce'],
      ['sedia', 0.0, -0.5, 0, 'noce'],
      ['sedia', -0.8, 0.8, 180, 'noce'],
      ['sedia', 0.0, 0.8, 180, 'noce'],
      ['lampadario', -0.4, 0.15, 0, 'nero'],
      ['pianta', -2.2, -1.8, 0, 'ruggine'],
    ],
  },
  {
    id: 'ufficio', name: 'Ufficio',
    room: { width: 5, depth: 4.6, height: 2.9, wall: 'grigio', floor: 'cemento', openings: [win('fondo', 0, 2.4, 1.6, 0.8), door('destra', 1.5)] },
    furniture: [
      ['scrivania', 0, -1.55, 0, 'rovere'],
      ['sedia', 0, -0.95, 180, 'nero'],
      ['lampadatavolo', 0.5, -1.65, 0, 'nero', 0.75],
      ['libreria', -2.3, -0.3, 90, 'rovere'],
      ['poltrona', 1.55, 0.7, -140, 'grigio'],
      ['pianta', 2.1, -1.9, 0, 'nero'],
    ],
  },
  {
    id: 'studio', name: 'Teatro di posa',
    room: { width: 9, depth: 7.5, height: 4.5, wall: 'nero', floor: 'cemento', openings: [door('destra', 2.5)] },
    furniture: [],
    people: [{ pose: 'piedi', x: 0, z: -0.8, rot: 0 }],
    lights: [{ type: 'Pannello', pos: [-1.6, 2.2, 0.6], target: [0, 1.55, -0.8] }],
  },
  {
    id: 'vuota', name: 'Stanza vuota',
    room: { width: 5, depth: 4, height: 2.8, wall: 'bianco', floor: 'rovere', openings: [win('fondo', 0, 1.4, 1.5, 0.85), door('destra', 1.2)] },
    furniture: [],
  },
];

// ---------------- luci legate alla stanza ----------------
// una luce "finestra" per ogni finestra (cielo), una lampadina per ogni lampada
export function syncRoomLights(room: RoomSpec, furniture: FurnitureState[], lights: LightState[]): LightState[] {
  const out: LightState[] = [];
  const wins = windowInfos(room);
  for (const L of lights) {
    if (L.origin === 'finestra') {
      const w = wins.find((x) => x.id === L.windowId);
      if (!w) continue;
      out.push(windowLight(w, L));
      continue;
    }
    if (L.attached) {
      const f = furniture.find((x) => x.id === L.attached);
      const p = f && lampWorld(f, room.height);
      if (!p) continue;
      out.push({ ...L, position: p, target: [p[0], p[1] - 1, p[2]] });
      continue;
    }
    out.push(L);
  }
  wins.forEach((w) => { if (!out.some((L) => L.windowId === w.id)) out.push(windowLight(w)); });
  for (const f of furniture) {
    const k = furnitureKind(f.kind);
    if (!k.light || out.some((L) => L.attached === f.id)) continue;
    const p = lampWorld(f, room.height)!;
    const n = out.filter((L) => L.attached && L.name.startsWith(k.light!.name)).length;
    out.push(makeLight(k.light.fixture, p, [p[0], p[1] - 1, p[2]], { name: n ? `${k.light.name} ${n + 1}` : k.light.name, kelvin: k.light.kelvin, softness: 0.5, attached: f.id }));
  }
  // numera le finestre
  const ws = out.filter((L) => L.origin === 'finestra');
  ws.forEach((L, i) => { L.name = ws.length > 1 ? `Finestra ${i + 1}` : 'Finestra'; });
  return out;
}

function windowLight(w: ReturnType<typeof windowInfos>[number], prev?: LightState): LightState {
  const c = new THREE.Vector3(...w.center), n = new THREE.Vector3(...w.normal);
  const pos = c.clone().addScaledVector(n, 0.03).toArray() as [number, number, number];
  const tgt = c.clone().addScaledVector(n, 2).setY(Math.max(0.6, c.y - 0.8)).toArray() as [number, number, number];
  if (prev) return { ...prev, position: pos, target: tgt, size: [w.width, w.height] };
  return makeLight('panel-120x60', pos, tgt, { name: 'Finestra', origin: 'finestra', size: [w.width, w.height], kelvin: 6500, softness: 1, windowId: w.id });
}

// il sole entra dalla finestra più grande all'ora scelta
export function orientSunFor(room: RoomSpec, hour = 10.5) {
  const sun = { ...defaultSun(), hour, enabled: true, weather: 'sereno' as const };
  const w = windowInfos(room).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!w) return sun;
  const n = new THREE.Vector3(...w.normal);
  const toSun = n.clone().negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(25));
  const azScene = THREE.MathUtils.radToDeg(Math.atan2(toSun.x, -toSun.z));
  const { azimuth } = sunAngles(sun.hour, sun.dayOfYear, sun.latitude);
  return { ...sun, north: (((azScene - azimuth) % 360) + 360) % 360 };
}

// ---------------- vincoli degli arredi ----------------
export function clampFurniture(f: FurnitureState, room: RoomSpec, all: FurnitureState[]): FurnitureState {
  const { hx, hz } = footprint(f);
  const b = roomBounds(room);
  const x = Math.min(b.max[0] - hx - 0.01, Math.max(b.min[0] + hx + 0.01, f.position[0]));
  const z = Math.min(b.max[2] - hz - 0.01, Math.max(b.min[2] + hz + 0.01, f.position[2]));
  const k = furnitureKind(f.kind);
  const y = k.onTop ? supportHeight(x, z, f.id, all) : 0;
  return { ...f, position: [hx * 2 > b.max[0] - b.min[0] ? 0 : x, y, hz * 2 > b.max[2] - b.min[2] ? 0 : z] };
}

// piano del mobile sotto il punto (per lampade da tavolo)
export function supportHeight(x: number, z: number, selfId: string, all: FurnitureState[]) {
  let y = 0;
  for (const o of all) {
    if (o.id === selfId) continue;
    const k = furnitureKind(o.kind);
    if (!k.surface || k.onTop) continue;
    const a = -THREE.MathUtils.degToRad(o.rotationY);
    const dx = x - o.position[0], dz = z - o.position[2];
    const lx = dx * Math.cos(a) + dz * Math.sin(a), lz = -dx * Math.sin(a) + dz * Math.cos(a);
    if (Math.abs(lx) < k.size[0] / 2 && Math.abs(lz) < k.size[1] / 2) y = Math.max(y, k.surface);
  }
  return y;
}

// ---------------- creazione ----------------
export async function createRoom(t: Template) {
  const e = eng();
  if (!e) return;
  const room: RoomSpec = { ...t.room, openings: t.room.openings.map((o) => ({ ...o, id: newId('a') })) };
  room.openings = room.openings.map((o) => fitOpening(room, o, room.openings));
  let furniture: FurnitureState[] = t.furniture.map(([kind, x, z, rot, color, y]) => ({ id: newId('m'), kind, position: [x, y || 0, z], rotationY: rot, color: color || furnitureKind(kind).finishes[0] }));
  furniture = furniture.map((f) => clampFurniture(f, room, furniture));
  const lights = syncRoomLights(room, furniture, []);
  for (const l of t.lights || []) {
    const L = makeLight(l.type === 'Pannello' ? 'panel-120x60' : 'fresnel-led-300', l.pos, l.target, { name: `${l.type} 1` });
    lights.push(L);
  }
  const people: PersonState[] = (t.people || []).map((p, i) => ({ id: newId('p'), name: `Persona ${i + 1}`, position: [p.x, 0, p.z], rotationY: p.rot, pose: p.pose, joints: poseJoints(p.pose), skin: 'media', height: 1.75 }));
  const sun = orientSunFor(room, t.hour ?? 10.5);
  e.clearBuilt();
  useStore.setState({
    phase: 'ready', status: '', recon: null, photos: [], placeName: t.name, room, furniture, lights, people, props: [], sun,
    cam: { ...defaultCam(), focal: 18 }, ambient: 0, shots: [], past: [], future: [], selection: null, manikin: null, meterPin: null, meter: false,
  });
  e.apply(snapshotNow());
  e.resetView();
  await sleep(60);
  autoExpose();
}

export function snapshotNow() {
  const s = useStore.getState();
  return { lights: s.lights, people: s.people, props: s.props, sun: s.sun, cam: s.cam, ambient: s.ambient, room: s.room, furniture: s.furniture };
}

export function autoExpose(toast = false) {
  const e = eng();
  if (!e) return;
  const exp = e.autoExposure();
  if (!exp) return;
  useStore.setState({ cam: { ...useStore.getState().cam, ...exp } });
  if (toast) useStore.getState().showToast(`Esposizione: ISO ${exp.iso}, f/${exp.fStop}`);
}

// modifica la stanza tenendo dentro arredi, aperture e luci
export function updateRoom(patch: Partial<RoomSpec>, snapshot = true) {
  const s = useStore.getState();
  if (!s.room) return;
  if (snapshot) s.snapshot();
  const room: RoomSpec = { ...s.room, ...patch };
  room.openings = room.openings.map((o) => fitOpening(room, o, room.openings));
  let furniture = s.furniture.map((f) => clampFurniture(f, room, s.furniture));
  furniture = furniture.map((f) => clampFurniture(f, room, furniture));
  const lights = syncRoomLights(room, furniture, s.lights).map((L) => {
    if (L.origin === 'finestra' || L.attached) return L;
    const b = roomBounds(room);
    const p = L.position;
    return { ...L, position: [Math.min(b.max[0] - 0.1, Math.max(b.min[0] + 0.1, p[0])), Math.min(b.max[1] - 0.1, p[1]), Math.min(b.max[2] - 0.1, Math.max(b.min[2] + 0.1, p[2]))] as [number, number, number] };
  });
  const b = roomBounds(room);
  const people = s.people.map((P) => ({ ...P, position: [Math.min(b.max[0] - 0.3, Math.max(b.min[0] + 0.3, P.position[0])), 0, Math.min(b.max[2] - 0.3, Math.max(b.min[2] + 0.3, P.position[2]))] as [number, number, number] }));
  useStore.setState({ room, furniture, lights, people });
}

// la parete che si sta guardando, e il punto toccato lungo di essa
function facedWall(): { wall: WallId; offset: number } {
  const s = useStore.getState();
  const e = eng();
  const room = s.room!;
  const walls: WallId[] = ['fondo', 'destra', 'davanti', 'sinistra'];
  if (!e) return { wall: 'fondo', offset: 0 };
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(e.camera.quaternion); fwd.y = 0; fwd.normalize();
  let best: WallId = 'fondo', bd = -Infinity;
  for (const w of walls) { const d = -wallFrame(room, w).normal.dot(fwd); if (d > bd) { bd = d; best = w; } }
  // punto in cui lo sguardo incontra la parete
  const f = wallFrame(room, best);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(f.normal, f.origin);
  const ray = new THREE.Ray(e.camera.position.clone(), fwd);
  const hit = ray.intersectPlane(plane, new THREE.Vector3());
  const offset = hit ? hit.clone().sub(f.origin).dot(f.right) : 0;
  return { wall: best, offset };
}

export function addOpening(kind: Opening['kind']) {
  const s = useStore.getState();
  if (!s.room) return;
  const k = OPENING_KINDS.find((x) => x.id === kind)!;
  const { wall, offset } = facedWall();
  const o: Opening = fitOpening(s.room, { id: newId('a'), kind, wall, offset, width: k.width, height: k.height, sill: k.sill }, s.room.openings);
  updateRoom({ openings: [...s.room.openings, o] });
  useStore.setState({ selection: { type: 'opening', id: o.id } });
  s.showToast(`${k.name} sulla parete ${wall === 'fondo' ? 'di fondo' : wall === 'davanti' ? 'davanti' : wall === 'destra' ? 'di destra' : 'di sinistra'}. Trascinala per spostarla.`);
}

export function updateOpening(id: string, patch: Partial<Opening>, snapshot = false) {
  const s = useStore.getState();
  if (!s.room) return;
  updateRoom({ openings: s.room.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)) }, snapshot);
}

export function addFurniture(kind: string) {
  const s = useStore.getState();
  const e = eng();
  if (!s.room) return;
  s.snapshot();
  const k = furnitureKind(kind);
  let pos = new THREE.Vector3(0, 0, 0), rot = 0;
  if (e) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(e.camera.quaternion); fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    // sul pavimento, al centro dell'inquadratura (non oltre la parete)
    const r = e.renderer.domElement.getBoundingClientRect();
    const hit = e.rayPlane(r.left + r.width / 2, r.top + r.height * 0.68, new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
    const d = hit ? Math.min(3, Math.max(1.4, hit.distanceTo(e.camera.position.clone().setY(0)))) : 2;
    pos = e.camera.position.clone().setY(0).addScaledVector(fwd, d + Math.max(k.size[0], k.size[1]) * 0.25);
    rot = Math.round(THREE.MathUtils.radToDeg(Math.atan2(-fwd.x, -fwd.z)) / 15) * 15;
  }
  let f: FurnitureState = { id: newId('m'), kind, position: [pos.x, 0, pos.z], rotationY: rot, color: k.finishes[0] };
  if (k.onTop) {
    // una lampada da tavolo va sul mobile più vicino con un piano
    const host = s.furniture.filter((o) => furnitureKind(o.kind).surface && !furnitureKind(o.kind).onTop && furnitureKind(o.kind).surface! > 0.35)
      .sort((a, b) => Math.hypot(a.position[0] - pos.x, a.position[2] - pos.z) - Math.hypot(b.position[0] - pos.x, b.position[2] - pos.z))[0];
    if (host) f.position = [host.position[0], 0, host.position[2]];
  }
  const all = [...s.furniture, f];
  f = clampFurniture(f, s.room, all);
  if (!k.onTop && !k.ceiling && kind !== 'tappeto') f = freeSpot(f, s.room, s.furniture);
  const furniture = [...s.furniture, f];
  const lights = syncRoomLights(s.room, furniture, s.lights);
  useStore.setState({ furniture, lights, selection: { type: 'furniture', id: f.id } });
  s.showToast(`${k.name}: trascinalo per spostarlo, la rotella o i tasti nella scheda per girarlo.`);
}

export function moveFurniture(id: string, patch: Partial<FurnitureState>) {
  const s = useStore.getState();
  if (!s.room) return;
  const f0 = s.furniture.find((f) => f.id === id);
  if (!f0) return;
  const f = clampFurniture({ ...f0, ...patch }, s.room, s.furniture);
  let furniture = s.furniture.map((x) => (x.id === id ? f : x));
  // le lampade da tavolo seguono il mobile su cui stanno
  furniture = furniture.map((x) => (furnitureKind(x.kind).onTop && x.id !== id ? riding(x, f0, f, furniture) : x));
  const lights = syncRoomLights(s.room, furniture, s.lights);
  useStore.setState({ furniture, lights });
}

function riding(lamp: FurnitureState, before: FurnitureState, after: FurnitureState, all: FurnitureState[]) {
  const kb = furnitureKind(before.kind);
  if (!kb.surface || kb.onTop) return clampFurniture(lamp, useStore.getState().room!, all);
  const a = -THREE.MathUtils.degToRad(before.rotationY);
  const dx = lamp.position[0] - before.position[0], dz = lamp.position[2] - before.position[2];
  const lx = dx * Math.cos(a) + dz * Math.sin(a), lz = -dx * Math.sin(a) + dz * Math.cos(a);
  if (Math.abs(lx) > kb.size[0] / 2 || Math.abs(lz) > kb.size[1] / 2) return clampFurniture(lamp, useStore.getState().room!, all);
  const b = THREE.MathUtils.degToRad(after.rotationY);
  const nx = after.position[0] + lx * Math.cos(b) + lz * Math.sin(b);
  const nz = after.position[2] - lx * Math.sin(b) + lz * Math.cos(b);
  return { ...lamp, position: [nx, kb.surface, nz] as [number, number, number], rotationY: lamp.rotationY + (after.rotationY - before.rotationY) };
}

// cerca, a spirale attorno al punto scelto, un posto dove il nuovo mobile non ne tocca altri
function overlaps(a: FurnitureState, b: FurnitureState) {
  const fa = footprint(a), fb = footprint(b);
  return Math.abs(a.position[0] - b.position[0]) < fa.hx + fb.hx + 0.05 && Math.abs(a.position[2] - b.position[2]) < fa.hz + fb.hz + 0.05;
}
function freeSpot(f: FurnitureState, room: RoomSpec, others: FurnitureState[]) {
  const solid = others.filter((o) => { const k = furnitureKind(o.kind); return !k.onTop && !k.ceiling && o.kind !== 'tappeto'; });
  if (!solid.some((o) => overlaps(f, o))) return f;
  for (let r = 0.25; r < 6; r += 0.25) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const c = clampFurniture({ ...f, position: [f.position[0] + Math.cos(ang) * r, 0, f.position[2] + Math.sin(ang) * r] }, room, others);
      if (!solid.some((o) => overlaps(c, o))) return c;
    }
  }
  return f;
}

export function removeFurniture(id: string) {
  const s = useStore.getState();
  if (!s.room) return;
  s.snapshot();
  const furniture = s.furniture.filter((f) => f.id !== id);
  const lights = syncRoomLights(s.room, furniture, s.lights);
  useStore.setState({ furniture, lights, selection: null });
}

export function duplicateFurniture(id: string) {
  const s = useStore.getState();
  const f0 = s.furniture.find((f) => f.id === id);
  if (!f0 || !s.room) return;
  s.snapshot();
  const k = furnitureKind(f0.kind);
  const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(f0.rotationY));
  const step = k.size[0] + 0.1;
  let f: FurnitureState = { ...f0, id: newId('m'), position: [f0.position[0] + right.x * step, f0.position[1], f0.position[2] + right.z * step] };
  f = clampFurniture(f, s.room, [...s.furniture, f]);
  const furniture = [...s.furniture, f];
  useStore.setState({ furniture, lights: syncRoomLights(s.room, furniture, s.lights), selection: { type: 'furniture', id: f.id } });
}

export function removeOpening(id: string) {
  const s = useStore.getState();
  if (!s.room) return;
  updateRoom({ openings: s.room.openings.filter((o) => o.id !== id) });
  useStore.setState({ selection: null });
}

export { FURNITURE, illuminanceAt };
