// Posizione del sole, cielo e meteo.
import * as THREE from 'three';

export interface SunState {
  enabled: boolean;
  hour: number;        // 0-24 ora locale solare
  dayOfYear: number;   // 1-365
  latitude: number;    // gradi
  north: number;       // gradi: direzione del nord rispetto alla vista della foto (0 = davanti)
  weather: WeatherId;
}

export type WeatherId = 'sereno' | 'velato' | 'nuvoloso' | 'coperto' | 'pioggia';
export const WEATHER: { id: WeatherId; name: string; sun: number; sky: number }[] = [
  { id: 'sereno', name: 'Sereno', sun: 1, sky: 1 },
  { id: 'velato', name: 'Velato', sun: 0.55, sky: 1.3 },
  { id: 'nuvoloso', name: 'Nuvoloso', sun: 0.12, sky: 1.1 },
  { id: 'coperto', name: 'Coperto', sun: 0, sky: 0.7 },
  { id: 'pioggia', name: 'Pioggia', sun: 0, sky: 0.4 },
];

// Elevazione e azimut (gradi; azimut da nord in senso orario)
export function sunAngles(hour: number, dayOfYear: number, latDeg: number) {
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
  const ha = 15 * (hour - 12);
  const d2r = Math.PI / 180;
  const lat = latDeg * d2r, dec = decl * d2r, h = ha * d2r;
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h);
  const el = Math.asin(sinEl);
  const cosAz = (Math.sin(dec) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat));
  let az = Math.acos(Math.min(1, Math.max(-1, cosAz)));
  if (ha > 0) az = 2 * Math.PI - az;
  return { elevation: el / d2r, azimuth: az / d2r };
}

// Direzione (dal punto verso il sole) nello spazio della scena.
// Scena: -Z è "davanti" (direzione della foto). north = angolo del nord rispetto a -Z, in senso orario visto dall'alto.
export function sunDirection(s: SunState) {
  const { elevation, azimuth } = sunAngles(s.hour, s.dayOfYear, s.latitude);
  const el = THREE.MathUtils.degToRad(elevation);
  const az = THREE.MathUtils.degToRad(azimuth + s.north);
  // azimut 0 = davanti (-Z), 90 = destra (+X)
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  return { dir, elevation, azimuth };
}

// Illuminamento del sole (lux su piano normale) e del cielo (lux orizzontale), colore in Kelvin
export function sunSky(s: SunState) {
  const { elevation } = sunAngles(s.hour, s.dayOfYear, s.latitude);
  const w = WEATHER.find((x) => x.id === s.weather) || WEATHER[0];
  const el = Math.max(-10, elevation);
  // massa d'aria semplificata
  const up = Math.max(0, Math.sin(THREE.MathUtils.degToRad(el)));
  const sunLux = el > 0 ? 110000 * Math.pow(up, 0.35) * Math.exp(-0.25 / Math.max(up, 0.05)) * w.sun : 0;
  // cielo: crepuscolo sotto l'orizzonte fino a -8°
  const twilight = THREE.MathUtils.clamp((el + 8) / 8, 0, 1);
  const skyLux = (el > 0 ? 3000 + 17000 * Math.pow(up, 0.7) : 3000 * twilight * twilight) * w.sky + 0.5;
  const sunK = el > 0 ? 2000 + 3600 * Math.min(1, Math.pow(up / 0.6, 0.7)) : 2000;
  const skyK = el > 2 ? (w.sun < 0.2 ? 6800 : 9000) : 12000 - 4000 * twilight;
  return { sunLux, skyLux, sunK, skyK, elevation };
}

export function fmtHour(h: number) {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function defaultSun(): SunState {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const doy = Math.floor((now.getTime() - start.getTime()) / 86400000);
  return { enabled: true, hour: 10.5, dayOfYear: doy, latitude: 42, north: 180, weather: 'sereno' };
}
