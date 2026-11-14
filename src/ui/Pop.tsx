import React, { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { eng } from '../engineRef';

// Scheda in vetro che compare vicino al punto (x, y), sempre dentro lo schermo.
export default function Pop({ x, y, width = 300, children, anchor = 'side', bottom, onClose, className = '' }: {
  x: number; y: number; width?: number; children: ReactNode; anchor?: 'side' | 'above' | 'below' | 'at'; bottom?: number; onClose?: () => void; className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; ox: number; oy: number } | null>(null);
  const [hgt, setHgt] = useState(0);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => setHgt(el.current ? el.current.offsetHeight : 0));
    ro.observe(el.current!);
    return () => ro.disconnect();
  }, []);
  // telefono: foglio in basso, sopra il barra, che lascia libera la scena
  const phone = typeof innerWidth !== 'undefined' && innerWidth <= 600;
  // tre altezze: 0 solo il titolo, 1 metà (predefinita), 2 tutto
  const [snap, setSnap] = useState<0 | 1 | 2>(1);
  useLayoutEffect(() => {
    if (!phone) return;
    setPos({ left: 8, bottom: 8, ox: x - 8, oy: 0 });
  }, [phone, x]);
  useLayoutEffect(() => {
    if (!phone || !pos || !el.current) return;
    const top = el.current.getBoundingClientRect().top;
    eng()?.setViewShift((innerHeight - top) / 2);
  }, [phone, pos, hgt, snap]);
  useLayoutEffect(() => {
    if (!phone) return;
    // la barra in basso lascia il posto al foglio finché è aperto
    const b = document.body;
    b.dataset.sheets = String(+(b.dataset.sheets || 0) + 1);
    b.classList.add('sheet-open');
    return () => {
      const n = +(b.dataset.sheets || 1) - 1;
      b.dataset.sheets = String(n);
      if (n <= 0) { b.classList.remove('sheet-open'); eng()?.setViewShift(0); }
    };
  }, [phone]);
  useLayoutEffect(() => {
    if (!phone) return;
    // trascinando nella scena (guardarsi intorno, spostare una luce) il foglio si abbassa al solo titolo
    const down = (ev: PointerEvent) => {
      const t = ev.target as HTMLElement;
      if (el.current?.contains(t) || t.closest?.('.pop,#dock,.chrome,#viewer')) return;
      const sx = ev.clientX, sy = ev.clientY;
      const mv = (m: PointerEvent) => { if (Math.hypot(m.clientX - sx, m.clientY - sy) > 10) { setSnap(0); end(); } };
      const end = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', end, true); removeEventListener('pointercancel', end, true); };
      addEventListener('pointermove', mv, true); addEventListener('pointerup', end, true); addEventListener('pointercancel', end, true);
    };
    addEventListener('pointerdown', down, true);
    return () => removeEventListener('pointerdown', down, true);
  }, [phone]);
  const grabDown = (e: React.PointerEvent) => {
    const sy = e.clientY;
    const up = (ev: PointerEvent) => {
      removeEventListener('pointerup', up);
      const dy = ev.clientY - sy;
      if (Math.abs(dy) < 8) setSnap((s) => (s === 1 ? 0 : 1));
      else setSnap((s) => (dy < 0 ? Math.min(2, s + 1) : Math.max(0, s - 1)) as 0 | 1 | 2);
    };
    addEventListener('pointerup', up);
  };
  // computer: la scheda si sposta trascinandola (da un punto qualsiasi che non sia un comando)
  const [pinned, setPinned] = useState<{ left: number; top: number } | null>(null);
  const dragStart = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (phone || e.button !== 0 || !el.current) return;
    const t = e.target as HTMLElement;
    if (t.closest('input,button,select,textarea,a,label,.toggle,.chip,.v,.type,.pose,[data-nodrag]')) return;
    const r = el.current.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const mv = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      const left = Math.max(8, Math.min(innerWidth - r.width - 8, r.left + ev.clientX - sx));
      const top = Math.max(8, Math.min(innerHeight - Math.min(r.height, 120) - 8, r.top + ev.clientY - sy));
      setPinned({ left, top });
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };
  useLayoutEffect(() => {
    if (phone) return;
    // misure senza la trasformazione dell'animazione di apertura
    const r = { height: el.current!.offsetHeight };
    const W = innerWidth, H = innerHeight;
    let left = x, top = y;
    if (anchor === 'side') {
      left = x + 56 + width < W - 16 ? x + 56 : x - 56 - width;
      top = y - 40;
    } else if (anchor === 'below') {
      left = x - width; top = y;
    } else if (anchor === 'at') {
      left = x; top = y;
    } else {
      left = x - width / 2;
    }
    left = Math.max(16, Math.min(W - width - 16, left));
    if (bottom != null) { setPos({ left, bottom, ox: x - left, oy: r.height }); return; }
    top = Math.max(16, Math.min(H - r.height - 96, top));
    setPos({ left, top, ox: x - left, oy: y - top });
  }, [x, y, width, anchor, bottom, hgt]);
  return (
    <div ref={el} className={`pop glass ${className}${phone ? ' sheet' : ''}${phone && snap === 0 ? ' mini' : ''}${phone && snap === 2 ? ' full' : ''}`} onPointerDown={dragStart} onClickCapture={(e) => { if (phone && snap === 0 && !(e.target as HTMLElement).closest('.toggle,.x')) { e.stopPropagation(); setSnap(1); } }} onKeyDown={(e) => { if (e.key === 'Escape') onClose?.(); }}
      style={{ width: phone ? innerWidth - 16 : width, left: pinned ? pinned.left : pos?.left ?? -9999, top: pinned ? pinned.top : pos?.top, bottom: pinned ? undefined : pos?.bottom, animation: pinned ? 'none' : undefined, ['--ox' as any]: `${pos?.ox ?? 0}px`, ['--oy' as any]: `${pos?.oy ?? 0}px`, visibility: pos ? 'visible' : 'hidden' }}>
      {phone ? <div className="grab" onPointerDown={grabDown} title={snap === 0 ? 'Apri' : 'Riduci'}><i />{onClose && <button className="x" aria-label="Chiudi" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onClose(); }}>×</button>}</div>
        : <div className="grip" title="Trascina per spostare"><i /></div>}
      {children}
    </div>
  );
}
