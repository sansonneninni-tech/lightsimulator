// Pannelli del dock (Luci, Persone, Camera), luce naturale in alto a destra, menu del luogo in alto a sinistra.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { eng } from '../engineRef';
import Pop from './Pop';
import { Svg, TYPE_ICONS, POSE_ICONS } from './icons';
import { cssColor } from './Handles';
import { FOCALS, SENSORS, ISO_VALUES, FSTOPS, SHUTTERS, ASPECTS, fmtShutter, fmtStop } from '../engine/photometry';
import { POSES, PoseId } from '../engine/mannequin';
import { WEATHER, fmtHour, sunAngles, sunSky } from '../engine/sun';
import { LIGHT_TYPES, addLight, addPerson, addProp } from '../actions';
import { stopsLabel } from '../export/exports';
import { PROP_KINDS } from '../engine/Engine';

const FOCUS_VALUES = [0, 0.5, 0.7, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 1000];
const fmtFocus = (v: number) => (!v ? 'fuoco auto' : v >= 1000 ? 'fuoco ∞' : `fuoco ${v.toLocaleString('it-IT')} m`);

export type PanelId = 'lights' | 'people' | 'camera' | 'sky' | 'place' | null;

function dockAnchor() {
  const d = document.getElementById('dock');
  const r = d?.getBoundingClientRect();
  return { x: r ? r.left + r.width / 2 : innerWidth / 2, bottom: r ? innerHeight - r.top + 12 : 96 };
}

export function LightsPanel({ onClose }: { onClose: () => void }) {
  const lights = useStore((s) => s.lights);
  const ambient = useStore((s) => s.ambient);
  const sun = useStore((s) => s.sun);
  const st = useStore.getState;
  const a = dockAnchor();
  const skyK = sunSky(sun).skyK;
  const [more, setMore] = useState(false);
  return (
    <Pop x={a.x} y={0} bottom={a.bottom} anchor="above" width={320} onClose={onClose}>
      <h3>Luci</h3>
      <div className="list">
        {lights.map((L) => (
          <div key={L.id} className="it" onClick={() => { useStore.setState({ selection: { type: 'light', id: L.id } }); onClose(); }}>
            <span className="sw" style={{ background: cssColor(L.origin === 'finestra' ? skyK : L.kelvin, L.gel), opacity: L.on ? 1 : 0.25 }} />
            <span>{L.name}</span>
            <span className="num">{L.origin === 'finestra' ? 'cielo' : `${stopsLabel(L.stops)} · ${L.kelvin} K`}</span>
          </div>
        ))}
        {!lights.length && <div className="hint">Nessuna luce in scena.</div>}
      </div>
      <div className="hr" />
      <div className="k" style={{ color: 'var(--t2)', fontSize: 11, marginBottom: 8 }}>Aggiungi luce</div>
      <div className="types">
        {LIGHT_TYPES.map((t) => <button key={t} className="type" onClick={() => { addLight(t); onClose(); }}><Svg d={TYPE_ICONS[t]} />{t}</button>)}
      </div>
      <div className="k" style={{ color: 'var(--t2)', fontSize: 11, margin: '12px 0 8px' }}>Controllo</div>
      <div className="types four">
        {PROP_KINDS.map((k) => <button key={k.id} className="type" onClick={() => { addProp(k.id); onClose(); }}><Svg d={TYPE_ICONS[k.name]} />{k.name}</button>)}
      </div>
      <button className="more" onClick={() => setMore(!more)}>{more ? 'Meno ‹' : 'Più ›'}</button>
      {more && (
        <div className="row" style={{ marginBottom: 0, marginTop: 10 }}>
          <div className="k"><span>Luce che resta dalla foto</span><b className="num">{Math.round(ambient * 100)}%</b></div>
          <input type="range" min={0} max={1} step={0.01} value={ambient} onPointerDown={() => st().snapshot()} onChange={(e) => useStore.setState({ ambient: +e.target.value })} />
          <div className="hint">Luce della foto non attribuita a una sorgente.</div>
        </div>
      )}
    </Pop>
  );
}

export function PeoplePanel({ onClose }: { onClose: () => void }) {
  const a = dockAnchor();
  return (
    <Pop x={a.x} y={0} bottom={a.bottom} anchor="above" width={300} onClose={onClose}>
      <h3>Persone</h3>
      <div className="poses">
        {POSES.map((p) => <button key={p.id} className="pose" onClick={() => { addPerson(p.id as PoseId); onClose(); }}><Svg d={POSE_ICONS[p.id]} vb="0 0 28 36" />{p.name}</button>)}
      </div>
      <div className="hint">Doppio clic sull'anello di una persona per muovere le articolazioni.</div>
    </Pop>
  );
}

// valore trascinabile a destra/sinistra; un clic passa al successivo
function DragValue<T>({ values, value, fmt, onChange }: { values: T[]; value: T; fmt: (v: T) => string; onChange: (v: T) => void }) {
  const el = useRef<HTMLSpanElement>(null);
  const cur = useRef(value);
  cur.current = value;
  useEffect(() => {
    const node = el.current!;
    let st: { x: number; i0: number; moved: boolean } | null = null;
    const idx = (v: T) => {
      let best = 0, bd = Infinity;
      values.forEach((x, i) => { const d = typeof x === 'number' ? Math.abs(Math.log((x as any) / (v as any))) : x === v ? 0 : 1; if (d < bd) { bd = d; best = i; } });
      return best;
    };
    const down = (e: PointerEvent) => { e.stopPropagation(); node.setPointerCapture(e.pointerId); useStore.getState().snapshot(); st = { x: e.clientX, i0: idx(cur.current), moved: false }; };
    const move = (e: PointerEvent) => {
      if (!st) return;
      const d = Math.round((e.clientX - st.x) / 22);
      if (d !== 0) st.moved = true;
      const i = Math.max(0, Math.min(values.length - 1, st.i0 + d));
      if (values[i] !== cur.current) onChange(values[i]);
    };
    const up = () => {
      if (st && !st.moved) { const i = (idx(cur.current) + 1) % values.length; onChange(values[i]); }
      st = null;
    };
    node.addEventListener('pointerdown', down); node.addEventListener('pointermove', move); node.addEventListener('pointerup', up);
    return () => { node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); };
  }, [values, onChange]);
  return <span ref={el} className="v">{fmt(value)}</span>;
}

export function CameraPanel({ onClose }: { onClose: () => void }) {
  const cam = useStore((s) => s.cam);
  const meter = useStore((s) => s.meter);
  const a = dockAnchor();
  const set = (p: any) => useStore.setState({ cam: { ...useStore.getState().cam, ...p } });
  const focals = [...new Set([...FOCALS, Math.round(cam.focal)])].sort((x, y) => x - y);
  return (
    <Pop x={a.x} y={0} bottom={a.bottom} anchor="above" width={560} onClose={onClose}>
      <h3>Camera</h3>
      <div className="cam num">
        <DragValue values={focals} value={Math.round(cam.focal)} fmt={(v) => `${v} mm`} onChange={(v) => set({ focal: v })} /><span className="d">·</span>
        <DragValue values={SENSORS.map((s) => s.id)} value={cam.sensor} fmt={(v) => SENSORS.find((s) => s.id === v)!.name} onChange={(v) => set({ sensor: v })} /><span className="d">·</span>
        <DragValue values={ISO_VALUES} value={cam.iso} fmt={(v) => `ISO ${v}`} onChange={(v) => set({ iso: v })} /><span className="d">·</span>
        <DragValue values={FSTOPS} value={cam.fStop} fmt={(v) => `f/${fmtStop(v)}`} onChange={(v) => set({ fStop: v })} /><span className="d">·</span>
        <DragValue values={SHUTTERS} value={cam.shutter} fmt={fmtShutter} onChange={(v) => set({ shutter: v })} /><span className="d">·</span>
        <DragValue values={FOCUS_VALUES} value={cam.focus || 0} fmt={fmtFocus} onChange={(v) => set({ focus: v })} />
      </div>
      <div className="hint" style={{ margin: '4px 0 14px' }}>Trascina un valore a destra o a sinistra, o toccalo per il successivo. Il fuoco automatico segue la persona inquadrata o il centro.</div>
      <div className="line"><span>False color</span><div className={`toggle ${cam.falseColor ? 'on' : ''}`} onClick={() => set({ falseColor: !cam.falseColor })} /></div>
      <div className="line"><span>Esposimetro: tocca un punto della scena</span><div className={`toggle ${meter ? 'on' : ''}`} onClick={() => { useStore.setState({ meter: !meter, meterPin: null }); if (!meter) useStore.getState().showToast('Tocca un punto: ti dico lux e diaframma.'); }} /></div>
      <div className="row">
        <div className="k"><span>Formato</span></div>
        <div className="chips">{ASPECTS.map((m) => <button key={m.id} className={`chip ${cam.aspect === m.id ? 'on' : ''}`} onClick={() => set({ aspect: m.id })}>{m.name}</button>)}</div>
      </div>
      <button className="btn" onClick={() => { eng()?.resetView(); const e = eng(); if (e) set({ focal: Math.round(e.focalForPhoto(cam.sensor) * 10) / 10 }); onClose(); }}>Torna all'inquadratura della foto</button>
      <div className="hint">Muoviti nella stanza: trascina per guardare, rotella per avanzare, W A S D per camminare, Q E per scendere e salire, tasto destro per spostarti di lato.</div>
    </Pop>
  );
}

const SEASONS = [{ n: 'Inverno', d: 355 }, { n: 'Primavera', d: 80 }, { n: 'Estate', d: 172 }, { n: 'Autunno', d: 266 }];

export function SkyPanel({ onClose }: { onClose: () => void }) {
  const sun = useStore((s) => s.sun);
  const hasWindows = useStore((s) => !!s.recon?.windows.length);
  const svg = useRef<SVGSVGElement>(null);
  const set = (p: any) => useStore.setState({ sun: { ...useStore.getState().sun, ...p } });
  // alba e tramonto del giorno scelto
  let rise = 6, setH = 18;
  for (let h = 3; h < 12; h += 0.05) if (sunAngles(h, sun.dayOfYear, sun.latitude).elevation > -0.5) { rise = h; break; }
  for (let h = 21; h > 12; h -= 0.05) if (sunAngles(h, sun.dayOfYear, sun.latitude).elevation > -0.5) { setH = h; break; }
  const t = Math.min(1, Math.max(0, (sun.hour - rise) / (setH - rise)));
  const ang = Math.PI * (1 - t);
  const cx = 130 + 120 * Math.cos(ang), cy = 100 - 90 * Math.sin(ang);
  const night = sun.hour < rise || sun.hour > setH;
  useEffect(() => {
    const dot = svg.current?.querySelector('#sundot') as SVGCircleElement;
    if (!dot) return;
    let on = false;
    const down = (e: PointerEvent) => { on = true; dot.setPointerCapture(e.pointerId); useStore.getState().snapshot(); };
    const move = (e: PointerEvent) => {
      if (!on || !svg.current) return;
      const b = svg.current.getBoundingClientRect();
      const x = ((e.clientX - b.left) / b.width) * 260, y = ((e.clientY - b.top) / b.height) * 110;
      let a = Math.atan2(100 - y, x - 130);
      a = Math.max(0, Math.min(Math.PI, a < -Math.PI / 2 ? Math.PI : a < 0 ? 0 : a));
      const s = useStore.getState().sun;
      let r = 6, se = 18;
      for (let h = 3; h < 12; h += 0.05) if (sunAngles(h, s.dayOfYear, s.latitude).elevation > -0.5) { r = h; break; }
      for (let h = 21; h > 12; h -= 0.05) if (sunAngles(h, s.dayOfYear, s.latitude).elevation > -0.5) { se = h; break; }
      const hour = r + (se - r) * (1 - a / Math.PI);
      useStore.setState({ sun: { ...s, hour: Math.round(hour * 12) / 12 } });
    };
    const up = () => { on = false; };
    dot.addEventListener('pointerdown', down); dot.addEventListener('pointermove', move); dot.addEventListener('pointerup', up);
    return () => { dot.removeEventListener('pointerdown', down); dot.removeEventListener('pointermove', move); dot.removeEventListener('pointerup', up); };
  }, []);
  const el = document.getElementById('sky')?.getBoundingClientRect();
  return (
    <Pop x={el ? el.right : innerWidth - 20} y={el ? el.bottom + 8 : 60} anchor="below" width={300} onClose={onClose}>
      <h3><span>Luce naturale</span><div className={`toggle ${sun.enabled ? 'on' : ''}`} onClick={() => { useStore.getState().snapshot(); set({ enabled: !sun.enabled }); }} /></h3>
      {!hasWindows && <div className="hint" style={{ marginTop: 0, marginBottom: 12 }}>Non ho trovato finestre nella foto: il sole non entra in questa stanza.</div>}
      <svg ref={svg} viewBox="0 0 260 110" width="100%" style={{ display: 'block', overflow: 'visible', opacity: sun.enabled ? 1 : 0.4 }}>
        <path d="M10 100 A120 90 0 0 1 250 100" fill="none" stroke="rgba(255,255,255,.18)" strokeDasharray="3 4" />
        <line x1="0" y1="100" x2="260" y2="100" stroke="rgba(255,255,255,.12)" />
        <circle id="sundot" cx={cx} cy={cy} r="9" fill={night ? '#9fb3ff' : '#ffd27a'} style={{ cursor: 'grab', filter: `drop-shadow(0 0 8px ${night ? '#6f86ff' : '#ffb13b'})` }} />
      </svg>
      <div className="num" style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--t2)', fontSize: 11, margin: '8px 0 14px' }}>
        <span>Alba {fmtHour(rise)}</span><b style={{ color: 'var(--t1)', fontWeight: 500 }}>{fmtHour(sun.hour)}</b><span>Tramonto {fmtHour(setH)}</span>
      </div>
      <div className="row">
        <div className="chips">{WEATHER.map((w) => <button key={w.id} className={`chip ${sun.weather === w.id ? 'on' : ''}`} onClick={() => { useStore.getState().snapshot(); set({ weather: w.id }); }}>{w.name}</button>)}</div>
      </div>
      <div className="row">
        <div className="k"><span>Stagione</span></div>
        <div className="chips">{SEASONS.map((s) => <button key={s.n} className={`chip ${Math.abs(sun.dayOfYear - s.d) < 46 || Math.abs(sun.dayOfYear - s.d) > 319 ? 'on' : ''}`} onClick={() => { useStore.getState().snapshot(); set({ dayOfYear: s.d }); }}>{s.n}</button>)}</div>
      </div>
      <div className="row" style={{ marginBottom: 0 }}>
        <div className="k"><span>Da dove entra il sole</span><b className="num">{Math.round(((sun.north % 360) + 360) % 360)}°</b></div>
        <input type="range" min={0} max={359} step={1} value={((sun.north % 360) + 360) % 360} onPointerDown={() => useStore.getState().snapshot()} onChange={(e) => set({ north: +e.target.value })} />
        <div className="hint">Ruota l'orientamento della stanza rispetto al nord.</div>
      </div>
    </Pop>
  );
}

export function PlaceMenu({ onClose, onNew, onSave, onOpen }: { onClose: () => void; onNew: () => void; onSave: () => void; onOpen: () => void }) {
  const name = useStore((s) => s.placeName);
  const shots = useStore((s) => s.shots);
  const el = document.getElementById('place')?.getBoundingClientRect();
  return (
    <Pop x={el ? el.left : 20} y={el ? el.bottom + 8 : 60} anchor="at" width={280} onClose={onClose} className="menu">
      <input className="name" value={name} onChange={(e) => useStore.setState({ placeName: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') onClose(); e.stopPropagation(); }} />
      <button className="mi" onClick={() => { onNew(); onClose(); }}>Nuove foto</button>
      <button className="mi" onClick={() => { onSave(); onClose(); }}>Salva progetto <small>Cmd S</small></button>
      <button className="mi" onClick={() => { onOpen(); onClose(); }}>Apri progetto</button>
      <button className="mi" onClick={() => { eng()?.resetView(); onClose(); }}>Torna all'inquadratura della foto</button>
      {shots.length > 0 && <button className="mi" onClick={() => { useStore.setState({ viewer: shots[shots.length - 1].id }); onClose(); }}>Esporta l'ultimo scatto</button>}
    </Pop>
  );
}
