// Rullino e visore degli scatti con le esportazioni.
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useStore, Shot } from '../store';
import { eng } from '../engineRef';
import { roomBounds, windowInfos } from '../engine/room';
import { planSVG, svgToCanvas, kitRows, kitSummary, kitCSV, buildPDF, download, slug, cameraLine, sunLine, PlanInput } from '../export/exports';

export function Roll() {
  const shots = useStore((s) => s.shots);
  return (
    <div id="roll" className="chrome">
      {shots.slice(-6).map((s) => <img key={s.id} src={s.url} alt="Scatto" onClick={() => useStore.setState({ viewer: s.id })} />)}
    </div>
  );
}

function planInput(shot: Shot): PlanInput | null {
  const st = useStore.getState();
  const room = shot.scene.room || st.room;
  const recon = room ? { room: roomBounds(room), windows: windowInfos(room), camera: { position: [0, 1.6, room.depth / 2 - 0.5] } } : st.recon;
  if (!recon) return null;
  const cp = (shot as any).camPos as [number, number, number] | undefined;
  const cd = (shot as any).camDir as [number, number, number] | undefined;
  const e = eng();
  const dir = cd || (e ? new THREE.Vector3(0, 0, -1).applyQuaternion(e.camera.quaternion).toArray() : [0, 0, -1]);
  const pos = cp || (e ? e.camera.position.toArray() : recon.camera.position);
  const hfov = (shot as any).hfov || THREE.MathUtils.degToRad(60);
  const m = shot.move;
  const first = m ? st.shots.find((x) => x.move?.group === m.group && x.move.frame === 0) : null;
  const move = m ? { start: m.start, startDir: ((first as any)?.camDir || dir) as any, end: m.end, endDir: m.endDir, text: m.text } : undefined;
  return { scene: shot.scene, recon, camera: { position: pos as any, dir: dir as any, hfov }, move };
}

export function Viewer() {
  const id = useStore((s) => s.viewer);
  const shots = useStore((s) => s.shots);
  const place = useStore((s) => s.placeName);
  const shot = shots.find((s) => s.id === id);
  const [tab, setTab] = useState<'img' | 'plan' | 'kit' | 'pdf'>('img');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTab('img'); }, [id]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') useStore.setState({ viewer: null }); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  const inp = useMemo(() => (shot ? planInput(shot) : null), [shot]);
  const svg = useMemo(() => (inp ? planSVG(inp) : ''), [inp]);
  if (!shot || !inp) return null;
  const group = shot.move ? shots.filter((x) => x.move?.group === shot.move!.group).sort((a, b) => a.move!.frame - b.move!.frame) : [];
  const base = `${slug(place)}-${new Date(shot.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
  const rows = kitRows(shot.scene);
  const sum = kitSummary(shot.scene);
  const close = () => useStore.setState({ viewer: null });
  const dl = async () => {
    setBusy(true);
    try {
      if (tab === 'img') download(shot.url, `${base}.jpg`);
      if (tab === 'plan') { const c = await svgToCanvas(svg, 2); download(c.toDataURL('image/png'), `${base}-pianta-luci.png`); }
      if (tab === 'kit') download(URL.createObjectURL(new Blob(['﻿' + kitCSV(shot.scene)], { type: 'text/csv' })), `${base}-lista-materiale.csv`);
      if (tab === 'pdf') { const doc = await buildPDF({ title: place, imageUrl: shot.url, imgW: shot.width, imgH: shot.height, plan: inp, frames: group.map((g) => ({ url: g.url, label: g.move!.label })) }); doc.save(`${base}-troupe.pdf`); }
    } finally { setBusy(false); }
  };
  return (
    <div id="viewer" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <button className="close" onClick={close}>Chiudi</button>
      <div className="stage">
        {tab === 'img' && <img src={shot.url} alt="Scatto" />}
        {tab === 'plan' && <div className="paper" dangerouslySetInnerHTML={{ __html: svg.replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"') }} />}
        {tab === 'kit' && (
          <div className="paper" style={{ flexDirection: 'column', gap: 20, padding: 24 }}>
            <table className="kit num">
              <thead><tr><th>N.</th><th>Nome</th><th>Apparecchio</th><th>Uscita</th><th>Colore</th><th>Accessori</th><th>Posizione</th><th>Sul soggetto</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.n} style={{ opacity: r.on ? 1 : 0.45 }}><td>{r.n}</td><td>{r.name}</td><td>{r.fixture}</td><td>{r.output}</td><td>{r.color}</td><td>{r.accessories}</td><td>{r.position}</td><td>{r.lux}</td></tr>)}</tbody>
            </table>
            <div style={{ width: '86%', fontSize: 13, color: '#333', lineHeight: 1.7 }}>
              <b>Da portare:</b> {sum.items.length ? sum.items.map(([n, q]) => `${q} × ${n}`).join(', ') : 'solo le luci già presenti sul luogo'}
              {sum.filters.length > 0 && <><br /><b>Filtri e diffusioni:</b> {sum.filters.map(([n, q]) => `${q} × ${n}`).join(', ')}</>}
              {sum.watts > 0 && <><br /><b>Potenza:</b> {sum.watts.toLocaleString('it-IT')} W, circa {Math.ceil(sum.watts / 230)} A a 230 V</>}
            </div>
          </div>
        )}
        {tab === 'pdf' && (
          <div style={{ color: 'var(--t2)', textAlign: 'center', lineHeight: 1.8, padding: 24 }}>
            Il PDF troupe unisce scatto, pianta luci e lista materiale in un solo documento A4.<br />
            <span style={{ color: 'var(--t3)' }}>{cameraLine(shot.scene)} · {sunLine(shot.scene)}</span>
          </div>
        )}
      </div>
      {group.length > 1 && (
        <div className="frames">
          {group.map((g) => <button key={g.id} className={g.id === shot.id ? 'on' : ''} onClick={() => useStore.setState({ viewer: g.id })}><img src={g.url} alt={g.move!.label} /><span>{g.move!.label}</span></button>)}
        </div>
      )}
      <div className="actions glass">
        <button className={tab === 'img' ? 'on' : ''} onClick={() => setTab('img')}>Immagine</button>
        <button className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')}>Pianta luci</button>
        <button className={tab === 'kit' ? 'on' : ''} onClick={() => setTab('kit')}>Lista materiale</button>
        <button className={tab === 'pdf' ? 'on' : ''} onClick={() => setTab('pdf')}>PDF troupe</button>
        <button className="dl" onClick={dl} disabled={busy}>{busy ? 'Preparo…' : 'Scarica'}</button>
      </div>
      <div className="meta num">{shot.move ? `${shot.move.text} · fotogramma ${shot.move.frame + 1} di ${shot.move.of} · ` : ''}{shot.width} × {shot.height} · {cameraLine(shot.scene)}</div>
    </div>
  );
}
