// Strumenti di regia: guide di inquadratura con il nome del taglio, confronto obiettivi.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { eng } from '../engineRef';

// guide sopra il formato: terzi, centro, area sicura 90%; in alto il taglio calcolato sulla persona
export function Guides({ busy }: { busy?: boolean }) {
  const on = useStore((s) => s.guides);
  const boxRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    if (!on) return;
    let raf = 0, last = 0;
    const step = (t: number) => {
      raf = requestAnimationFrame(step);
      const e = eng(), el = boxRef.current;
      if (!e || !el) return;
      const W = e.container.clientWidth, H = e.container.clientHeight;
      const fr = e.frameRect;
      el.style.left = `${fr.x0 * W}px`; el.style.width = `${(fr.x1 - fr.x0) * W}px`;
      el.style.top = `${(1 - fr.y1) * H}px`; el.style.height = `${(fr.y1 - fr.y0) * H}px`;
      if (t - last > 250 && !e.shot) { last = t; setText(e.describeShot().text); }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [on]);
  if (!on) return null;
  return (
    <div id="guides" ref={boxRef} className={busy ? 'busy' : ''}>
      <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 300 300">
        <path d="M100 0V300M200 0V300M0 100H300M0 200H300" />
        <path d="M150 140V160M140 150H160" />
        <rect x="15" y="15" width="270" height="270" className="safe" />
      </svg>
      <div className="lbl num">{text}</div>
    </div>
  );
}

const STRIP_FOCALS = [18, 25, 35, 50, 85, 135];

// confronto obiettivi: la stessa inquadratura da 18 a 135 mm, si sceglie toccandola
export function LensStrip() {
  const open = useStore((s) => s.lensStrip);
  const focal = useStore((s) => Math.round(s.cam.focal));
  const [items, setItems] = useState<{ focal: number; url: string; text: string }[]>([]);
  useEffect(() => {
    if (!open) { setItems([]); return; }
    const t = setTimeout(() => setItems(eng()?.lensStrip(STRIP_FOCALS) || []), 30);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') useStore.setState({ lensStrip: false }); };
    addEventListener('keydown', k);
    return () => { clearTimeout(t); removeEventListener('keydown', k); };
  }, [open]);
  if (!open) return null;
  const close = () => useStore.setState({ lensStrip: false });
  const pick = (f: number) => {
    const s = useStore.getState();
    s.snapshot();
    useStore.setState({ cam: { ...s.cam, focal: f }, lensStrip: false });
    s.showToast(`Obiettivo ${f} mm`);
  };
  return (
    <div id="lenses" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="head"><span>Stessa posizione, obiettivi diversi. Tocca quello che vuoi.</span><button onClick={close}>Chiudi</button></div>
      <div className="grid">
        {items.length === 0 && <div className="wait">Preparo le inquadrature…</div>}
        {items.map((it) => (
          <button key={it.focal} className={it.focal === focal ? 'on' : ''} onClick={() => pick(it.focal)}>
            <img src={it.url} alt={`${it.focal} mm`} />
            <span className="num"><b>{it.focal} mm</b> {it.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
