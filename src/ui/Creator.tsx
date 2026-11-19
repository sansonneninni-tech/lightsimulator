// Creazione del personaggio: anteprima 3D a tutto schermo e controlli per corpo, viso, capelli,
// abiti ed espressione. "Fatto" applica l'aspetto alla persona nella scena.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useStore } from '../store';
import { buildHuman, defaultLook, Look, HAIR_COLORS, EXPRESSIONS, loadBase, WHOLE_SUITS } from '../engine/human';
import { prepareHuman } from '../engine/figure';
import { SKINS } from '../engine/mannequin';

const HAIR = [['', 'Rasati'], ['short02', 'Corti'], ['short01', 'Corti mossi'], ['short03', 'Ciuffo'], ['short04', 'Tirati indietro'], ['bob01', 'Caschetto con frangia'], ['bob02', 'Caschetto'], ['long01', 'Lunghi'], ['ponytail01', 'Coda'], ['braid01', 'Treccia']];
const BROWS = [['eyebrow001', 'Naturali'], ['eyebrow002', 'Folte'], ['eyebrow003', 'Arcuate'], ['eyebrow006', 'Sottili'], ['eyebrow009', 'Cespugliose'], ['eyebrow010', 'Curate'], ['eyebrow011', 'Fini'], ['eyebrow012', 'Leggere']];
// abiti divisi: sopra e sotto si prendono da abiti diversi (la salopette è un pezzo unico)
const TOPS = [['', 'Nudo'], ['male_casualsuit01', 'Camicia'], ['male_casualsuit02', 'Maglia'], ['male_casualsuit03', 'Camicia a righe'], ['male_casualsuit04', 'T-shirt'], ['male_casualsuit06', 'T-shirt bianca'], ['male_casualsuit05', 'Giacca'], ['male_elegantsuit01', 'Giacca scura'], ['male_worksuit01', 'Salopette'],
  ['female_casualsuit01', 'Maglietta'], ['female_elegantsuit01', 'Camicetta'], ['female_sportsuit01', 'Top sportivo']];
const BOTTOMS = [['', 'Nudo'], ['male_casualsuit01', 'Jeans con cintura'], ['male_casualsuit02', 'Jeans'], ['male_elegantsuit01', 'Pantaloni scuri'],
  ['female_casualsuit01', 'Jeans'], ['female_casualsuit02', 'Shorts'], ['female_elegantsuit01', 'Gonna'], ['female_sportsuit01', 'Leggings']];
const UNDER = [['', 'No'], ['nero', 'Nero'], ['bianco', 'Bianco'], ['carne', 'Color carne']];
// all'uomo i capi da uomo; alla donna i suoi e quelli da uomo che le stanno bene
const UNISEX = ['male_casualsuit01', 'male_casualsuit03', 'male_casualsuit05', 'male_casualsuit06', 'male_elegantsuit01', 'male_worksuit01'];
const forFig = (l: string[][], f: 'uomo' | 'donna') => l.filter(([id]) => !id || (f === 'uomo' ? id.startsWith('male') : id.startsWith('female') || UNISEX.includes(id)));
const topOf = (l: Look) => l.top ?? l.outfit ?? '';
const botOf = (l: Look) => l.bottom ?? l.outfit ?? '';
const SHOES = [['', 'Piedi nudi'], ['shoes01', 'Cuoio'], ['shoes02', 'Scarponcini'], ['shoes03', 'Stivali'], ['shoes04', 'Nere']];
const EYES = [['brown', 'Castani'], ['brownlight', 'Nocciola'], ['green', 'Verdi'], ['blue', 'Azzurri'], ['lightblue', 'Celesti'], ['grey', 'Grigi']];
const EYE_SW: Record<string, string> = { brown: '#4a2c1a', brownlight: '#8a5a2e', green: '#4f6b3a', blue: '#3c6a9a', lightblue: '#8db4d8', grey: '#8a9096' };
const FORMS = [['', 'Libera'], ['oval', 'Ovale'], ['round', 'Tonda'], ['rectangular', 'Rettangolare'], ['square', 'Quadrata'], ['triangular', 'Triangolare'], ['invertedtriangular', 'A cuore'], ['diamond', 'A diamante']];

const BODY: [string, string, string, string][] = [['spalle', 'Spalle', 'strette', 'larghe'], ['torace', 'Torace', 'stretto', 'ampio'], ['fianchi', 'Fianchi', 'stretti', 'larghi'], ['pancia', 'Pancia', 'piatta', 'pronunciata'], ['glutei', 'Glutei', 'piccoli', 'pieni'], ['collo', 'Collo', 'sottile', 'robusto']];
const FACE: [string, [string, string, string, string][]][] = [
  ['Testa', [['testa', 'Larghezza', 'stretta', 'larga'], ['guanceTesta', 'Pienezza', 'scavata', 'piena'], ['fronte', 'Fronte', 'bassa', 'alta']]],
  ['Occhi', [['occhi', 'Grandezza', 'piccoli', 'grandi'], ['occhiDist', 'Distanza', 'vicini', 'lontani'], ['occhiAng', 'Taglio', 'all\'ingiù', 'all\'insù'], ['palpebre', 'Apertura', 'socchiusi', 'aperti']]],
  ['Sopracciglia', [['sopracciglia', 'Altezza', 'basse', 'alte'], ['sopraccigliaAng', 'Inclinazione', 'giù', 'su']]],
  ['Naso', [['naso', 'Larghezza', 'stretto', 'largo'], ['nasoLung', 'Lunghezza', 'corto', 'lungo'], ['nasoPunta', 'Punta', 'fine', 'larga'], ['nasoGobba', 'Gobba', 'dritto', 'aquilino'], ['narici', 'Narici', 'strette', 'larghe']]],
  ['Bocca', [['bocca', 'Larghezza', 'piccola', 'larga'], ['labbroSup', 'Labbro superiore', 'sottile', 'pieno'], ['labbroInf', 'Labbro inferiore', 'sottile', 'pieno'], ['angoliBocca', 'Angoli', 'all\'ingiù', 'all\'insù']]],
  ['Mento e mascella', [['mento', 'Mento', 'indietro', 'avanti'], ['mentoLargo', 'Larghezza mento', 'stretto', 'largo'], ['mascella', 'Mascella', 'morbida', 'marcata'], ['fossetta', 'Fossetta', 'nessuna', 'marcata']]],
  ['Zigomi e guance', [['zigomi', 'Zigomi', 'piatti', 'alti'], ['guance', 'Guance', 'scavate', 'piene']]],
  ['Orecchie', [['orecchie', 'Grandezza', 'piccole', 'grandi'], ['orecchieAp', 'Apertura', 'aderenti', 'a sventola']]],
];
const TABS = ['Corpo', 'Viso', 'Capelli', 'Abiti', 'Espressione'] as const;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pickR = <T,>(l: readonly T[]) => l[Math.floor(Math.random() * l.length)];

function randomLook(fig: 'uomo' | 'donna'): Look {
  const L = defaultLook(fig);
  L.age = Math.max(0, rnd(-0.2, 0.7)); L.muscle = rnd(0.25, 0.8); L.weight = rnd(0.2, 0.8); L.breast = fig === 'donna' ? rnd(-0.5, 0.8) : 0;
  const r = [Math.random(), Math.random(), Math.random() * 1.5]; const t = r[0] + r[1] + r[2]; L.race = [r[0] / t, r[1] / t, r[2] / t];
  for (const [, l] of FACE) for (const [k] of l) L.s[k] = Math.random() < 0.6 ? +(rnd(-0.6, 0.6)).toFixed(2) : 0;
  L.form = pickR(FORMS)[0];
  L.hair = fig === 'donna' ? pickR(['bob01', 'bob02', 'long01', 'ponytail01', 'braid01', 'short01']) : pickR(['short01', 'short02', 'short03', 'short04', '', 'short02']);
  L.hairColor = L.age > 0.55 ? pickR(['#8d8a86', '#e3e0da']) : pickR(HAIR_COLORS).id;
  L.brows = pickR(BROWS)[0]; L.eyes = pickR(EYES)[0];
  L.outfit = pickR(TOPS.filter(([id]) => id && id.startsWith(fig === 'donna' ? 'female' : 'male')))[0];
  L.top = L.outfit; L.bottom = WHOLE_SUITS.includes(L.outfit) ? '' : BOTTOMS.some(([id]) => id === L.outfit) ? L.outfit : pickR(forFig(BOTTOMS, fig).filter(([id]) => id))[0];
  L.outfitHue = Math.random() < 0.5 ? 0 : Math.round(rnd(-18, 18)) * 10; L.outfitLight = Math.round(rnd(-0.5, 0.4) * 20) / 20;
  L.shoes = pickR(SHOES.slice(1))[0];
  return L;
}

function Slider({ label, lo, hi, v, min = -1, max = 1, set, fmt }: { label: string; lo?: string; hi?: string; v: number; min?: number; max?: number; set: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <div className="row cr-sl">
      <div className="k"><span>{label}</span><b className="num">{fmt ? fmt(v) : v === 0 ? '' : v < 0 ? lo : hi}</b></div>
      <input type="range" min={min} max={max} step={0.01} value={v} onChange={(e) => set(+e.target.value)} onDoubleClick={() => set(min < 0 ? 0 : (min + max) / 2)} />
    </div>
  );
}

function Chips({ items, v, set, sw }: { items: readonly (readonly [string, string])[] | string[][]; v: string; set: (v: string) => void; sw?: Record<string, string> }) {
  return <div className="chips">{(items as any[]).map(([id, n]) => <button key={id || 'none'} className={`chip ${sw ? 'sw' : ''} ${v === id ? 'on' : ''}`} onClick={() => set(id)}>{sw && <i style={{ background: sw[id] }} />}{n}</button>)}</div>;
}

export default function Creator() {
  const id = useStore((s) => s.creator);
  const person = useStore((s) => s.people.find((p) => p.id === s.creator));
  const [fig, setFig] = useState<'uomo' | 'donna'>(person?.figure || 'uomo');
  const [skin, setSkin] = useState(person?.skin || 'media');
  const [height, setHeight] = useState(person?.height || 1.75);
  const [look, setLook] = useState<Look>(() => JSON.parse(JSON.stringify(person?.look || defaultLook(person?.figure || 'uomo', person?.skin))));
  const [tab, setTab] = useState<(typeof TABS)[number]>('Corpo');
  const [busy, setBusy] = useState(true);
  const [frame, setFrame] = useState<'tutto' | 'volto'>('tutto');
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{ r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; fig: THREE.Object3D | null; yaw: number; dirty: boolean; target: THREE.Vector3; dist: number; stop: boolean } | null>(null);
  const set = (p: Partial<Look>) => setLook((l) => ({ ...l, ...p }));
  const setS = (k: string, v: number) => setLook((l) => ({ ...l, s: { ...l.s, [k]: Math.abs(v) < 0.03 ? 0 : v } }));

  // anteprima: scena da studio con luce morbida, si gira trascinando
  useEffect(() => {
    if (!id || !host.current) return;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    r.setPixelRatio(Math.min(2, devicePixelRatio));
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1.1;
    r.outputColorSpace = THREE.SRGBColorSpace;
    host.current.appendChild(r.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#111113');
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    const key = new THREE.DirectionalLight('#fff4e8', 2.2); key.position.set(1.5, 2.5, 2); scene.add(key);
    const rim = new THREE.DirectionalLight('#dfe8ff', 1.2); rim.position.set(-2, 2, -2); scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), new THREE.MeshStandardMaterial({ color: '#1c1c1f', roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
    const st = { r, scene, cam, fig: null as THREE.Object3D | null, yaw: 0.35, dirty: true, target: new THREE.Vector3(0, 0.95, 0), dist: 4.2, stop: false };
    three.current = st;
    const resize = () => { const w = host.current!.clientWidth, h = host.current!.clientHeight; r.setSize(w, h, false); r.domElement.style.width = w + 'px'; r.domElement.style.height = h + 'px'; cam.aspect = w / h; cam.updateProjectionMatrix(); st.dirty = true; };
    const ro = new ResizeObserver(resize); ro.observe(host.current); resize();
    const loop = () => {
      if (st.stop) return;
      if (st.dirty) {
        st.dirty = false;
        cam.position.set(st.target.x + Math.sin(st.yaw) * st.dist, st.target.y + 0.05, st.target.z + Math.cos(st.yaw) * st.dist);
        cam.lookAt(st.target);
        r.render(scene, cam);
      }
      requestAnimationFrame(loop);
    };
    loop();
    let drag: number | null = null;
    const el = r.domElement;
    el.style.touchAction = 'none';
    const down = (e: PointerEvent) => { drag = e.clientX; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (drag == null) return; st.yaw -= (e.clientX - drag) * 0.012; drag = e.clientX; st.dirty = true; };
    const up = () => { drag = null; };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    return () => { st.stop = true; ro.disconnect(); r.dispose(); pm.dispose(); el.remove(); three.current = null; };
  }, [id]);

  // inquadratura: tutto il corpo o il volto
  useEffect(() => {
    const st = three.current;
    if (!st) return;
    const s = height / 1.75;
    // telefono: la scena è bassa e in alto ci sono i comandi, quindi la figura si allontana e scende un poco
    const low = st.r.domElement.clientHeight < 460 ? 1 : 0;
    if (frame === 'volto') { st.target.set(0, (1.6 + 0.03 * low) * s, 0); st.dist = 1.15 * (1 + 0.2 * low); } else { st.target.set(0, (0.92 + 0.12 * low) * s, 0); st.dist = 4.6 * s * (1 + 0.25 * low); }
    st.dirty = true;
  }, [frame, height, id]);

  // ricostruzione del personaggio a ogni modifica (raggruppata mentre si trascina un cursore)
  const key = useMemo(() => JSON.stringify([fig, skin, look]), [fig, skin, look]);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        await loadBase();
        const g = await buildHuman(look, fig, skin);
        if (!alive) return;
        const st = three.current;
        if (!st) return;
        const tpl = prepareHuman(g);
        const s = (0.95 * height / 1.75) / tpl.hipsH;
        g.scale.setScalar(s);
        if (st.fig) { st.scene.remove(st.fig); st.fig.traverse((o: any) => { if (o.isMesh) o.geometry.dispose(); }); }
        st.fig = g; st.scene.add(g); st.dirty = true;
      } finally { if (alive) setBusy(false); }
    }, 90);
    return () => { alive = false; clearTimeout(t); };
  }, [key, height, id]);

  if (!id || !person) return null;
  const close = () => useStore.setState({ creator: null });
  const done = () => {
    const s = useStore.getState();
    s.snapshot();
    s.updatePerson(id, { figure: fig, skin, height, look });
    useStore.setState({ creator: null });
    s.showToast(`${person.name}: nuovo aspetto.`, true);
  };
  const switchFig = (f: 'uomo' | 'donna') => {
    if (f === fig) return;
    const d = defaultLook(f, skin);
    setFig(f);
    setLook((l) => ({ ...l, breast: 0, hair: d.hair, brows: d.brows, outfit: d.outfit, top: d.top, bottom: d.bottom, shoes: d.shoes }));
    setHeight(f === 'donna' ? Math.min(height, 1.66) : Math.max(height, 1.76));
  };
  const raceNames = ['Africani', 'Asiatici', 'Europei'];
  const setRace = (i: number, v: number) => setLook((l) => {
    const r = [...l.race] as [number, number, number];
    r[i] = v;
    const rest = r.reduce((a, b, j) => (j === i ? a : a + b), 0);
    const left = 1 - v;
    for (let j = 0; j < 3; j++) if (j !== i) r[j] = rest > 1e-6 ? (r[j] / rest) * left : left / 2;
    return { ...l, race: r };
  });

  return (
    <div id="creator">
      <div className="cr-stage" ref={host}>
        <div className="cr-top">
          <div className="seg">{(['uomo', 'donna'] as const).map((f) => <button key={f} className={fig === f ? 'on' : ''} onClick={() => switchFig(f)}>{f === 'uomo' ? 'Uomo' : 'Donna'}</button>)}</div>
          <div className="seg">{(['tutto', 'volto'] as const).map((f) => <button key={f} className={frame === f ? 'on' : ''} onClick={() => setFrame(f)}>{f === 'tutto' ? 'Corpo' : 'Volto'}</button>)}</div>
        </div>
        {busy && <div className="cr-busy">…</div>}
        <div className="cr-hint">Trascina per girarlo</div>
      </div>
      <div className="cr-panel glass">
        <div className="cr-head">
          <h3>{person.name}</h3>
          <div className="cr-acts">
            <button className="btn" onClick={() => setLook(randomLook(fig))} title="Un aspetto a caso">Casuale</button>
            <button className="btn" onClick={close}>Annulla</button>
            <button className="btn primary" onClick={done}>Fatto</button>
          </div>
        </div>
        <div className="cr-tabs">{TABS.map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
        <div className="cr-body">
          {tab === 'Corpo' && <>
            <Slider label="Altezza" v={height} min={1.45} max={2.05} set={setHeight} fmt={(v) => `${v.toFixed(2).replace('.', ',')} m`} />
            <Slider label="Età" v={look.age} min={0} max={1} set={(v) => set({ age: v })} fmt={(v) => `${Math.round(25 + v * 65)} anni`} />
            <Slider label="Muscoli" v={look.muscle} min={0} max={1} set={(v) => set({ muscle: v })} fmt={(v) => (v < 0.35 ? 'pochi' : v > 0.65 ? 'tanti' : 'nella media')} />
            <Slider label="Peso" v={look.weight} min={0} max={1} set={(v) => set({ weight: v })} fmt={(v) => (v < 0.35 ? 'magro' : v > 0.65 ? 'robusto' : 'nella media')} />
            {fig === 'donna' && <Slider label="Seno" lo="piccolo" hi="grande" v={look.breast} set={(v) => set({ breast: v })} />}
            {BODY.map(([k, n, lo, hi]) => <Slider key={k} label={n} lo={lo} hi={hi} v={look.s[k] || 0} set={(v) => setS(k, v)} />)}
            <div className="row"><div className="k"><span>Pelle</span></div><Chips items={SKINS.map((s) => [s.id, s.name])} v={skin} set={setSkin} sw={Object.fromEntries(SKINS.map((s) => [s.id, s.color]))} /></div>
            <Slider label="Tono della pelle" lo="più scuro" hi="più chiaro" v={look.skinLight || 0} set={(v) => set({ skinLight: v })} />
          </>}
          {tab === 'Viso' && <>
            <div className="row"><div className="k"><span>Forma del viso</span></div><Chips items={FORMS} v={look.form} set={(v) => set({ form: v })} /></div>
            <div className="cr-sec">Tratti</div>
            {raceNames.map((n, i) => <Slider key={n} label={n} v={look.race[i]} min={0} max={1} set={(v) => setRace(i, v)} fmt={(v) => `${Math.round(v * 100)}%`} />)}
            <div className="row"><div className="k"><span>Occhi</span></div><Chips items={EYES} v={look.eyes} set={(v) => set({ eyes: v })} sw={EYE_SW} /></div>
            {FACE.map(([sec, l]) => <div key={sec}><div className="cr-sec">{sec}</div>{l.map(([k, n, lo, hi]) => <Slider key={k} label={n} lo={lo} hi={hi} v={look.s[k] || 0} set={(v) => setS(k, v)} />)}</div>)}
          </>}
          {tab === 'Capelli' && <>
            <div className="row"><div className="k"><span>Taglio</span></div><Chips items={HAIR} v={look.hair} set={(v) => set({ hair: v })} /></div>
            <div className="row"><div className="k"><span>Colore</span></div><Chips items={HAIR_COLORS.map((c) => [c.id, c.name])} v={look.hairColor} set={(v) => set({ hairColor: v })} sw={Object.fromEntries(HAIR_COLORS.map((c) => [c.id, c.id]))} /></div>
            <div className="row"><div className="k"><span>Sopracciglia</span></div><Chips items={BROWS} v={look.brows} set={(v) => set({ brows: v })} /></div>
          </>}
          {tab === 'Abiti' && <>
            <div className="row"><div className="k"><span>Sopra</span></div><Chips items={forFig(TOPS, fig)} v={topOf(look)} set={(v) => set({ top: v, bottom: botOf(look) })} /></div>
            {!WHOLE_SUITS.includes(topOf(look)) && <div className="row"><div className="k"><span>Sotto</span></div><Chips items={forFig(BOTTOMS, fig)} v={botOf(look)} set={(v) => set({ bottom: v, top: topOf(look) })} /></div>}
            <div className="row"><div className="k"><span>Intimo</span></div><Chips items={UNDER} v={look.under || ''} set={(v) => set({ under: v })} /></div>
            {(topOf(look) || botOf(look)) && <Slider label="Tinta" v={look.outfitHue} min={-180} max={180} set={(v) => set({ outfitHue: Math.round(v / 10) * 10 })} fmt={(v) => (v === 0 ? 'originale' : `${v > 0 ? '+' : ''}${v}°`)} />}
            {(topOf(look) || botOf(look)) && <Slider label="Chiarezza" lo="più scuro" hi="più chiaro" v={look.outfitLight} set={(v) => set({ outfitLight: Math.round(v * 20) / 20 })} />}
            <div className="row"><div className="k"><span>Scarpe</span></div><Chips items={SHOES} v={look.shoes} set={(v) => set({ shoes: v })} /></div>
            <div className="line"><span>Cappello</span><div className={`toggle ${look.hat ? 'on' : ''}`} onClick={() => set({ hat: look.hat ? '' : 'fedora01' })} /></div>
            <div className="hint">Il colore degli abiti conta per la luce: un tessuto chiaro rimbalza luce sul viso, uno scuro la assorbe.</div>
          </>}
          {tab === 'Espressione' && <>
            <div className="chips cr-expr">{EXPRESSIONS.map((e) => <button key={e.id} className={`chip ${look.expr === e.id ? 'on' : ''}`} onClick={() => { set({ expr: e.id }); setFrame('volto'); }}>{e.name}</button>)}</div>
          </>}
        </div>
      </div>
    </div>
  );
}
