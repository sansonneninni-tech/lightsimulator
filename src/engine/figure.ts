// Figura umana realistica: persone vere con scheletro (Microsoft Rocketbox, licenza MIT) guidate dal
// manichino, che resta invisibile sotto (pose, maniglie delle articolazioni e selezione usano quello).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

// articolazione del manichino -> osso del modello
const MAP: Record<string, string> = {
  hips: 'Pelvis', spine: 'Spine', chest: 'Spine2', neck: 'Neck', head: 'Head',
  shoulder_l: 'L_UpperArm', elbow_l: 'L_Forearm', wrist_l: 'L_Hand',
  shoulder_r: 'R_UpperArm', elbow_r: 'R_Forearm', wrist_r: 'R_Hand',
  hip_l: 'L_Thigh', knee_l: 'L_Calf', ankle_l: 'L_Foot',
  hip_r: 'R_Thigh', knee_r: 'R_Calf', ankle_r: 'R_Foot',
};

type Template = { scene: THREE.Object3D; hipsH: number; rest: Map<string, THREE.Quaternion> };
const templates = new Map<string, Template | null>();
const loading = new Map<string, Promise<Template | null>>();
const noRay = () => {};

const bone = (root: THREE.Object3D, name: string) => root.getObjectByName('Bip01_' + name);

const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

// rotazione "in mondo" di un osso: da applicare come premoltiplicazione nella sua cornice
function rotateWorld(b: THREE.Object3D, q: THREE.Quaternion) {
  b.parent!.getWorldQuaternion(q1);
  b.getWorldQuaternion(q2);
  q2.premultiply(q);
  b.quaternion.copy(q1.invert().multiply(q2));
  b.updateMatrixWorld(true);
}

function prepare(scene: THREE.Object3D): Template {
  scene.updateMatrixWorld(true);
  // da T a braccia lungo i fianchi (come il manichino a riposo)
  for (const s of ['L_', 'R_']) {
    const arm = bone(scene, s + 'UpperArm')!, fore = bone(scene, s + 'Forearm')!, hand = bone(scene, s + 'Hand')!;
    arm.getWorldPosition(v1); fore.getWorldPosition(v2);
    rotateWorld(arm, new THREE.Quaternion().setFromUnitVectors(v2.clone().sub(v1).normalize(), new THREE.Vector3(0, -1, 0)));
    fore.getWorldPosition(v1); hand.getWorldPosition(v2);
    rotateWorld(fore, new THREE.Quaternion().setFromUnitVectors(v2.clone().sub(v1).normalize(), new THREE.Vector3(0, -1, 0)));
  }
  scene.updateMatrixWorld(true);
  const rest = new Map<string, THREE.Quaternion>();
  for (const j in MAP) rest.set(j, bone(scene, MAP[j])!.getWorldQuaternion(new THREE.Quaternion()));
  const hipsH = bone(scene, 'Pelvis')!.getWorldPosition(new THREE.Vector3()).y;
  scene.traverse((o: any) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      o.frustumCulled = false;
      o.raycast = noRay;
    }
  });
  return { scene, hipsH, rest };
}

export const figureModel = (p: { figure?: string; skin: string }) => `${p.figure || 'uomo'}-${p.skin}`;

export function loadFigure(model: string): Promise<Template | null> {
  if (templates.has(model)) return Promise.resolve(templates.get(model)!);
  if (!loading.has(model)) {
    loading.set(model, new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/${model}.glb`)
      .then((g) => { const t = prepare(g.scene); templates.set(model, t); return t; })
      .catch((e) => { console.warn('figura non caricata', e); templates.set(model, null); return null; }));
  }
  return loading.get(model)!;
}

// aggiunge (se serve) la figura alla persona e la mette nella posa del manichino
export function poseFigure(root: THREE.Group, p: { figure?: string; skin: string; height: number }) {
  const model = figureModel(p);
  const template = templates.get(model);
  if (!template) return false;
  const height = p.height;
  const joints = root.userData.joints as Record<string, THREE.Group>;
  const body = root.userData.body as THREE.Group;
  let fig = root.userData.figure as THREE.Object3D | undefined;
  if (fig && fig.userData.model !== model) { root.remove(fig); fig = undefined; }
  if (!fig) {
    fig = SkeletonUtils.clone(template.scene);
    fig.name = 'figura';
    fig.userData.model = model;
    const pid = root.userData.personId;
    fig.traverse((o: any) => { o.layers.enable(1); if (o.isMesh) { o.userData.personId = pid; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.raycast = noRay; } });
    root.add(fig);
    root.userData.figure = fig;
    // il manichino resta per pose e selezione, ma non si vede e non fa ombra
    body.visible = false;
  }
  fig.scale.setScalar((0.95 * height / 1.75) / template.hipsH);
  root.updateMatrixWorld(true);
  // ossa dall'alto verso il basso: ognuno prende l'orientamento del giunto del manichino
  const wq = new THREE.Quaternion();
  const order: string[] = [];
  fig.traverse((o: any) => { if (o.isBone) order.push(o.name); });
  const byBone = new Map<string, string>();
  for (const j in MAP) { const b = bone(fig, MAP[j]); if (b) byBone.set(b.name, j); }
  for (const name of order) {
    const b = fig.getObjectByName(name)!;
    const j = byBone.get(name);
    if (j) {
      joints[j].getWorldQuaternion(wq);
      wq.multiply(template.rest.get(j)!);
      b.parent!.getWorldQuaternion(q1);
      b.quaternion.copy(q1.invert().multiply(wq));
      if (j === 'hips') {
        joints.hips.getWorldPosition(v1);
        b.position.copy(b.parent!.worldToLocal(v1));
      }
    }
    b.updateMatrixWorld(false);
    // i figli devono vedere la nuova cornice del genitore
    for (const c of b.children) c.updateMatrixWorld(false);
  }
  fig.updateMatrixWorld(true);
  return true;
}
