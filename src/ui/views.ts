// viste rapide: pianta dall'alto, inquadratura iniziale della camera, viso della persona
import { useStore } from '../store';
import { eng } from '../engineRef';
import { TOUCH } from './touch';

export type QuickView = 'pianta' | 'camera' | 'viso';

export function quickView(k: QuickView) {
  const e = eng();
  const s = useStore.getState();
  if (!e || s.phase !== 'ready') return;
  if (k === 'camera') { e.resetView(); return; }
  if (k === 'pianta') { e.topView(); s.showToast(TOUCH ? 'Pianta dall\'alto. Camera › Vista per tornare.' : 'Pianta dall\'alto. F o 2 per tornare alla camera.'); return; }
  // la persona scelta, altrimenti la prima
  const id = s.selection?.type === 'person' ? s.selection.id : s.people[0]?.id;
  if (!id || !e.faceView(id)) { s.showToast('Non ci sono persone in scena.'); return; }
}
