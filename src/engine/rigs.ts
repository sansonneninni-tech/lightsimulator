// Corpo visibile delle luci aggiunte (solo anteprima): testa del proiettore o pannello orientati verso
// il bersaglio, stativo fino a terra con il treppiede, anello a terra e fascio leggero.
// Non fa ombra, non si clicca e sparisce nello scatto.
import * as THREE from 'three';
import { LightState, fixtureById, lightColor, spotAngles } from './photometry';

const METAL = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.45, metalness: 0.6 });
const noRay = () => {};

type Rig = { g: THREE.Group; key: string; head: THREE.Group; lens: THREE.Mesh; stand: THREE.Mesh; legs: THREE.Group; ring: THREE.Mesh; beam: THREE.Mesh | null; lensMat: THREE.MeshBasicMaterial; ringMat: THREE.MeshBasicMaterial; beamMat: THREE.MeshBasicMaterial | null };

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = false; m.receiveShadow = false;
  m.raycast = noRay;
  return m;
}

function buildRig(L: LightState): Rig {
  const fx = fixtureById(L.fixtureId);
  const g = new THREE.Group();
  g.name = 'rig';
  const head = new THREE.Group();
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  let lens: THREE.Mesh;
  if (fx.kind === 'spot') {
    // proiettore: corpo cilindrico, lente davanti (asse +Z verso il bersaglio)
    const r = Math.max(0.08, (fx.radius || 0.06) * 1.5);
    const len = r * 2.6;
    const body = mesh(new THREE.CylinderGeometry(r, r * 1.05, len, 24, 1, true), METAL);
    body.rotation.x = Math.PI / 2; body.position.z = -len / 2;
    const back = mesh(new THREE.CircleGeometry(r * 1.05, 24), METAL);
    back.position.z = -len; back.rotation.y = Math.PI;
    lens = mesh(new THREE.CircleGeometry(r * 0.92, 24), lensMat);
    lens.position.z = 0.002;
    // forcella
    const yoke = mesh(new THREE.TorusGeometry(r * 1.25, 0.012, 6, 20, Math.PI), METAL);
    yoke.rotation.z = Math.PI; yoke.position.z = -len / 2;
    head.add(body, back, lens, yoke);
  } else if (fx.kind === 'area') {
    // pannello/softbox/tubo: cornice scura, faccia luminosa davanti
    const [w, h] = L.size;
    const d = Math.max(0.03, Math.min(0.25, Math.min(w, h) * 0.3));
    const frame = mesh(new THREE.BoxGeometry(w + 0.03, h + 0.03, d), METAL);
    frame.position.z = -d / 2 - 0.002;
    lens = mesh(new THREE.PlaneGeometry(w, h), lensMat);
    head.add(frame, lens);
  } else {
    // lampadina / pallone
    const r = Math.max(0.04, fx.radius || 0.04);
    lens = mesh(new THREE.SphereGeometry(r, 20, 14), lensMat);
    head.add(lens);
  }
  const stand = mesh(new THREE.CylinderGeometry(0.014, 0.018, 1, 8), METAL);
  const legs = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = mesh(new THREE.CylinderGeometry(0.01, 0.01, 1, 6), METAL);
    // da (0, h, 0) a (cos a · s, 0, sin a · s)
    const s = 0.32, hgt = 0.45;
    const len = Math.hypot(s, hgt);
    leg.scale.y = len;
    leg.position.set(Math.cos(a) * s / 2, hgt / 2, Math.sin(a) * s / 2);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.cos(a) * s, hgt, -Math.sin(a) * s).normalize());
    legs.add(leg);
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const ring = mesh(new THREE.RingGeometry(0.36, 0.4, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  let beam: THREE.Mesh | null = null, beamMat: THREE.MeshBasicMaterial | null = null;
  if (fx.kind !== 'point') {
    beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
    // cono con la punta all'origine e la base a z = 1
    const geo = new THREE.ConeGeometry(1, 1, 32, 1, true);
    geo.translate(0, -0.5, 0); geo.rotateX(-Math.PI / 2);
    beam = mesh(geo, beamMat);
    beam.renderOrder = 2;
  }
  g.add(head, stand, legs, ring);
  if (beam) g.add(beam);
  return { g, key: fx.kind + L.size.join('x') + L.fixtureId, head, lens, stand, legs, ring, beam, lensMat, ringMat, beamMat };
}

export class Rigs {
  group = new THREE.Group();
  private map = new Map<string, Rig>();
  private sel: string | null = null;
  private last: LightState[] = [];
  floorY = 0;

  constructor() { this.group.name = 'rigs'; }

  select(id: string | null) {
    if (id === this.sel) return false;
    this.sel = id;
    this.sync(this.last);
    return true;
  }

  sync(lights: LightState[]) {
    this.last = lights;
    const want = lights.filter((L) => L.origin === 'aggiunta' && !L.attached);
    const ids = new Set(want.map((L) => L.id));
    for (const [id, r] of this.map) if (!ids.has(id)) { this.drop(r); this.map.delete(id); }
    for (const L of want) {
      const fx = fixtureById(L.fixtureId);
      let r = this.map.get(L.id);
      const key = fx.kind + L.size.join('x') + L.fixtureId;
      if (r && r.key !== key) { this.drop(r); r = undefined; }
      if (!r) { r = buildRig(L); this.map.set(L.id, r); this.group.add(r.g); }
      const P = new THREE.Vector3(...L.position), T = new THREE.Vector3(...L.target);
      const sel = this.sel === L.id;
      r.head.position.copy(P);
      if (P.distanceToSquared(T) > 1e-6) r.head.lookAt(T);
      // colore della sorgente: acceso = colore della luce, spento = grigio
      const c = lightColor(L.kelvin, L.gel);
      const m = Math.max(c.r, c.g, c.b) || 1;
      if (L.on) r.lensMat.color.setRGB(c.r / m, c.g / m, c.b / m); else r.lensMat.color.setRGB(0.18, 0.18, 0.2);
      // stativo: da terra fin sotto la testa
      const top = P.y - (fx.kind === 'spot' ? 0.0 : fx.kind === 'area' ? Math.min(0.3, L.size[1] / 2) : 0.05);
      const bottom = this.floorY + 0.45;
      const showStand = top > this.floorY + 0.2;
      r.stand.visible = r.legs.visible = showStand;
      if (showStand) {
        const h = Math.max(0.01, top - bottom);
        r.stand.scale.y = h; r.stand.position.set(P.x, bottom + h / 2, P.z);
        r.legs.position.set(P.x, this.floorY, P.z);
        r.legs.scale.y = Math.min(1, (top - this.floorY) / 0.45);
      }
      r.ring.position.set(P.x, this.floorY + 0.004, P.z);
      r.ringMat.color.copy(r.lensMat.color);
      r.ringMat.opacity = sel ? 0.9 : 0.45;
      if (r.beam && r.beamMat) {
        const len = Math.min(8, P.distanceTo(T));
        const half = fx.kind === 'spot' ? THREE.MathUtils.degToRad(Math.min(160, spotAngles(L).field) / 2) : THREE.MathUtils.degToRad(30);
        const rad = Math.max(L.size[0], L.size[1]) / 2;
        const base = fx.kind === 'spot' ? Math.tan(half) * len : rad + Math.tan(half) * len * 0.5;
        r.beam.position.copy(P);
        r.beam.lookAt(T);
        r.beam.scale.set(Math.max(0.02, base), Math.max(0.02, base), Math.max(0.05, len));
        r.beam.visible = L.on && len > 0.1;
        r.beamMat.color.copy(r.lensMat.color);
        r.beamMat.opacity = sel ? 0.13 : 0.05;
      }
    }
  }

  private drop(r: Rig) {
    this.group.remove(r.g);
    r.g.traverse((o: any) => { if (o.isMesh) { o.geometry.dispose(); if (o.material !== METAL) o.material.dispose(); } });
  }
}
