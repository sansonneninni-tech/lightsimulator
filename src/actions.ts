// Azioni sulla scena (aggiungere luci, persone, oggetti) condivise da gesti e pannelli.
import * as THREE from 'three';
import { useStore, PropState } from './store';
import { eng } from './engineRef';
import { makeLight, FIXTURES, newId, fixtureById, illuminanceAt } from './engine/photometry';
import { PersonState, PoseId, poseJoints, POSES } from './engine/mannequin';
import { PROP_KINDS } from './engine/Engine';

export const TYPE_FIXTURE: Record<string, string> = {
  Pannello: 'panel-120x60',
  Fresnel: 'fresnel-led-300',
  Lampadina: 'bulb-60',
  Tubo: 'tube-120',
  HMI: 'hmi-1200',
};
export const LIGHT_TYPES = Object.keys(TYPE_FIXTURE);
export const familyType = (fixtureId: string) => {
  const f = fixtureById(fixtureId).family;
  return f === 'Fresnel' ? 'Fresnel' : f === 'HMI' ? 'HMI' : f === 'Tubo' ? 'Tubo' : f === 'Lampadina' ? 'Lampadina' : 'Pannello';
};
export const fixturesOfType = (type: string) => FIXTURES.filter((f) => familyType(f.id) === type);

function room() {
  const r = useStore.getState().recon;
  return r ? r.room : { min: [-3, 0, -5], max: [3, 2.8, 2] };
}

export function clampToRoom(p: THREE.Vector3, margin = 0.15) {
  const { min, max } = room();
  p.x = Math.min(max[0] - margin, Math.max(min[0] + margin, p.x));
  p.y = Math.min(max[1] - margin, Math.max(0.1, p.y));
  p.z = Math.min(max[2] - margin, Math.max(min[2] + margin, p.z));
  return p;
}

// punto di interesse: la prima persona, altrimenti ciò che c'è al centro dell'inquadratura
export function subjectPoint(): THREE.Vector3 {
  const s = useStore.getState();
  const e = eng();
  if (s.people.length) {
    const p = s.people[0];
    const head = e?.jointWorld(p.id, 'head');
    if (head) return head;
    return new THREE.Vector3(p.position[0], 1.5, p.position[2]);
  }
  if (e) {
    const r = e.renderer.domElement.getBoundingClientRect();
    const hit = e.raycast(r.left + r.width / 2, r.top + r.height * 0.55);
    if (hit) {
      const camPos = e.camera.position;
      const d = hit.point.distanceTo(camPos);
      const p = camPos.clone().add(hit.point.clone().sub(camPos).normalize().multiplyScalar(Math.min(d, 3.5)));
      p.y = Math.max(0.9, Math.min(1.6, p.y));
      return p;
    }
    const f = new THREE.Vector3(0, 0, -2.5).applyQuaternion(e.camera.quaternion).add(e.camera.position);
    f.y = 1.4;
    return f;
  }
  return new THREE.Vector3(0, 1.4, -2.5);
}

export function addLight(type: string, at?: THREE.Vector3) {
  const s = useStore.getState();
  const e = eng();
  s.snapshot();
  const fixtureId = TYPE_FIXTURE[type] || 'panel-120x60';
  const fx = fixtureById(fixtureId);
  const subject = at ? at.clone() : subjectPoint();
  const camPos = e ? e.camera.position.clone() : new THREE.Vector3(0, 1.6, 0);
  const toCam = camPos.clone().sub(subject); toCam.y = 0;
  if (toCam.lengthSq() < 1e-4) toCam.set(0, 0, 1);
  toCam.normalize();
  const count = s.lights.filter((l) => l.origin === 'aggiunta').length;
  const side = count % 2 === 0 ? 1 : -1;
  const angle = THREE.MathUtils.degToRad(40) * side;
  const dir = toCam.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  const dist = fx.kind === 'spot' ? 3.2 : fx.kind === 'point' ? 1.3 : 2.2;
  let pos = subject.clone().addScaledVector(dir, dist);
  pos.y = fx.kind === 'point' ? Math.max(1.2, subject.y) : subject.y + (fx.family === 'Tubo' ? 0.3 : 0.7);
  if (!at && e) {
    // compare dentro la vista, nel terzo superiore centrale, già puntata sul soggetto
    const r = e.renderer.domElement.getBoundingClientRect();
    const d = camPos.distanceTo(subject);
    const ray = e.rayPlane(r.left + r.width * (0.5 + side * 0.12), r.top + r.height * 0.28, new THREE.Plane(toCam.clone().negate(), 0).translate(camPos.clone().addScaledVector(toCam, -Math.max(0.9, Math.min(d - 0.8, d * 0.55)))));
    if (ray) pos = ray;
  }
  clampToRoom(pos, 0.3);
  const num = s.lights.filter((l) => familyType(l.fixtureId) === type && l.origin !== 'finestra').length + 1;
  const L = makeLight(fixtureId, pos.toArray() as any, subject.toArray() as any, { name: `${type} ${num}` });
  if (fx.kind === 'point') L.kelvin = 3200;
  // già regolata: il soggetto esce esposto al diaframma della camera
  const c = s.cam;
  const want = (250 * c.fStop * c.fStop) / (c.shutter * c.iso);
  const n = pos.clone().sub(subject).normalize();
  const full = illuminanceAt({ ...L, stops: 0 }, subject, n);
  if (full > 0) L.stops = Math.max(-8, Math.min(0, Math.round(Math.log2(want / full) * 3) / 3));
  (L as any)._new = true;
  useStore.setState({ lights: [...s.lights, L], selection: { type: 'light', id: L.id } });
  return L;
}

export function addLightAtScreen(x: number, y: number) {
  const e = eng();
  if (!e) return;
  const hit = e.raycast(x, y);
  if (!hit) return addLight('Pannello');
  // la luce illumina il punto toccato, da dove guarda la camera
  return addLight('Pannello', hit.point.clone().addScaledVector(hit.normal, 0.05));
}

export function addPerson(pose: PoseId) {
  const s = useStore.getState();
  const e = eng();
  s.snapshot();
  let pos = new THREE.Vector3(0, 0, -2.5);
  let rotY = 0;
  if (e) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(e.camera.quaternion); fwd.y = 0; fwd.normalize();
    const r = e.renderer.domElement.getBoundingClientRect();
    const hit = e.raycast(r.left + r.width / 2, r.top + r.height * 0.7);
    const maxD = hit ? Math.max(1.2, hit.point.clone().setY(0).distanceTo(e.camera.position.clone().setY(0)) - 0.4) : 3;
    const d = Math.min(2.6, maxD);
    pos = e.camera.position.clone().addScaledVector(fwd, d);
    const offset = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar((s.people.length % 3 - 1) * 0.8);
    pos.add(offset);
    pos.y = 0;
    rotY = THREE.MathUtils.radToDeg(Math.atan2(-fwd.x, -fwd.z));
  }
  clampToRoom(pos, 0.4); pos.y = 0;
  const P: PersonState = {
    id: newId('p'), name: `Persona ${s.people.length + 1}`, position: pos.toArray() as any, rotationY: rotY,
    pose, joints: poseJoints(pose), skin: 'media', height: 1.75,
  };
  useStore.setState({ people: [...s.people, P], selection: { type: 'person', id: P.id } });
  s.showToast(`${POSES.find((p) => p.id === pose)?.name}: trascina l'anello a terra per spostarla. Doppio clic per le articolazioni.`);
  return P;
}

export function addProp(kind: PropState['kind']) {
  const s = useStore.getState();
  s.snapshot();
  const subject = subjectPoint();
  const e = eng();
  const camPos = e ? e.camera.position.clone() : new THREE.Vector3(0, 1.6, 0);
  const toCam = camPos.clone().sub(subject); toCam.y = 0; toCam.normalize();
  const side = toCam.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(kind === 'bianco' ? -70 : 60));
  const pos = subject.clone().addScaledVector(side, 1.2);
  pos.y = kind === 'diffusore' ? 2.0 : 1.3;
  clampToRoom(pos, 0.3);
  const face = subject.clone().sub(pos); face.y = 0;
  const k = PROP_KINDS.find((p) => p.id === kind)!;
  const P: PropState = {
    id: newId('o'), kind, position: pos.toArray() as any, rotationY: THREE.MathUtils.radToDeg(Math.atan2(face.x, face.z)),
    tilt: kind === 'diffusore' ? -30 : 0, size: [...k.size] as [number, number],
  };
  useStore.setState({ props: [...s.props, P], selection: { type: 'prop', id: P.id } });
  return P;
}

export function removeSelection() {
  const s = useStore.getState();
  const sel = s.selection;
  if (!sel) return;
  s.snapshot();
  if (sel.type === 'light') {
    const L = s.lights.find((l) => l.id === sel.id);
    useStore.setState({ lights: s.lights.filter((l) => l.id !== sel.id), selection: null });
    s.showToast(`${L?.name || 'Luce'} rimossa. Cmd+Z per riaverla.`);
  } else if (sel.type === 'person') {
    useStore.setState({ people: s.people.filter((l) => l.id !== sel.id), selection: null, manikin: null });
    s.showToast('Persona rimossa. Cmd+Z per riaverla.');
  } else {
    useStore.setState({ props: s.props.filter((l) => l.id !== sel.id), selection: null });
    s.showToast('Oggetto rimosso. Cmd+Z per riaverlo.');
  }
}
