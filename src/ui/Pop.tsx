import { ReactNode, useLayoutEffect, useRef, useState } from 'react';

// Scheda in vetro che compare vicino al punto (x, y), sempre dentro lo schermo.
export default function Pop({ x, y, width = 300, children, anchor = 'side', bottom, onClose, className = '' }: {
  x: number; y: number; width?: number; children: ReactNode; anchor?: 'side' | 'above' | 'below' | 'at'; bottom?: number; onClose?: () => void; className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; ox: number; oy: number } | null>(null);
  useLayoutEffect(() => {
    const r = el.current!.getBoundingClientRect();
    const W = innerWidth, H = innerHeight;
    let left = x, top = y;
    if (anchor === 'side') {
      left = x + 44 + width < W - 16 ? x + 44 : x - 44 - width;
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
  }, [x, y, width, anchor, bottom]);
  return (
    <div ref={el} className={`pop glass ${className}`} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose?.(); }}
      style={{ width, left: pos?.left ?? -9999, top: pos?.top, bottom: pos?.bottom, ['--ox' as any]: `${pos?.ox ?? 0}px`, ['--oy' as any]: `${pos?.oy ?? 0}px`, visibility: pos ? 'visible' : 'hidden' }}>
      {children}
    </div>
  );
}
