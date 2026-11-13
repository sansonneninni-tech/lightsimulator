// Esportazioni: pianta luci (SVG/PNG), lista materiale (tabella/CSV), PDF troupe.
import * as THREE from 'three';
import { jsPDF } from 'jspdf';
import type { SceneSnapshot } from '../store';
import { furnitureKind } from '../engine/furniture';
import {
  LightState, fixtureById, effectiveLumens, lightColor, spotAngles, gelById, diffusionById, effectiveKelvin,
  illuminanceAt, SENSORS, fmtShutter, fmtStop, ASPECTS,
} from '../engine/photometry';
import { POSES } from '../engine/mannequin';
import { sunSky, fmtHour, WEATHER } from '../engine/sun';
import { PROP_KINDS } from '../engine/Engine';

export interface PlanInput {
  scene: SceneSnapshot;
  recon: { room: { min: [number, number, number]; max: [number, number, number] }; windows: { center: [number, number, number]; right: [number, number, number]; width: number }[] };
  camera: { position: [number, number, number]; dir: [number, number, number]; hfov: number };
  // movimento di camera: posizione e direzione finali, descrizione
  move?: { start: [number, number, number]; startDir: [number, number, number]; end: [number, number, number]; endDir: [number, number, number]; text: string };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function stopsLabel(stops: number) {
  const v = Math.round(stops * 3) / 3;
  if (Math.abs(v) < 0.01) return '0 stop';
  const w = Math.trunc(v), fr = Math.round(Math.abs(v - w) * 3);
  const sign = v > 0 ? '+' : '−';
  return `${sign}${Math.abs(w) ? Math.abs(w) + (fr ? ' ' : '') : ''}${fr ? fr + '/3' : ''} stop`;
}

export function luxAtTarget(L: LightState, skyLux: number) {
  const t = new THREE.Vector3(...L.target), p = new THREE.Vector3(...L.position);
  const n = p.clone().sub(t).normalize();
  return illuminanceAt(L, t, n, skyLux);
}

export function planSVG(inp: PlanInput, opts: { width?: number; height?: number } = {}) {
  const W = opts.width || 1000, H = opts.height || 640;
  const { scene, recon, camera } = inp;
  const [x0, , z0] = recon.room.min, [x1, , z1] = recon.room.max;
  const pad = 70;
  // pianta a sinistra, legenda numerata a destra (i numeri rimandano alla lista materiale)
  const legendW = Math.round(W * 0.32);
  const PW = W - legendW;
  const sx = (PW - pad * 2) / (x1 - x0), sz = (H - pad * 2 - 30) / (z1 - z0);
  const s = Math.min(sx, sz);
  const ox = (PW - (x1 - x0) * s) / 2, oz = (H - 30 - (z1 - z0) * s) / 2;
  const X = (x: number) => ox + (x - x0) * s;
  const Z = (z: number) => oz + (z - z0) * s;
  const skyLux = scene.sun.enabled ? sunSky(scene.sun).skyLux : 0;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, Helvetica, Arial, sans-serif">`;
  out += `<rect width="${W}" height="${H}" fill="#fff"/>`;
  // griglia 1 m
  for (let x = Math.ceil(x0); x <= x1; x++) out += `<line x1="${X(x)}" y1="${Z(z0)}" x2="${X(x)}" y2="${Z(z1)}" stroke="#f0f0f0"/>`;
  for (let z = Math.ceil(z0); z <= z1; z++) out += `<line x1="${X(x0)}" y1="${Z(z)}" x2="${X(x1)}" y2="${Z(z)}" stroke="#f0f0f0"/>`;
  out += `<rect x="${X(x0)}" y="${Z(z0)}" width="${(x1 - x0) * s}" height="${(z1 - z0) * s}" fill="none" stroke="#111" stroke-width="3"/>`;
  // finestre
  for (const w of recon.windows) {
    const c = new THREE.Vector3(...w.center), r = new THREE.Vector3(...w.right);
    const a = c.clone().addScaledVector(r, -w.width / 2), b = c.clone().addScaledVector(r, w.width / 2);
    out += `<line x1="${X(a.x)}" y1="${Z(a.z)}" x2="${X(b.x)}" y2="${Z(b.z)}" stroke="#fff" stroke-width="7"/>`;
    out += `<line x1="${X(a.x)}" y1="${Z(a.z)}" x2="${X(b.x)}" y2="${Z(b.z)}" stroke="#6aa9ff" stroke-width="3"/>`;
  }
  // camera
  const cp = camera.position, cd = new THREE.Vector3(camera.dir[0], 0, camera.dir[2]).normalize();
  const half = camera.hfov / 2, len = Math.min(3, (z1 - z0) * 0.6);
  const left = cd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), half), right = cd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -half);
  out += `<path d="M${X(cp[0])},${Z(cp[2])} L${X(cp[0] + left.x * len)},${Z(cp[2] + left.z * len)} L${X(cp[0] + right.x * len)},${Z(cp[2] + right.z * len)} Z" fill="rgba(0,0,0,.05)" stroke="#999" stroke-dasharray="4 4"/>`;
  const ang = Math.atan2(cd.x, -cd.z) * 180 / Math.PI;
  out += `<g transform="translate(${X(cp[0])},${Z(cp[2])}) rotate(${ang})"><rect x="-11" y="-2" width="22" height="16" rx="3" fill="#111"/><path d="M-6,-2 L6,-2 L9,-9 L-9,-9 Z" fill="#111"/></g>`;
  if (inp.move) {
    // movimento: camera di partenza e di arrivo, percorso tratteggiato con la freccia
    const mv = inp.move;
    const body = (p: [number, number, number], d: [number, number, number], fill: string) => {
      const v = new THREE.Vector3(d[0], 0, d[2]).normalize();
      const a = Math.atan2(v.x, -v.z) * 180 / Math.PI;
      return `<g transform="translate(${X(p[0])},${Z(p[2])}) rotate(${a})"><rect x="-11" y="-2" width="22" height="16" rx="3" fill="${fill}"/><path d="M-6,-2 L6,-2 L9,-9 L-9,-9 Z" fill="${fill}"/></g>`;
    };
    const sx0 = X(mv.start[0]), sz0 = Z(mv.start[2]), sx1 = X(mv.end[0]), sz1 = Z(mv.end[2]);
    out += `<defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#d23"/></marker></defs>`;
    if (Math.hypot(sx1 - sx0, sz1 - sz0) > 4) out += `<line x1="${sx0}" y1="${sz0}" x2="${sx1}" y2="${sz1}" stroke="#d23" stroke-width="2.5" stroke-dasharray="7 5" marker-end="url(#arr)"/>`;
    out += body(mv.start, mv.startDir, '#111') + body(mv.end, mv.endDir, '#d23');
    out += `<text x="${(sx0 + sx1) / 2}" y="${Math.max(sz0, sz1) + 34}" text-anchor="middle" font-size="12" fill="#d23" font-weight="600">${esc(mv.text)}</text>`;
  } else out += `<text x="${X(cp[0])}" y="${Z(cp[2]) + 32}" text-anchor="middle" font-size="12" fill="#111" font-weight="600">Camera</text>`;
  // arredi (pianta)
  for (const f of scene.furniture || []) {
    const k = furnitureKind(f.kind);
    if (k.ceiling) continue;
    const cx = X(f.position[0]), cy = Z(f.position[2]);
    const w = k.size[0] * s, d = k.size[1] * s;
    const rug = f.kind === 'tappeto';
    out += `<rect x="${cx - w / 2}" y="${cy - d / 2}" width="${w}" height="${d}" rx="3" transform="rotate(${-f.rotationY} ${cx} ${cy})" fill="${rug ? 'none' : '#f3f3f1'}" stroke="${rug ? '#ddd' : '#bbb'}" stroke-dasharray="${rug ? '4 3' : ''}"/>`;
    if (!rug && !k.onTop && Math.min(w, d) > 22) out += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="10" fill="#999">${esc(k.name)}</text>`;
  }
  // porte
  // oggetti
  for (const p of scene.props) {
    const r = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(p.rotationY));
    const a = new THREE.Vector3(...p.position).addScaledVector(r, -p.size[0] / 2), b = new THREE.Vector3(...p.position).addScaledVector(r, p.size[0] / 2);
    const col = p.kind === 'bianco' ? '#bbb' : p.kind === 'diffusore' ? '#9ab' : '#111';
    out += `<line x1="${X(a.x)}" y1="${Z(a.z)}" x2="${X(b.x)}" y2="${Z(b.z)}" stroke="${col}" stroke-width="5" stroke-linecap="round"/>`;
    out += `<text x="${X(p.position[0])}" y="${Z(p.position[2]) + 18}" text-anchor="middle" font-size="10" fill="#666">${esc(PROP_KINDS.find((k) => k.id === p.kind)?.name || '')}</text>`;
  }
  // persone
  for (const p of scene.people) {
    const px = X(p.position[0]), pz = Z(p.position[2]);
    const a = THREE.MathUtils.degToRad(p.rotationY);
    const fx = Math.sin(a), fz = Math.cos(a);
    out += `<ellipse cx="${px}" cy="${pz}" rx="${0.25 * s}" ry="${0.14 * s}" transform="rotate(${-p.rotationY} ${px} ${pz})" fill="#ddd" stroke="#111"/>`;
    out += `<circle cx="${px}" cy="${pz}" r="${0.1 * s}" fill="#111"/>`;
    out += `<line x1="${px}" y1="${pz}" x2="${px + fx * 0.3 * s}" y2="${pz + fz * 0.3 * s}" stroke="#111" stroke-width="2"/>`;
    out += `<text x="${px}" y="${pz + 0.35 * s + 12}" text-anchor="middle" font-size="11" fill="#444">${esc(POSES.find((q) => q.id === p.pose)?.name || '')}</text>`;
  }
  // luci
  scene.lights.forEach((L, i) => {
    const fx = fixtureById(L.fixtureId);
    const lx = X(L.position[0]), lz = Z(L.position[2]);
    const t = new THREE.Vector3(L.target[0] - L.position[0], 0, L.target[2] - L.position[2]);
    const dist = t.length();
    const dir = dist > 0.01 ? t.normalize() : new THREE.Vector3(0, 0, 1);
    const c = lightColor(L.origin === 'finestra' ? 6500 : L.kelvin, L.gel);
    const mx = Math.max(c.r, c.g, c.b);
    const col = `rgb(${Math.round((c.r / mx) * 255)},${Math.round((c.g / mx) * 255)},${Math.round((c.b / mx) * 255)})`;
    if (L.on && L.origin !== 'finestra') {
      const field = fx.kind === 'spot' ? spotAngles(L).field : fx.kind === 'area' ? 100 : 0;
      if (field) {
        const r = Math.min(dist + 0.4, 2.5);
        const h = THREE.MathUtils.degToRad(Math.min(150, field) / 2);
        const l = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), h), rr = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -h);
        out += `<path d="M${lx},${lz} L${lx + l.x * r * s},${lz + l.z * r * s} L${lx + rr.x * r * s},${lz + rr.z * r * s} Z" fill="${col}" fill-opacity=".18" stroke="none"/>`;
      }
      out += `<line x1="${lx}" y1="${lz}" x2="${X(L.target[0])}" y2="${Z(L.target[2])}" stroke="#111" stroke-width="1" stroke-dasharray="3 3"/>`;
    }
    if (fx.kind === 'area' || L.origin === 'finestra') {
      const perp = new THREE.Vector3(-dir.z, 0, dir.x);
      const hw = (L.size[0] / 2) * s;
      out += `<line x1="${lx - perp.x * hw}" y1="${lz - perp.z * hw}" x2="${lx + perp.x * hw}" y2="${lz + perp.z * hw}" stroke="#111" stroke-width="4"/>`;
    }
    out += `<circle cx="${lx}" cy="${lz}" r="15" fill="${L.on ? col : '#fff'}" stroke="#111" stroke-width="1.5"/>`;
    out += `<text x="${lx}" y="${lz + 4.5}" text-anchor="middle" font-size="13" font-weight="700" fill="#111">${i + 1}</text>`;
    const lux = Math.round(luxAtTarget(L, skyLux));
    const sub = L.origin === 'finestra' ? 'Luce naturale' : `${effectiveKelvin(L.kelvin, L.gel)} K · ${stopsLabel(L.stops)}${L.on ? ` · ${lux} lux` : ' · spenta'}`;
    const ly = pad + i * 44;
    if (ly < H - 60) {
      out += `<circle cx="${PW + 14}" cy="${ly}" r="11" fill="${L.on ? col : '#fff'}" stroke="#111" stroke-width="1.2"/>`;
      out += `<text x="${PW + 14}" y="${ly + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#111">${i + 1}</text>`;
      out += `<text x="${PW + 34}" y="${ly - 2}" font-size="12" font-weight="600" fill="#111">${esc(L.name)}</text>`;
      out += `<text x="${PW + 34}" y="${ly + 13}" font-size="10.5" fill="#666">${esc(sub)} · h ${L.position[1].toFixed(1)} m</text>`;
    }
  });
  // scala e nord
  const bx = PW - pad - s, by = H - 22;
  out += `<line x1="${bx}" y1="${by}" x2="${bx + s}" y2="${by}" stroke="#111" stroke-width="2"/><line x1="${bx}" y1="${by - 5}" x2="${bx}" y2="${by + 5}" stroke="#111"/><line x1="${bx + s}" y1="${by - 5}" x2="${bx + s}" y2="${by + 5}" stroke="#111"/>`;
  out += `<text x="${bx + s / 2}" y="${by - 8}" text-anchor="middle" font-size="11" fill="#111">1 m</text>`;
  const nA = scene.sun.north;
  out += `<g transform="translate(${pad},${H - 30}) rotate(${-nA})"><path d="M0,-14 L6,6 L0,2 L-6,6 Z" fill="#111"/><text x="0" y="-18" text-anchor="middle" font-size="11" font-weight="700">N</text></g>`;
  out += `</svg>`;
  return out;
}

export async function svgToCanvas(svg: string, scale = 2) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas');
  c.width = img.width * scale; c.height = img.height * scale;
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  return c;
}

export interface KitRow { n: number; name: string; fixture: string; output: string; color: string; accessories: string; position: string; lux: string; on: boolean }

export function kitRows(scene: SceneSnapshot): KitRow[] {
  const skyLux = scene.sun.enabled ? sunSky(scene.sun).skyLux : 0;
  return scene.lights.map((L, i) => {
    const fx = fixtureById(L.fixtureId);
    const acc: string[] = [];
    if (L.gel !== 'none') acc.push(gelById(L.gel).name);
    if (L.diffusion !== 'none') acc.push(diffusionById(L.diffusion).name);
    const bd = L.barnDoors;
    if (bd.top || bd.bottom || bd.left || bd.right) acc.push('Alette');
    if (fx.kind === 'spot') acc.push(`Fascio ${Math.round(spotAngles(L).beam)}°`);
    const win = L.origin === 'finestra';
    return {
      n: i + 1,
      name: L.name,
      fixture: win ? 'Finestra (luce naturale)' : L.attached ? `Pratica: ${fx.name}` : `${fx.name}${L.origin === 'letta' ? ' (in scena)' : ''}`,
      output: win ? `${Math.round(effectiveLumens(L, skyLux)).toLocaleString('it-IT')} lm` : `${fx.watts} W · ${stopsLabel(L.stops)} · ${Math.round(effectiveLumens(L, skyLux)).toLocaleString('it-IT')} lm`,
      color: win ? 'Cielo' : `${effectiveKelvin(L.kelvin, L.gel)} K${fx.kelvinFixed ? '' : ''}`,
      accessories: acc.join(', ') || '—',
      position: `h ${L.position[1].toFixed(2)} m`,
      lux: win || !L.on ? '—' : `${Math.round(luxAtTarget(L, skyLux))} lux`,
      on: L.on,
    };
  });
}

export function kitSummary(scene: SceneSnapshot) {
  const map = new Map<string, number>();
  for (const L of scene.lights) {
    if (L.origin !== 'aggiunta') continue;
    const name = L.attached ? `${fixtureById(L.fixtureId).name} (per le pratiche)` : fixtureById(L.fixtureId).name;
    map.set(name, (map.get(name) || 0) + 1);
  }
  for (const p of scene.props) {
    const name = PROP_KINDS.find((k) => k.id === p.kind)?.name || p.kind;
    map.set(name, (map.get(name) || 0) + 1);
  }
  const gels = new Map<string, number>();
  for (const L of scene.lights) if (L.gel !== 'none') gels.set(gelById(L.gel).name, (gels.get(gelById(L.gel).name) || 0) + 1);
  for (const L of scene.lights) if (L.diffusion !== 'none') gels.set(diffusionById(L.diffusion).name, (gels.get(diffusionById(L.diffusion).name) || 0) + 1);
  let watts = 0;
  for (const L of scene.lights) if (L.origin === 'aggiunta' && L.on) watts += fixtureById(L.fixtureId).watts;
  return { items: [...map.entries()], filters: [...gels.entries()], watts };
}

export function kitCSV(scene: SceneSnapshot) {
  const rows = kitRows(scene);
  const head = ['N.', 'Nome', 'Apparecchio', 'Uscita', 'Colore', 'Accessori', 'Posizione', 'Sul soggetto'];
  const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  return [head.map(q).join(';'), ...rows.map((r) => [r.n, r.name, r.fixture, r.output, r.color, r.accessories, r.position, r.lux].map((x) => q(String(x))).join(';'))].join('\n');
}

export function cameraLine(scene: SceneSnapshot) {
  const c = scene.cam;
  const sensor = SENSORS.find((s) => s.id === c.sensor)?.name || '';
  const asp = ASPECTS.find((a) => a.id === c.aspect);
  return `${Math.round(c.focal)} mm · ${sensor} · ISO ${c.iso} · f/${fmtStop(c.fStop)} · ${fmtShutter(c.shutter)}${asp && asp.ratio ? ' · ' + asp.name : ''}`;
}

export function sunLine(scene: SceneSnapshot) {
  const s = scene.sun;
  if (!s.enabled) return 'Luce naturale spenta';
  return `${fmtHour(s.hour)} · ${WEATHER.find((w) => w.id === s.weather)?.name}`;
}

const pdfText = (s: string) => s.replace(/−/g, '-').replace(/·/g, '-').replace(/—/g, '-').replace(/[’]/g, "'");

export async function buildPDF(opts: { title: string; imageUrl: string; imgW: number; imgH: number; plan: PlanInput; frames?: { url: string; label: string }[] }) {
  const { scene } = opts.plan;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const PW = 297, PH = 210, M = 14;
  const date = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  const header = (sub: string) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(17);
    doc.text(pdfText(opts.title), M, M + 4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110);
    doc.text(pdfText(`${sub}  -  ${date}`), M, M + 10);
    doc.text('Light Simulator', PW - M, M + 4, { align: 'right' });
  };
  // pagina 1: scatto
  header('Scatto');
  const maxW = PW - M * 2, maxH = PH - M * 2 - 28;
  const r = Math.min(maxW / opts.imgW, maxH / opts.imgH);
  const iw = opts.imgW * r, ih = opts.imgH * r;
  doc.addImage(opts.imageUrl, 'JPEG', (PW - iw) / 2, M + 16, iw, ih);
  doc.setFontSize(10); doc.setTextColor(40);
  doc.text(pdfText(`Camera: ${cameraLine(scene)}     Luce naturale: ${sunLine(scene)}`), M, PH - M);
  // movimento di camera: tutti i fotogrammi in fila
  if (opts.frames && opts.frames.length > 1 && opts.plan.move) {
    doc.addPage();
    header(`Movimento di camera: ${opts.plan.move.text}`);
    const n = opts.frames.length, gap = 5;
    const cols = n <= 3 ? n : 3, rowsN = Math.ceil(n / cols);
    const cw = (PW - M * 2 - gap * (cols - 1)) / cols;
    const ch = Math.min(cw * opts.imgH / opts.imgW, (PH - M * 2 - 34 - (rowsN - 1) * 12) / rowsN);
    const fw = ch * opts.imgW / opts.imgH;
    opts.frames.forEach((f, i) => {
      const cx = M + (i % cols) * (cw + gap) + (cw - fw) / 2, cy = M + 18 + Math.floor(i / cols) * (ch + 12);
      doc.addImage(f.url, 'JPEG', cx, cy, fw, ch);
      doc.setFontSize(9); doc.setTextColor(40);
      doc.text(pdfText(`${i + 1}. ${f.label}`), cx, cy + ch + 5);
    });
    doc.setFontSize(10); doc.setTextColor(40);
    doc.text(pdfText(`${opts.plan.move.text}, ${n} fotogrammi. Partenza e arrivo sono disegnati nella pianta luci.`), M, PH - M);
  }
  // pagina 2: pianta
  doc.addPage();
  header('Pianta luci');
  const svg = planSVG(opts.plan, { width: 1000, height: 640 });
  const pc = await svgToCanvas(svg, 2);
  const pr = Math.min(maxW / 1000, (PH - M * 2 - 20) / 640);
  doc.addImage(pc.toDataURL('image/png'), 'PNG', (PW - 1000 * pr) / 2, M + 16, 1000 * pr, 640 * pr);
  // pagina 3: lista materiale
  doc.addPage();
  header('Lista materiale');
  const rows = kitRows(scene);
  const cols = [
    { k: 'n', t: 'N.', w: 10 }, { k: 'name', t: 'Nome', w: 34 }, { k: 'fixture', t: 'Apparecchio', w: 52 }, { k: 'output', t: 'Uscita', w: 56 },
    { k: 'color', t: 'Colore', w: 22 }, { k: 'accessories', t: 'Accessori', w: 52 }, { k: 'position', t: 'Altezza', w: 22 }, { k: 'lux', t: 'Sul soggetto', w: 21 },
  ];
  let y = M + 22;
  doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(100);
  let x = M; for (const c of cols) { doc.text(c.t, x, y); x += c.w; }
  y += 3; doc.setDrawColor(220); doc.line(M, y, PW - M, y); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setTextColor(20);
  for (const row of rows) {
    x = M;
    for (const c of cols) { doc.text(pdfText(String((row as any)[c.k])).slice(0, 60), x, y, { maxWidth: c.w - 2 }); x += c.w; }
    y += 4; doc.line(M, y, PW - M, y); y += 6;
    if (y > PH - 40) { doc.addPage(); header('Lista materiale'); y = M + 22; }
  }
  const sum = kitSummary(scene);
  y += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Da portare', M, y); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  if (!sum.items.length) { doc.text('Solo luci gia presenti sul luogo.', M, y); y += 5; }
  for (const [name, n] of sum.items) { doc.text(pdfText(`${n} × ${name}`), M, y); y += 5; }
  if (sum.filters.length) { doc.text(pdfText(`Filtri e diffusioni: ${sum.filters.map(([n, q]) => `${q} × ${n}`).join(', ')}`), M, y); y += 5; }
  if (sum.watts) { doc.text(pdfText(`Potenza totale apparecchi aggiunti: ${sum.watts.toLocaleString('it-IT')} W (circa ${Math.ceil(sum.watts / 230)} A a 230 V)`), M, y); y += 5; }
  doc.text(pdfText(`Camera: ${cameraLine(scene)}`), M, y + 3);
  return doc;
}

export function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

export function slug(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scena';
}
