// Figura umana realistica: personaggi MakeHuman (CC0) costruiti sull'aspetto scelto e guidati dal
// manichino, che resta invisibile sotto (pose, maniglie delle articolazioni e selezione usano quello).
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

import { buildHuman, defaultLook, HUMAN_MAP, Look } from './human';

type Template = { scene: THREE.Object3D; hipsH: number; rest: Map<string, THREE.Quaternion>; map: Record<string, string> };
const templates = new Map<string, Template | null>();
const loading = new Map<string, Promise<Template | null>>();
const noRay = () => {};

const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

// rotazione "in mondo" di un osso: da applicare come premoltiplicazione nella sua cornice
function rotateWorld(b: THREE.Object3D, q: THREE.Quaternion) {
  b.parent!.getWorldQuaternion(q1);
  b.getWorldQuaternion(q2);
  q2.premultiply(q);
  b.quaternion.copy(q1.invert().multiply(q2));
  b.updateMatrixWorld(true);
}

function prepare(scene: THREE.Object3D, map: Record<string, string>): Template {
  scene.updateMatrixWorld(true);
  const by = (j: string) => scene.getObjectByName(map[j])!;
  // da braccia aperte a braccia lungo i fianchi (come il manichino a riposo)
  for (const s of ['_l', '_r']) {
    const arm = by('shoulder' + s), fore = by('elbow' + s), hand = by('wrist' + s);
    arm.getWorldPosition(v1); fore.getWorldPosition(v2);
    rotateWorld(arm, new THREE.Quaternion().setFromUnitVectors(v2.clone().sub(v1).normalize(), new THREE.Vector3(0, -1, 0)));
    fore.getWorldPosition(v1); hand.getWorldPosition(v2);
    rotateWorld(fore, new THREE.Quaternion().setFromUnitVectors(v2.clone().sub(v1).normalize(), new THREE.Vector3(0, -1, 0)));
  }
  // gambe dritte sotto le anche (la maglia nasce a gambe leggermente aperte)
  for (const s of ['_l', '_r']) {
    const thigh = by('hip' + s), shin = by('knee' + s), foot = by('ankle' + s);
    thigh.getWorldPosition(v1); shin.getWorldPosition(v2);
    rotateWorld(thigh, new THREE.Quaternion().setFromUnitVectors(v2.clone().sub(v1).normalize(), new THREE.Vector3(0, -1, 0)));
    shin.getWorldPosition(v1); foot.getWorldPosition(v2);
    rotateWorld(shin, new THREE.Quaternion().setFromUnitVectors(v2.clone().sub(v1).normalize(), new THREE.Vector3(0, -1, 0)));
  }
  scene.updateMatrixWorld(true);
  const rest = new Map<string, THREE.Quaternion>();
  for (const j in map) rest.set(j, by(j).getWorldQuaternion(new THREE.Quaternion()));
  const hipsH = by('hips').getWorldPosition(new THREE.Vector3()).y;
  scene.traverse((o: any) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      o.frustumCulled = false;
      o.raycast = noRay;
    }
  });
  return { scene, hipsH, rest, map };
}

export const prepareHuman = (g: THREE.Object3D) => prepare(g, HUMAN_MAP);

type P = { figure?: 'uomo' | 'donna'; skin: string; look?: Look };
const lookOf = (p: P) => ({ ...defaultLook(p.figure || 'uomo', p.skin), ...(p.look || {}) }); // i progetti vecchi possono non avere i campi nuovi
export const figureModel = (p: P) => JSON.stringify([p.figure || 'uomo', p.skin, lookOf(p)]);

export function loadFigure(model: string): Promise<Template | null> {
  if (templates.has(model)) return Promise.resolve(templates.get(model)!);
  if (!loading.has(model)) {
    const [figure, skin, look] = JSON.parse(model);
    loading.set(model, buildHuman(look, figure, skin)
      .then((g) => { const t = prepare(g, HUMAN_MAP); templates.set(model, t); return t; })
      .catch((e) => { console.warn('figura non caricata', e); templates.set(model, null); return null; }));
  }
  return loading.get(model)!;
}

// aggiunge (se serve) la figura alla persona e la mette nella posa del manichino
export function poseFigure(root: THREE.Group, p: P & { height: number; pose?: string }) {
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
  fig.position.set(0, 0, 0);
  root.updateMatrixWorld(true);
  // ossa dall'alto verso il basso: ognuno prende l'orientamento del giunto del manichino
  const wq = new THREE.Quaternion();
  const order: string[] = [];
  fig.traverse((o: any) => { if (o.isBone) order.push(o.name); });
  const byBone = new Map<string, string>();
  for (const j in template.map) byBone.set(template.map[j], j);
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
  // steso: la schiena sul materasso (il manichino ha un altro spessore e resterebbe sospeso)
  if (p.pose === 'steso') {
    const skin = fig.getObjectByName('pelle');
    if (skin) {
      const box = new THREE.Box3().setFromObject(skin, true);
      fig.position.y = root.position.y + 0.465 - box.min.y;
      fig.updateMatrixWorld(true);
    }
  }
  return true;
}
