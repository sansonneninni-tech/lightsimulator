import type { Engine } from './engine/Engine';
export const ref: { engine: Engine | null } = { engine: null };
export const eng = () => ref.engine;
