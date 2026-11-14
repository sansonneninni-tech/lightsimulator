// Movimenti di camera da set: dolly, carrello, pan, tilt, gru. Il movimento parte dall'inquadratura
// attuale; lo scatto ne fa fotogrammi fissi di qualità finale (inizio, intermedi, fine).
export type MoveKind = 'dolly' | 'carrello' | 'pan' | 'tilt' | 'gru';
export interface CamMove { kind: MoveKind; amount: number; frames: number }
export interface Pose { pos: [number, number, number]; yaw: number; pitch: number }

export const MOVES: { id: MoveKind; name: string; unit: 'm' | '°'; min: number; max: number; step: number; def: number; pos: string; neg: string }[] = [
  { id: 'dolly', name: 'Dolly', unit: 'm', min: -4, max: 4, step: 0.1, def: 1.5, pos: 'avanti', neg: 'indietro' },
  { id: 'carrello', name: 'Carrello', unit: 'm', min: -4, max: 4, step: 0.1, def: 1.5, pos: 'a destra', neg: 'a sinistra' },
  { id: 'pan', name: 'Pan', unit: '°', min: -120, max: 120, step: 1, def: 30, pos: 'a destra', neg: 'a sinistra' },
  { id: 'tilt', name: 'Tilt', unit: '°', min: -60, max: 60, step: 1, def: 15, pos: 'in su', neg: 'in giù' },
  { id: 'gru', name: 'Gru', unit: 'm', min: -1.5, max: 3, step: 0.1, def: 1, pos: 'in su', neg: 'in giù' },
];

const RAD = Math.PI / 180;

export function poseAt(start: Pose, m: CamMove, t: number): Pose {
  const a = m.amount * t;
  const [x, y, z] = start.pos;
  const fx = -Math.sin(start.yaw), fz = -Math.cos(start.yaw); // avanti, in orizzontale
  const rx = Math.cos(start.yaw), rz = -Math.sin(start.yaw); // destra
  switch (m.kind) {
    case 'dolly': return { ...start, pos: [x + fx * a, y, z + fz * a] };
    case 'carrello': return { ...start, pos: [x + rx * a, y, z + rz * a] };
    case 'gru': return { ...start, pos: [x, y + a, z] };
    case 'pan': return { ...start, yaw: start.yaw - a * RAD };
    case 'tilt': return { ...start, pitch: start.pitch + a * RAD };
  }
}

const num = (v: number, unit: string) => `${unit === 'm' ? Math.abs(v).toFixed(1).replace('.', ',') + ' m' : Math.round(Math.abs(v)) + '°'}`;

export function moveLabel(m: CamMove) {
  const d = MOVES.find((q) => q.id === m.kind)!;
  if (Math.abs(m.amount) < 1e-6) return `${d.name} fermo`;
  return `${d.name} ${m.amount > 0 ? d.pos : d.neg} ${num(m.amount, d.unit)}`;
}

export function frameLabel(i: number, n: number) {
  if (i === 0) return 'Inizio';
  if (i === n - 1) return 'Fine';
  if (n === 3) return 'Metà';
  return `${Math.round((i / (n - 1)) * 100)}%`;
}

export const easeInOut = (t: number) => t * t * (3 - 2 * t);
