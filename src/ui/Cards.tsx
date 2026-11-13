// Schede accanto all'elemento selezionato: luce, persona, oggetto.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { eng } from '../engineRef';
import Pop from './Pop';
import { edgePoint } from './Handles';
import { Svg, TYPE_ICONS, POSE_ICONS } from './icons';
import {
  fixtureById, GELS, DIFFUSIONS, effectiveKelvin, effectiveLumens, fStopForLux, fmtStop, fmtShutter,
} from '../engine/photometry';
import { POSES, SKINS, poseJoints, PoseId } from '../engine/mannequin';
import { LIGHT_TYPES, TYPE_FIXTURE, familyType, fixturesOfType, removeSelection } from '../actions';
import { stopsLabel, luxAtTarget } from '../export/exports';
import { sunSky } from '../engine/sun';
import { PROP_KINDS } from '../engine/Engine';
import { FurnitureCard, OpeningCard } from './Room';
import { updateOpening } from '../build';

const MAIN_GELS = ['none', 'cto-quarter', 'cto-half', 'cto-full', 'ctb-half', 'ctb-full', 'plus-green', 'minus-green'];

function useAnchor(pos: [number, number, number] | undefined, key: string) {
  const [xy, setXy] = useState({ x: innerWidth / 2, y: innerHeight / 2 });
  useEffect(() => {
    const e = eng();
    if (!e || !pos) return;
    const p = edgePoint(pos);
    setXy({ x: p.x, y: p.y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return xy;
}

export function LightCard({ id }: { id: string }) {
  const L = useStore((s) => s.lights.find((l) => l.id === id));
  const cam = useStore((s) => s.cam);
  const sun = useStore((s) => s.sun);
  const st = useStore.getState;
  const [more, setMore] = useState(false);
  const xy = useAnchor(L?.position, id);
  if (!L) return null;
  const fx = fixtureById(L.fixtureId);
  const win = L.origin === 'finestra';
  const skyLux = sun.enabled ? sunSky(sun).skyLux : 0;
  // lettura vera sulla superficie dove punta la luce: tutte le luci, l'angolo e le ombre
  const rd = !win && L.on ? eng()?.aimReading(L) : null;
  const over = rd ? rd.stops : 0;
  const up = (p: any) => st().updateLight(id, p);
  const snap = () => st().snapshot();
  const type = familyType(L.fixtureId);
  const kFixed = !!fx.kelvinFixed;
  const [kMin, kMax] = fx.kelvinRange || [1800, 10000];
  return (
    <Pop x={xy.x} y={xy.y} onClose={() => useStore.setState({ selection: null })}>
      <h3><span>{L.name}</span><div className={`toggle ${L.on ? 'on' : ''}`} title={win && L.windowId && st().room ? 'Aperta (spegni per chiudere l\'oscurante)' : 'Accesa'} onClick={() => {
        // finestra di una stanza costruita: spegnere vuol dire chiudere l'oscurante (vale anche nello scatto)
        if (win && L.windowId && st().room) { updateOpening(L.windowId, { closed: true }, true); useStore.setState({ selection: null }); st().showToast('Oscurante chiuso: da questa finestra non entra più luce. Toccala per riaprirla.'); return; }
        snap(); up({ on: !L.on });
      }} /></h3>
      <div className="row">
        <div className="k"><span>Intensità</span><b className="num">{win ? (sun.enabled ? `cielo · ${stopsLabel(L.stops)}` : 'luce naturale spenta') : `${stopsLabel(L.stops)}${L.stops > 0.01 ? ' oltre il pieno' : L.stops < -0.01 ? ` · ${Math.max(1, Math.round(Math.pow(2, L.stops) * 100))}%` : ' · pieno'}`}</b></div>
        <input type="range" min={-8} max={win ? 2 : 3} step={1 / 3} value={L.stops} onPointerDown={snap} onChange={(e) => {
          const v = +e.target.value;
          // le finestre di una stanza costruita condividono il filtro (sole e cielo sono uno solo)
          if (win && st().room) useStore.setState({ lights: st().lights.map((x) => (x.origin === 'finestra' ? { ...x, stops: v } : x)) });
          else up({ stops: v });
        }} />
        {win && st().room && <div className="hint" style={{ marginTop: 8 }}>Vale per tutte le finestre, come un filtro ND sui vetri: abbassa sole e cielo insieme, anche nello scatto. L'interruttore chiude l'oscurante.</div>}
        {rd && <div className="hint num" style={{ marginTop: 8 }}>Dove punta: {Math.round(rd.lux).toLocaleString('it-IT')} lux, {Math.abs(over) < 0.05 ? 'esposto giusto' : `${Math.abs(over).toFixed(1)} stop ${over > 0 ? 'sopra' : 'sotto'}`} a f/{fmtStop(cam.fStop)}, ISO {cam.iso}{over > 2.5 ? ' · lì è bruciato' : over < -3 ? ' · lì è quasi nero' : ''}</div>}
      </div>
      {!win && (
        <div className="row">
          <div className="k"><span>Colore</span><b className="num">{effectiveKelvin(L.kelvin, L.gel)} K{L.gel !== 'none' ? ` · ${GELS.find((g) => g.id === L.gel)?.name}` : ''}{kFixed ? ' · fissa' : ''}</b></div>
          <input type="range" className="kelvin" min={kFixed ? fx.kelvinFixed : kMin} max={kFixed ? fx.kelvinFixed! + 1 : kMax} step={100} value={L.kelvin} disabled={kFixed} onPointerDown={snap} onChange={(e) => up({ kelvin: +e.target.value })} />
          <div className="chips" style={{ marginTop: 10 }}>
            {(more ? GELS.map((g) => g.id) : MAIN_GELS).map((g) => (
              <button key={g} className={`chip ${L.gel === g ? 'on' : ''}`} onClick={() => { snap(); up({ gel: g }); }}>{GELS.find((x) => x.id === g)!.name}</button>
            ))}
          </div>
        </div>
      )}
      {!win && !L.attached && (
        <div className="row">
          <div className="k"><span>Altezza</span><b className="num">{L.position[1].toFixed(2)} m</b></div>
          <input type="range" min={0.1} max={Math.max(4, (useStore.getState().room?.height || 2.8) + 4)} step={0.05} value={L.position[1]} onPointerDown={snap} onChange={(e) => up({ position: [L.position[0], +e.target.value, L.position[2]] })} />
        </div>
      )}
      {!win && (
        <div className="row" style={{ marginBottom: 6 }}>
          <div className="k"><span>Tipo</span><b>{fx.name}</b></div>
          <div className="types">
            {LIGHT_TYPES.map((t) => (
              <button key={t} className={`type ${type === t ? 'on' : ''}`} onClick={() => {
                if (type === t) return;
                snap();
                const nf = fixtureById(TYPE_FIXTURE[t]);
                up({ fixtureId: nf.id, kelvin: nf.kelvinFixed || (nf.kelvinRange ? Math.min(nf.kelvinRange[1], Math.max(nf.kelvinRange[0], L.kelvin)) : L.kelvin), size: nf.size ? [...nf.size] : L.size, beam: nf.beamRange ? Math.round((nf.beamRange[0] + nf.beamRange[1]) / 2) : L.beam, name: L.origin === 'aggiunta' ? `${t} ${L.name.split(' ').pop()}` : L.name });
              }}><Svg d={TYPE_ICONS[t]} />{t}</button>
            ))}
          </div>
        </div>
      )}
      <button className="more" onClick={() => setMore(!more)}>{more ? 'Meno ‹' : 'Più ›'}</button>
      {more && (
        <div>
          <div className="hr" />
          {!win && (
            <div className="row">
              <div className="k"><span>Morbidezza</span><b className="num">{Math.round(L.softness * 100)}%</b></div>
              <input type="range" min={0} max={1} step={0.01} value={L.softness} onPointerDown={snap} onChange={(e) => up({ softness: +e.target.value })} />
            </div>
          )}
          {fx.kind === 'spot' && !win && (
            <div className="row">
              <div className="k"><span>Fascio</span><b className="num">{L.beam}°</b></div>
              <input type="range" min={fx.beamRange?.[0] || 10} max={fx.beamRange?.[1] || 60} step={1} value={L.beam} onPointerDown={snap} onChange={(e) => up({ beam: +e.target.value })} />
            </div>
          )}
          {!win && (
            <div className="row">
              <div className="k"><span>Diffusione</span></div>
              <div className="chips">
                {DIFFUSIONS.map((d) => <button key={d.id} className={`chip ${L.diffusion === d.id ? 'on' : ''}`} onClick={() => { snap(); up({ diffusion: d.id }); }}>{d.name}</button>)}
              </div>
            </div>
          )}
          {fx.kind === 'spot' && !win && (
            <div className="row">
              <div className="k"><span>Alette</span></div>
              <div className="flags">
                {([['top', 'Sopra'], ['bottom', 'Sotto'], ['left', 'Sinistra'], ['right', 'Destra']] as const).map(([k, n]) => (
                  <div key={k}><div className="k"><span>{n}</span><b className="num">{L.barnDoors[k]}°</b></div>
                    <input type="range" min={0} max={90} step={1} value={L.barnDoors[k]} onPointerDown={snap} onChange={(e) => up({ barnDoors: { ...L.barnDoors, [k]: +e.target.value } })} /></div>
                ))}
              </div>
            </div>
          )}
          {!win && (
            <div className="row">
              <div className="k"><span>Fotometria</span><b className="num">{fx.watts} W · {Math.round(effectiveLumens(L, skyLux)).toLocaleString('it-IT')} lm · CRI {fx.cri}</b></div>
              <div className="chips">
                {fixturesOfType(type).map((f) => <button key={f.id} className={`chip ${f.id === L.fixtureId ? 'on' : ''}`} onClick={() => { snap(); up({ fixtureId: f.id, kelvin: f.kelvinFixed || L.kelvin, size: f.size ? [...f.size] : L.size }); }}>{f.name}</button>)}
              </div>
            </div>
          )}
          {(win || L.attached) && <div className="line num"><span>Altezza</span><b>{L.position[1].toFixed(2)} m</b></div>}
          <div className="hint">Trascina il punto per spostarla ovunque, anche fuori dalla stanza o oltre la finestra (Alt o il cursore Altezza per alzarla). Il mirino la punta, l'anello in verticale è il dimmer. Alt + rotella: Kelvin.</div>
          {!win && <><div className="hr" /><button className="more danger" onClick={removeSelection}>{L.attached ? 'Rimuovi la lampada' : 'Rimuovi luce'}</button></>}
        </div>
      )}
    </Pop>
  );
}

export function PersonCard({ id }: { id: string }) {
  const P = useStore((s) => s.people.find((p) => p.id === id));
  const manikin = useStore((s) => s.manikin);
  const st = useStore.getState;
  const xy = useAnchor(P?.position, id);
  if (!P) return null;
  const up = (p: any) => st().updatePerson(id, p);
  const snap = () => st().snapshot();
  return (
    <Pop x={xy.x} y={xy.y - 120} onClose={() => useStore.setState({ selection: null })}>
      <h3><span>{P.name}</span></h3>
      <div className="poses" style={{ marginBottom: 14 }}>
        {POSES.map((q) => <button key={q.id} className={`pose ${P.pose === q.id ? 'on' : ''}`} onClick={() => { snap(); up({ pose: q.id as PoseId, joints: poseJoints(q.id as PoseId) }); }}><Svg d={POSE_ICONS[q.id]} vb="0 0 28 36" />{q.name}</button>)}
      </div>
      <div className="row">
        <div className="k"><span>Pelle</span></div>
        <div className="chips">{SKINS.map((s) => <button key={s.id} className={`chip ${P.skin === s.id ? 'on' : ''}`} onClick={() => { snap(); up({ skin: s.id }); }}>{s.name}</button>)}</div>
      </div>
      <div className="row">
        <div className="k"><span>Altezza</span><b className="num">{P.height.toFixed(2)} m</b></div>
        <input type="range" min={1.0} max={2.05} step={0.01} value={P.height} onPointerDown={snap} onChange={(e) => up({ height: +e.target.value })} />
      </div>
      <div className="row">
        <div className="k"><span>Rotazione</span><b className="num">{Math.round(P.rotationY)}°</b></div>
        <input type="range" min={0} max={359} step={1} value={((P.rotationY % 360) + 360) % 360} onPointerDown={snap} onChange={(e) => up({ rotationY: +e.target.value })} />
      </div>
      <div className="line"><span>Manichino</span><div className={`toggle ${manikin === id ? 'on' : ''}`} onClick={() => useStore.setState({ manikin: manikin === id ? null : id })} /></div>
      <div className="hint">Trascina l'anello a terra per spostarla, rotella per girarla. Doppio clic sull'anello per muovere le articolazioni.</div>
      <div className="hr" /><button className="more danger" onClick={removeSelection}>Rimuovi persona</button>
    </Pop>
  );
}

export function PropCard({ id }: { id: string }) {
  const O = useStore((s) => s.props.find((p) => p.id === id));
  const st = useStore.getState;
  const xy = useAnchor(O?.position, id);
  if (!O) return null;
  const up = (p: any) => st().updateProp(id, p);
  const snap = () => st().snapshot();
  return (
    <Pop x={xy.x} y={xy.y} onClose={() => useStore.setState({ selection: null })}>
      <h3><span>{PROP_KINDS.find((k) => k.id === O.kind)?.name}</span></h3>
      <div className="row">
        <div className="types four">{PROP_KINDS.map((k) => <button key={k.id} className={`type ${O.kind === k.id ? 'on' : ''}`} onClick={() => { snap(); up({ kind: k.id }); }}><Svg d={TYPE_ICONS[k.name]} />{k.name}</button>)}</div>
      </div>
      <div className="row">
        <div className="k"><span>Larghezza</span><b className="num">{O.size[0].toFixed(2)} m</b></div>
        <input type="range" min={0.3} max={3.6} step={0.05} value={O.size[0]} onPointerDown={snap} onChange={(e) => up({ size: [+e.target.value, O.size[1]] })} />
      </div>
      <div className="row">
        <div className="k"><span>Altezza pannello</span><b className="num">{O.size[1].toFixed(2)} m</b></div>
        <input type="range" min={0.3} max={3.6} step={0.05} value={O.size[1]} onPointerDown={snap} onChange={(e) => up({ size: [O.size[0], +e.target.value] })} />
      </div>
      <div className="row">
        <div className="k"><span>Rotazione</span><b className="num">{Math.round(O.rotationY)}°</b></div>
        <input type="range" min={0} max={359} step={1} value={((O.rotationY % 360) + 360) % 360} onPointerDown={snap} onChange={(e) => up({ rotationY: +e.target.value })} />
      </div>
      <div className="row">
        <div className="k"><span>Inclinazione</span><b className="num">{Math.round(O.tilt)}°</b></div>
        <input type="range" min={-90} max={90} step={1} value={O.tilt} onPointerDown={snap} onChange={(e) => up({ tilt: +e.target.value })} />
      </div>
      <div className="hint">{({
        bandiera: 'Bandiera: taglia la luce. Mettila davanti a una lampada per togliere luce dove non la vuoi (ombra netta vicino al soggetto, morbida vicino alla lampada).',
        nero: 'Pannello nero: toglie il riempimento. Dal suo lato la stanza rimbalza meno luce, il lato in ombra del soggetto si scurisce.',
        bianco: 'Pannello bianco: rimbalza la luce che lo colpisce. Giralo verso la lampada e verso il soggetto per schiarire le ombre.',
        diffusore: 'Telaio di diffusione: mettilo davanti a una lampada, la luce diventa grande e morbida.',
      } as Record<string, string>)[O.kind]} Trascina il quadratino per spostarlo (Alt per l'altezza), rotella per girarlo.</div>
      <div className="hr" /><button className="more danger" onClick={removeSelection}>Rimuovi</button>
    </Pop>
  );
}

export function SelectionCard() {
  const sel = useStore((s) => s.selection);
  const shooting = useStore((s) => s.shooting);
  const key = useMemo(() => (sel ? sel.type + sel.id : ''), [sel]);
  if (!sel || shooting) return null;
  if (sel.type === 'light') return <LightCard key={key} id={sel.id} />;
  if (sel.type === 'person') return <PersonCard key={key} id={sel.id} />;
  if (sel.type === 'furniture') return <FurnitureCard key={key} id={sel.id} />;
  if (sel.type === 'opening') return <OpeningCard key={key} id={sel.id} />;
  return <PropCard key={key} id={sel.id} />;
}
