export const TYPE_ICONS: Record<string, string> = {
  Pannello: '<rect x="4" y="6" width="16" height="12" rx="2"/>',
  Fresnel: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2.5"/>',
  Lampadina: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3 11v2h6v-2a6 6 0 0 0-3-11z"/>',
  Tubo: '<rect x="3" y="10" width="18" height="4" rx="2"/>',
  HMI: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  Bandiera: '<rect x="6" y="3" width="12" height="13" fill="currentColor" fill-opacity=".5"/><path d="M12 16v6"/>',
  'Pannello bianco': '<rect x="5" y="4" width="14" height="14"/><path d="M12 18v4"/>',
  'Pannello nero': '<rect x="5" y="4" width="14" height="14" fill="currentColor" fill-opacity=".7"/><path d="M12 18v4"/>',
  'Telaio diffusione': '<rect x="4" y="4" width="16" height="14" stroke-dasharray="2 2"/><path d="M12 18v4"/>',
};

export const POSE_ICONS: Record<string, string> = {
  piedi: '<circle cx="14" cy="5" r="3"/><path d="M14 9v13M14 22l-4 12M14 22l4 12M14 12l-6 8M14 12l6 8"/>',
  seduto: '<circle cx="12" cy="8" r="3"/><path d="M12 12v12h10v10M12 15l6 6"/>',
  steso: '<circle cx="4" cy="26" r="3"/><path d="M8 26h18M10 30h16"/>',
  ginocchio: '<circle cx="12" cy="7" r="3"/><path d="M12 11v11l8 1v11M12 22l-2 12M12 14l5 6"/>',
  cammina: '<circle cx="14" cy="5" r="3"/><path d="M14 9v13M14 22l-6 12M14 22l6 12M14 12l-5 9M14 12l5 7"/>',
  conserte: '<circle cx="14" cy="5" r="3"/><path d="M14 9v13M14 22l-4 12M14 22l4 12M8 15h12"/>',
};

export const Svg = ({ d, vb = '0 0 24 24' }: { d: string; vb?: string }) => <svg viewBox={vb} dangerouslySetInnerHTML={{ __html: d }} />;
