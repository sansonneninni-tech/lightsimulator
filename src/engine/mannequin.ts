// Manichino articolato con pose preset.
import * as THREE from 'three';

export type PoseId = 'piedi' | 'seduto' | 'steso' | 'ginocchio' | 'cammina' | 'conserte';
export const POSES: { id: PoseId; name: string }[] = [
  { id: 'piedi', name: 'In piedi' },
  { id: 'seduto', name: 'Seduto' },
  { id: 'steso', name: 'Steso' },
  { id: 'ginocchio', name: 'In ginocchio' },
  { id: 'cammina', name: 'Cammina' },
  { id: 'conserte', name: 'Braccia conserte' },
];

export const SKINS = [
  { id: 'chiara', name: 'Chiara', color: '#e8c4a8' },
  { id: 'media', name: 'Media', color: '#b98a64' },
  { id: 'scura', name: 'Scura', color: '#6b4630' },
];

export type JointRot = Record<string, [number, number, number]>; // gradi

export interface PersonState {
  id: string;
  name: string;
  position: [number, number, number];
  rotationY: number; // gradi
  pose: PoseId;
  joints: JointRot;  // rotazioni personalizzate (manichino)
  skin: string;
  height: number;    // metri
}

// gerarchia: nome, genitore, offset locale (persona alta 1.75)
const SKELETON: [string, string | null, [number, number, number]][] = [
  ['hips', null, [0, 0.95, 0]],
  ['spine', 'hips', [0, 0.1, 0]],
  ['chest', 'spine', [0, 0.22, 0]],
  ['neck', 'chest', [0, 0.2, 0]],
  ['head', 'neck', [0, 0.09, 0]],
  ['shoulder_l', 'chest', [0.18, 0.15, 0]],
  ['elbow_l', 'shoulder_l', [0, -0.29, 0]],
  ['wrist_l', 'elbow_l', [0, -0.26, 0]],
  ['shoulder_r', 'chest', [-0.18, 0.15, 0]],
  ['elbow_r', 'shoulder_r', [0, -0.29, 0]],
  ['wrist_r', 'elbow_r', [0, -0.26, 0]],
  ['hip_l', 'hips', [0.1, -0.06, 0]],
  ['knee_l', 'hip_l', [0, -0.43, 0]],
  ['ankle_l', 'knee_l', [0, -0.42, 0]],
  ['hip_r', 'hips', [-0.1, -0.06, 0]],
  ['knee_r', 'hip_r', [0, -0.43, 0]],
  ['ankle_r', 'knee_r', [0, -0.42, 0]],
];

// maniglie: pallino sul giunto figlio, ruota il genitore
export const HANDLES: { at: string; rotates: string; label: string }[] = [
  { at: 'head', rotates: 'neck', label: 'Testa' },
  { at: 'neck', rotates: 'spine', label: 'Busto' },
  { at: 'elbow_l', rotates: 'shoulder_l', label: 'Braccio sx' },
  { at: 'wrist_l', rotates: 'elbow_l', label: 'Avambraccio sx' },
  { at: 'elbow_r', rotates: 'shoulder_r', label: 'Braccio dx' },
  { at: 'wrist_r', rotates: 'elbow_r', label: 'Avambraccio dx' },
  { at: 'knee_l', rotates: 'hip_l', label: 'Coscia sx' },
  { at: 'ankle_l', rotates: 'knee_l', label: 'Gamba sx' },
  { at: 'knee_r', rotates: 'hip_r', label: 'Coscia dx' },
  { at: 'ankle_r', rotates: 'knee_r', label: 'Gamba dx' },
];

interface PoseDef { hipsY: number; rootRot?: [number, number, number]; joints: JointRot; prop?: 'sedia' | 'letto' }
const POSE_DEFS: Record<PoseId, PoseDef> = {
  piedi: { hipsY: 0.95, joints: { shoulder_l: [0, 0, 7], shoulder_r: [0, 0, -7], elbow_l: [-8, 0, 0], elbow_r: [-8, 0, 0] } },
  seduto: {
    hipsY: 0.52, prop: 'sedia',
    joints: { spine: [6, 0, 0], hip_l: [-88, 0, 4], hip_r: [-88, 0, -4], knee_l: [88, 0, 0], knee_r: [88, 0, 0], ankle_l: [0, 0, 0], ankle_r: [0, 0, 0],
      shoulder_l: [-25, 0, 8], shoulder_r: [-25, 0, -8], elbow_l: [-55, 0, 0], elbow_r: [-55, 0, 0], neck: [6, 0, 0] },
  },
  steso: {
    hipsY: 0.6, rootRot: [-90, 0, 0], prop: 'letto',
    joints: { shoulder_l: [0, 0, 12], shoulder_r: [0, 0, -12], hip_l: [0, 0, 3], hip_r: [0, 0, -3], neck: [-10, 0, 0] },
  },
  ginocchio: {
    hipsY: 0.52,
    joints: { hip_l: [-4, 0, 3], hip_r: [-4, 0, -3], knee_l: [92, 0, 0], knee_r: [92, 0, 0], ankle_l: [-40, 0, 0], ankle_r: [-40, 0, 0],
      shoulder_l: [-10, 0, 8], shoulder_r: [-10, 0, -8], elbow_l: [-20, 0, 0], elbow_r: [-20, 0, 0] },
  },
  cammina: {
    hipsY: 0.93,
    joints: { hip_l: [-22, 0, 2], knee_l: [12, 0, 0], hip_r: [16, 0, -2], knee_r: [28, 0, 0], ankle_r: [-10, 0, 0],
      shoulder_l: [18, 0, 7], shoulder_r: [-20, 0, -7], elbow_l: [-10, 0, 0], elbow_r: [-30, 0, 0], spine: [3, 0, 0] },
  },
  conserte: {
    hipsY: 0.95,
    joints: { shoulder_l: [-38, -28, 12], elbow_l: [-112, 0, 0], shoulder_r: [-38, 28, -12], elbow_r: [-112, 0, 0], hip_l: [0, 0, 3], hip_r: [0, 0, -3] },
  },
};

export function poseJoints(pose: PoseId): JointRot {
  return JSON.parse(JSON.stringify(POSE_DEFS[pose].joints));
}

export function buildMannequin(p: PersonState) {
  const root = new THREE.Group();
  root.name = 'person';
  root.userData.personId = p.id;
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(SKINS.find((s) => s.id === p.skin)?.color || '#c99a78'), roughness: 0.55, metalness: 0 });
  const clothMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5d6670'), roughness: 0.9 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2e3238'), roughness: 0.9 });
  const joints: Record<string, THREE.Group> = {};
  const body = new THREE.Group();
  root.add(body);
  for (const [name, parent, off] of SKELETON) {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(...off);
    g.userData.rest = off;
    joints[name] = g;
    (parent ? joints[parent] : body).add(g);
  }
  const tagged = (m: THREE.Mesh, joint: string) => {
    m.castShadow = true; m.receiveShadow = true;
    m.userData.personId = p.id; m.userData.joint = joint;
    return m;
  };
  const capsule = (r: number, len: number, mat: THREE.Material, joint: string, dir: [number, number, number] = [0, -1, 0]) => {
    const geo = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 6, 14);
    const m = tagged(new THREE.Mesh(geo, mat), joint);
    const d = new THREE.Vector3(...dir).normalize();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    m.position.copy(d.multiplyScalar(len / 2));
    joints[joint].add(m);
    return m;
  };
  const ell = (rx: number, ry: number, rz: number, mat: THREE.Material, joint: string, pos: [number, number, number]) => {
    const m = tagged(new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), mat), joint);
    m.scale.set(rx, ry, rz); m.position.set(...pos);
    joints[joint].add(m);
    return m;
  };
  // bacino e busto
  ell(0.17, 0.12, 0.11, pantsMat, 'hips', [0, -0.02, 0]);
  ell(0.15, 0.13, 0.1, clothMat, 'spine', [0, 0.1, 0]);
  ell(0.2, 0.17, 0.12, clothMat, 'chest', [0, 0.08, 0]);
  capsule(0.05, 0.12, skinMat, 'neck', [0, 1, 0]);
  // testa con naso, per leggere le ombre sul volto
  ell(0.085, 0.11, 0.1, skinMat, 'head', [0, 0.1, 0.005]);
  const nose = tagged(new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.04, 10), skinMat), 'head');
  nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.085, 0.105); joints.head.add(nose);
  ell(0.02, 0.012, 0.012, skinMat, 'head', [0.032, 0.12, 0.085]); // arcate sopracciliari
  ell(0.02, 0.012, 0.012, skinMat, 'head', [-0.032, 0.12, 0.085]);
  ell(0.03, 0.015, 0.02, skinMat, 'head', [0, 0.03, 0.08]); // mento
  ell(0.015, 0.03, 0.02, skinMat, 'head', [0.088, 0.1, 0]); // orecchie
  ell(0.015, 0.03, 0.02, skinMat, 'head', [-0.088, 0.1, 0]);
  for (const s of ['l', 'r']) {
    capsule(0.05, 0.3, clothMat, `shoulder_${s}`);
    capsule(0.04, 0.27, skinMat, `elbow_${s}`);
    const hand = ell(0.03, 0.08, 0.045, skinMat, `wrist_${s}`, [0, -0.07, 0.005]);
    hand.userData.joint = `wrist_${s}`;
    capsule(0.075, 0.45, pantsMat, `hip_${s}`);
    capsule(0.055, 0.43, pantsMat, `knee_${s}`);
    ell(0.05, 0.035, 0.12, new THREE.MeshStandardMaterial({ color: '#1d1d1f', roughness: 0.6 }), `ankle_${s}`, [0, -0.04, 0.06]);
  }
  root.userData.joints = joints;
  root.userData.body = body;
  // oggetti di scena per le pose
  const propMat = new THREE.MeshStandardMaterial({ color: '#6e5a48', roughness: 0.7 });
  const chair = new THREE.Group(); chair.name = 'sedia';
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 0.45), propMat); seat.position.set(0, 0.44, 0.04); chair.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.04), propMat); back.position.set(0, 0.7, -0.17); chair.add(back);
  for (const [x, zz] of [[-0.2, -0.16], [0.2, -0.16], [-0.2, 0.24], [0.2, 0.24]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.44, 0.035), propMat); leg.position.set(x, 0.22, zz); chair.add(leg);
  }
  const bed = new THREE.Group(); bed.name = 'letto';
  const bedMat = new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.95 });
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.45, 2.05), bedMat); mattress.position.set(0, 0.225, -0.35); bed.add(mattress);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.35), bedMat); pillow.position.set(0, 0.5, -1.15); bed.add(pillow);
  for (const g of [chair, bed]) {
    g.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.personId = p.id; o.userData.joint = 'root'; } });
    root.add(g);
  }
  applyPose(root, p);
  return root;
}

export function applyPose(root: THREE.Group, p: PersonState) {
  const def = POSE_DEFS[p.pose];
  const joints = root.userData.joints as Record<string, THREE.Group>;
  const body = root.userData.body as THREE.Group;
  const s = p.height / 1.75;
  body.scale.setScalar(s);
  for (const name in joints) {
    const r = p.joints[name] || [0, 0, 0];
    joints[name].rotation.set(THREE.MathUtils.degToRad(r[0]), THREE.MathUtils.degToRad(r[1]), THREE.MathUtils.degToRad(r[2]));
  }
  const rr = def.rootRot || [0, 0, 0];
  body.rotation.set(THREE.MathUtils.degToRad(rr[0]), THREE.MathUtils.degToRad(rr[1]), THREE.MathUtils.degToRad(rr[2]));
  // altezza bacino: in piedi l'offset di riposo, altrimenti quello della posa
  const hips = joints.hips;
  if (def.rootRot) {
    // steso: il corpo ruota attorno ai piedi; lo appoggiamo sul letto
    hips.position.set(0, 0.95, 0);
    body.position.set(0, def.hipsY + 0.12 * s, 0.6);
  } else {
    hips.position.set(0, def.hipsY, 0);
    body.position.set(0, 0, 0);
  }
  for (const child of root.children) {
    if (child.name === 'sedia') child.visible = def.prop === 'sedia';
    if (child.name === 'letto') child.visible = def.prop === 'letto';
  }
  root.position.set(...p.position);
  root.rotation.set(0, THREE.MathUtils.degToRad(p.rotationY), 0);
}

// Rotazione di un giunto per far puntare il segmento verso un punto (modalità manichino)
export function aimJoint(root: THREE.Group, jointName: string, childName: string, targetWorld: THREE.Vector3): [number, number, number] {
  const joints = root.userData.joints as Record<string, THREE.Group>;
  const J = joints[jointName], C = joints[childName];
  root.updateMatrixWorld(true);
  const jp = J.getWorldPosition(new THREE.Vector3());
  const cp = C.getWorldPosition(new THREE.Vector3());
  const cur = cp.sub(jp).normalize();
  const des = targetWorld.clone().sub(jp).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(cur, des);
  const jw = J.getWorldQuaternion(new THREE.Quaternion());
  const pw = J.parent!.getWorldQuaternion(new THREE.Quaternion());
  const nl = pw.invert().multiply(q).multiply(jw);
  J.quaternion.copy(nl);
  const e = new THREE.Euler().setFromQuaternion(nl);
  return [THREE.MathUtils.radToDeg(e.x), THREE.MathUtils.radToDeg(e.y), THREE.MathUtils.radToDeg(e.z)];
}
