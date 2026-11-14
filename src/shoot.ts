// Scatto finale: una foto, oppure i fotogrammi fissi di un movimento di camera.
import * as THREE from 'three';
import { useStore, Shot } from './store';
import { eng } from './engineRef';
import { snapshotOf } from './project';
import { newId } from './engine/photometry';
import { CamMove, Pose, poseAt, moveLabel, frameLabel, easeInOut } from './engine/camMove';

function shotOf(canvas: HTMLCanvasElement): Shot & any {
  const e = eng()!;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(e.camera.quaternion);
  const fr = e.frameRect;
  const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(e.camera.fov) / 2) * e.camera.aspect * (fr.x1 - fr.x0));
  return { id: newId('s'), url: canvas.toDataURL('image/jpeg', 0.92), width: canvas.width, height: canvas.height, scene: snapshotOf(), createdAt: Date.now(), camPos: e.camera.position.toArray(), camDir: fwd.toArray(), hfov };
}

export function getPose(): Pose {
  const e = eng()!;
  return { pos: e.camera.position.toArray() as [number, number, number], yaw: e.yaw, pitch: e.pitch };
}

export function setPose(p: Pose) {
  const e = eng();
  if (!e) return;
  e.camera.position.set(...p.pos);
  e.yaw = p.yaw; e.pitch = p.pitch;
  e.applyLook();
  e.dirty = true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// anteprima del movimento in tempo reale (poi si torna all'inquadratura di partenza)
let previewing = 0;
export async function previewMove(m: CamMove) {
  const e = eng();
  if (!e || previewing) return;
  const id = ++previewing;
  const start = getPose();
  const dur = 2600;
  const t0 = performance.now();
  e.navEnabled = false;
  await new Promise<void>((res) => {
    const step = () => {
      if (previewing !== id) return res();
      const t = Math.min(1, (performance.now() - t0) / dur);
      setPose(poseAt(start, m, easeInOut(t)));
      if (t < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  await sleep(700);
  setPose(start);
  e.navEnabled = true;
  previewing = 0;
}

async function render(onProgress: (p: number) => void) {
  const e = eng()!;
  e.navEnabled = false;
  const canvas = await e.shoot(onProgress);
  e.navEnabled = true;
  return canvas;
}

export async function shootOnce() {
  const e = eng();
  const s = useStore.getState();
  if (!e || s.phase !== 'ready') return;
  if (s.shooting) { e.cancelShot(); return; }
  useStore.setState({ shooting: 0.001, selection: null, manikin: null, meterPin: null });
  const canvas = await render((p) => useStore.setState({ shooting: Math.max(0.001, p) }));
  useStore.setState({ shooting: 0 });
  if (!canvas) { s.showToast('Scatto annullato.'); return; }
  useStore.setState({ shots: [...useStore.getState().shots, shotOf(canvas)] });
  useStore.getState().showToast('Scatto salvato nel rullino, con lo stato di tutte le luci.');
}

// movimento: N fotogrammi fissi lungo il percorso, ognuno in qualità finale
export async function shootMove(m: CamMove) {
  const e = eng();
  const s = useStore.getState();
  if (!e || s.phase !== 'ready' || s.shooting) return;
  previewing = 0;
  const n = Math.max(2, m.frames);
  const start = getPose();
  const endP = poseAt(start, m, 1);
  setPose(endP);
  const endDir = new THREE.Vector3(0, 0, -1).applyQuaternion(e.camera.quaternion).toArray() as [number, number, number];
  setPose(start);
  const group = newId('m');
  const text = moveLabel(m);
  useStore.setState({ shooting: 0.001, selection: null, manikin: null, meterPin: null });
  const out: Shot[] = [];
  let cancelled = false;
  for (let i = 0; i < n; i++) {
    setPose(poseAt(start, m, i / (n - 1)));
    await sleep(60);
    s.showToast(`${text}: fotogramma ${i + 1} di ${n}`);
    const canvas = await render((p) => useStore.setState({ shooting: Math.max(0.001, (i + Math.min(1, p)) / n) }));
    if (!canvas) { cancelled = true; break; }
    const sh = shotOf(canvas);
    sh.move = { group, kind: m.kind, amount: m.amount, frame: i, of: n, label: frameLabel(i, n), text, start: start.pos, end: endP.pos, endDir };
    out.push(sh);
    useStore.setState({ shots: [...useStore.getState().shots, sh] });
  }
  setPose(start);
  useStore.setState({ shooting: 0 });
  if (cancelled) s.showToast(out.length ? `Movimento interrotto: ${out.length} fotogrammi salvati.` : 'Scatto annullato.');
  else { s.showToast(`${text}: ${n} fotogrammi nel rullino.`); useStore.setState({ viewer: out[0].id }); }
}
