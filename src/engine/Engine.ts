// Motore 3D: scena dalla ricostruzione, luci in tempo reale, navigazione libera,
// esposizione fisica, false color e render finale in path tracing.
import * as THREE from 'three';
import { WebGLPathTracer, PhysicalCamera, PhysicalSpotLight } from 'three-gpu-pathtracer';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import type { Reconstruction } from './reconstruct';
import {
  LightState, fixtureById, effectiveLumens, lightColor, spotAngles, spotCandela, illuminanceAt,
  ev100, exposureFromEV100, ISO_VALUES, FSTOPS, SENSORS, ASPECTS, fStopForLux,
} from './photometry';
import { PersonState, buildMannequin, applyPose } from './mannequin';
import { SunState, sunDirection, sunSky } from './sun';
import type { PropState, CamState, SceneSnapshot } from '../store';

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as any).raycast = acceleratedRaycast;

const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

const QUAD_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const QUAD_FRAG = `
precision highp float;
uniform sampler2D tDiffuse; uniform float exposure; uniform int falseColor; uniform vec4 frame; uniform float maskAlpha;
varying vec2 vUv;
vec3 neutral(vec3 color){
  const float startCompression = 0.8 - 0.04; const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c)); }
void main(){
  vec3 c = max(texture2D(tDiffuse, vUv).rgb * exposure, 0.0);
  vec3 s = toSRGB(clamp(neutral(c), 0.0, 1.0));
  if (falseColor == 1) {
    float y = dot(s, vec3(0.2126, 0.7152, 0.0722)) * 100.0;
    vec3 g = vec3(dot(s, vec3(0.2126, 0.7152, 0.0722))) * 0.8 + 0.05;
    if (y < 2.5) g = vec3(0.45, 0.05, 0.6);
    else if (y < 4.0) g = vec3(0.1, 0.25, 0.95);
    else if (y >= 38.0 && y < 42.0) g = vec3(0.25, 0.75, 0.25);
    else if (y >= 52.0 && y < 56.0) g = vec3(0.95, 0.55, 0.68);
    else if (y >= 97.0 && y < 99.0) g = vec3(1.0, 0.9, 0.1);
    else if (y >= 99.0) g = vec3(0.95, 0.1, 0.1);
    s = g;
  }
  // mascherina del formato
  if (vUv.x < frame.x || vUv.x > frame.z || vUv.y < frame.y || vUv.y > frame.w) s *= maskAlpha;
  gl_FragColor = vec4(s, 1.0);
}`;

interface LightObj { state: LightState; raster: THREE.Light; target: THREE.Object3D; doors: THREE.Group | null }

export interface Hit { point: THREE.Vector3; normal: THREE.Vector3; object: THREE.Object3D }

export class Engine {
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new PhysicalCamera(50, 1, 0.03, 200);
  rt: THREE.WebGLRenderTarget;
  quad: THREE.Mesh;
  quadScene = new THREE.Scene();
  quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quadMat: THREE.ShaderMaterial;

  recon: Reconstruction | null = null;
  room = new THREE.Group();
  surfaces: THREE.Object3D[] = [];
  material: THREE.MeshStandardMaterial | null = null;
  blurMaterial: THREE.MeshStandardMaterial | null = null;
  blurAlbedo: HTMLCanvasElement | null = null;
  blurEmissive: HTMLCanvasElement | null = null;
  blurEmissiveTex: THREE.CanvasTexture | null = null;
  panes: { mesh: THREE.Mesh; windowId: string }[] = [];
  emissiveCanvas: HTMLCanvasElement | null = null;
  emissiveTex: THREE.CanvasTexture | null = null;
  photoLin: Float32Array | null = null;
  maskLin: Map<string, Float32Array> = new Map();
  emW = 0; emH = 0;
  K = 1; // nits per unità di foto
  skyCal = 10000;

  rasterLights = new THREE.Group();
  lightObjs = new Map<string, LightObj>();
  people = new Map<string, { state: PersonState; obj: THREE.Group }>();
  props = new Map<string, { state: PropState; obj: THREE.Group }>();
  sun = new THREE.DirectionalLight(0xffffff, 0);
  ambient = new THREE.AmbientLight(0xffffff, 0);
  snapshot: SceneSnapshot | null = null;

  exposure = 1;
  frameRect = { x0: 0, y0: 0, x1: 1, y1: 1 }; // in coordinate UV del canvas (y in basso)
  dirty = true;
  onFrame: (() => void) | null = null;
  keys = new Set<string>();
  yaw = 0; pitch = 0;
  albedoMean = 0.5;
  shotRestore: (() => void) | null = null;
  homePose: { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number } | null = null;
  pt: any = null;
  shot: { target: number; start: number; onProgress: (p: number) => void; resolve: (c: HTMLCanvasElement | null) => void; ptLights: THREE.Group } | null = null;
  lastTime = performance.now();
  disposed = false;
  navEnabled = true;

  constructor(container: HTMLElement) {
    this.container = container;
    RectAreaLightUniformsLib.init();
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, colorSpace: THREE.LinearSRGBColorSpace });
    this.quadMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: QUAD_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: this.rt.texture }, exposure: { value: 1 }, falseColor: { value: 0 }, frame: { value: new THREE.Vector4(0, 0, 1, 1) }, maskAlpha: { value: 0.12 } },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.quadMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.scene.background = new THREE.Color(0x050506);
    this.scene.add(this.room, this.rasterLights, this.camera);
    this.rasterLights.add(this.sun, this.sun.target, this.ambient);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.camera.filmGauge = 24.89;
    this.camera.apertureBlades = 0;

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.bindNav();
    const loop = () => {
      if (this.disposed) return;
      requestAnimationFrame(loop);
      this.tick();
    };
    requestAnimationFrame(loop);
  }

  // ---------------- dimensioni e inquadratura ----------------
  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    this.rt.setSize(Math.round(w * pr), Math.round(h * pr));
    this.camera.aspect = w / h;
    this.updateLens();
    this.dirty = true;
  }

  get cam(): CamState | null { return this.snapshot?.cam || null; }

  updateLens() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    const cam = this.cam;
    const sensor = SENSORS.find((s) => s.id === (cam?.sensor || 's35')) || SENSORS[0];
    const focal = cam?.focal || 24;
    const ar = ASPECTS.find((a) => a.id === (cam?.aspect || 'free'))?.ratio || 0;
    // rettangolo del formato dentro il canvas
    let fw = w, fh = h;
    if (ar) { if (w / h > ar) { fh = h * 0.86; fw = fh * ar; if (fw > w * 0.94) { fw = w * 0.94; fh = fw / ar; } } else { fw = w * 0.94; fh = fw / ar; if (fh > h * 0.86) { fh = h * 0.86; fw = fh * ar; } } }
    else { fw = w; fh = h; }
    this.frameRect = { x0: (w - fw) / 2 / w, y0: (h - fh) / 2 / h, x1: (w + fw) / 2 / w, y1: (h + fh) / 2 / h };
    // il lato largo del sensore copre la larghezza del formato
    const tanHalfH = sensor.width / (2 * focal);
    const tanHalfV = tanHalfH * (h / fw);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanHalfV));
    this.camera.aspect = w / h;
    this.camera.filmGauge = sensor.width * (w / fw);
    this.camera.updateProjectionMatrix();
    this.quadMat.uniforms.frame.value.set(this.frameRect.x0, this.frameRect.y0, this.frameRect.x1, this.frameRect.y1);
    this.quadMat.uniforms.maskAlpha.value = ar ? 0.1 : 1;
  }

  // focale equivalente per il campo visivo verticale della foto
  focalForPhoto(sensorId: string) {
    if (!this.recon) return 24;
    const sensor = SENSORS.find((s) => s.id === sensorId) || SENSORS[0];
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.recon.camera.fov) / 2);
    // vogliamo che la foto riempia l'altezza del canvas: tanHalfV(canvas) = tanV
    const tanHalfH = tanV * (w / h);
    return sensor.width / (2 * tanHalfH);
  }

  // ---------------- ricostruzione ----------------
  loadRecon(recon: Reconstruction) {
    this.recon = recon;
    for (const c of [...this.room.children]) { this.room.remove(c); c.traverse((o: any) => { o.geometry?.dispose?.(); }); }
    this.surfaces = [];
    this.panes = [];
    this.maskLin.clear();

    const photoTex = new THREE.CanvasTexture(recon.photo);
    photoTex.colorSpace = THREE.SRGBColorSpace;
    photoTex.anisotropy = 8;
    const albedoTex = new THREE.CanvasTexture(recon.albedo);
    albedoTex.colorSpace = THREE.SRGBColorSpace;
    albedoTex.anisotropy = 8;

    // emissivo = foto lineare × quota residua (+ sorgenti lette)
    const EW = Math.min(1024, recon.photo.width), EH = Math.round((EW * recon.photo.height) / recon.photo.width);
    this.emW = EW; this.emH = EH;
    const ec = document.createElement('canvas'); ec.width = EW; ec.height = EH;
    const ectx = ec.getContext('2d', { willReadFrequently: true })!;
    ectx.drawImage(recon.photo, 0, 0, EW, EH);
    const pd = ectx.getImageData(0, 0, EW, EH).data;
    this.photoLin = new Float32Array(EW * EH * 3);
    for (let i = 0; i < EW * EH; i++) for (let c = 0; c < 3; c++) this.photoLin[i * 3 + c] = srgbToLin(pd[i * 4 + c] / 255);
    for (const m of recon.masks) {
      const mc = document.createElement('canvas'); mc.width = EW; mc.height = EH;
      const mctx = mc.getContext('2d', { willReadFrequently: true })!;
      mctx.drawImage(m.mask, 0, 0, EW, EH);
      const md = mctx.getImageData(0, 0, EW, EH).data;
      const arr = new Float32Array(EW * EH);
      for (let i = 0; i < EW * EH; i++) arr[i] = md[i * 4 + 3] / 255;
      this.maskLin.set(m.lightId, arr);
    }
    this.emissiveCanvas = ec;
    this.emissiveTex = new THREE.CanvasTexture(ec);
    this.emissiveTex.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.MeshStandardMaterial({
      map: albedoTex, emissiveMap: this.emissiveTex, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1,
      roughness: 0.82, metalness: 0, side: THREE.DoubleSide,
    });
    this.material = mat;
    this.albedoMean = meanLinear(recon.albedo);
    // materiale sfocato per le parti della stanza che la foto non vede
    this.blurAlbedo = blurCanvas(recon.albedo, 48);
    const blurAlbedoTex = new THREE.CanvasTexture(this.blurAlbedo);
    blurAlbedoTex.colorSpace = THREE.SRGBColorSpace;
    this.blurEmissive = blurCanvas(ec, 48);
    this.blurEmissiveTex = new THREE.CanvasTexture(this.blurEmissive);
    this.blurEmissiveTex.colorSpace = THREE.SRGBColorSpace;
    this.blurMaterial = new THREE.MeshStandardMaterial({
      map: blurAlbedoTex, emissiveMap: this.blurEmissiveTex, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1,
      roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    });

    const { gw, gh, world, camDepth } = recon;
    // ---- mesh di profondità ----
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(world.slice(), 3));
    const uv = new Float32Array(gw * gh * 2);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const k = j * gw + i; uv[k * 2] = i / (gw - 1); uv[k * 2 + 1] = 1 - j / (gh - 1); }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx: number[] = [];
    const ta = new THREE.Vector3(), tb = new THREE.Vector3(), tc = new THREE.Vector3(), tn = new THREE.Vector3(), tv = new THREE.Vector3();
    const camP = new THREE.Vector3(...recon.camera.position);
    const inWindow = (u: number, v: number) => recon.windows.some((w) => u > w.bbox[0] - 0.004 && u < w.bbox[2] + 0.004 && v > w.bbox[1] - 0.004 && v < w.bbox[3] + 0.004);
    for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
      const a = j * gw + i, b = a + 1, c = a + gw, d = c + 1;
      const za = camDepth[a], zb = camDepth[b], zc = camDepth[c], zd = camDepth[d];
      const mx = Math.max(za, zb, zc, zd), mn = Math.min(za, zb, zc, zd);
      if (mx / mn > 1.09 + 0.012 * mn) continue;
      if (inWindow((i + 0.5) / (gw - 1), (j + 0.5) / (gh - 1))) continue;
      // triangoli quasi paralleli allo sguardo della foto: stirati, meglio un buco
      ta.set(world[a * 3], world[a * 3 + 1], world[a * 3 + 2]);
      tb.set(world[b * 3], world[b * 3 + 1], world[b * 3 + 2]);
      tc.set(world[c * 3], world[c * 3 + 1], world[c * 3 + 2]);
      tn.subVectors(tb, ta).cross(tc.clone().sub(ta));
      const ln = tn.length();
      if (ln > 1e-9) {
        tv.copy(ta).sub(camP).normalize();
        if (Math.abs(tn.dot(tv) / ln) < 0.06) continue;
      }
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);
    geo.computeVertexNormals();
    (geo as any).computeBoundsTree();
    const depthMesh = new THREE.Mesh(geo, mat);
    depthMesh.name = 'stanza';
    depthMesh.castShadow = true; depthMesh.receiveShadow = true;
    this.room.add(depthMesh);
    this.surfaces.push(depthMesh);

    // ---- scatola della stanza (per girare liberamente) ----
    const box = this.buildBox(recon, mat);
    this.room.add(box);
    this.surfaces.push(box);

    // ---- finestre: vetro con la vista esterna della foto ----
    for (const w of recon.windows) {
      const pg = new THREE.PlaneGeometry(w.width, w.height);
      const [u0, v0, u1, v1] = w.bbox;
      const puv = pg.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < puv.count; k++) {
        const uu = puv.getX(k), vv = puv.getY(k);
        // il piano guarda verso l'interno: la sua destra locale è -right della finestra vista da dentro
        puv.setXY(k, u0 + (1 - uu) * (u1 - u0), 1 - (v1 - (vv) * (v1 - v0)));
      }
      const pm = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, emissive: 0xffffff, emissiveMap: photoTex, emissiveIntensity: 1,
        transmission: 1, roughness: 0, metalness: 0, ior: 1.5, thickness: 0, transparent: false, side: THREE.DoubleSide,
      });
      const pane = new THREE.Mesh(pg, pm);
      const n = new THREE.Vector3(...w.normal);
      pane.position.set(...w.center).addScaledVector(n, -0.005);
      pane.lookAt(pane.position.clone().sub(n)); // la faccia +Z guarda fuori, così la vista da dentro è la faccia posteriore
      pane.castShadow = false; pane.receiveShadow = false;
      pane.name = 'vetro';
      this.room.add(pane);
      this.panes.push({ mesh: pane, windowId: w.id });
    }

    this.homePose = {
      pos: new THREE.Vector3(...recon.camera.position),
      quat: new THREE.Quaternion(...recon.camera.quaternion),
      fov: recon.camera.fov,
    };
    this.resetView();
    // ombre del sole: la camera d'ombra copre la stanza
    const size = new THREE.Vector3(recon.room.max[0] - recon.room.min[0], recon.room.max[1] - recon.room.min[1], recon.room.max[2] - recon.room.min[2]);
    const r = size.length() / 2 + 0.5;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.1; sc.far = r * 4; sc.updateProjectionMatrix();
    this.dirty = true;
  }

  buildBox(recon: Reconstruction, mat: THREE.MeshStandardMaterial) {
    const [x0, y0, z0] = recon.room.min, [x1, y1, z1] = recon.room.max;
    const camPos = new THREE.Vector3(...recon.camera.position);
    const camQ = new THREE.Quaternion(...recon.camera.quaternion);
    const inv = camQ.clone().invert();
    const tanV = Math.tan(THREE.MathUtils.degToRad(recon.camera.fov) / 2);
    const tanH = tanV * recon.camera.aspect;
    const inside = (p: THREE.Vector3) => {
      const c = p.clone().sub(camPos).applyQuaternion(inv);
      if (c.z > -0.05) return false;
      const u = (c.x / (-c.z * tanH) + 1) / 2, v = (c.y / (-c.z * tanV) + 1) / 2;
      return u > 0.01 && u < 0.99 && v > 0.01 && v < 0.99;
    };
    const project = (p: THREE.Vector3) => {
      const c = p.clone().sub(camPos).applyQuaternion(inv);
      const z = Math.min(c.z, -0.25);
      const u = (c.x / (-z * tanH) + 1) / 2, v = (c.y / (-z * tanV) + 1) / 2;
      return [Math.min(0.998, Math.max(0.002, u)), Math.min(0.998, Math.max(0.002, v))];
    };
    const faces: { o: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3; back?: boolean }[] = [
      { o: new THREE.Vector3(x0, y0, z0), a: new THREE.Vector3(x1 - x0, 0, 0), b: new THREE.Vector3(0, y1 - y0, 0) }, // fondo
      { o: new THREE.Vector3(x0, y0, z1), a: new THREE.Vector3(0, 0, z0 - z1), b: new THREE.Vector3(0, y1 - y0, 0) }, // sinistra
      { o: new THREE.Vector3(x1, y0, z0), a: new THREE.Vector3(0, 0, z1 - z0), b: new THREE.Vector3(0, y1 - y0, 0) }, // destra
      { o: new THREE.Vector3(x0, y0, z1), a: new THREE.Vector3(x1 - x0, 0, 0), b: new THREE.Vector3(0, 0, z0 - z1) }, // pavimento
      { o: new THREE.Vector3(x0, y1, z0), a: new THREE.Vector3(x1 - x0, 0, 0), b: new THREE.Vector3(0, 0, z1 - z0) }, // soffitto
      { o: new THREE.Vector3(x1, y0, z1), a: new THREE.Vector3(x0 - x1, 0, 0), b: new THREE.Vector3(0, y1 - y0, 0), back: true }, // dietro la camera
    ];
    const N = 40;
    const pos: number[] = [], uvs: number[] = [], index: number[] = [];
    const backIndex: number[] = [], outIndex: number[] = [];
    const windows = recon.windows.map((w) => ({ w, c: new THREE.Vector3(...w.center) }));
    let base = 0;
    for (const f of faces) {
      const normal = f.a.clone().cross(f.b).normalize();
      // la normale deve guardare dentro la stanza
      const center = f.o.clone().addScaledVector(f.a, 0.5).addScaledVector(f.b, 0.5);
      const toIn = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).sub(center);
      const flip = normal.dot(toIn) < 0;
      const planeD = -normal.dot(f.o);
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const p = f.o.clone().addScaledVector(f.a, i / N).addScaledVector(f.b, j / N);
        pos.push(p.x, p.y, p.z);
        const [u, v] = project(p);
        uvs.push(u, v);
      }
      // finestre su questa faccia
      const winsHere = windows.filter(({ c }) => Math.abs(normal.dot(c) + planeD) < 1.2);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const a = base + j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
        if (!f.back && winsHere.length) {
          const p = f.o.clone().addScaledVector(f.a, (i + 0.5) / N).addScaledVector(f.b, (j + 0.5) / N);
          const [u, v] = project(p);
          const vv = 1 - v;
          if (winsHere.some(({ w }) => u > w.bbox[0] && u < w.bbox[2] && vv > w.bbox[1] && vv < w.bbox[3])) continue;
        }
        const tri = flip ? [a, c, b, b, c, d] : [a, b, c, b, d, c];
        const pc = f.o.clone().addScaledVector(f.a, (i + 0.5) / N).addScaledVector(f.b, (j + 0.5) / N);
        (f.back ? backIndex : inside(pc) ? index : outIndex).push(...tri);
      }
      base += (N + 1) * (N + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex([...index, ...outIndex, ...backIndex]);
    g.addGroup(0, index.length, 0);
    g.addGroup(index.length, outIndex.length, 2);
    g.addGroup(index.length + outIndex.length, backIndex.length, 1);
    g.computeVertexNormals();
    (g as any).computeBoundsTree();
    // parete dietro la camera: colore medio dell'albedo
    const avg = averageColor(recon.albedo);
    const backMat = new THREE.MeshStandardMaterial({ color: avg, roughness: 0.9, side: THREE.DoubleSide, emissive: avg, emissiveIntensity: 0 });
    const mesh = new THREE.Mesh(g, [mat, backMat, this.blurMaterial!]);
    mesh.name = 'scatola';
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.backMat = backMat;
    return mesh;
  }

  // ---------------- stato -> scena ----------------
  apply(s: SceneSnapshot) {
    const prev = this.snapshot;
    this.snapshot = s;
    if (!prev || prev.cam !== s.cam) { this.updateLens(); this.updateExposure(); }
    if (!prev || prev.lights !== s.lights || prev.sun !== s.sun) this.syncLights(s.lights, s.sun);
    if (!prev || prev.sun !== s.sun) this.syncSun(s.sun);
    if (!prev || prev.people !== s.people) this.syncPeople(s.people);
    if (!prev || prev.props !== s.props) this.syncProps(s.props);
    if (!prev || prev.lights !== s.lights || prev.ambient !== s.ambient || prev.sun !== s.sun) this.updateEmissive();
    this.updateIndirect();
    this.quadMat.uniforms.falseColor.value = s.cam.falseColor ? 1 : 0;
    this.dirty = true;
  }

  updateExposure() {
    const c = this.cam;
    if (!c) return;
    this.exposure = exposureFromEV100(ev100(c.fStop, c.shutter, c.iso));
    this.quadMat.uniforms.exposure.value = this.exposure;
    this.camera.fStop = c.fStop;
  }

  skyLux() {
    return this.snapshot ? (this.snapshot.sun.enabled ? sunSky(this.snapshot.sun).skyLux : 0) : 10000;
  }

  syncLights(lights: LightState[], sun: SunState) {
    const skyLux = sun.enabled ? sunSky(sun).skyLux : 0;
    const skyK = sunSky(sun).skyK;
    const ids = new Set(lights.map((l) => l.id));
    for (const [id, o] of this.lightObjs) if (!ids.has(id)) { this.removeLightObj(o); this.lightObjs.delete(id); }
    let shadowBudget = 10;
    for (const L of lights) {
      let o = this.lightObjs.get(L.id);
      const fx = fixtureById(L.fixtureId);
      const wantKind = L.origin === 'finestra' ? 'area' : fx.kind;
      const kindOf = (l: THREE.Light) => ((l as any).isPointLight ? 'point' : 'spot');
      const needKind = wantKind === 'point' ? 'point' : 'spot';
      if (o && kindOf(o.raster) !== needKind) { this.removeLightObj(o); this.lightObjs.delete(L.id); o = undefined; }
      if (!o) {
        const target = new THREE.Object3D();
        const raster = needKind === 'point' ? new THREE.PointLight() : new THREE.SpotLight();
        raster.castShadow = true;
        (raster as any).shadow.mapSize.set(1024, 1024);
        (raster as any).shadow.bias = -0.0006;
        (raster as any).shadow.normalBias = 0.02;
        (raster as any).shadow.camera.near = 0.05;
        if ((raster as any).isSpotLight) (raster as THREE.SpotLight).target = target;
        this.rasterLights.add(raster, target);
        o = { state: L, raster, target, doors: null };
        this.lightObjs.set(L.id, o);
      }
      o.state = L;
      const r = o.raster as any;
      r.position.set(...L.position);
      o.target.position.set(...L.target);
      o.target.updateMatrixWorld();
      const kelvin = L.origin === 'finestra' ? skyK : L.kelvin;
      r.color.copy(lightColor(kelvin, L.gel));
      const lm = L.on ? effectiveLumens(L, skyLux) : 0;
      r.visible = L.on && lm > 0;
      r.castShadow = r.visible && shadowBudget-- > 0;
      if (wantKind === 'point') {
        r.intensity = lm / (4 * Math.PI);
        r.decay = 2; r.distance = 0;
        r.shadow.radius = 2 + L.softness * 8;
      } else if (wantKind === 'area') {
        // emettitore lambertiano approssimato con uno spot morbido
        r.intensity = lm / Math.PI;
        r.angle = THREE.MathUtils.degToRad(84);
        r.penumbra = 1;
        r.decay = 2; r.distance = 0;
        const sz = Math.max(L.size[0], L.size[1]) * (1 + L.softness);
        r.shadow.radius = 3 + sz * 10;
        r.shadow.camera.fov = 170;
      } else {
        const { beam, field } = spotAngles(L);
        r.intensity = spotCandela(lm, beam);
        r.angle = THREE.MathUtils.degToRad(Math.min(170, field) / 2);
        r.penumbra = Math.min(1, Math.max(0.05, 1 - beam / field));
        r.decay = 2; r.distance = 0;
        r.shadow.radius = 1 + L.softness * 6;
      }
      // bandiere (alette) per gli spot
      const bd = L.barnDoors;
      const hasDoors = wantKind === 'spot' && (bd.top || bd.bottom || bd.left || bd.right);
      if (hasDoors) {
        if (!o.doors) { o.doors = makeDoors(); this.scene.add(o.doors); }
        updateDoors(o.doors, L);
      } else if (o.doors) { this.scene.remove(o.doors); o.doors = null; }
    }
  }

  removeLightObj(o: LightObj) {
    this.rasterLights.remove(o.raster, o.target);
    (o.raster as any).shadow?.map?.dispose?.();
    o.raster.dispose?.();
    if (o.doors) this.scene.remove(o.doors);
  }

  syncSun(s: SunState) {
    const { dir, elevation } = sunDirection(s);
    const sk = sunSky(s);
    const on = s.enabled && elevation > 0 && sk.sunLux > 0 && !!this.recon?.windows.length;
    this.sun.visible = on;
    this.sun.intensity = on ? sk.sunLux : 0;
    this.sun.color.copy(lightColor(sk.sunK, 'none'));
    const c = this.recon ? new THREE.Vector3((this.recon.room.min[0] + this.recon.room.max[0]) / 2, 1.2, (this.recon.room.min[2] + this.recon.room.max[2]) / 2) : new THREE.Vector3();
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    this.sun.position.copy(c).addScaledVector(dir, sc.far / 2);
    this.sun.target.position.copy(c);
    this.sun.target.updateMatrixWorld();
    // vetri: luminosità della vista esterna segue il cielo
    const f = this.skyCal > 0 ? Math.min(8, (s.enabled ? sk.skyLux : 0) / this.skyCal) : 1;
    for (const p of this.panes) {
      (p.mesh.material as THREE.MeshPhysicalMaterial).emissiveIntensity = this.K * Math.max(0.002, f);
    }
  }

  syncPeople(list: PersonState[]) {
    const ids = new Set(list.map((p) => p.id));
    for (const [id, o] of this.people) if (!ids.has(id)) { this.scene.remove(o.obj); this.people.delete(id); }
    for (const p of list) {
      const o = this.people.get(p.id);
      if (!o || o.state.skin !== p.skin) {
        if (o) this.scene.remove(o.obj);
        const obj = buildMannequin(p);
        this.scene.add(obj);
        this.people.set(p.id, { state: p, obj });
      } else {
        o.state = p;
        applyPose(o.obj, p);
      }
    }
  }

  syncProps(list: PropState[]) {
    const ids = new Set(list.map((p) => p.id));
    for (const [id, o] of this.props) if (!ids.has(id)) { this.scene.remove(o.obj); this.props.delete(id); }
    for (const p of list) {
      let o = this.props.get(p.id);
      if (!o || o.state.kind !== p.kind) {
        if (o) this.scene.remove(o.obj);
        o = { state: p, obj: buildProp(p) };
        this.scene.add(o.obj);
        this.props.set(p.id, o);
      }
      o.state = p;
      const panel = o.obj.getObjectByName('pannello')!;
      panel.scale.set(p.size[0], p.size[1], 1);
      panel.rotation.set(THREE.MathUtils.degToRad(p.tilt), 0, 0);
      const pole = o.obj.getObjectByName('palo')!;
      pole.scale.set(1, Math.max(0.01, p.position[1]), 1);
      pole.position.set(0, -p.position[1] / 2, 0);
      o.obj.position.set(...p.position);
      o.obj.rotation.set(0, THREE.MathUtils.degToRad(p.rotationY), 0);
    }
  }

  // emissivo: luce residua della foto + sorgenti lette accese
  updateEmissive() {
    if (!this.recon || !this.emissiveCanvas || !this.photoLin || !this.snapshot) return;
    const s = this.snapshot;
    const amb = s.ambient;
    const N = this.emW * this.emH;
    const gains: { m: Float32Array; g: number }[] = [];
    for (const L of s.lights) {
      const m = this.maskLin.get(L.id);
      if (!m || L.origin === 'finestra') continue;
      const g = L.on ? Math.min(1.6, Math.pow(2, L.stops)) : 0.0;
      gains.push({ m, g });
    }
    const ctx = this.emissiveCanvas.getContext('2d', { willReadFrequently: true })!;
    const img = ctx.createImageData(this.emW, this.emH);
    const d = img.data;
    const pl = this.photoLin;
    for (let i = 0; i < N; i++) {
      let f = amb;
      for (const { m, g } of gains) { const w = m[i]; if (w > 0) f = f * (1 - w) + w * g; }
      for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.round(linToSrgb(Math.min(1, pl[i * 3 + c] * f)) * 255);
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    if (this.emissiveTex) this.emissiveTex.needsUpdate = true;
    if (this.material) this.material.emissiveIntensity = this.K;
    if (this.blurEmissive && this.blurEmissiveTex && this.blurMaterial) {
      const b = blurCanvas(this.emissiveCanvas, 48);
      const bctx = this.blurEmissive.getContext('2d')!;
      bctx.clearRect(0, 0, b.width, b.height);
      bctx.drawImage(b, 0, 0);
      this.blurEmissiveTex.needsUpdate = true;
      this.blurMaterial.emissiveIntensity = this.K;
    }
    const box = this.room.getObjectByName('scatola') as THREE.Mesh;
    if (box) {
      const bm = box.userData.backMat as THREE.MeshStandardMaterial;
      bm.emissiveIntensity = this.K * amb * 0.35;
    }
  }

  // luce indiretta stimata (sfera integratrice) per l'anteprima
  updateIndirect() {
    if (!this.recon || !this.snapshot) return;
    const s = this.snapshot;
    const skyLux = s.sun.enabled ? sunSky(s.sun).skyLux : 0;
    let flux = 0;
    for (const L of s.lights) if (L.on) flux += effectiveLumens(L, skyLux) * (fixtureById(L.fixtureId).kind === 'spot' && L.origin !== 'finestra' ? 0.7 : 1);
    if (this.sun.visible) {
      const { dir } = sunDirection(s.sun);
      for (const w of this.recon.windows) flux += this.sun.intensity * w.width * w.height * Math.max(0, -dir.dot(new THREE.Vector3(...w.normal))) * 0.85;
    }
    const [x0, y0, z0] = this.recon.room.min, [x1, y1, z1] = this.recon.room.max;
    const W = x1 - x0, H = y1 - y0, D = Math.min(z1, 0.5) - z0;
    const A = 2 * (W * H + W * D + H * D);
    const rho = 0.4;
    const E = (flux * rho) / (A * (1 - rho));
    this.ambient.intensity = E * 0.8;
  }

  // ---------------- calibrazione dell'esposizione sulla foto ----------------
  calibrate(): { iso: number; fStop: number; shutter: number } {
    if (!this.recon || !this.material || !this.snapshot) return { iso: 800, fStop: 2.8, shutter: 1 / 50 };
    const w = 160, h = Math.round(160 / this.camera.aspect) || 90;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    const prevK = this.material.emissiveIntensity;
    this.material.emissiveIntensity = 0;
    const panesVis = this.panes.map((p) => p.mesh.visible);
    this.panes.forEach((p) => (p.mesh.visible = false));
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, this.camera);
    const buf = new Float32Array(w * h * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    this.renderer.setRenderTarget(null);
    rt.dispose();
    this.panes.forEach((p, i) => (p.mesh.visible = panesVis[i]));
    this.material.emissiveIntensity = prevK;
    // media robusta (escludo le sorgenti molto brillanti)
    const lums: number[] = [];
    for (let i = 0; i < w * h; i++) lums.push(0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2]);
    lums.sort((a, b) => a - b);
    const cut = lums.slice(0, Math.floor(lums.length * 0.97));
    const M = cut.reduce((a, b) => a + b, 0) / Math.max(1, cut.length);
    const P = Math.max(0.01, this.recon.photoMeanLum);
    const amb = this.snapshot.ambient;
    let e = M > 1e-6 ? ((1 - amb) * P) / M : 1 / 60;
    if (!isFinite(e) || e <= 0) e = 1 / 60;
    // impostazioni camera: diaframma 2.8, otturatore 1/50, ISO di conseguenza
    const shutter = 1 / 50;
    let fStop = 2.8;
    let ev = Math.log2(1 / (1.2 * e));
    let iso = (100 * (fStop * fStop) / shutter) / Math.pow(2, ev);
    if (iso > 12800) { fStop = FSTOPS.filter((f) => f >= 1.4).find((f) => (100 * f * f / shutter) / Math.pow(2, ev) <= 12800) || 1.4; iso = (100 * fStop * fStop / shutter) / Math.pow(2, ev); }
    if (iso < 100) { fStop = FSTOPS.find((f) => (100 * f * f / shutter) / Math.pow(2, ev) >= 100) || 22; iso = (100 * fStop * fStop / shutter) / Math.pow(2, ev); }
    const isoSnap = ISO_VALUES.reduce((a, b) => (Math.abs(Math.log2(b / iso)) < Math.abs(Math.log2(a / iso)) ? b : a));
    const eActual = exposureFromEV100(ev100(fStop, shutter, isoSnap));
    this.K = 1 / eActual;
    this.skyCal = this.snapshot.sun.enabled ? sunSky(this.snapshot.sun).skyLux : 10000;
    return { iso: isoSnap, fStop, shutter };
  }

  // ---------------- vista ----------------
  resetView() {
    if (!this.homePose) return;
    this.camera.position.copy(this.homePose.pos);
    this.camera.quaternion.copy(this.homePose.quat);
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y; this.pitch = e.x;
    this.applyLook();
    this.dirty = true;
  }

  applyLook() {
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.clampCamera();
    this.camera.updateMatrixWorld();
  }

  clampCamera() {
    if (!this.recon) return;
    const { min, max } = this.recon.room;
    const p = this.camera.position;
    p.x = Math.min(max[0] - 0.15, Math.max(min[0] + 0.15, p.x));
    p.y = Math.min(max[1] - 0.1, Math.max(0.15, p.y));
    p.z = Math.min(max[2] - 0.15, Math.max(min[2] + 0.15, p.z));
  }

  isHome() {
    if (!this.homePose) return false;
    return this.camera.position.distanceTo(this.homePose.pos) < 0.02 && this.camera.quaternion.angleTo(this.homePose.quat) < 0.01;
  }

  bindNav() {
    const el = this.renderer.domElement;
    let drag: { x: number; y: number; btn: number; moved: boolean; shift: boolean } | null = null;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (!this.navEnabled) return;
      drag = { x: e.clientX, y: e.clientY, btn: e.button, moved: false, shift: e.shiftKey };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || !this.navEnabled) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.btn === 2 || drag.btn === 1 || drag.shift) {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0);
        this.camera.position.addScaledVector(right, -dx * 0.006).addScaledVector(up, dy * 0.006);
      } else {
        const k = THREE.MathUtils.degToRad(this.camera.fov) / this.container.clientHeight;
        this.yaw += dx * k; this.pitch += dy * k;
      }
      this.applyLook();
      this.dirty = true;
    });
    const end = (e: PointerEvent) => {
      if (drag && !drag.moved) this.onClick?.(e);
      drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => (drag = null));
    el.addEventListener('wheel', (e) => {
      if (!this.navEnabled) return;
      e.preventDefault();
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.camera.position.addScaledVector(f, -e.deltaY * 0.004);
      this.applyLook();
      this.dirty = true;
    }, { passive: false });
    el.addEventListener('dblclick', (e) => this.onDoubleClick?.(e));
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onClick: ((e: PointerEvent) => void) | null = null;
  onDoubleClick: ((e: MouseEvent) => void) | null = null;

  // ---------------- picking ----------------
  ndc(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  raycast(clientX: number, clientY: number, objects?: THREE.Object3D[]): Hit | null {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(this.ndc(clientX, clientY), this.camera);
    (rc as any).firstHitOnly = true;
    const list = objects || [...this.surfaces, ...[...this.people.values()].map((p) => p.obj), ...[...this.props.values()].map((p) => p.obj)];
    const hits = rc.intersectObjects(list, true).filter((h) => (h.object as any).visible !== false);
    if (!hits.length) return null;
    const h = hits[0];
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    if (n.dot(rc.ray.direction) > 0) n.negate();
    return { point: h.point.clone(), normal: n, object: h.object };
  }

  rayPlane(clientX: number, clientY: number, plane: THREE.Plane) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(this.ndc(clientX, clientY), this.camera);
    return rc.ray.intersectPlane(plane, new THREE.Vector3());
  }

  ray(clientX: number, clientY: number) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(this.ndc(clientX, clientY), this.camera);
    return rc.ray;
  }

  project(p: THREE.Vector3 | [number, number, number]) {
    const v = Array.isArray(p) ? new THREE.Vector3(...p) : p.clone();
    const c = v.clone().applyMatrix4(this.camera.matrixWorldInverse);
    const behind = c.z > -0.05;
    v.project(this.camera);
    return { x: ((v.x + 1) / 2) * this.container.clientWidth, y: ((1 - v.y) / 2) * this.container.clientHeight, behind, dist: -c.z };
  }

  jointWorld(personId: string, joint: string) {
    const o = this.people.get(personId);
    if (!o) return null;
    const j = (o.obj.userData.joints as any)[joint] as THREE.Object3D;
    o.obj.updateMatrixWorld(true);
    return j.getWorldPosition(new THREE.Vector3());
  }

  // ---------------- esposimetro ----------------
  measure(clientX: number, clientY: number) {
    const hit = this.raycast(clientX, clientY);
    if (!hit || !this.snapshot) return null;
    const s = this.snapshot;
    const skyLux = s.sun.enabled ? sunSky(s.sun).skyLux : 0;
    const p = hit.point.clone().addScaledVector(hit.normal, 0.01);
    const occluders = [...this.surfaces, ...[...this.people.values()].map((x) => x.obj), ...[...this.props.values()].map((x) => x.obj)];
    const rc = new THREE.Raycaster();
    (rc as any).firstHitOnly = true;
    let lux = 0;
    for (const L of s.lights) {
      const e = illuminanceAt(L, p, hit.normal, skyLux);
      if (e <= 0) continue;
      const lp = new THREE.Vector3(...L.position);
      const dir = lp.clone().sub(p);
      const dist = dir.length();
      rc.set(p, dir.normalize());
      rc.far = dist - 0.05;
      if (L.origin !== 'finestra' && rc.intersectObjects(occluders, true).length) continue;
      lux += e;
    }
    if (this.sun.visible) {
      const { dir } = sunDirection(s.sun);
      const cos = Math.max(0, dir.dot(hit.normal));
      if (cos > 0) {
        rc.set(p, dir); rc.far = 50;
        const blockers = rc.intersectObjects(occluders, true);
        if (!blockers.length) lux += this.sun.intensity * cos;
      }
    }
    lux += this.ambient.intensity;
    const c = s.cam;
    const fs = fStopForLux(lux, c.shutter, c.iso);
    return { lux, fStop: fs, point: hit.point, stops: Math.log2(fs / c.fStop) * 2 };
  }

  // ---------------- loop ----------------
  tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (this.keys.size && this.navEnabled && !this.shot) {
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion); f.y = 0; f.normalize();
      const r = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion); r.y = 0; r.normalize();
      const sp = 1.6 * dt;
      const k = this.keys;
      if (k.has('w') || k.has('arrowup')) this.camera.position.addScaledVector(f, sp);
      if (k.has('s') || k.has('arrowdown')) this.camera.position.addScaledVector(f, -sp);
      if (k.has('a')) this.camera.position.addScaledVector(r, -sp);
      if (k.has('d')) this.camera.position.addScaledVector(r, sp);
      if (k.has('arrowleft')) this.yaw += dt * 1.2;
      if (k.has('arrowright')) this.yaw -= dt * 1.2;
      if (k.has('q')) this.camera.position.y -= sp;
      if (k.has('e')) this.camera.position.y += sp;
      this.applyLook();
      this.dirty = true;
    }
    if (this.shot) { this.tickShot(); this.onFrame?.(); return; }
    if (!this.dirty) return;
    this.dirty = false;
    this.camera.updateMatrixWorld();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
    this.onFrame?.();
  }

  // ---------------- scatto (path tracing) ----------------
  async shoot(onProgress: (p: number) => void, samples = 384): Promise<HTMLCanvasElement | null> {
    if (this.shot || !this.snapshot) return null;
    const s = this.snapshot;
    // luci per il path tracer
    const ptLights = new THREE.Group();
    const skyLux = s.sun.enabled ? sunSky(s.sun).skyLux : 0;
    const skyK = sunSky(s.sun).skyK;
    for (const L of s.lights) {
      if (!L.on) continue;
      const fx = fixtureById(L.fixtureId);
      const lm = effectiveLumens(L, skyLux);
      if (lm <= 0) continue;
      const color = lightColor(L.origin === 'finestra' ? skyK : L.kelvin, L.gel);
      const pos = new THREE.Vector3(...L.position), tgt = new THREE.Vector3(...L.target);
      if (L.origin === 'finestra' || fx.kind === 'area') {
        const w = L.size[0] * (L.origin === 'finestra' ? 1 : 1 + L.softness), h = L.size[1] * (L.origin === 'finestra' ? 1 : 1 + L.softness);
        const nits = lm / (Math.PI * w * h);
        const al = new THREE.RectAreaLight(color, nits, w, h);
        al.position.copy(pos);
        al.lookAt(tgt);
        ptLights.add(al);
      } else if (fx.kind === 'spot') {
        const { beam, field } = spotAngles(L);
        const sl = new PhysicalSpotLight(color, spotCandela(lm, beam));
        sl.angle = THREE.MathUtils.degToRad(Math.min(170, field) / 2);
        sl.penumbra = Math.min(1, Math.max(0.05, 1 - beam / field));
        sl.decay = 2; sl.distance = 0;
        sl.radius = (fx.radius || 0.05) * (1 + L.softness * 3);
        sl.position.copy(pos);
        const t = new THREE.Object3D(); t.position.copy(tgt); ptLights.add(t); sl.target = t;
        ptLights.add(sl);
      } else {
        const pl = new THREE.PointLight(color, lm / (4 * Math.PI), 0, 2);
        (pl as any).radius = (fx.radius || 0.03) * (1 + L.softness * 3);
        pl.position.copy(pos);
        ptLights.add(pl);
      }
    }
    if (this.sun.visible) {
      const d = new THREE.DirectionalLight(this.sun.color.clone(), this.sun.intensity);
      d.position.copy(this.sun.position); d.target.position.copy(this.sun.target.position);
      ptLights.add(d, d.target);
    }
    const refMean = this.meanRender();
    this.scene.remove(this.rasterLights);
    this.scene.add(ptLights);
    ptLights.updateMatrixWorld(true);
    // fuoco: persona più vicina al centro o superficie al centro
    const r = this.renderer.domElement.getBoundingClientRect();
    const hit = this.raycast(r.left + r.width / 2, r.top + r.height / 2);
    let focus = hit ? hit.point.distanceTo(this.camera.position) : 3;
    for (const p of this.people.values()) {
      const head = this.jointWorld(p.state.id, 'head');
      if (head) { const pr = this.project(head); if (!pr.behind && pr.x > 0 && pr.x < r.width && pr.y > 0 && pr.y < r.height) { focus = pr.dist; break; } }
    }
    this.camera.focusDistance = focus;
    this.camera.fStop = s.cam.fStop;
    this.camera.apertureBlades = 7;

    if (!this.pt) {
      this.pt = new WebGLPathTracer(this.renderer);
      this.pt.tiles.set(2, 2);
      this.pt.minSamples = 1;
      this.pt.renderDelay = 0;
      this.pt.fadeDuration = 0;
      this.pt.dynamicLowRes = false;
      this.pt.filterGlossyFactor = 0.5;
      this.pt.textureSize.set(2048, 2048);
    }
    this.pt.multipleImportanceSampling = true;
    this.pt.bounces = 5;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = this.exposure;
    // la luce che resta dalla foto contiene già i suoi rimbalzi: nel path tracer
    // non deve rimbalzare di nuovo. Albedo contenuta e emissione ridotta di (1 - albedo).
    const cScale = Math.min(1, 0.55 / Math.max(0.05, this.albedoMean));
    const rho = Math.min(0.9, this.albedoMean * cScale);
    const emScale = Math.max(0.15, 1 - rho * 0.9);
    const saved: [THREE.MeshStandardMaterial, THREE.Color, number][] = [];
    const roomMats = [this.material, this.blurMaterial, (this.room.getObjectByName('scatola') as THREE.Mesh)?.userData.backMat].filter(Boolean) as THREE.MeshStandardMaterial[];
    for (const m of roomMats) {
      saved.push([m, m.color.clone(), m.emissiveIntensity]);
      m.color.multiplyScalar(cScale);
      m.emissiveIntensity *= emScale;
    }
    this.shotRestore = () => { for (const [m, c, ei] of saved) { m.color.copy(c); m.emissiveIntensity = ei; } };
    const prevBg = this.scene.background;
    this.scene.background = new THREE.Color(0, 0, 0);
    this.scene.environment = null;
    this.ambient.visible = false;
    try {
      await new Promise((r) => setTimeout(r, 30));
      this.pt.setScene(this.scene, this.camera);
    } catch (e) {
      console.error(e);
      this.finishShot(ptLights, prevBg);
      return null;
    }
    this.pt.reset();
    return new Promise((resolve) => {
      this.shot = { target: samples, start: performance.now(), onProgress, resolve, ptLights };
      (this.shot as any).refMean = refMean;
      (this.shot as any).prevBg = prevBg;
    });
  }

  tickShot() {
    const sh = this.shot!;
    this.pt.renderSample();
    const smp = this.pt.samples;
    const elapsed = (performance.now() - sh.start) / 1000;
    const cap = Number(new URLSearchParams(location.search).get("cap")) || 120;
    const p = Math.min(1, Math.max(smp / sh.target, elapsed / cap));
    (window as any).__ptSamples = smp;
    sh.onProgress(p);
    if (p >= 1) {
      // cattura immediata dal canvas (stesso frame)
      const cv = this.renderer.domElement;
      const fr = this.frameRect;
      const sx = Math.round(fr.x0 * cv.width), sy = Math.round(fr.y0 * cv.height);
      const sw = Math.round((fr.x1 - fr.x0) * cv.width), shh = Math.round((fr.y1 - fr.y0) * cv.height);
      const out = this.captureShot(sx, sy, sw, shh, (sh as any).refMean) || (() => {
        const o = document.createElement('canvas');
        o.width = sw; o.height = shh;
        o.getContext('2d')!.drawImage(cv, sx, sy, sw, shh, 0, 0, sw, shh);
        return o;
      })();
      despeckle(out);
      const resolve = sh.resolve;
      this.finishShot(sh.ptLights, (sh as any).prevBg);
      resolve(out);
    }
  }

  // luminanza media (lineare, già esposta) dell'anteprima, per allineare lo scatto
  meanRender(): number {
    const w = 160, h = Math.max(2, Math.round(160 / this.camera.aspect));
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, this.camera);
    const buf = new Float32Array(w * h * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    this.renderer.setRenderTarget(null);
    rt.dispose();
    return robustMean(buf, w * h);
  }

  // scatto letto dal buffer in virgola mobile del path tracer, esposto come l'anteprima
  captureShot(sx: number, sy: number, sw: number, sh: number, refMean: number): HTMLCanvasElement | null {
    try {
      const tgt = this.pt.target as THREE.WebGLRenderTarget;
      const cv = this.renderer.domElement;
      const W = tgt.width, H = tgt.height;
      if (!W || !H) return null;
      const buf = new Float32Array(W * H * 4);
      this.renderer.readRenderTargetPixels(tgt, 0, 0, W, H, buf);
      const kx = W / cv.width, ky = H / cv.height;
      const x0 = Math.round(sx * kx), w = Math.max(1, Math.round(sw * kx));
      const y0 = Math.round(sy * ky), h = Math.max(1, Math.round(sh * ky));
      // ritaglio (il buffer è capovolto in verticale)
      const crop = new Float32Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        const srcRow = H - 1 - (y0 + y);
        crop.set(buf.subarray((srcRow * W + x0) * 4, (srcRow * W + x0 + w) * 4), y * w * 4);
      }
      const ptMean = robustMean(crop, w * h);
      let k = 1;
      if (refMean > 0 && ptMean > 0) k = Math.min(1.5, Math.max(0.3, refMean / ptMean));
      (window as any).__shotMatch = { refMean, ptMean, k };
      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      const ctx = out.getContext('2d')!;
      const img = ctx.createImageData(w, h);
      const d = img.data;
      k *= this.exposure;
      for (let i = 0; i < w * h; i++) {
        const [r, g, b] = neutralTM(crop[i * 4] * k, crop[i * 4 + 1] * k, crop[i * 4 + 2] * k);
        d[i * 4] = linToSrgb8(r); d[i * 4 + 1] = linToSrgb8(g); d[i * 4 + 2] = linToSrgb8(b); d[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return out;
    } catch (e) {
      console.warn(e);
      return null;
    }
  }

  cancelShot() {
    if (!this.shot) return;
    const sh = this.shot;
    this.finishShot(sh.ptLights, (sh as any).prevBg);
    sh.resolve(null);
  }

  finishShot(ptLights: THREE.Group, prevBg: any) {
    this.shotRestore?.(); this.shotRestore = null;
    this.scene.remove(ptLights);
    ptLights.traverse((o: any) => o.dispose?.());
    this.scene.add(this.rasterLights);
    this.scene.background = prevBg;
    this.ambient.visible = true;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.camera.apertureBlades = 0;
    this.shot = null;
    this.dirty = true;
  }

  // anteprima: copia il canvas corrente (inquadratura)
  grabPreview(): HTMLCanvasElement {
    this.dirty = true;
    this.tick();
    const cv = this.renderer.domElement;
    const fr = this.frameRect;
    const sx = Math.round(fr.x0 * cv.width), sy = Math.round(fr.y0 * cv.height);
    const sw = Math.round((fr.x1 - fr.x0) * cv.width), sh = Math.round((fr.y1 - fr.y0) * cv.height);
    const out = document.createElement('canvas');
    out.width = sw; out.height = sh;
    out.getContext('2d')!.drawImage(cv, sx, sy, sw, sh, 0, 0, sw, sh);
    return out;
  }

  dispose() {
    this.disposed = true;
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function blurCanvas(src: HTMLCanvasElement, w: number) {
  const h = Math.max(2, Math.round((w * src.height) / src.width));
  const small = document.createElement('canvas'); small.width = w; small.height = h;
  const sctx = small.getContext('2d')!;
  sctx.filter = 'blur(2.5px)';
  // margine per evitare bordi scuri della sfocatura
  sctx.drawImage(src, -4, -4, w + 8, h + 8);
  return small;
}

function averageColor(c: HTMLCanvasElement) {
  const s = document.createElement('canvas'); s.width = 8; s.height = 8;
  const ctx = s.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < 64; i++) { r += srgbToLin(d[i * 4] / 255); g += srgbToLin(d[i * 4 + 1] / 255); b += srgbToLin(d[i * 4 + 2] / 255); }
  return new THREE.Color(r / 64, g / 64, b / 64);
}

// ---------------- alette (bandiere) ----------------
// media robusta della luminanza (senza il 3% più brillante)
function robustMean(buf: Float32Array, n: number) {
  const l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
  l.sort();
  const m = Math.floor(n * 0.97);
  let a = 0;
  for (let i = 0; i < m; i++) a += l[i];
  return m ? a / m : 0;
}

// Khronos PBR Neutral, come nell'anteprima
function neutralTM(r: number, g: number, b: number): [number, number, number] {
  const startCompression = 0.8 - 0.04, desaturation = 0.15;
  const x = Math.min(r, g, b);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  r -= offset; g -= offset; b -= offset;
  const peak = Math.max(r, g, b);
  if (peak < startCompression) return [r, g, b];
  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  r *= newPeak / peak; g *= newPeak / peak; b *= newPeak / peak;
  const f = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return [r * (1 - f) + newPeak * f, g * (1 - f) + newPeak * f, b * (1 - f) + newPeak * f];
}
function linToSrgb8(v: number) {
  v = Math.min(1, Math.max(0, v));
  return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
}

// toglie i puntini isolati (fireflies) rimasti dal path tracing
function despeckle(cv: HTMLCanvasElement) {
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const W = cv.width, H = cv.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data, src = new Uint8ClampedArray(d);
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = 0.2126 * src[i * 4] + 0.7152 * src[i * 4 + 1] + 0.0722 * src[i * 4 + 2];
  const nb = new Float32Array(8);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) nb[n++] = lum[i + dy * W + dx];
    const sorted = Array.from(nb).sort((a, b) => a - b);
    const med = (sorted[3] + sorted[4]) / 2;
    if (lum[i] > med + 28 && lum[i] > sorted[6] + 12) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) acc += src[(i + dy * W + dx) * 4 + c];
        d[i * 4 + c] = acc / 8;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// luminanza lineare media di una tela (miniatura)
function meanLinear(cv: HTMLCanvasElement) {
  const c = document.createElement('canvas'); c.width = 32; c.height = 24;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(cv, 0, 0, 32, 24);
  const d = x.getImageData(0, 0, 32, 24).data;
  const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  let m = 0;
  for (let i = 0; i < 32 * 24; i++) m += 0.2126 * lin(d[i * 4]) + 0.7152 * lin(d[i * 4 + 1]) + 0.0722 * lin(d[i * 4 + 2]);
  return m / (32 * 24);
}

const doorMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide });
function makeDoors() {
  const g = new THREE.Group();
  g.name = 'alette';
  for (const name of ['top', 'bottom', 'left', 'right']) {
    const hinge = new THREE.Group(); hinge.name = name;
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), doorMat);
    leaf.castShadow = true; leaf.receiveShadow = false;
    leaf.name = 'leaf';
    hinge.add(leaf);
    g.add(hinge);
  }
  return g;
}

function updateDoors(g: THREE.Group, L: LightState) {
  const pos = new THREE.Vector3(...L.position), tgt = new THREE.Vector3(...L.target);
  g.position.copy(pos);
  // +Z locale verso il bersaglio
  const m = new THREE.Matrix4().lookAt(tgt, pos, new THREE.Vector3(0, 1, 0));
  g.quaternion.setFromRotationMatrix(m);
  const fx = fixtureById(L.fixtureId);
  const r = Math.max(0.08, (fx.radius || 0.06) * 1.6); // mezza apertura del frontale
  const d = 0.1;               // distanza del frontale dalla sorgente
  const len = r * 1.5;          // lunghezza dell'aletta
  const conf: Record<string, { axis: 'x' | 'y'; sign: number; v: number }> = {
    top: { axis: 'x', sign: 1, v: L.barnDoors.top },
    bottom: { axis: 'x', sign: -1, v: L.barnDoors.bottom },
    left: { axis: 'y', sign: 1, v: L.barnDoors.left },
    right: { axis: 'y', sign: -1, v: L.barnDoors.right },
  };
  for (const hinge of g.children) {
    const c = conf[hinge.name];
    const leaf = hinge.getObjectByName('leaf') as THREE.Mesh;
    // apertura: 0 = aperta a 55° verso l'esterno, 90 = chiusa davanti al fascio
    const open = THREE.MathUtils.degToRad(55);
    const closed = THREE.MathUtils.degToRad(-88);
    const a = open + (closed - open) * (c.v / 90);
    hinge.rotation.set(0, 0, 0);
    if (c.axis === 'x') {
      hinge.position.set(0, c.sign * r, d);
      hinge.rotation.x = -c.sign * a;
      leaf.scale.set(2 * r, len, 1);
      leaf.position.set(0, 0, len / 2);
      leaf.rotation.set(Math.PI / 2, 0, 0);
    } else {
      hinge.position.set(c.sign * r, 0, d);
      hinge.rotation.y = c.sign * a;
      leaf.scale.set(len, 2 * r, 1);
      leaf.position.set(0, 0, len / 2);
      leaf.rotation.set(0, Math.PI / 2, 0);
    }
  }
}

// ---------------- oggetti di scena ----------------
export const PROP_KINDS: { id: PropState['kind']; name: string; size: [number, number] }[] = [
  { id: 'bandiera', name: 'Bandiera', size: [0.6, 0.9] },
  { id: 'bianco', name: 'Pannello bianco', size: [1.2, 1.2] },
  { id: 'nero', name: 'Pannello nero', size: [1.2, 1.2] },
  { id: 'diffusore', name: 'Telaio diffusione', size: [1.2, 1.2] },
];

function buildProp(p: PropState) {
  const g = new THREE.Group();
  g.userData.propId = p.id;
  let mat: THREE.Material;
  if (p.kind === 'bianco') mat = new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 1, side: THREE.DoubleSide });
  else if (p.kind === 'diffusore') mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 1, transmission: 1, thickness: 0.001, ior: 1.2, side: THREE.DoubleSide, transparent: true, opacity: 0.55 });
  else mat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95, side: THREE.DoubleSide });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  panel.name = 'pannello';
  panel.castShadow = p.kind !== 'diffusore';
  panel.receiveShadow = true;
  panel.userData.propId = p.id;
  g.add(panel);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.6, roughness: 0.4 }));
  pole.name = 'palo';
  pole.castShadow = true;
  pole.userData.propId = p.id;
  g.add(pole);
  return g;
}
