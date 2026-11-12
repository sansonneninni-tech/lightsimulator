import { useEffect, useRef, useState } from 'react';
import { useStore, Shot } from './store';
import { Engine } from './engine/Engine';
import { ref, eng } from './engineRef';
import Handles from './ui/Handles';
import { SelectionCard } from './ui/Cards';
import { LightsPanel, PeoplePanel, CameraPanel, SkyPanel, PlaceMenu, PanelId } from './ui/Panels';
import { Roll, Viewer } from './ui/Viewer';
import { loadPhotos, saveProject, openProject, loadSample, snapshotOf } from './project';
import { addLightAtScreen, addLight, removeSelection } from './actions';
import { Start, RoomPanel, FurnitureCard, OpeningCard } from './ui/Room';
import { moveFurniture, updateOpening, autoExpose } from './build';
import { wallFrame } from './engine/room';
import { fmtHour, WEATHER } from './engine/sun';
import { fmtStop } from './engine/photometry';
import { newId } from './engine/photometry';
import * as THREE from 'three';

const FC_LEGEND: [string, string][] = [['#730f99', 'Nero'], ['#1a40f2', '−4'], ['#3fbf3f', '18%'], ['#f28cad', 'Pelle'], ['#ffe61a', '+3'], ['#f21a1a', 'Bruciato']];

export default function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const projRef = useRef<HTMLInputElement>(null);
  const phase = useStore((s) => s.phase);
  const status = useStore((s) => s.status);
  const progress = useStore((s) => s.progress);
  const photos = useStore((s) => s.photos);
  const placeName = useStore((s) => s.placeName);
  const sun = useStore((s) => s.sun);
  const cam = useStore((s) => s.cam);
  const toast = useStore((s) => s.toast);
  const shooting = useStore((s) => s.shooting);
  const showOriginal = useStore((s) => s.showOriginal);
  const recon = useStore((s) => s.recon);
  const [panel, setPanel] = useState<PanelId>(null);
  const [over, setOver] = useState(false);
  const [idle, setIdle] = useState(false);
  const [toastOn, setToastOn] = useState(false);
  const [forming, setForming] = useState(false);
  const [help, setHelp] = useState(() => !localStorage.getItem('ls-help'));

  // motore
  useEffect(() => {
    const e = new Engine(stageRef.current!);
    ref.engine = e;
    (window as any).__engine = e;
    (window as any).__store = useStore;
    const unsub = useStore.subscribe((s, p) => {
      if (s.lights !== p.lights || s.people !== p.people || s.props !== p.props || s.sun !== p.sun || s.cam !== p.cam || s.ambient !== p.ambient || s.room !== p.room || s.furniture !== p.furniture) e.apply(snapshotOf());
      if (s.selection !== p.selection || s.furniture !== p.furniture) e.setSelected(s.selection?.type === 'furniture' || s.selection?.type === 'opening' ? s.selection.id : null);
    });
    const idOf = (o: THREE.Object3D | null | undefined, key: string): string | null => {
      while (o) { if (o.userData?.[key]) return o.userData[key]; o = o.parent; }
      return null;
    };
    // trascinare l'arredo o l'apertura già scelti (altrimenti il trascinamento gira lo sguardo)
    const grabTarget = (ev: PointerEvent) => {
      const s = useStore.getState();
      if (s.phase !== 'ready' || s.meter || !s.room || !s.selection) return null;
      const sel = s.selection;
      if (sel.type !== 'furniture' && sel.type !== 'opening') return null;
      const hit = e.raycast(ev.clientX, ev.clientY);
      if (!hit) return null;
      const id = idOf(hit.object, sel.type === 'furniture' ? 'furnitureId' : 'openingId');
      return id === sel.id ? { sel, hit } : null;
    };
    e.onHover = (ev) => !!grabTarget(ev);
    e.onGrab = (ev) => {
      const g = grabTarget(ev);
      if (!g) return null;
      const s = useStore.getState();
      if (g.sel.type === 'furniture') {
        const f = s.furniture.find((x) => x.id === g.sel.id)!;
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -g.hit.point.y);
        const ox = f.position[0] - g.hit.point.x, oz = f.position[2] - g.hit.point.z;
        return {
          start: () => useStore.getState().snapshot(),
          move: (m) => {
            const p = e.rayPlane(m.clientX, m.clientY, plane);
            if (!p || p.distanceTo(e.camera.position) > 40) return;
            moveFurniture(f.id, { position: [p.x + ox, f.position[1], p.z + oz] });
          },
        };
      }
      const o = s.room!.openings.find((x) => x.id === g.sel.id)!;
      const fr = wallFrame(s.room!, o.wall);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(fr.normal, fr.origin);
      const u0 = g.hit.point.clone().sub(fr.origin).dot(fr.right), v0 = g.hit.point.y;
      return {
        start: () => useStore.getState().snapshot(),
        move: (m) => {
          const p = e.rayPlane(m.clientX, m.clientY, plane);
          if (!p) return;
          const u = p.clone().sub(fr.origin).dot(fr.right);
          const patch: any = { offset: o.offset + (u - u0) };
          if (o.kind === 'finestra') patch.sill = Math.max(0.2, o.sill + (p.y - v0));
          updateOpening(o.id, patch);
        },
      };
    };
    e.onClick = (ev) => {
      const s = useStore.getState();
      setPanel(null);
      if (s.phase !== 'ready') return;
      if (s.meter) {
        const m = e.measure(ev.clientX, ev.clientY);
        if (m) useStore.setState({ meterPin: { p: m.point.toArray() as any, text: `${Math.round(m.lux).toLocaleString('it-IT')} lux · f/${fmtStop(m.fStop)} · ${m.stops >= 0 ? '+' : '−'}${Math.abs(m.stops).toFixed(1)} stop` } });
        return;
      }
      // tocco su persona o oggetto: selezione
      const hit = e.raycast(ev.clientX, ev.clientY);
      let o: THREE.Object3D | null = hit?.object || null;
      while (o) {
        if (o.userData?.personId) { useStore.setState({ selection: { type: 'person', id: o.userData.personId } }); return; }
        if (o.userData?.propId) { useStore.setState({ selection: { type: 'prop', id: o.userData.propId } }); return; }
        if (o.userData?.furnitureId) { useStore.setState({ selection: { type: 'furniture', id: o.userData.furnitureId }, manikin: null }); return; }
        if (o.userData?.openingId) { useStore.setState({ selection: { type: 'opening', id: o.userData.openingId }, manikin: null }); return; }
        o = o.parent;
      }
      useStore.setState({ selection: null, manikin: null });
    };
    e.onDoubleClick = (ev) => {
      if (useStore.getState().phase !== 'ready' || useStore.getState().meter) return;
      addLightAtScreen(ev.clientX, ev.clientY);
    };
    return () => { unsub(); e.dispose(); ref.engine = null; };
  }, []);

  // forma della scena: sfocata mentre si costruisce
  useEffect(() => {
    if (phase === 'ready') { setForming(true); const t = setTimeout(() => setForming(false), 80); return () => clearTimeout(t); }
  }, [phase]);

  // aiuto: solo alla prima scena, poi si ritira (resta nelle schede e nel pannello Camera)
  useEffect(() => {
    if (phase !== 'ready' || !help) return;
    const t = setTimeout(() => { setHelp(false); localStorage.setItem('ls-help', '1'); }, 20000);
    return () => clearTimeout(t);
  }, [phase, help]);

  // toast
  useEffect(() => {
    if (!toast) return;
    setToastOn(true);
    const t = setTimeout(() => setToastOn(false), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  // comandi da tastiera
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range';
      if (typing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else { s.undo(); if (s.past.length) s.showToast('Annullato'); } return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); projRef.current?.click(); return; }
      if (s.phase !== 'ready') return;
      if (e.code === 'Space' && !e.repeat && s.photos.length) { e.preventDefault(); useStore.setState({ showOriginal: true }); return; }
      if (e.key.toLowerCase() === 'r' && !mod && s.selection?.type === 'furniture') {
        const f = s.furniture.find((x) => x.id === s.selection!.id);
        if (f) { s.snapshot(); moveFurniture(f.id, { rotationY: (f.rotationY + (e.shiftKey ? 90 : 270)) % 360 }); }
        return;
      }
      if (e.key === 'Escape') {
        if (s.shooting) { eng()?.cancelShot(); return; }
        setPanel(null); useStore.setState({ selection: null, manikin: null, meter: false, meterPin: null }); return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && s.selection) {
        const L = s.selection.type === 'light' ? s.lights.find((l) => l.id === s.selection!.id) : null;
        if (L?.origin === 'finestra') { s.showToast('Le finestre non si possono rimuovere: spegnile o chiudi la luce naturale.'); return; }
        e.preventDefault(); removeSelection(); return;
      }
      if (e.key === '+' || e.key === '=') { addLight('Pannello'); return; }
      if (e.key.toLowerCase() === 'f' && !mod) { eng()?.resetView(); return; }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') useStore.setState({ showOriginal: false }); };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); };
  }, []);

  // interfaccia che si ritira quando non si muove nulla
  useEffect(() => {
    let t: any;
    // su tablet e telefono (niente mouse) l'interfaccia resta sempre visibile: un tocco
    // su un pulsante nascosto finirebbe sulla scena
    if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) return;
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 3500); };
    addEventListener('pointermove', wake); addEventListener('keydown', wake); addEventListener('pointerdown', wake, true);
    wake();
    return () => { removeEventListener('pointermove', wake); removeEventListener('keydown', wake); removeEventListener('pointerdown', wake, true); clearTimeout(t); };
  }, []);

  // trascinamento file
  useEffect(() => {
    const dragover = (e: DragEvent) => { e.preventDefault(); setOver(true); };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setOver(false); };
    const drop = (e: DragEvent) => {
      e.preventDefault(); setOver(false);
      const files = [...(e.dataTransfer?.files || [])];
      const proj = files.find((f) => f.name.endsWith('.luce'));
      if (proj) { openProject(proj); return; }
      // il caricamento delle foto è messo da parte per ora: si costruisce la stanza a mano
      if (files.length) useStore.getState().showToast('Per ora la stanza si costruisce a mano: scegli un modello. Qui si aprono i progetti .luce.');
    };
    addEventListener('dragover', dragover); addEventListener('dragleave', leave); addEventListener('drop', drop);
    return () => { removeEventListener('dragover', dragover); removeEventListener('dragleave', leave); removeEventListener('drop', drop); };
  }, []);

  const shoot = async () => {
    const e = eng();
    const s = useStore.getState();
    if (!e || s.phase !== 'ready') return;
    if (s.shooting) { e.cancelShot(); return; }
    setPanel(null);
    useStore.setState({ shooting: 0.001, selection: null, manikin: null, meterPin: null });
    e.navEnabled = false;
    const canvas = await e.shoot((p) => useStore.setState({ shooting: Math.max(0.001, p) }));
    e.navEnabled = true;
    useStore.setState({ shooting: 0 });
    if (!canvas) { s.showToast('Scatto annullato.'); return; }
    const url = canvas.toDataURL('image/jpeg', 0.92);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(e.camera.quaternion);
    const fr = e.frameRect;
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(e.camera.fov) / 2) * e.camera.aspect * (fr.x1 - fr.x0));
    const shot: Shot & any = { id: newId('s'), url, width: canvas.width, height: canvas.height, scene: snapshotOf(), createdAt: Date.now(), camPos: e.camera.position.toArray(), camDir: fwd.toArray(), hfov };
    useStore.setState({ shots: [...useStore.getState().shots, shot] });
    useStore.getState().showToast('Scatto salvato nel rullino, con lo stato di tutte le luci.');
  };

  // posizione della foto originale (Spazio): stessa apertura verticale della foto
  const origStyle = (() => {
    const e = eng();
    if (!e || !recon) return {};
    const H = e.container.clientHeight;
    const k = Math.tan(THREE.MathUtils.degToRad(recon.camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(e.camera.fov) / 2);
    const h = H * k;
    return { height: h, width: h * recon.camera.aspect };
  })();

  const ready = phase === 'ready';
  const ringOffset = 132 * (1 - shooting);
  return (
    <div className={idle && ready && !panel && !shooting ? 'idle' : ''}>
      {phase === 'working' && photos[0] && <div id="workbg" style={{ backgroundImage: `url(${photos[0]})` }} />}
      <div id="stage" ref={stageRef} className={forming ? 'forming' : ''} style={{ visibility: ready ? 'visible' : 'hidden' }} />
      {ready && <Handles />}
      {ready && showOriginal && photos[0] && (
        <>
          <div id="orig"><img src={photos[0]} style={origStyle as any} alt="Foto originale" /></div>
          <div id="origLbl" className="glass">Foto originale</div>
        </>
      )}

      {phase === 'empty' && <Start onOpen={() => projRef.current?.click()} />}
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) loadPhotos(f); }} />
      <input ref={projRef} type="file" accept=".luce,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) openProject(f); }} />

      <div id="status" className={status ? 'show' : ''}>
        {status}
        {phase === 'working' && progress > 0 && progress < 1 && <div className="bar"><i style={{ width: `${progress * 100}%` }} /></div>}
      </div>

      {ready && (
        <>
          <button id="place" className={`chrome ${panel === 'place' ? 'on' : ''}`} onClick={() => setPanel(panel === 'place' ? null : 'place')}>{placeName}</button>
          <button id="sky" className={`chrome num ${panel === 'sky' ? 'on' : ''}`} onClick={() => setPanel(panel === 'sky' ? null : 'sky')}>
            {sun.enabled ? `${fmtHour(sun.hour)} · ${WEATHER.find((w) => w.id === sun.weather)?.name}` : 'Luce naturale spenta'}
          </button>
          <div id="dock" className="glass chrome">
            {useStore.getState().room && (
              <button className={`dbtn ${panel === 'room' ? 'on' : ''}`} onClick={() => setPanel(panel === 'room' ? null : 'room')}>
                <svg viewBox="0 0 24 24"><path d="M3 10l9-6 9 6v10H3z" /><path d="M9 20v-6h6v6" /></svg><span className="t">Stanza</span>
              </button>
            )}
            <button className={`dbtn ${panel === 'lights' ? 'on' : ''}`} onClick={() => setPanel(panel === 'lights' ? null : 'lights')}>
              <svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="5" /><path d="M10 18h4M10.5 21h3" /></svg><span className="t">Luci</span>
            </button>
            <button className={`dbtn ${panel === 'people' ? 'on' : ''}`} onClick={() => setPanel(panel === 'people' ? null : 'people')}>
              <svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="3" /><path d="M6 21v-5a6 6 0 0 1 12 0v5" /></svg><span className="t">Persone</span>
            </button>
            <button className={`dbtn ${panel === 'camera' ? 'on' : ''}`} onClick={() => setPanel(panel === 'camera' ? null : 'camera')}>
              <svg viewBox="0 0 24 24"><rect x="3" y="7" width="14" height="11" rx="2" /><path d="M17 11l4-2v7l-4-2" /></svg><span className="t">Camera</span>
            </button>
            <div className="sep" />
            <button id="shutter" className={shooting ? 'busy' : ''} aria-label="Scatta" onClick={shoot}>
              <div className="core" />
              <svg width="44" height="44"><circle className="p" cx="22" cy="22" r="21" style={{ strokeDashoffset: shooting ? ringOffset : 132 }} /></svg>
              <span className="tip">{shooting ? `Render ${Math.round(shooting * 100)}% · tocca per annullare` : 'Scatta il render finale'}</span>
            </button>
          </div>
          {cam.falseColor ? (
            <div id="legend" className="glass chrome">{FC_LEGEND.map(([c, n]) => <span key={n}><i style={{ background: c }} />{n}</span>)}</div>
          ) : help && (
            <div id="help" className="chrome">Trascina per guardarti intorno · rotella o W A S D per muoverti<br />Tocca un mobile e trascinalo · trascina un punto luminoso per spostare la luce<br />Doppio clic: nuova luce · Cmd+Z: annulla · F: vista iniziale</div>
          )}
          <Roll />
          <SelectionCard />
          {panel === 'room' && <RoomPanel onClose={() => setPanel(null)} />}
          {panel === 'lights' && <LightsPanel onClose={() => setPanel(null)} />}
          {panel === 'people' && <PeoplePanel onClose={() => setPanel(null)} />}
          {panel === 'camera' && <CameraPanel onClose={() => setPanel(null)} />}
          {panel === 'sky' && <SkyPanel onClose={() => setPanel(null)} />}
          {panel === 'place' && <PlaceMenu onClose={() => setPanel(null)} onNew={() => useStore.setState({ phase: 'empty', selection: null, manikin: null })} onSave={saveProject} onOpen={() => projRef.current?.click()} />}
          <Viewer />
        </>
      )}
      <div id="toast" className={`glass ${toastOn ? 'show' : ''}`}>{toast?.text}</div>
    </div>
  );
}
