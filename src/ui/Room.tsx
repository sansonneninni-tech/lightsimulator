// Stanza costruita a mano: schermata iniziale, pannello Stanza, schede di arredi e aperture.
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { eng } from '../engineRef';
import Pop from './Pop';
import { Svg } from './icons';
import { edgePoint } from './Handles';
import { TEMPLATES, Template, createRoom, updateRoom, addOpening, updateOpening, addFurniture, moveFurniture, duplicateFurniture, removeFurniture, removeOpening } from '../build';
import { FURNITURE, FINISHES, furnitureKind } from '../engine/furniture';
import { WALL_FINISHES, FLOORS, OPENING_KINDS, WALLS, RoomSpec } from '../engine/room';
import { stopsLabel } from '../export/exports';

const fmtM = (v: number) => `${v.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} m`;

const OPENING_ICONS: Record<string, string> = {
  finestra: '<rect x="5" y="4" width="14" height="12"/><path d="M12 4v12M5 10h14M4 19h16"/>',
  portafinestra: '<rect x="6" y="3" width="12" height="18"/><path d="M12 3v18M6 11h12"/>',
  porta: '<rect x="7" y="3" width="10" height="18"/><path d="M14.5 12h.01"/>',
};

function planIcon(t: Template) {
  const { width: W, depth: D } = t.room;
  const s = 30 / Math.max(W, D);
  const w = W * s, d = D * s, x0 = (36 - w) / 2, y0 = (36 - d) / 2;
  let out = `<rect x="${x0}" y="${y0}" width="${w}" height="${d}" rx="1"/>`;
  for (const [kind, x, z, rot] of t.furniture) {
    const k = furnitureKind(kind);
    if (k.ceiling || k.onTop || kind === 'tappeto') continue;
    const cx = x0 + (x + W / 2) * s, cy = y0 + (z + D / 2) * s;
    out += `<rect x="${cx - (k.size[0] * s) / 2}" y="${cy - (k.size[1] * s) / 2}" width="${k.size[0] * s}" height="${k.size[1] * s}" rx=".6" transform="rotate(${-rot} ${cx} ${cy})" fill="currentColor" fill-opacity=".25" stroke-width=".8"/>`;
  }
  for (const p of t.people || []) out += `<circle cx="${x0 + (p.x + W / 2) * s}" cy="${y0 + (p.z + D / 2) * s}" r="1.8" fill="currentColor"/>`;
  return out;
}

export function Start({ onOpen }: { onOpen: () => void }) {
  const room = useStore((s) => s.room);
  return (
    <div id="start">
      <div className="brand">Light Simulator</div>
      <h1>Scegli la stanza</h1>
      <p>Poi cambi misure, pareti, finestre e arredi, metti persone e luci, e scatti il render.</p>
      <div className="tiles">
        {TEMPLATES.map((t) => (
          <button key={t.id} className="tile" onClick={() => createRoom(t)}>
            <svg viewBox="0 0 36 36" dangerouslySetInnerHTML={{ __html: planIcon(t) }} />
            <b>{t.name}</b>
            <span className="num">{t.room.width.toLocaleString('it-IT')} × {t.room.depth.toLocaleString('it-IT')} m</span>
          </button>
        ))}
      </div>
      <div className="links">
        {room && <button className="alt" onClick={() => useStore.setState({ phase: 'ready' })}>Torna alla stanza</button>}
        <button className="alt" onClick={onOpen}>Apri un progetto salvato</button>
      </div>
    </div>
  );
}

function dockAnchor() {
  const d = document.getElementById('dock');
  const r = d?.getBoundingClientRect();
  return { x: r ? r.left + r.width / 2 : innerWidth / 2, bottom: r ? innerHeight - r.top + 12 : 96 };
}

function Slider({ label, value, min, max, step = 0.05, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div className="row">
      <div className="k"><span>{label}</span><b className="num">{fmtM(value)}</b></div>
      <input type="range" min={min} max={max} step={step} value={value} onPointerDown={() => useStore.getState().snapshot()} onChange={(e) => onChange(+e.target.value)} />
    </div>
  );
}

export function RoomPanel({ onClose }: { onClose: () => void }) {
  const room = useStore((s) => s.room);
  const [tab, setTab] = useState<'arredi' | 'stanza'>('arredi');
  const a = dockAnchor();
  if (!room) return null;
  const up = (p: Partial<RoomSpec>) => updateRoom(p, false);
  return (
    <Pop x={a.x} y={0} bottom={a.bottom} anchor="above" width={372} onClose={onClose}>
      <div className="seg">
        <button className={tab === 'arredi' ? 'on' : ''} onClick={() => setTab('arredi')}>Arredi</button>
        <button className={tab === 'stanza' ? 'on' : ''} onClick={() => setTab('stanza')}>Stanza</button>
      </div>
      {tab === 'arredi' ? (
        <>
          <div className="types five">
            {FURNITURE.map((k) => <button key={k.id} className="type" onClick={() => { addFurniture(k.id); onClose(); }}><Svg d={k.icon} />{k.name}</button>)}
          </div>
          <div className="hint">Compare davanti a te. Toccalo per sceglierlo, poi trascinalo dove vuoi. Le lampade fanno luce vera.</div>
        </>
      ) : (
        <>
          <Slider label="Larghezza" value={room.width} min={2} max={16} onChange={(v) => up({ width: v })} />
          <Slider label="Profondità" value={room.depth} min={2} max={16} onChange={(v) => up({ depth: v })} />
          <Slider label="Altezza" value={room.height} min={2.2} max={6} onChange={(v) => up({ height: v })} />
          <div className="row">
            <div className="k"><span>Pareti</span></div>
            <div className="chips">
              {WALL_FINISHES.map((w) => (
                <button key={w.id} className={`chip sw ${room.wall === w.id ? 'on' : ''}`} onClick={() => { useStore.getState().snapshot(); up({ wall: w.id }); }}>
                  <i style={{ background: w.texture === 'mattoni' ? 'linear-gradient(#9b4a33 0 45%,#c9bfb2 45% 55%,#9b4a33 55%)' : w.color }} />{w.name}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <div className="k"><span>Pavimento</span></div>
            <div className="chips">
              {FLOORS.map((f) => <button key={f.id} className={`chip ${room.floor === f.id ? 'on' : ''}`} onClick={() => { useStore.getState().snapshot(); up({ floor: f.id }); }}>{f.name}</button>)}
            </div>
          </div>
          <div className="row" style={{ marginBottom: 0 }}>
            <div className="k"><span>Aggiungi sulla parete che guardi</span></div>
            <div className="types four" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
              {OPENING_KINDS.map((o) => <button key={o.id} className="type" onClick={() => { addOpening(o.id); onClose(); }}><Svg d={OPENING_ICONS[o.id]} />{o.name}</button>)}
            </div>
          </div>
        </>
      )}
    </Pop>
  );
}

function useAnchor(pos: [number, number, number] | undefined, key: string) {
  const [xy, setXy] = useState({ x: innerWidth / 2, y: innerHeight / 2 });
  useEffect(() => {
    if (!eng() || !pos) return;
    const p = edgePoint(pos);
    setXy({ x: p.x, y: p.y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return xy;
}

export function FurnitureCard({ id }: { id: string }) {
  const f = useStore((s) => s.furniture.find((x) => x.id === id));
  const light = useStore((s) => s.lights.find((l) => l.attached === id));
  const k = f ? furnitureKind(f.kind) : null;
  const xy = useAnchor(f ? [f.position[0], (f.position[1] || 0) + Math.min(1.2, k!.height * 0.7), f.position[2]] : undefined, id);
  if (!f || !k) return null;
  const st = useStore.getState;
  const rot = (d: number) => { st().snapshot(); moveFurniture(id, { rotationY: (((f.rotationY + d) % 360) + 360) % 360 }); };
  return (
    <Pop x={xy.x} y={xy.y} onClose={() => useStore.setState({ selection: null })}>
      <h3><span>{k.name}</span>{light && <div className={`toggle ${light.on ? 'on' : ''}`} title="Accesa" onClick={() => { st().snapshot(); st().updateLight(light.id, { on: !light.on }); }} />}</h3>
      <div className="row">
        <div className="k"><span>Finitura</span></div>
        <div className="chips">
          {k.finishes.map((c) => (
            <button key={c} className={`chip sw ${f.color === c ? 'on' : ''}`} onClick={() => { st().snapshot(); st().updateFurniture(id, { color: c }); }}>
              <i style={{ background: FINISHES[c].kind === 'legno' ? (c === 'noce' ? '#5c3c26' : '#b69268') : FINISHES[c].color }} />{FINISHES[c].name}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <div className="k"><span>Rotazione</span><b className="num">{Math.round(f.rotationY)}°</b></div>
        <div className="rotrow">
          <button className="btn" onClick={() => rot(90)} title="Gira a sinistra">↺ 90°</button>
          <input type="range" min={0} max={359} step={5} value={((f.rotationY % 360) + 360) % 360} onPointerDown={() => st().snapshot()} onChange={(e) => moveFurniture(id, { rotationY: +e.target.value })} />
          <button className="btn" onClick={() => rot(-90)} title="Gira a destra">↻ 90°</button>
        </div>
      </div>
      {light && (
        <div className="row">
          <div className="k"><span>Luce</span><b className="num">{light.on ? `${stopsLabel(light.stops)} · ${light.kelvin} K` : 'spenta'}</b></div>
          <button className="btn" onClick={() => useStore.setState({ selection: { type: 'light', id: light.id } })}>Regola la luce</button>
        </div>
      )}
      <div className="hint">Trascinalo per spostarlo. R lo gira di 90°, Canc lo toglie.</div>
      <div className="hr" />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button className="more" onClick={() => duplicateFurniture(id)}>Duplica</button>
        <button className="more danger" onClick={() => removeFurniture(id)}>Rimuovi</button>
      </div>
    </Pop>
  );
}

export function OpeningCard({ id }: { id: string }) {
  const room = useStore((s) => s.room);
  const o = room?.openings.find((x) => x.id === id);
  const pos = (() => {
    if (!room || !o) return undefined;
    const w = WALLS.find((x) => x.id === o.wall);
    if (!w) return undefined;
    const W = room.width, D = room.depth;
    const p: [number, number, number] = o.wall === 'fondo' ? [o.offset, o.sill + o.height / 2, -D / 2] : o.wall === 'davanti' ? [-o.offset, o.sill + o.height / 2, D / 2] : o.wall === 'sinistra' ? [-W / 2, o.sill + o.height / 2, -o.offset] : [W / 2, o.sill + o.height / 2, o.offset];
    return p;
  })();
  const xy = useAnchor(pos, id);
  if (!room || !o) return null;
  const st = useStore.getState;
  const up = (p: any, snap = false) => updateOpening(id, p, snap);
  const name = OPENING_KINDS.find((k) => k.id === o.kind)?.name || '';
  return (
    <Pop x={xy.x} y={xy.y} onClose={() => useStore.setState({ selection: null })}>
      <h3><span>{name}{o.kind !== 'porta' && o.closed ? ' · oscurata' : ''}</span>{o.kind !== 'porta' && <div className={`toggle ${o.closed ? '' : 'on'}`} title={o.closed ? 'Apri' : 'Chiudi l\'oscurante'} onClick={() => up({ closed: !o.closed }, true)} />}</h3>
      {o.kind !== 'porta' && <div className="hint" style={{ marginBottom: 12 }}>{o.closed ? 'Oscurante chiuso: da qui non entra luce. Con tutte le finestre chiuse la stanza è al buio.' : 'Aperta: entrano sole e cielo. L\'interruttore chiude l\'oscurante.'}</div>}
      <div className="row">
        <div className="types four" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          {OPENING_KINDS.map((k) => <button key={k.id} className={`type ${o.kind === k.id ? 'on' : ''}`} onClick={() => up({ kind: k.id, width: k.width, height: k.height, sill: k.sill }, true)}><Svg d={OPENING_ICONS[k.id]} />{k.name}</button>)}
        </div>
      </div>
      <div className="row">
        <div className="k"><span>Parete</span></div>
        <div className="chips">{WALLS.map((w) => <button key={w.id} className={`chip ${o.wall === w.id ? 'on' : ''}`} onClick={() => up({ wall: w.id, offset: 0 }, true)}>{w.name}</button>)}</div>
      </div>
      <div className="row">
        <div className="k"><span>Larghezza</span><b className="num">{fmtM(o.width)}</b></div>
        <input type="range" min={0.5} max={6} step={0.05} value={o.width} onPointerDown={() => st().snapshot()} onChange={(e) => up({ width: +e.target.value })} />
      </div>
      <div className="row">
        <div className="k"><span>Altezza</span><b className="num">{fmtM(o.height)}</b></div>
        <input type="range" min={0.5} max={room.height - 0.1} step={0.05} value={o.height} onPointerDown={() => st().snapshot()} onChange={(e) => up({ height: +e.target.value })} />
      </div>
      {o.kind === 'finestra' && (
        <div className="row">
          <div className="k"><span>Davanzale</span><b className="num">{fmtM(o.sill)}</b></div>
          <input type="range" min={0.2} max={Math.max(0.3, room.height - o.height - 0.1)} step={0.05} value={o.sill} onPointerDown={() => st().snapshot()} onChange={(e) => up({ sill: +e.target.value })} />
        </div>
      )}
      <div className="hint">Trascinala per spostarla lungo la parete. {o.kind !== 'porta' ? "Da qui entrano il sole e il cielo: l'ora si cambia in alto a destra." : ''}</div>
      <div className="hr" /><button className="more danger" onClick={() => removeOpening(id)}>Rimuovi</button>
    </Pop>
  );
}
