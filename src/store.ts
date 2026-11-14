import { create } from 'zustand';
import { LightState } from './engine/photometry';
import { PersonState } from './engine/mannequin';
import { SunState, defaultSun } from './engine/sun';
import type { Reconstruction } from './engine/reconstruct';
import type { RoomSpec } from './engine/room';
import type { FurnitureState } from './engine/furniture';

export interface PropState {
  id: string;
  kind: 'bandiera' | 'bianco' | 'nero' | 'diffusore';
  position: [number, number, number]; // centro
  rotationY: number;
  tilt: number; // gradi
  size: [number, number];
}

export interface CamState {
  focal: number;
  sensor: string;
  iso: number;
  fStop: number;
  shutter: number;
  aspect: string;
  falseColor: boolean;
  focus?: number; // metri; 0 o assente = automatico
}

export interface Shot {
  id: string;
  url: string;      // dataURL jpeg
  width: number;
  height: number;
  scene: SceneSnapshot;
  createdAt: number;
  // fotogramma di un movimento di camera
  move?: { group: string; kind: string; amount: number; frame: number; of: number; label: string; text: string; start: [number, number, number]; end: [number, number, number]; endDir: [number, number, number] };
}

export interface SceneSnapshot {
  lights: LightState[];
  people: PersonState[];
  props: PropState[];
  sun: SunState;
  cam: CamState;
  ambient: number;
  room?: RoomSpec | null;          // stanza costruita a mano
  furniture?: FurnitureState[];
}

export type Selection = { type: 'light' | 'person' | 'prop' | 'furniture' | 'opening'; id: string } | null;

interface Store extends SceneSnapshot {
  room: RoomSpec | null;
  furniture: FurnitureState[];
  phase: 'empty' | 'working' | 'ready';
  status: string;
  progress: number;
  placeName: string;
  recon: Reconstruction | null;
  photos: string[];
  selection: Selection;
  manikin: string | null;
  showOriginal: boolean;
  meter: boolean;
  meterPin: { p: [number, number, number]; text: string } | null;
  viewer: string | null;
  shots: Shot[];
  shooting: number; // 0 = no, 0..1 progresso
  camMove: import('./engine/camMove').CamMove | null; // movimento di camera scelto (null = camera ferma)
  past: string[];
  future: string[];
  toast: { text: string; t: number } | null;
  set: (p: Partial<Store>) => void;
  snapshot: () => void;
  undo: () => void;
  redo: () => void;
  updateLight: (id: string, p: Partial<LightState>) => void;
  updatePerson: (id: string, p: Partial<PersonState>) => void;
  updateProp: (id: string, p: Partial<PropState>) => void;
  updateFurniture: (id: string, p: Partial<FurnitureState>) => void;
  showToast: (text: string) => void;
}

export const defaultCam = (): CamState => ({ focal: 24, sensor: 's35', iso: 800, fStop: 2.8, shutter: 1 / 50, aspect: 'free', falseColor: false, focus: 0 });

const snap = (s: SceneSnapshot): string =>
  JSON.stringify({ lights: s.lights, people: s.people, props: s.props, sun: s.sun, cam: s.cam, ambient: s.ambient, room: s.room, furniture: s.furniture });

export const useStore = create<Store>((set, get) => ({
  phase: 'empty',
  status: '',
  progress: 0,
  placeName: 'Nuovo luogo',
  recon: null,
  photos: [],
  lights: [],
  people: [],
  props: [],
  room: null,
  furniture: [],
  sun: defaultSun(),
  cam: defaultCam(),
  ambient: 0.18,
  selection: null,
  manikin: null,
  showOriginal: false,
  meter: false,
  meterPin: null,
  viewer: null,
  shots: [],
  shooting: 0,
  camMove: null,
  past: [],
  future: [],
  toast: null,
  set: (p) => set(p as any),
  snapshot: () => {
    const s = get();
    const cur = snap(s);
    if (s.past[s.past.length - 1] === cur) return;
    set({ past: [...s.past.slice(-199), cur], future: [] });
  },
  undo: () => {
    const s = get();
    if (!s.past.length) return;
    const prev = s.past[s.past.length - 1];
    set({ ...JSON.parse(prev), past: s.past.slice(0, -1), future: [...s.future, snap(s)] });
  },
  redo: () => {
    const s = get();
    if (!s.future.length) return;
    const next = s.future[s.future.length - 1];
    set({ ...JSON.parse(next), future: s.future.slice(0, -1), past: [...s.past, snap(s)] });
  },
  updateLight: (id, p) => set((s) => ({ lights: s.lights.map((l) => (l.id === id ? { ...l, ...p } : l)) })),
  updatePerson: (id, p) => set((s) => ({ people: s.people.map((l) => (l.id === id ? { ...l, ...p } : l)) })),
  updateProp: (id, p) => set((s) => ({ props: s.props.map((l) => (l.id === id ? { ...l, ...p } : l)) })),
  updateFurniture: (id, p) => set((s) => ({ furniture: s.furniture.map((l) => (l.id === id ? { ...l, ...p } : l)) })),
  showToast: (text) => set({ toast: { text, t: Date.now() } }),
}));
