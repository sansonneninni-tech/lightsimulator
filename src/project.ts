// Caricamento foto -> scena, salvataggio e apertura dei progetti (.luce).
import * as THREE from 'three';
import { useStore, defaultCam, SceneSnapshot } from './store';
import { eng } from './engineRef';
import { estimateDepth, downscale, readExif, DepthResult } from './engine/depth';
import { reconstruct, Reconstruction } from './engine/reconstruct';
import { sunAngles, defaultSun } from './engine/sun';
import { registerExtra, extraLights } from './engine/register';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap | HTMLImageElement;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as any);
  } catch {
    bmp = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file);
    });
  }
  return downscale(bmp as any, 2048);
}

function linkIds(recon: Reconstruction, readIds?: string[]) {
  if (!readIds) return;
  recon.lights.forEach((L, i) => {
    const old = L.id, nid = readIds[i];
    if (!nid) return;
    L.id = nid;
    recon.masks.forEach((m) => { if (m.lightId === old) m.lightId = nid; });
  });
}

// orienta il nord in modo che, all'ora scelta, il sole entri dalla finestra principale
function orientSun(recon: Reconstruction) {
  const sun = { ...defaultSun(), enabled: true, weather: 'nuvoloso' as const };
  const w = recon.windows.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!w) return { ...sun, weather: 'sereno' as const };
  const n = new THREE.Vector3(...w.normal);
  const toSun = n.clone().negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(30));
  const azScene = THREE.MathUtils.radToDeg(Math.atan2(toSun.x, -toSun.z));
  const { azimuth } = sunAngles(sun.hour, sun.dayOfYear, sun.latitude);
  return { ...sun, north: (((azScene - azimuth) % 360) + 360) % 360 };
}

export async function loadPhotos(files: File[]) {
  const st = useStore.getState;
  const images = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|avif)$/i.test(f.name));
  if (!images.length) { st().showToast('Questo file non è una foto. Prova con un JPG o un PNG.'); return; }
  const main = images[0];
  useStore.setState({ phase: 'working', status: images.length > 1 ? `Leggo ${images.length} foto e ricostruisco la stanza…` : 'Leggo la stanza e ricostruisco lo spazio…', progress: 0, selection: null, manikin: null });
  try {
    const buf = await main.arrayBuffer();
    const exif = readExif(buf);
    const canvas = await fileToCanvas(main);
    const url = canvas.toDataURL('image/jpeg', 0.9);
    useStore.setState({ photos: [url] });
    const name = main.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    // foto in più dello stesso luogo (fino a 5)
    const extras: ExtraIn[] = [];
    for (const f of images.slice(1, 6)) {
      try {
        const ex = readExif(await f.arrayBuffer());
        extras.push({ canvas: await fileToCanvas(f), focal35: ex.focal35 || exif.focal35 || 26 });
      } catch { /* foto illeggibile: si salta */ }
    }
    await build(canvas, undefined, exif.focal35 || 26, name && !/^(img|dsc|pxl|photo|foto)\s?\d/i.test(name) ? name : 'Nuovo luogo', undefined, extras);
  } catch (e) {
    console.error(e);
    useStore.setState({ phase: 'empty', status: '' });
    st().showToast('Non riesco ad aprire questa foto. Prova con un JPG o un PNG.');
  }
}

interface ExtraIn { canvas: HTMLCanvasElement; focal35: number; depth?: DepthResult; saved?: any }

async function build(canvas: HTMLCanvasElement, depthIn: DepthResult | undefined, focal35: number, placeName: string, saved?: any, extras: ExtraIn[] = []) {
  const st = useStore.getState;
  const depth = depthIn || await estimateDepth(canvas, (p, msg) => useStore.setState({ progress: p, status: p < 1 ? `${msg} · ${Math.round(p * 100)}%` : `${msg}…` }));
  useStore.setState({ status: 'Ricostruisco lo spazio…', progress: 1 });
  await sleep(30);
  const recon = reconstruct(canvas, depth, focal35);
  // foto in più: allineate alla prima, aggiungono le parti di stanza che la prima non vede
  const skipped: number[] = [];
  for (let i = 0; i < extras.length; i++) {
    const x = extras[i];
    const tot = extras.length + 1;
    const d = x.depth || await estimateDepth(x.canvas, (p) => useStore.setState({ progress: p, status: `Leggo la foto ${i + 2} di ${tot} · ${Math.round(p * 100)}%` }));
    useStore.setState({ status: `Unisco la foto ${i + 2} di ${tot} alla stanza…`, progress: 1 });
    await sleep(30);
    const ex = await registerExtra(recon, x.canvas, d, x.focal35, x.saved).catch((e) => { console.warn(e); return null; });
    if (!ex) { skipped.push(i + 2); continue; }
    recon.extras.push(ex);
    if (!x.saved) recon.lights.push(...extraLights(recon, ex));
    growRoom(recon, ex);
  }
  linkIds(recon, saved?.readIds);
  const e = eng()!;
  e.loadRecon(recon);
  const lights = saved ? saved.scene.lights : recon.lights;
  const sun = saved ? saved.scene.sun : orientSun(recon);
  const cam = saved ? saved.scene.cam : { ...defaultCam(), focal: Math.round(e.focalForPhoto('s35') * 10) / 10 };
  useStore.setState({
    recon, placeName, lights: [], people: saved?.scene.people || [], props: saved?.scene.props || [], sun, cam,
    ambient: saved ? saved.scene.ambient : 0.18, shots: saved?.shots || [], past: [], future: [], selection: null,
  });
  if (saved) {
    e.K = saved.K; e.skyCal = saved.skyCal;
    // riferimento con le luci lette, poi la scena salvata
    useStore.setState({ lights: recon.lights, ambient: 0.18, sun: orientSunSaved(saved, recon) });
    e.apply(snapshotOf()); e.updateEmissive(); e.syncSun(st().sun);
    e.captureBase();
    (e as any).baseSun = st().sun;
    useStore.setState({ lights, sun, ambient: saved.scene.ambient, phase: 'ready', status: '' });
    e.apply(snapshotOf());
    return;
  }
  // calibrazione con tutte le luci accese
  useStore.setState({ lights });
  e.apply(snapshotOf());
  const exp = e.calibrate();
  useStore.setState({ cam: { ...st().cam, ...exp } });
  e.updateEmissive(); e.syncSun(st().sun);
  e.captureBase();
  (e as any).baseSun = st().sun;
  useStore.setState({ lights: [] });
  // le luci trovate si accendono una alla volta
  useStore.setState({ phase: 'ready', status: 'Trovo le fonti di luce…' });
  for (const L of lights) {
    await sleep(550);
    useStore.setState({ lights: [...st().lights, { ...L, _new: true } as any] });
  }
  await sleep(300);
  const nWin = lights.filter((l: any) => l.origin === 'finestra').length;
  const nSrc = lights.length - nWin;
  const parts = [];
  if (nSrc) parts.push(`${nSrc} ${nSrc === 1 ? 'sorgente' : 'sorgenti'} di luce`);
  if (nWin) parts.push(`${nWin} ${nWin === 1 ? 'finestra' : 'finestre'}`);
  useStore.setState({ status: parts.length ? `Trovate ${parts.join(' e ')}` : 'Nessuna sorgente visibile: ho messo una luce ambiente' });
  if (skipped.length) st().showToast(skipped.length === 1 ? `La foto ${skipped[0]} non ha abbastanza punti in comune con la prima: l'ho lasciata da parte.` : `Le foto ${skipped.join(', ')} non hanno abbastanza punti in comune con la prima: le ho lasciate da parte.`);
  else if (recon.extras.length) st().showToast(`Ho unito ${recon.extras.length + 1} foto: la stanza è più completa quando ti muovi.`);
  if (depth.source === 'stima') st().showToast('Profondità stimata senza il lettore: la stanza è approssimata. Con la connessione il risultato è più preciso.');
  await sleep(2200);
  useStore.setState({ status: '', past: [], future: [] });
}

// la stanza si allarga per contenere ciò che le foto in più vedono
function growRoom(recon: Reconstruction, ex: import('./engine/register').ExtraView) {
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  const used = new Set(ex.index);
  for (const k of used) { xs.push(ex.world[k * 3]); ys.push(ex.world[k * 3 + 1]); zs.push(ex.world[k * 3 + 2]); }
  if (xs.length < 50) return;
  const pc = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor((p / 100) * (b.length - 1))]; };
  const r = recon.room;
  r.min[0] = Math.max(-15, Math.min(r.min[0], pc(xs, 2) - 0.08));
  r.max[0] = Math.min(15, Math.max(r.max[0], pc(xs, 98) + 0.08));
  r.min[2] = Math.max(-30, Math.min(r.min[2], pc(zs, 2) - 0.08));
  r.max[2] = Math.min(15, Math.max(r.max[2], pc(zs, 98) + 0.08));
  r.max[1] = Math.min(8, Math.max(r.max[1], pc(ys, 99) + 0.05));
}

// il sole com'era quando la foto è stata letta (salvato con il progetto se presente)
function orientSunSaved(saved: any, recon: Reconstruction) {
  return saved.baseSun || saved.scene.sun || orientSun(recon);
}

export function snapshotOf(): SceneSnapshot {
  const s = useStore.getState();
  return { lights: s.lights, people: s.people, props: s.props, sun: s.sun, cam: s.cam, ambient: s.ambient, room: s.room, furniture: s.furniture };
}

function f32ToB64(a: Float32Array) {
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToF32(b: string) {
  const s = atob(b);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return new Float32Array(u.buffer);
}

function downloadJSON(data: any, name: string) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(name || 'scena').replace(/[^\w\- àèéìòù]+/gi, '').trim() || 'scena'}.luce`;
  document.body.appendChild(a); a.click(); a.remove();
}

export function saveProject() {
  const s = useStore.getState();
  const e = eng();
  if (s.room) {
    downloadJSON({ app: 'lightsimulator', version: 2, kind: 'stanza', placeName: s.placeName, scene: snapshotOf(), shots: s.shots }, s.placeName);
    s.showToast('Progetto salvato. Puoi riaprirlo o mandarlo a chi lavora con te.');
    return;
  }
  if (!s.recon || !e) return;
  const r = s.recon;
  const data = {
    app: 'lightsimulator', version: 1, placeName: s.placeName,
    photo: r.photo.toDataURL('image/jpeg', 0.92),
    depth: { width: r.depthGrid.width, height: r.depthGrid.height, metric: r.depthGrid.metric, data: f32ToB64(Float32Array.from(r.depthGrid.data)) },
    focal35: r.focal35, readIds: r.lights.map((l) => l.id),
    K: e.K, skyCal: e.skyCal, baseSun: (e as any).baseSun,
    scene: snapshotOf(),
    shots: s.shots,
    extras: r.extras.map((x) => ({
      photo: x.photo.toDataURL('image/jpeg', 0.9), focal35: x.focal35,
      depth: { width: x.depthGrid.width, height: x.depthGrid.height, metric: x.depthGrid.metric, data: f32ToB64(Float32Array.from(x.depthGrid.data)) },
      pose: x.pose, alpha: x.alpha, beta: x.beta, gain: x.gain, inliers: x.inliers,
    })),
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(s.placeName || 'scena').replace(/[^\w\- àèéìòù]+/gi, '').trim() || 'scena'}.luce`;
  document.body.appendChild(a); a.click(); a.remove();
  s.showToast('Progetto salvato. Puoi riaprirlo o mandarlo a chi lavora con te.');
}

export async function openProject(file: File) {
  const st = useStore.getState;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'lightsimulator') throw new Error('formato');
    if (data.kind === 'stanza') {
      const e = eng()!;
      const sc = data.scene;
      e.clearBuilt();
      useStore.setState({
        phase: 'ready', status: '', recon: null, photos: [], placeName: data.placeName || 'Stanza',
        room: sc.room, furniture: sc.furniture || [], lights: sc.lights || [], people: sc.people || [], props: sc.props || [],
        sun: sc.sun, cam: sc.cam, ambient: 0, shots: data.shots || [], past: [], future: [], selection: null, manikin: null,
      });
      e.apply(snapshotOf());
      e.resetView();
      return;
    }
    useStore.setState({ phase: 'working', status: 'Apro il progetto…', progress: 1 });
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = data.photo; });
    const canvas = downscale(img, 2048);
    useStore.setState({ photos: [data.photo] });
    const depth: DepthResult = { width: data.depth.width, height: data.depth.height, metric: data.depth.metric, data: b64ToF32(data.depth.data), source: 'modello' };
    const extras: ExtraIn[] = [];
    for (const x of data.extras || []) {
      const im = new Image();
      await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = x.photo; });
      extras.push({ canvas: downscale(im, 2048), focal35: x.focal35, depth: { width: x.depth.width, height: x.depth.height, metric: x.depth.metric, data: b64ToF32(x.depth.data), source: 'modello' }, saved: x });
    }
    useStore.setState({ photos: [data.photo, ...(data.extras || []).map((x: any) => x.photo)] });
    await build(canvas, depth, data.focal35, data.placeName, data, extras);
  } catch (e) {
    console.error(e);
    useStore.setState({ phase: st().recon ? 'ready' : 'empty', status: '' });
    st().showToast('Non riesco ad aprire questo progetto. Serve un file .luce salvato da Light Simulator.');
  }
}

export async function loadSample() {
  let blob: Blob | null = null;
  try {
    const res = await fetch('./esempio.jpg');
    if (res.ok) blob = await res.blob();
  } catch { blob = null; }
  if (!blob || !blob.type.startsWith('image/')) {
    useStore.getState().showToast('La stanza di esempio non è disponibile, trascina una tua foto.');
    return;
  }
  await loadPhotos([new File([blob], 'Soggiorno di esempio.jpg', { type: 'image/jpeg' })]);
}
