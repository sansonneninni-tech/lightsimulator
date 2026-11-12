// Punti luminosi, anelli delle persone, quadratini degli oggetti, articolazioni e mirino:
// elementi DOM sopra la scena 3D, riposizionati a ogni fotogramma.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import { eng } from '../engineRef';
import { lightColor, fixtureById } from '../engine/photometry';
import { HANDLES, aimJoint, POSES } from '../engine/mannequin';
import { clampToRoom } from '../actions';
import { stopsLabel } from '../export/exports';
import { sunSky } from '../engine/sun';
import { PROP_KINDS } from '../engine/Engine';

export const cssColor = (kelvin: number, gel: string) => {
  const c = lightColor(kelvin, gel);
  const m = Math.max(c.r, c.g, c.b) || 1;
  return `rgb(${Math.round((Math.pow(c.r / m, 1 / 2.2)) * 255)},${Math.round(Math.pow(c.g / m, 1 / 2.2) * 255)},${Math.round(Math.pow(c.b / m, 1 / 2.2) * 255)})`;
};

// punto sul bordo dello schermo nella direzione di p (per ciò che sta fuori inquadratura)
export function edgePoint(p: THREE.Vector3 | [number, number, number], margin = 30) {
  const e = eng()!;
  const W = e.container.clientWidth, H = e.container.clientHeight;
  const pr = e.project(p);
  const inside = !pr.behind && pr.x >= 0 && pr.y >= 0 && pr.x <= W && pr.y <= H;
  const v = (Array.isArray(p) ? new THREE.Vector3(...p) : p.clone()).applyMatrix4(e.camera.matrixWorldInverse);
  let dx = v.x, dy = -v.y;
  if (Math.hypot(dx, dy) < 1e-4) dy = 1;
  const cx = W / 2, cy = H / 2;
  const k = Math.min((cx - margin) / Math.max(1e-6, Math.abs(dx)), (cy - margin) / Math.max(1e-6, Math.abs(dy)));
  return { inside, x: inside ? pr.x : cx + dx * k, y: inside ? pr.y : cy + dy * k, angle: Math.atan2(dy, dx) };
}

export function lookToward(p: [number, number, number]) {
  const e = eng();
  if (!e) return;
  const d = new THREE.Vector3(...p).sub(e.camera.position);
  e.yaw = Math.atan2(-d.x, -d.z);
  e.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) * 0.6;
  e.applyLook();
  e.dirty = true;
}

type DragSt = { x: number; y: number; moved: boolean; [k: string]: any };
function drag(el: HTMLElement, onMove: (e: PointerEvent, st: DragSt) => void, onStart?: (e: PointerEvent, st: DragSt) => void, onEnd?: (e: PointerEvent, st: DragSt) => void) {
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const st: DragSt = { x: e.clientX, y: e.clientY, moved: false };
    onStart?.(e, st);
    const mv = (ev: PointerEvent) => { st.moved = st.moved || Math.hypot(ev.clientX - st.x, ev.clientY - st.y) > 3; if (st.moved) onMove(ev, st); };
    const up = (ev: PointerEvent) => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); onEnd?.(ev, st); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  el.addEventListener('pointerdown', down);
  return () => el.removeEventListener('pointerdown', down);
}

export default function Handles() {
  const lights = useStore((s) => s.lights);
  const people = useStore((s) => s.people);
  const props = useStore((s) => s.props);
  const selection = useStore((s) => s.selection);
  const manikin = useStore((s) => s.manikin);
  const sun = useStore((s) => s.sun);
  const meterPin = useStore((s) => s.meterPin);
  const box = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  const els = useRef(new Map<string, HTMLElement>());

  const reg = (key: string) => (el: HTMLElement | null) => { if (el) els.current.set(key, el); else els.current.delete(key); };

  // posizionamento a ogni fotogramma
  useEffect(() => {
    const e = eng();
    if (!e) return;
    const place = () => {
      const s = useStore.getState();
      const W = e.container.clientWidth, H = e.container.clientHeight;
      const put = (key: string, p: THREE.Vector3 | [number, number, number] | null) => {
        const el = els.current.get(key);
        if (!el) return null;
        if (!p) { el.style.display = 'none'; return null; }
        const pr = e.project(p);
        const off = pr.behind || pr.x < -40 || pr.y < -40 || pr.x > W + 40 || pr.y > H + 40;
        el.style.display = off ? 'none' : '';
        el.style.transform = `translate(${pr.x}px,${pr.y}px)`;
        return pr;
      };
      for (const L of s.lights) {
        put('l' + L.id, L.position);
        const ed = els.current.get('e' + L.id);
        if (ed) {
          const q = edgePoint(L.position);
          ed.style.display = q.inside ? 'none' : '';
          ed.style.transform = `translate(${q.x}px,${q.y}px)`;
          (ed.firstElementChild as HTMLElement).style.transform = `rotate(${q.angle}rad)`;
        }
      }
      for (const P of s.people) put('p' + P.id, P.position);
      for (const O of s.props) put('o' + O.id, O.position);
      const sel = s.selection;
      const line = lineRef.current;
      if (sel?.type === 'light') {
        const L = s.lights.find((l) => l.id === sel.id);
        if (L && L.origin !== 'finestra' && fixtureById(L.fixtureId).kind !== 'point') {
          const a = put('aim', L.target);
          const b = e.project(L.position);
          if (line && a && !a.behind && !b.behind) {
            line.setAttribute('x1', String(b.x)); line.setAttribute('y1', String(b.y));
            line.setAttribute('x2', String(a.x)); line.setAttribute('y2', String(a.y));
            line.style.display = '';
          } else if (line) line.style.display = 'none';
        } else { put('aim', null); if (line) line.style.display = 'none'; }
      } else if (line) line.style.display = 'none';
      if (s.manikin) for (const h of HANDLES) put('j' + h.at, e.jointWorld(s.manikin, h.at));
      const mp = s.meterPin;
      if (mp) put('meter', mp.p);
    };
    e.onFrame = place;
    e.dirty = true;
    return () => { if (e.onFrame === place) e.onFrame = null; };
  }, [lights, people, props, selection, manikin, meterPin]);

  const skyK = sunSky(sun).skyK;
  return (
    <div id="handles" ref={box}>
      <svg className="lines"><line ref={lineRef} stroke="rgba(255,255,255,.5)" strokeWidth="1" strokeDasharray="3 4" style={{ display: 'none' }} /></svg>
      {lights.map((L) => (
        <LightHandle key={L.id} id={L.id} reg={reg('l' + L.id)} color={cssColor(L.origin === 'finestra' ? skyK : L.kelvin, L.gel)}
          on={L.on} sel={selection?.type === 'light' && selection.id === L.id} label={`${L.name} · ${L.origin === 'finestra' ? (sun.enabled ? 'cielo' : 'spenta') : stopsLabel(L.stops)}`}
          appear={(L as any)._new} win={L.origin === 'finestra'} />
      ))}
      {lights.map((L) => (
        <div key={'e' + L.id} ref={reg('e' + L.id)} className={`edge${selection?.type === 'light' && selection.id === L.id ? ' sel' : ''}`} title={L.name}
          style={{ color: cssColor(L.origin === 'finestra' ? skyK : L.kelvin, L.gel), opacity: L.on ? 1 : 0.4 }}
          onPointerDown={(ev) => ev.stopPropagation()}
          onClick={() => useStore.setState({ selection: { type: 'light', id: L.id } })}
          onDoubleClick={(ev) => { ev.stopPropagation(); lookToward(L.position); }}>
          <i /><b />
        </div>
      ))}
      {people.map((P) => (
        <PersonHandle key={P.id} id={P.id} reg={reg('p' + P.id)} sel={selection?.type === 'person' && selection.id === P.id} label={POSES.find((q) => q.id === P.pose)?.name || ''} />
      ))}
      {props.map((O) => (
        <PropHandle key={O.id} id={O.id} reg={reg('o' + O.id)} sel={selection?.type === 'prop' && selection.id === O.id} label={PROP_KINDS.find((k) => k.id === O.kind)?.name || ''} />
      ))}
      {selection?.type === 'light' && <AimHandle reg={reg('aim')} id={selection.id} />}
      {manikin && HANDLES.map((h) => <JointHandle key={h.at} reg={reg('j' + h.at)} personId={manikin} at={h.at} rotates={h.rotates} label={h.label} />)}
      {meterPin && <div ref={reg('meter')} className="meterpin glass num">{meterPin.text}</div>}
    </div>
  );
}

function LightHandle({ id, reg, color, on, sel, label, appear, win }: { id: string; reg: (el: HTMLElement | null) => void; color: string; on: boolean; sel: boolean; label: string; appear?: boolean; win?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = el.current!;
    const dot = root.querySelector('.dot') as HTMLElement, ring = root.querySelector('.ring') as HTMLElement;
    const select = () => useStore.setState({ selection: { type: 'light', id } });
    const st = useStore.getState;
    const offs: (() => void)[] = [];
    // punto: sposta (in orizzontale; Alt = in verticale)
    offs.push(drag(dot, (e, s) => {
      const L = st().lights.find((l) => l.id === id);
      const en = eng();
      if (!L || !en || L.origin === 'finestra') return;
      let p: THREE.Vector3 | null;
      if (e.altKey) {
        const pr = en.project(L.position);
        const dy = (s.ly - e.clientY) * (pr.dist * 2 * Math.tan(THREE.MathUtils.degToRad(en.camera.fov) / 2)) / en.container.clientHeight;
        s.ly = e.clientY;
        p = new THREE.Vector3(L.position[0], L.position[1] + dy, L.position[2]);
      } else {
        p = en.rayPlane(e.clientX, e.clientY, new THREE.Plane(new THREE.Vector3(0, 1, 0), -L.position[1]));
        if (!p || p.distanceTo(en.camera.position) > 40) return;
      }
      clampToRoom(p, 0.1);
      st().updateLight(id, { position: p.toArray() as any });
    }, (e, s) => { st().snapshot(); s.ly = e.clientY; }, (_e, s) => { if (!s.moved) select(); }));
    // anello: intensità in stop
    offs.push(drag(ring, (e, s) => {
      const v = Math.max(-8, Math.min(3, s.s0 + (s.y - e.clientY) / 40));
      st().updateLight(id, { stops: Math.round(v * 3) / 3 });
    }, (_e, s) => { st().snapshot(); s.s0 = st().lights.find((l) => l.id === id)?.stops || 0; }, (_e, s) => { if (!s.moved) select(); }));
    // rotella: Kelvin
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); e.stopPropagation();
      const L = st().lights.find((l) => l.id === id);
      if (!L || L.origin === 'finestra') return;
      const fx = fixtureById(L.fixtureId);
      if (fx.kelvinFixed) { st().showToast(`${fx.name}: ${fx.kelvinFixed} K fissa. Usa i gel per cambiare colore.`); return; }
      const [a, b] = fx.kelvinRange || [2000, 10000];
      const k = Math.max(a, Math.min(b, L.kelvin - Math.sign(e.deltaY) * 100));
      st().updateLight(id, { kelvin: k });
      st().showToast(`${L.name}: ${k} K`);
    };
    root.addEventListener('wheel', wheel, { passive: false });
    return () => { offs.forEach((f) => f()); root.removeEventListener('wheel', wheel); };
  }, [id]);
  return (
    <div ref={(n) => { (el as any).current = n; reg(n); }} className={`handle${sel ? ' sel' : ''}${on ? '' : ' off'}${appear ? ' appear' : ''}${win ? ' win' : ''}`}>
      <div className="ring" />
      <div className="dot" style={{ background: color, color }} />
      <div className="lbl num">{label}</div>
    </div>
  );
}

function PersonHandle({ id, reg, sel, label }: { id: string; reg: (el: HTMLElement | null) => void; sel: boolean; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = el.current!;
    const st = useStore.getState;
    const off = drag(root, (e) => {
      const en = eng();
      if (!en) return;
      const p = en.rayPlane(e.clientX, e.clientY, new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
      if (!p || p.distanceTo(en.camera.position) > 30) return;
      clampToRoom(p, 0.3); p.y = 0;
      st().updatePerson(id, { position: p.toArray() as any });
    }, () => st().snapshot(), (_e, s) => { if (!s.moved) useStore.setState({ selection: { type: 'person', id } }); });
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); e.stopPropagation();
      const P = st().people.find((p) => p.id === id);
      if (!P) return;
      st().updatePerson(id, { rotationY: (P.rotationY + Math.sign(e.deltaY) * 10 + 360) % 360 });
    };
    const dbl = (e: MouseEvent) => {
      e.stopPropagation();
      const m = st().manikin === id ? null : id;
      useStore.setState({ manikin: m, selection: { type: 'person', id } });
      if (m) st().showToast('Manichino: trascina i pallini delle articolazioni. Doppio clic per uscire.');
    };
    root.addEventListener('wheel', wheel, { passive: false });
    root.addEventListener('dblclick', dbl);
    return () => { off(); root.removeEventListener('wheel', wheel); root.removeEventListener('dblclick', dbl); };
  }, [id]);
  return <div ref={(n) => { (el as any).current = n; reg(n); }} className={`phandle${sel ? ' sel' : ''}`}><div className="lbl">{label}</div></div>;
}

function PropHandle({ id, reg, sel, label }: { id: string; reg: (el: HTMLElement | null) => void; sel: boolean; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = el.current!;
    const st = useStore.getState;
    const off = drag(root, (e, s) => {
      const en = eng();
      const O = st().props.find((p) => p.id === id);
      if (!en || !O) return;
      let p: THREE.Vector3 | null;
      if (e.altKey) {
        const pr = en.project(O.position);
        const dy = (s.ly - e.clientY) * (pr.dist * 2 * Math.tan(THREE.MathUtils.degToRad(en.camera.fov) / 2)) / en.container.clientHeight;
        s.ly = e.clientY;
        p = new THREE.Vector3(O.position[0], O.position[1] + dy, O.position[2]);
      } else {
        p = en.rayPlane(e.clientX, e.clientY, new THREE.Plane(new THREE.Vector3(0, 1, 0), -O.position[1]));
        if (!p || p.distanceTo(en.camera.position) > 30) return;
      }
      clampToRoom(p, 0.1);
      st().updateProp(id, { position: p.toArray() as any });
    }, (e, s) => { st().snapshot(); s.ly = e.clientY; }, (_e, s) => { if (!s.moved) useStore.setState({ selection: { type: 'prop', id } }); });
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); e.stopPropagation();
      const O = st().props.find((p) => p.id === id);
      if (O) st().updateProp(id, { rotationY: (O.rotationY + Math.sign(e.deltaY) * 10 + 360) % 360 });
    };
    root.addEventListener('wheel', wheel, { passive: false });
    return () => { off(); root.removeEventListener('wheel', wheel); };
  }, [id]);
  return <div ref={(n) => { (el as any).current = n; reg(n); }} className={`ohandle${sel ? ' sel' : ''}`}><div className="lbl">{label}</div></div>;
}

function AimHandle({ reg, id }: { reg: (el: HTMLElement | null) => void; id: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = el.current!;
    const st = useStore.getState;
    return drag(root, (e) => {
      const en = eng();
      if (!en) return;
      const hit = en.raycast(e.clientX, e.clientY);
      if (!hit) return;
      st().updateLight(id, { target: hit.point.toArray() as any });
    }, () => st().snapshot());
  }, [id]);
  return <div ref={(n) => { (el as any).current = n; reg(n); }} className="aim" title="Trascina per puntare la luce" />;
}

function JointHandle({ reg, personId, at, rotates, label }: { reg: (el: HTMLElement | null) => void; personId: string; at: string; rotates: string; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = el.current!;
    const st = useStore.getState;
    return drag(root, (e) => {
      const en = eng();
      if (!en) return;
      const o = en.people.get(personId);
      const jp = en.jointWorld(personId, at);
      if (!o || !jp) return;
      const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(en.camera.quaternion);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, jp);
      const p = en.rayPlane(e.clientX, e.clientY, plane);
      if (!p) return;
      const eul = aimJoint(o.obj, rotates, at, p);
      const P = st().people.find((q) => q.id === personId);
      if (P) st().updatePerson(personId, { joints: { ...P.joints, [rotates]: eul } });
    }, () => st().snapshot());
  }, [personId, at, rotates]);
  return <div ref={(n) => { (el as any).current = n; reg(n); }} className="joint" title={label} />;
}
