// Motore 3D: scena dalla ricostruzione, luci in tempo reale, navigazione libera,
// esposizione fisica, false color e render finale in path tracing.
import * as THREE from 'three';
import { WebGLPathTracer, PhysicalCamera, PhysicalSpotLight } from 'three-gpu-pathtracer';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import type { Reconstruction } from './reconstruct';
import {
  LightState, fixtureById, effectiveLumens, diffusionById, lightColor, spotAngles, spotCandela, illuminanceAt,
  ev100, exposureFromEV100, ISO_VALUES, FSTOPS, SENSORS, ASPECTS, fStopForLux,
} from './photometry';
import { PersonState, buildMannequin, applyPose } from './mannequin';
import { SunState, sunDirection, sunSky } from './sun';
import type { PropState, CamState, SceneSnapshot } from '../store';
import { RoomSpec, WallId, wallFrame, buildRoom, roomBounds, windowInfos, skyTexture, WindowInfoLite } from './room';
import { FurnitureState, buildFurniture } from './furniture';
import { denoise } from './denoise';

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as any).raycast = acceleratedRaycast;

const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

const QUAD_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const QUAD_FRAG = `
precision highp float;
uniform sampler2D tDiffuse; uniform float exposure; uniform int falseColor; uniform vec4 frame; uniform float maskAlpha;
uniform sampler2D tPhoto; uniform sampler2D tBase; uniform sampler2D tCur; uniform sampler2D tMask;
uniform sampler2D tAdd; uniform float addW;
uniform float relightW; uniform float photoK; uniform vec2 texel; uniform mat4 invProj; uniform mat3 camRot; uniform mat3 photoRotInv; uniform mat4 photoProj;
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
  vec3 scene = texture2D(tDiffuse, vUv).rgb;
  if (relightW > 0.0) {
    // dal punto di vista della foto: la foto stessa, più (o meno) ciò che cambia nelle luci
    vec4 v = invProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 dir = camRot * (v.xyz / v.w);
    vec4 cl = photoProj * vec4(photoRotInv * dir, 1.0);
    if (cl.w > 0.0) {
      vec2 puv = cl.xy / cl.w * 0.5 + 0.5;
      float edge = smoothstep(0.0, 0.002, min(min(puv.x, 1.0 - puv.x), min(puv.y, 1.0 - puv.y)));
      if (edge > 0.0) {
        // differenza ammorbidita: i cambi di luce sono morbidi, l'aliasing delle ombre no
        vec3 cur = vec3(0.0), base = vec3(0.0);
        for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
          vec2 o = vec2(float(i), float(j)) * texel * 1.5;
          cur += texture2D(tCur, puv + o).rgb; base += texture2D(tBase, puv + o).rgb;
        }
        cur /= 9.0; base /= 9.0;
        vec3 photo = texture2D(tPhoto, puv).rgb * photoK;
        // luce tolta: la foto si scurisce in proporzione; luce aggiunta: si somma
        float eps = 0.02 * photoK;
        vec3 down = photo * (min(cur, base) + eps) / (base + eps);
        vec3 relit = down + max(cur - base, 0.0);
        relit = mix(relit, texture2D(tCur, puv).rgb, texture2D(tMask, puv).r);
        scene = mix(scene, relit, relightW * edge);
      }
    }
  }
  // scatto: luci aggiunte calcolate in path tracing, sommate alla scena
  if (addW > 0.0) scene += texture2D(tAdd, vUv).rgb * addW;
  vec3 c = max(scene * exposure, 0.0);
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

// profondità di campo: distanza dalla camera per pixel, poi sfocatura con il circolo di confusione
const DIST_VERT = `varying float vD; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = length(mv.xyz); gl_Position = projectionMatrix * mv; }`;
const DIST_FRAG = `varying float vD; void main(){ gl_FragColor = vec4(vD, 0.0, 0.0, 1.0); }`;
const DOF_FRAG = `
precision highp float;
uniform sampler2D tColor; uniform sampler2D tDist; uniform vec2 texel; uniform float A; uniform float S; uniform float pxPerMM; uniform float maxR;
varying vec2 vUv;
// diametro del circolo di confusione in pixel -> raggio
float coc(float dm){ float d = max(dm * 1000.0, 1.0); return min(maxR, 0.5 * A * abs(d - S) / d * pxPerMM); }
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
void main(){
  float r0 = coc(texture2D(tDist, vUv).r);
  vec3 c0 = lin(texture2D(tColor, vUv).rgb);
  if (r0 < 0.5) { gl_FragColor = vec4(pow(c0, vec3(1.0/2.2)), 1.0); return; }
  vec3 acc = c0; float wsum = 1.0;
  for (int i = 0; i < 64; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / 64.0) * r0;
    float a = fi * 2.39996;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * texel;
    float rs = coc(texture2D(tDist, uv).r);
    // un campione conta se il suo circolo copre questo pixel (niente aloni dal nitido)
    float w = clamp(rs - r + 1.0, 0.0, 1.0);
    acc += lin(texture2D(tColor, uv).rgb) * w; wsum += w;
  }
  gl_FragColor = vec4(pow(acc / wsum, vec3(1.0/2.2)), 1.0);
}`;

interface LightObj { state: LightState; raster: THREE.Light; target: THREE.Object3D; doors: THREE.Group | null }

export interface Grab { start?: () => void; move: (e: PointerEvent) => void; end?: () => void }

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
  fillMesh: THREE.Mesh | null = null;
  extraMats: { mat: THREE.MeshStandardMaterial; gain: number }[] = [];
  boxMats: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial][] = []; // copia della scatola, originale
  syncBox() { for (const [c, o] of this.boxMats) c.emissiveIntensity = o.emissiveIntensity; }
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
  yaw = 0; pitch = 0; homeRoll = 0;
  albedoMean = 0.5;
  // vista dalla foto: foto proiettata + differenza di illuminazione
  photoCam = new THREE.PerspectiveCamera(50, 1, 0.03, 200);
  baseRT: THREE.WebGLRenderTarget | null = null;
  curRT: THREE.WebGLRenderTarget | null = null;
  maskRT: THREE.WebGLRenderTarget | null = null;
  relightPhotoTex: THREE.Texture | null = null;
  hasBase = false;
  maskBlack = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
  maskWhite = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  shotRestore: (() => void) | null = null;
  // profondità di campo
  distRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  postRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType });
  distMat = new THREE.ShaderMaterial({ vertexShader: DIST_VERT, fragmentShader: DIST_FRAG, side: THREE.DoubleSide });
  dofMat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT, fragmentShader: DOF_FRAG, depthTest: false, depthWrite: false,
    uniforms: { tColor: { value: null }, tDist: { value: null }, texel: { value: new THREE.Vector2() }, A: { value: 0 }, S: { value: 2000 }, pxPerMM: { value: 1 }, maxR: { value: 24 } },
  });
  dofScene = new THREE.Scene();
  focusM = 2; // distanza di messa a fuoco in uso (metri)
  homePose: { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number } | null = null;
  pt: any = null;
  shot: { target: number; start: number; onProgress: (p: number) => void; resolve: (c: HTMLCanvasElement | null) => void; ptLights: THREE.Group } | null = null;
  lastTime = performance.now();
  disposed = false;
  navEnabled = true;
  // stanza costruita a mano
  built: RoomSpec | null = null;
  furn = new Map<string, { state: FurnitureState; obj: THREE.Group; ceil: number }>();
  skyTex: THREE.DataTexture | null = null;
  selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffffff);
  selId: string | null = null;
  picks: THREE.Mesh[] = [];
  tmpRT: THREE.WebGLRenderTarget | null = null;

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
      uniforms: { tDiffuse: { value: this.rt.texture }, exposure: { value: 1 }, falseColor: { value: 0 }, frame: { value: new THREE.Vector4(0, 0, 1, 1) }, maskAlpha: { value: 0.12 },
        tPhoto: { value: null }, tBase: { value: null }, tCur: { value: null }, tMask: { value: null }, tAdd: { value: null }, addW: { value: 0 }, relightW: { value: 0 }, photoK: { value: 1 }, texel: { value: new THREE.Vector2(0.001, 0.001) },
        invProj: { value: new THREE.Matrix4() }, camRot: { value: new THREE.Matrix3() }, photoRotInv: { value: new THREE.Matrix3() }, photoProj: { value: new THREE.Matrix4() } },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.quadMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    const dq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.dofMat);
    dq.frustumCulled = false;
    this.dofScene.add(dq);

    this.scene.background = new THREE.Color(0x050506);
    this.scene.add(this.room, this.rasterLights, this.camera);
    this.selBox.visible = false;
    (this.selBox.material as THREE.LineBasicMaterial).transparent = true;
    (this.selBox.material as THREE.LineBasicMaterial).opacity = 0.55;
    this.scene.add(this.selBox);
    this.rasterLights.add(this.sun, this.sun.target, this.ambient);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.015;
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
    this.distRT.setSize(Math.round(w * pr), Math.round(h * pr));
    this.postRT.setSize(Math.round(w * pr), Math.round(h * pr));
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
    if (!this.recon) return 24 * ((SENSORS.find((s) => s.id === sensorId) || SENSORS[0]).width / 24.89);
    const sensor = SENSORS.find((s) => s.id === sensorId) || SENSORS[0];
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.recon.camera.fov) / 2);
    // vogliamo che la foto riempia l'altezza del canvas: tanHalfV(canvas) = tanV
    // la foto copre tutto lo schermo (come "cover"): si taglia il lato in eccesso
    const tanHalfH = tanV * Math.min(w / h, this.recon.camera.aspect);
    return sensor.width / (2 * tanHalfH);
  }

  // ---------------- ricostruzione ----------------
  loadRecon(recon: Reconstruction) {
    this.clearBuilt();
    this.picks = [];
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
    const fill: number[] = []; // salti di profondità: superfici di raccordo sfocate al posto dei buchi
    const ta = new THREE.Vector3(), tb = new THREE.Vector3(), tc = new THREE.Vector3(), tn = new THREE.Vector3(), tv = new THREE.Vector3();
    const camP = new THREE.Vector3(...recon.camera.position);
    const inWindow = (u: number, v: number) => recon.windows.some((w) => u > w.bbox[0] - 0.004 && u < w.bbox[2] + 0.004 && v > w.bbox[1] - 0.004 && v < w.bbox[3] + 0.004);
    for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
      const a = j * gw + i, b = a + 1, c = a + gw, d = c + 1;
      if (inWindow((i + 0.5) / (gw - 1), (j + 0.5) / (gh - 1))) continue;
      // per triangolo (bordi più fini): salti di profondità e triangoli stirati diventano buchi
      const tri = (p: number, q: number, r: number) => {
        const zp = camDepth[p], zq = camDepth[q], zr = camDepth[r];
        const mx = Math.max(zp, zq, zr), mn = Math.min(zp, zq, zr);
        if (mx / mn > 1.08 + 0.012 * mn) { if (mx / mn < 1.9) fill.push(p, q, r); return; }
        ta.set(world[p * 3], world[p * 3 + 1], world[p * 3 + 2]);
        tb.set(world[q * 3], world[q * 3 + 1], world[q * 3 + 2]);
        tc.set(world[r * 3], world[r * 3 + 1], world[r * 3 + 2]);
        tn.subVectors(tb, ta).cross(tc.sub(ta));
        const ln = tn.length();
        if (ln > 1e-9) {
          tv.copy(ta).sub(camP).normalize();
          if (Math.abs(tn.dot(tv) / ln) < 0.06) { fill.push(p, q, r); return; }
        }
        idx.push(p, q, r);
      };
      tri(a, c, b); tri(b, c, d);
    }
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // raccordi: stessa griglia, nessuna ombra portata
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', geo.attributes.position);
    fgeo.setAttribute('uv', geo.attributes.uv);
    fgeo.setIndex(fill);
    fgeo.computeVertexNormals();
    const fillMesh = new THREE.Mesh(fgeo, this.blurMaterial);
    fillMesh.name = 'raccordi';
    fillMesh.castShadow = false; fillMesh.receiveShadow = true;
    this.fillMesh = fillMesh;
    // pareti, pavimento e soffitto letti (vicini ai piani della stanza) non portano ombre:
    // l'involucro le porta già, e i loro bordi irregolari disegnavano strisce di luce e ombra
    const [rx0, ry0, rz0] = recon.room.min, [rx1, ry1] = recon.room.max;
    const near = (k: number) => {
      const x = world[k * 3], y = world[k * 3 + 1], z = world[k * 3 + 2];
      return Math.min(x - rx0, rx1 - x, y - ry0, ry1 - y, z - rz0) < 0.3;
    };
    const objIdx: number[] = [], shellIdx: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      const [p, q, r] = [idx[t], idx[t + 1], idx[t + 2]];
      (near(p) && near(q) && near(r) ? shellIdx : objIdx).push(p, q, r);
    }
    const sgeo = new THREE.BufferGeometry();
    for (const k of ['position', 'uv', 'normal']) sgeo.setAttribute(k, geo.attributes[k]);
    sgeo.setIndex(shellIdx);
    (sgeo as any).computeBoundsTree();
    const shellMesh = new THREE.Mesh(sgeo, mat);
    shellMesh.name = 'stanza';
    shellMesh.castShadow = false; shellMesh.receiveShadow = true;
    geo.setIndex(objIdx);
    (geo as any).computeBoundsTree();
    const depthMesh = new THREE.Mesh(geo, mat);
    depthMesh.name = 'oggetti';
    depthMesh.castShadow = true; depthMesh.receiveShadow = true;
    this.room.add(depthMesh, shellMesh, fillMesh);
    this.surfaces.push(depthMesh, shellMesh);

    // ---- foto in più: le parti della stanza che la prima foto non vede ----
    this.extraMats = [];
    for (const ex of recon.extras || []) {
      if (!ex.index.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(ex.world.slice(), 3));
      const euv = new Float32Array(ex.gw * ex.gh * 2);
      for (let j = 0; j < ex.gh; j++) for (let i = 0; i < ex.gw; i++) { const k = j * ex.gw + i; euv[k * 2] = i / (ex.gw - 1); euv[k * 2 + 1] = 1 - j / (ex.gh - 1); }
      g.setAttribute('uv', new THREE.BufferAttribute(euv, 2));
      g.setIndex(ex.index);
      g.computeVertexNormals();
      (g as any).computeBoundsTree();
      const at = new THREE.CanvasTexture(ex.albedo); at.colorSpace = THREE.SRGBColorSpace; at.anisotropy = 8;
      const et = new THREE.CanvasTexture(ex.photo); et.colorSpace = THREE.SRGBColorSpace;
      const em = new THREE.MeshStandardMaterial({ map: at, emissiveMap: et, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
      this.extraMats.push({ mat: em, gain: ex.gain });
      const mesh = new THREE.Mesh(g, em);
      mesh.name = 'foto in più';
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.room.add(mesh);
      this.surfaces.push(mesh);
    }

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
    this.setupRelight(recon);
    // ombre del sole: la camera d'ombra copre la stanza
    const size = new THREE.Vector3(recon.room.max[0] - recon.room.min[0], recon.room.max[1] - recon.room.min[1], recon.room.max[2] - recon.room.min[2]);
    const r = size.length() / 2 + 0.5;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.1; sc.far = r * 4; sc.updateProjectionMatrix();
    this.dirty = true;
  }

  // ---------------- stanza costruita a mano ----------------
  get bounds(): { min: [number, number, number]; max: [number, number, number] } {
    if (this.built) return roomBounds(this.built);
    if (this.recon) return this.recon.room;
    return { min: [-3, 0, -3], max: [3, 2.8, 3] };
  }

  windowList(): WindowInfoLite[] {
    if (this.built) return windowInfos(this.built, true);
    return this.recon?.windows || [];
  }

  clearBuilt() {
    for (const [, o] of this.furn) this.scene.remove(o.obj);
    this.furn.clear();
    this.built = null;
  }

  loadRoom(spec: RoomSpec, resetView: boolean) {
    const first = !this.built;
    this.recon = null;
    for (const c of [...this.room.children]) { this.room.remove(c); c.traverse((o: any) => { o.geometry?.dispose?.(); }); }
    this.surfaces = []; this.panes = []; this.maskLin.clear(); this.extraMats = []; this.boxMats = [];
    this.fillMesh = null; this.material = null; this.blurMaterial = null; this.photoLin = null; this.emissiveCanvas = null;
    this.hasBase = false; this.quadMat.uniforms.relightW.value = 0;
    this.built = spec;
    const { group, surfaces, picks } = buildRoom(spec);
    this.room.add(group);
    this.surfaces = surfaces;
    this.picks = picks;
    this.K = 1;
    // vista iniziale: da un angolo verso l'angolo opposto, come si entra in una stanza
    const W = spec.width, D = spec.depth;
    const m = Math.min(0.5, W * 0.1, D * 0.1);
    const pos = new THREE.Vector3(W / 2 - m, Math.min(1.6, spec.height - 0.3), D / 2 - m);
    const dir = new THREE.Vector3(-W * 0.22, 1.05, -D * 0.3).sub(pos);
    this.homePose = {
      pos,
      quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.atan2(dir.y, Math.hypot(dir.x, dir.z)), Math.atan2(-dir.x, -dir.z), 0, 'YXZ')),
      fov: 50,
    };
    if (resetView || first) this.resetView(); else { this.applyLook(); }
    const b = this.bounds;
    const size = new THREE.Vector3(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const r = size.length() / 2 + 0.6;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.1; sc.far = r * 4; sc.updateProjectionMatrix();
    // le lampade appese seguono l'altezza del soffitto
    for (const [id, o] of this.furn) if (o.ceil !== spec.height) { this.scene.remove(o.obj); this.furn.delete(id); }
    if (this.snapshot) this.syncSun(this.snapshot.sun);
    this.dirty = true;
  }

  syncFurniture(list: FurnitureState[]) {
    const ids = new Set(list.map((f) => f.id));
    for (const [id, o] of this.furn) if (!ids.has(id)) { this.scene.remove(o.obj); this.furn.delete(id); }
    const ceil = this.built?.height || 2.8;
    for (const f of list) {
      let o = this.furn.get(f.id);
      if (!o || o.state.kind !== f.kind || o.state.color !== f.color || o.ceil !== ceil) {
        if (o) this.scene.remove(o.obj);
        const obj = buildFurniture(f, ceil);
        obj.userData.furnitureId = f.id;
        this.scene.add(obj);
        o = { state: f, obj, ceil };
        this.furn.set(f.id, o);
      }
      o.state = f;
      o.obj.position.set(...f.position);
      o.obj.rotation.set(0, THREE.MathUtils.degToRad(f.rotationY), 0);
      o.obj.updateMatrixWorld(true);
    }
    this.updateSelBox();
    this.updateGlow();
  }

  setSelected(id: string | null) {
    this.selId = id;
    this.updateSelBox();
    this.dirty = true;
  }

  updateSelBox() {
    const o = this.selId ? this.furn.get(this.selId) : null;
    if (o) { this.selBox.box.setFromObject(o.obj); this.selBox.visible = true; return; }
    // apertura (finestra, porta): il riquadro del suo telaio
    const box = new THREE.Box3();
    if (this.selId) this.room.traverse((m: any) => { if (m.isMesh && m.userData.openingId === this.selId) box.expandByObject(m); });
    if (!box.isEmpty()) { this.selBox.box.copy(box.expandByScalar(0.02)); this.selBox.visible = true; return; }
    this.selBox.visible = false;
  }

  // lampadine e paralumi accesi come la loro luce
  updateGlow() {
    if (!this.snapshot) return;
    const lights = this.snapshot.lights;
    for (const [id, o] of this.furn) {
      const L = lights.find((l) => l.attached === id);
      const lm = L && L.on ? effectiveLumens(L, 0) : 0;
      const col = L ? lightColor(L.kelvin, L.gel) : new THREE.Color(1, 1, 1);
      o.obj.traverse((m: any) => {
        if (!m.isMesh) return;
        if (m.userData.bulb) {
          const r = (m.geometry as THREE.SphereGeometry).parameters.radius;
          m.material.emissive.copy(col);
          m.material.emissiveIntensity = lm / (Math.PI * 4 * Math.PI * r * r);
        } else if (m.userData.glow) {
          const g = m.geometry as THREE.CylinderGeometry;
          const rr = (g.parameters.radiusTop + g.parameters.radiusBottom) / 2;
          // luce che attraversa il tessuto (circa un quarto), distribuita sul paralume
          m.material.emissive.copy(col).multiply(new THREE.Color(1, 0.93, 0.82));
          m.material.emissiveIntensity = (lm * 0.25) / (Math.PI * 2 * Math.PI * rr * g.parameters.height * 2);
        }
      });
    }
  }

  furnitureObjects() { return [...this.furn.values()].map((f) => f.obj); }

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
      if (!(u > 0.01 && u < 0.99 && v > 0.01 && v < 0.99)) return false;
      // la foto vede davvero questa parete solo se lì la profondità letta coincide:
      // altrimenti proietterebbe sulla scatola ciò che sta davanti (lampade, mobili) come strisce
      const gi = Math.min(recon.gw - 1, Math.max(0, Math.round(u * (recon.gw - 1))));
      const gj = Math.min(recon.gh - 1, Math.max(0, Math.round((1 - v) * (recon.gh - 1))));
      const dz = recon.camDepth[gj * recon.gw + gi];
      return Math.abs(dz + c.z) < Math.max(0.25, -c.z * 0.15);
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
    const faceOut: number[] = [];
    let su = 0, sv = 0, sn = 0;
    const windows = recon.windows.map((w) => ({ w, c: new THREE.Vector3(...w.center) }));
    let base = 0;
    for (const f of faces) {
      const normal = f.a.clone().cross(f.b).normalize();
      // la normale deve guardare dentro la stanza
      const center = f.o.clone().addScaledVector(f.a, 0.5).addScaledVector(f.b, 0.5);
      const toIn = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).sub(center);
      const flip = normal.dot(toIn) < 0;
      const planeD = -normal.dot(f.o);
      su = 0; sv = 0; sn = 0;
      base = pos.length / 3;
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
        if (f.back) backIndex.push(...tri);
        else if (inside(pc)) { index.push(...tri); const [u, v] = project(pc); su += u; sv += v; sn++; }
        else faceOut.push(...tri);
      }
      // parti che la foto non vede: un colore uniforme, preso dalla parte vista della stessa parete
      // (con le coordinate bloccate al bordo della foto venivano strisce)
      const mu = sn ? su / sn : 0.5, mv = sn ? sv / sn : 0.5;
      for (const k of faceOut) {
        outIndex.push(pos.length / 3);
        pos.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
        uvs.push(mu, mv);
      }
      faceOut.length = 0;
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
    // la scatola fa da sfondo: non copre mai la stanza ricostruita (dall'interno di una scatola
    // ogni direzione incontra una sola parete, quindi non serve la profondità)
    const front = mat.clone(), blur = this.blurMaterial!.clone();
    for (const m of [front, backMat, blur]) m.depthWrite = false;
    this.boxMats = [[front, mat], [blur, this.blurMaterial!]];
    const mesh = new THREE.Mesh(g, [front, backMat, blur]);
    mesh.renderOrder = -1;
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
    if (!prev || prev.lights !== s.lights || prev.sun !== s.sun || prev.props !== s.props) this.syncLights(s.lights, s.sun);
    if (!prev || prev.sun !== s.sun || (this.built && prev.lights !== s.lights && this.windowGain(prev.lights) !== this.windowGain(s.lights))) this.syncSun(s.sun);
    if (!prev || prev.people !== s.people) this.syncPeople(s.people);
    if (!prev || prev.props !== s.props) this.syncProps(s.props);
    if (!prev || prev.props !== s.props || prev.lights !== s.lights) this.glowFrames(this.resolveLights(s.lights));
    if (s.room && (!prev || prev.room !== s.room || !this.built)) { this.loadRoom(s.room, false); this.updateSelBox(); }
    if (!prev || prev.furniture !== s.furniture || prev.room !== s.room) this.syncFurniture(s.furniture || []);
    if (!prev || prev.lights !== s.lights) this.updateGlow();
    if (!prev || prev.lights !== s.lights || prev.ambient !== s.ambient || prev.sun !== s.sun) this.updateEmissive();
    this.updateIndirect();
    this.syncPropLights();
    this.quadMat.uniforms.falseColor.value = s.cam.falseColor ? 1 : 0;
    this.dirty = true;
  }

  updateExposure() {
    const c = this.cam;
    if (!c) return;
    this.exposure = exposureFromEV100(ev100(c.fStop, c.shutter, c.iso));
    this.quadMat.uniforms.exposure.value = this.exposure;
    // la profondità di campo si calcola dopo (uguale in anteprima e nello scatto)
    this.camera.fStop = 1e9;
  }

  skyLux() {
    return this.snapshot ? (this.snapshot.sun.enabled ? sunSky(this.snapshot.sun).skyLux : 0) : 10000;
  }

  // una luce che punta attraverso un telaio di diffusione diventa una sorgente grande e morbida
  // grande quanto il telaio (con la parte di flusso che lo colpisce, meno l'assorbimento del telo)
  diffused(L: LightState, props: PropState[]): LightState | null {
    if (L.origin === 'finestra' || L.attached) return null;
    const pos = new THREE.Vector3(...L.position), tgt = new THREE.Vector3(...L.target);
    const reach = pos.distanceTo(tgt);
    if (reach < 1e-3) return null;
    const dir = tgt.clone().sub(pos).normalize();
    const fx = fixtureById(L.fixtureId);
    let best: { t: number; L: LightState } | null = null;
    for (const p of props) {
      if (p.kind !== 'diffusore') continue;
      const rot = new THREE.Euler(THREE.MathUtils.degToRad(p.tilt), THREE.MathUtils.degToRad(p.rotationY), 0, 'YXZ');
      const n = new THREE.Vector3(0, 0, 1).applyEuler(rot), right = new THREE.Vector3(1, 0, 0).applyEuler(rot), up = new THREE.Vector3(0, 1, 0).applyEuler(rot);
      const c = new THREE.Vector3(...p.position);
      const den = dir.dot(n);
      if (Math.abs(den) < 0.05) continue;
      const t = c.clone().sub(pos).dot(n) / den;
      if (t < 0.05 || t > reach + 1) continue;
      const h = pos.clone().addScaledVector(dir, t).sub(c);
      const [w, hh] = p.size;
      if (Math.abs(h.dot(right)) > w * 0.65 || Math.abs(h.dot(up)) > hh * 0.65) continue;
      if (best && best.t < t) continue;
      const omega = Math.min(2 * Math.PI, (w * hh * Math.abs(den)) / (t * t));
      let frac: number;
      if (fx.kind === 'spot') { const { field } = spotAngles(L); frac = omega / (2 * Math.PI * (1 - Math.cos(THREE.MathUtils.degToRad(Math.min(170, field)) / 2))); }
      else if (fx.kind === 'area') frac = omega / Math.PI;
      else frac = omega / (4 * Math.PI);
      const out = den > 0 ? n : n.clone().negate();
      const ctr = c.clone().addScaledVector(out, 0.03);
      best = { t, L: {
        ...L, fixtureId: 'panel-120x60', position: ctr.toArray() as any, target: ctr.clone().addScaledVector(out, 2).toArray() as any,
        size: [w, hh], softness: 0, diffusion: 'none', virtualLm: effectiveLumens(L, 0) * Math.min(1, frac) * 0.7,
      } };
      (best.L as any).frameId = p.id;
    }
    return best?.L || null;
  }

  resolveLights(lights: LightState[]) {
    const props = this.snapshot?.props || [];
    if (!props.some((p) => p.kind === 'diffusore')) return lights;
    return lights.map((L) => this.diffused(L, props) || L);
  }

  // anteprima: il pannello bianco rimbalza la luce che lo colpisce, il pannello nero toglie il
  // riempimento della stanza dal suo lato (nello scatto lo fa da solo il path tracing)
  propLights = new Map<string, THREE.SpotLight>();
  syncPropLights() {
    const want = new Set<string>();
    const s = this.snapshot;
    if (s) for (const p of s.props) {
      if (p.kind !== 'bianco' && p.kind !== 'nero') continue;
      const rot = new THREE.Euler(THREE.MathUtils.degToRad(p.tilt), THREE.MathUtils.degToRad(p.rotationY), 0, 'YXZ');
      const n = new THREE.Vector3(0, 0, 1).applyEuler(rot);
      const c = new THREE.Vector3(...p.position);
      const A = p.size[0] * p.size[1];
      for (const side of [1, -1]) {
        const nn = n.clone().multiplyScalar(side);
        let I = 0;
        if (p.kind === 'bianco') {
          // luce che arriva su questa faccia (senza il riempimento stimato), riflessa all'85%
          const r = this.readingAt(c.clone().addScaledVector(nn, 0.02), nn);
          const E = r ? Math.max(0, r.lux - this.ambient.intensity) : 0;
          I = (0.85 * E * A) / Math.PI;
        } else {
          // superficie nera: dal suo lato manca la luce che la stanza rimbalzerebbe
          I = -(this.ambient.intensity / Math.PI) * A * 0.9;
        }
        if (Math.abs(I) < 1e-3) continue;
        const key = `${p.id}:${side}`;
        want.add(key);
        let l = this.propLights.get(key);
        if (!l) {
          l = new THREE.SpotLight();
          l.angle = THREE.MathUtils.degToRad(84); l.penumbra = 1; l.decay = 2; l.distance = 0;
          l.castShadow = true;
          l.shadow.mapSize.set(512, 512); l.shadow.bias = -0.0006; l.shadow.normalBias = 0.02;
          l.shadow.camera.near = 0.08; l.shadow.radius = 6; (l.shadow.camera as THREE.PerspectiveCamera).fov = 170;
          this.rasterLights.add(l, l.target);
          this.propLights.set(key, l);
        }
        l.color.setRGB(1, 1, 1);
        l.intensity = I;
        l.position.copy(c).addScaledVector(nn, 0.04);
        l.target.position.copy(c).addScaledVector(nn, 2);
        l.target.updateMatrixWorld();
      }
    }
    for (const [k, l] of this.propLights) if (!want.has(k)) { this.rasterLights.remove(l, l.target); l.shadow.map?.dispose(); l.dispose(); this.propLights.delete(k); }
    this.dirty = true;
  }

  // il telo del telaio si illumina (solo in anteprima: nello scatto la luce è la sorgente stessa)
  glowFrames(lights: LightState[]) {
    const lum = new Map<string, number>();
    for (const L of lights) {
      const id = (L as any).frameId;
      if (!id || !L.on) continue;
      lum.set(id, (lum.get(id) || 0) + effectiveLumens(L, 0) / (Math.PI * L.size[0] * L.size[1]));
    }
    for (const [id, o] of this.props) {
      if (o.state.kind !== 'diffusore') continue;
      const m = (o.obj.getObjectByName('pannello') as THREE.Mesh).material as THREE.MeshStandardMaterial;
      const v = lum.get(id) || 0;
      m.emissive.setRGB(1, 1, 1);
      m.emissiveIntensity = v;
      m.userData.glow = v;
    }
  }

  syncLights(rawLights: LightState[], sun: SunState) {
    const lights = this.resolveLights(rawLights);
    this.glowFrames(lights);
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
      // le luci lette stanno dentro la forma della loro lampada (paralume, globo): senza un
      // margine la lampada stessa proietta raggi d'ombra su soffitto e pareti
      const nearShadow = L.origin === 'letta' ? 0.35 : 0.05;
      if (r.shadow.camera.near !== nearShadow) { r.shadow.camera.near = nearShadow; r.shadow.camera.updateProjectionMatrix(); }
      if (wantKind === 'point') {
        r.intensity = lm / (4 * Math.PI);
        r.decay = 2; r.distance = 0;
        r.shadow.radius = 2 + L.softness * 8 + diffusionById(L.diffusion).spread * 8;
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
        r.shadow.radius = 1 + L.softness * 6 + diffusionById(L.diffusion).spread * 10;
      }
      // bandiere (alette) per gli spot
      const bd = L.barnDoors;
      const hasDoors = wantKind === 'spot' && (bd.top || bd.bottom || bd.left || bd.right);
      if (hasDoors) {
        if (!o.doors) { o.doors = makeDoors(); o.doors.traverse((q) => q.layers.enable(1)); this.scene.add(o.doors); }
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

  // stanza costruita: il cursore della luce dalle finestre fa da filtro ND su tutte le finestre
  // (sole e cielo insieme, uguale in anteprima e nello scatto)
  windowGain(lights?: LightState[]) {
    if (!this.built) return 1;
    const ws = (lights || this.snapshot?.lights || []).filter((L) => L.origin === 'finestra');
    if (!ws.length) return 1;
    const on = ws.filter((L) => L.on);
    if (!on.length) return 0;
    return Math.pow(2, Math.max(...on.map((L) => L.stops)));
  }

  syncSun(s: SunState) {
    const { dir, elevation } = sunDirection(s);
    const sk = sunSky(s);
    const gain = this.windowGain();
    const on = s.enabled && elevation > 0 && sk.sunLux > 0 && this.windowList().length > 0 && gain > 0;
    this.sun.visible = on;
    this.sun.intensity = on ? sk.sunLux * gain : 0;
    this.sun.color.copy(lightColor(sk.sunK, 'none'));
    const bb = this.bounds;
    const c = new THREE.Vector3((bb.min[0] + bb.max[0]) / 2, 1.2, (bb.min[2] + bb.max[2]) / 2);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    this.sun.position.copy(c).addScaledVector(dir, sc.far / 2);
    this.sun.target.position.copy(c);
    this.sun.target.updateMatrixWorld();
    // vetri: luminosità della vista esterna segue il cielo
    const f = this.skyCal > 0 ? Math.min(8, (s.enabled ? sk.skyLux : 0) / this.skyCal) : 1;
    for (const p of this.panes) {
      (p.mesh.material as THREE.MeshPhysicalMaterial).emissiveIntensity = this.K * Math.max(0.002, f);
    }
    // stanza costruita: cielo e terreno fuori dalle finestre
    if (this.built) {
      const skyLux = (s.enabled ? sk.skyLux : 0.3) * gain;
      const groundLux = (on ? sk.sunLux * gain * Math.max(0, Math.sin(THREE.MathUtils.degToRad(elevation))) : 0) + skyLux;
      const skyCol = lightColor(sk.skyK, 'none');
      this.skyTex = skyTexture(skyLux / Math.PI, skyCol, (0.18 * groundLux) / Math.PI, this.skyTex || undefined);
      this.scene.background = this.skyTex;
      this.scene.backgroundIntensity = 1;
    } else if (this.scene.background === this.skyTex) {
      this.scene.background = new THREE.Color(0x050506);
    }
    this.dirty = true;
  }

  syncPeople(list: PersonState[]) {
    const ids = new Set(list.map((p) => p.id));
    for (const [id, o] of this.people) if (!ids.has(id)) { this.scene.remove(o.obj); this.people.delete(id); }
    for (const p of list) {
      const o = this.people.get(p.id);
      if (!o || o.state.skin !== p.skin) {
        if (o) this.scene.remove(o.obj);
        const obj = buildMannequin(p);
        obj.traverse((o) => o.layers.enable(1));
        this.scene.add(obj);
        this.people.set(p.id, { state: p, obj });
      } else {
        o.state = p;
        applyPose(o.obj, p);
      }
      // i piedi poggiano sul pavimento letto dalla foto (che può non stare esattamente a quota 0)
      const obj = this.people.get(p.id)!.obj;
      obj.position.y = p.position[1] + this.groundAt(p.position[0], p.position[2]);
    }
  }

  groundAt(x: number, z: number) {
    if (this.built) return 0;
    // quota del pavimento letto attorno ai piedi (mediana su una piccola griglia)
    const ys: number[] = [];
    const rc = new THREE.Raycaster();
    rc.far = 2.2;
    for (const dx of [-0.3, 0, 0.3]) for (const dz of [-0.3, 0, 0.3]) {
      rc.set(new THREE.Vector3(x + dx, 1.4, z + dz), new THREE.Vector3(0, -1, 0));
      for (const h of rc.intersectObjects(this.surfaces, false)) {
        if (h.object.name === 'scatola') break;
        const n = h.face?.normal;
        if (h.point.y < 0.5 && h.point.y > -0.4 && (!n || Math.abs(n.y) > 0.5)) { ys.push(h.point.y); break; }
      }
    }
    if (!ys.length) return 0;
    ys.sort((p, q) => p - q);
    return ys[Math.floor(ys.length / 2)];
  }


  syncProps(list: PropState[]) {
    const ids = new Set(list.map((p) => p.id));
    for (const [id, o] of this.props) if (!ids.has(id)) { this.scene.remove(o.obj); this.props.delete(id); }
    for (const p of list) {
      let o = this.props.get(p.id);
      if (!o || o.state.kind !== p.kind) {
        if (o) this.scene.remove(o.obj);
        o = { state: p, obj: buildProp(p) };
        o.obj.traverse((q) => q.layers.enable(1));
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
    // foto in più: la loro luce, riportata all'esposizione della prima foto
    for (const x of this.extraMats) x.mat.emissiveIntensity = this.K * amb * x.gain;
    this.syncBox();
    const box = this.room.getObjectByName('scatola') as THREE.Mesh;
    if (box) {
      const bm = box.userData.backMat as THREE.MeshStandardMaterial;
      bm.emissiveIntensity = this.K * amb * 0.35;
    }
  }

  // luce indiretta stimata (sfera integratrice) per l'anteprima
  updateIndirect() {
    if ((!this.recon && !this.built) || !this.snapshot) return;
    const s = this.snapshot;
    const skyLux = s.sun.enabled ? sunSky(s.sun).skyLux : 0;
    let flux = 0;
    for (const L of s.lights) if (L.on) flux += effectiveLumens(L, skyLux) * (fixtureById(L.fixtureId).kind === 'spot' && L.origin !== 'finestra' ? 0.7 : 1);
    if (this.sun.visible) {
      const { dir } = sunDirection(s.sun);
      for (const w of this.windowList()) flux += this.sun.intensity * w.width * w.height * Math.max(0, -dir.dot(new THREE.Vector3(...w.normal))) * 0.85;
    }
    const [x0, y0, z0] = this.bounds.min, [x1, y1, z1] = this.bounds.max;
    const W = x1 - x0, H = y1 - y0, D = (this.built ? z1 : Math.min(z1, 0.5)) - z0;
    const A = 2 * (W * H + W * D + H * D);
    const rho = this.built ? builtReflectance(this.built) : 0.4;
    const E = (flux * rho) / (A * (1 - rho));
    // stanza costruita: tarata sullo scatto in path tracing (la luce rimbalzata è meno di una sfera ideale
    // e prende il colore del pavimento)
    this.ambient.intensity = E * (this.built ? 0.45 : 0.8);
    if (this.built) this.ambient.color.copy(FLOOR_TINT[this.built.floor] || new THREE.Color(1, 1, 1));
    else this.ambient.color.setRGB(1, 1, 1);
  }

  // ---------------- calibrazione dell'esposizione sulla foto ----------------
  calibrate(): { iso: number; fStop: number; shutter: number } {
    if (!this.recon || !this.material || !this.snapshot) return { iso: 800, fStop: 2.8, shutter: 1 / 50 };
    const w = 160, h = Math.round(160 / this.camera.aspect) || 90;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    const prevK = this.material.emissiveIntensity;
    this.material.emissiveIntensity = 0;
    const prevEx = this.extraMats.map((x) => x.mat.emissiveIntensity);
    this.extraMats.forEach((x) => (x.mat.emissiveIntensity = 0));
    this.syncBox();
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
    this.extraMats.forEach((x, i) => (x.mat.emissiveIntensity = prevEx[i]));
    this.syncBox();
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

  // esposizione automatica per l'interno (le finestre, molto più chiare, non contano)
  autoExposure(): { iso: number; fStop: number; shutter: number } | null {
    if (!this.snapshot) return null;
    const w = 160, h = Math.max(2, Math.round(160 / this.camera.aspect));
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    const sel = this.selBox.visible;
    this.selBox.visible = false;
    this.camera.updateMatrixWorld();
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, this.camera);
    const buf = new Float32Array(w * h * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    this.renderer.setRenderTarget(null);
    rt.dispose();
    this.selBox.visible = sel;
    const lums: number[] = [];
    for (let i = 0; i < w * h; i++) lums.push(0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2]);
    lums.sort((a, b) => a - b);
    const cut = lums.slice(Math.floor(lums.length * 0.05), Math.floor(lums.length * 0.85));
    const M = cut.reduce((a, b) => a + b, 0) / Math.max(1, cut.length);
    if (!(M > 1e-7)) return null;
    this.dirty = true;
    return this.settingsFor(0.2 / M);
  }

  settingsFor(e: number) {
    const shutter = 1 / 50;
    let fStop = 2.8;
    const ev = Math.log2(1 / (1.2 * e));
    let iso = (100 * (fStop * fStop) / shutter) / Math.pow(2, ev);
    if (iso > 12800) { fStop = FSTOPS.filter((f) => f >= 1.4).find((f) => (100 * f * f / shutter) / Math.pow(2, ev) <= 12800) || 1.4; iso = (100 * fStop * fStop / shutter) / Math.pow(2, ev); }
    if (iso < 100) { fStop = FSTOPS.find((f) => (100 * f * f / shutter) / Math.pow(2, ev) >= 100) || 22; iso = (100 * fStop * fStop / shutter) / Math.pow(2, ev); }
    const isoSnap = ISO_VALUES.reduce((a, b) => (Math.abs(Math.log2(b / iso)) < Math.abs(Math.log2(a / iso)) ? b : a));
    return { iso: isoSnap, fStop, shutter };
  }

  // ---------------- vista ----------------
  resetView() {
    if (!this.homePose) return;
    this.camera.position.copy(this.homePose.pos);
    this.camera.quaternion.copy(this.homePose.quat);
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y; this.pitch = e.x; this.homeRoll = e.z;
    this.applyLook();
    this.dirty = true;
  }

  applyLook() {
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    this.clampCamera();
    // la foto può essere storta (camera a mano): dal suo punto di vista si tiene la stessa
    // inclinazione, così la foto riempie lo schermo; allontanandosi l'orizzonte torna dritto
    const d = this.homePose ? this.camera.position.distanceTo(this.homePose.pos) : 1;
    const roll = this.homeRoll * (1 - THREE.MathUtils.smoothstep(d, 0.05, 0.8));
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, roll, 'YXZ'));
    this.camera.updateMatrixWorld();
  }

  clampCamera() {
    if (!this.recon && !this.built) return;
    const { min, max } = this.bounds;
    const p = this.camera.position;
    if (this.built) {
      // stanza costruita: si può uscire dalla stanza (le pareti davanti alla camera spariscono)
      const m = 9;
      p.x = Math.min(max[0] + m, Math.max(min[0] - m, p.x));
      p.y = Math.min(max[1] + m, Math.max(0.15, p.y));
      p.z = Math.min(max[2] + m, Math.max(min[2] - m, p.z));
      return;
    }
    p.x = Math.min(max[0] - 0.15, Math.max(min[0] + 0.15, p.x));
    p.y = Math.min(max[1] - 0.1, Math.max(0.15, p.y));
    p.z = Math.min(max[2] - 0.15, Math.max(min[2] + 0.15, p.z));
  }

  // pareti "volanti": guardando da fuori, le pareti (e il soffitto) tra la camera e la stanza
  // non si vedono e non si toccano, ma continuano a fare ombra
  cutaway = new Set<string>();
  updateCutaway(on: boolean) {
    if (!this.built) return;
    const r = this.built;
    const p = this.camera.position;
    const cut = new Set<string>();
    if (on) {
      for (const w of ['fondo', 'davanti', 'sinistra', 'destra'] as WallId[]) {
        const f = wallFrame(r, w);
        if (p.clone().sub(f.origin).dot(f.normal) < 0.02) cut.add(w);
      }
      if (p.y > r.height - 0.02) cut.add('soffitto');
    }
    if (cut.size === this.cutaway.size && [...cut].every((c) => this.cutaway.has(c))) return;
    this.cutaway = cut;
    this.room.traverse((o) => {
      const c = o.userData.cut;
      if (!c) return;
      if (cut.has(c)) o.layers.set(1); else o.layers.set(0);
    });
    this.scene.traverse((o: any) => { if (o.isLight && o.shadow) o.shadow.camera.layers.enable(1); });
  }

  isHome() {
    if (!this.homePose) return false;
    return this.camera.position.distanceTo(this.homePose.pos) < 0.02 && this.camera.quaternion.angleTo(this.homePose.quat) < 0.01;
  }

  // avanti/indietro lungo la direzione del puntatore
  dolly(amount: number, clientX?: number, clientY?: number) {
    let dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    if (clientX !== undefined && clientY !== undefined) {
      const rc = new THREE.Raycaster();
      rc.setFromCamera(this.ndc(clientX, clientY), this.camera);
      dir = rc.ray.direction.clone();
    }
    this.camera.position.addScaledVector(dir, Math.max(-1.2, Math.min(1.2, amount)));
    this.applyLook();
    this.dirty = true;
  }

  // rotella del mouse o pizzico sul trackpad (arriva come rotella con Ctrl)
  wheelZoom(e: WheelEvent) {
    if (!this.navEnabled) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const k = e.ctrlKey ? 0.02 : 0.004;
    this.dolly(-e.deltaY * unit * k, e.clientX, e.clientY);
  }

  bindNav() {
    const el = this.renderer.domElement;
    let drag: { x: number; y: number; btn: number; moved: boolean; shift: boolean; grab?: Grab | null } | null = null;
    // dita sullo schermo: due dita = pizzico per avanzare/arretrare e trascinamento per spostarsi
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; x: number; y: number } | null = null;
    const pinchState = () => {
      const [a, b] = [...touches.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (!this.navEnabled) return;
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          if (drag?.grab && drag.moved) drag.grab.end?.();
          drag = null;
          pinch = pinchState();
          el.setPointerCapture(e.pointerId);
          return;
        }
        if (touches.size > 2) return;
      }
      const grab = e.button === 0 ? this.onGrab?.(e) : null;
      drag = { x: e.clientX, y: e.clientY, btn: e.button, moved: false, shift: e.shiftKey, grab };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && touches.size >= 2 && this.navEnabled) {
          const n = pinchState();
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
          this.camera.position.addScaledVector(right, -(n.x - pinch.x) * 0.006).addScaledVector(new THREE.Vector3(0, 1, 0), (n.y - pinch.y) * 0.006);
          this.dolly((n.d - pinch.d) * 0.009, n.x, n.y);
          pinch = n;
          return;
        }
      }
      if (!drag || !this.navEnabled) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      if (drag.grab) {
        if (!drag.moved) drag.grab.start?.();
        drag.moved = true;
        drag.grab.move(e);
        this.dirty = true;
        return;
      }
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
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        if (touches.size < 2) pinch = null;
      }
      if (drag && !drag.moved) this.onClick?.(e);
      if (drag?.grab && drag.moved) drag.grab.end?.();
      drag = null;
    };
    el.addEventListener('pointermove', (e) => {
      if (drag) return;
      const g = this.onHover?.(e);
      el.style.cursor = g ? 'grab' : '';
    });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; drag = null; });
    el.addEventListener('wheel', (e) => {
      if (!this.navEnabled) return;
      e.preventDefault();
      this.wheelZoom(e);
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
  onGrab: ((e: PointerEvent) => Grab | null) | null = null;
  onHover: ((e: PointerEvent) => boolean) | null = null;
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
    const list = objects || [...this.picks, ...this.surfaces, ...this.furnitureObjects(), ...[...this.people.values()].map((p) => p.obj), ...[...this.props.values()].map((p) => p.obj)];
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
    return this.readingAt(hit.point, hit.normal);
  }

  // lettura dell'esposimetro sulla superficie dove punta una luce (tutte le luci, con le ombre)
  aimReading(L: { position: [number, number, number]; target: [number, number, number]; attached?: string }) {
    if (!this.snapshot) return null;
    const from = new THREE.Vector3(...L.position), to = new THREE.Vector3(...L.target);
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-3) return null;
    dir.normalize();
    const rc = new THREE.Raycaster(from.clone().addScaledVector(dir, 0.08), dir, 0, len + 6);
    (rc as any).firstHitOnly = true;
    const own = L.attached ? this.furn.get(L.attached)?.obj : null;
    const occ = [...this.surfaces, ...this.furnitureObjects().filter((o) => o !== own), ...[...this.people.values()].map((x) => x.obj), ...[...this.props.values()].map((x) => x.obj)];
    const hit = rc.intersectObjects(occ, true).sort((a, b) => a.distance - b.distance)[0];
    if (!hit || !hit.face) return this.readingAt(to, dir.clone().negate());
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (n.dot(dir) > 0) n.negate();
    return this.readingAt(hit.point, n);
  }

  readingAt(point: THREE.Vector3, normal: THREE.Vector3) {
    if (!this.snapshot) return null;
    const hit = { point, normal };
    const s = this.snapshot;
    const skyLux = s.sun.enabled ? sunSky(s.sun).skyLux : 0;
    const p = hit.point.clone().addScaledVector(hit.normal, 0.01);
    const occluders = [...this.surfaces, ...this.furnitureObjects(), ...[...this.people.values()].map((x) => x.obj), ...[...this.props.values()].map((x) => x.obj)];
    const rc = new THREE.Raycaster();
    (rc as any).firstHitOnly = true;
    let lux = 0;
    for (const L of this.resolveLights(s.lights)) {
      const e = illuminanceAt(L, p, hit.normal, skyLux);
      if (e <= 0) continue;
      const lp = new THREE.Vector3(...L.position);
      const dir = lp.clone().sub(p);
      const dist = dir.length();
      rc.set(p, dir.normalize());
      rc.far = dist - 0.05;
      const fr = (L as any).frameId ? this.props.get((L as any).frameId)?.obj : null;
      if (L.origin !== 'finestra' && rc.intersectObjects(fr ? occluders.filter((o) => o !== fr) : occluders, true).length) continue;
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
    // con più foto i raccordi tra primo piano e sfondo (stirati dalla prima foto) coprirebbero
    // ciò che le altre foto vedono: si mostrano solo vicino al punto di vista della prima
    if (this.fillMesh && this.recon?.extras.length && this.homePose) this.fillMesh.visible = this.camera.position.distanceTo(this.homePose.pos) < 0.35;
    this.camera.updateMatrixWorld();
    this.updateCutaway(true);
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.updateRelight();
    this.present(null);
    this.onFrame?.();
  }

  // distanza di messa a fuoco: quella scelta, oppure la prima persona inquadrata, oppure il centro
  focusDistance(): number {
    const c = this.cam;
    if (c?.focus && c.focus > 0) return c.focus;
    this.camera.updateMatrixWorld();
    for (const p of this.people.values()) {
      const j = (p.obj.userData.joints as any)?.head as THREE.Object3D | undefined;
      if (!j) continue;
      const hp = j.getWorldPosition(new THREE.Vector3());
      const v = hp.clone().project(this.camera);
      const inFront = hp.clone().applyMatrix4(this.camera.matrixWorldInverse).z < 0;
      if (inFront && Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9) return hp.distanceTo(this.camera.position);
    }
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    (rc as any).firstHitOnly = true;
    const h = rc.intersectObjects([...this.surfaces, ...this.furnitureObjects(), ...[...this.people.values()].map((p) => p.obj), ...[...this.props.values()].map((p) => p.obj)], true)[0];
    return h ? Math.max(0.3, h.distance) : 3;
  }

  // parametri della profondità di campo; false se tutto è a fuoco
  setupDof(target: { width: number; height: number }): boolean {
    const c = this.cam;
    if (!c || (!this.recon && !this.built)) return false;
    const sensor = SENSORS.find((x) => x.id === c.sensor) || SENSORS[0];
    const f = c.focal, N = c.fStop;
    const S = Math.max(this.focusDistance() * 1000, f * 1.5);
    this.focusM = S / 1000;
    const A = (f * f) / (N * (S - f));
    const fw = (this.frameRect.x1 - this.frameRect.x0) * target.width;
    const pxPerMM = fw / sensor.width;
    // sfocatura massima possibile (sfondo all'infinito): se è sotto mezzo pixel non serve
    if (0.5 * A * pxPerMM < 0.5) return false;
    const u = this.dofMat.uniforms;
    u.A.value = A; u.S.value = S; u.pxPerMM.value = pxPerMM;
    u.maxR.value = Math.max(4, Math.round(target.width / 80));
    u.texel.value.set(1 / target.width, 1 / target.height);
    return true;
  }

  // compone l'immagine finale (foto, luci, esposizione) e la profondità di campo
  present(target: THREE.WebGLRenderTarget | null) {
    const size = target || this.rt;
    if (!this.setupDof(size)) {
      this.renderer.setRenderTarget(target);
      this.renderer.render(this.quadScene, this.quadCam);
      return;
    }
    if (this.postRT.width !== size.width || this.postRT.height !== size.height) { this.postRT.setSize(size.width, size.height); this.distRT.setSize(size.width, size.height); }
    this.renderer.setRenderTarget(this.postRT);
    this.renderer.render(this.quadScene, this.quadCam);
    // distanza per pixel
    const prevBg = this.scene.background, prevOv = this.scene.overrideMaterial;
    const prevClear = this.renderer.getClearColor(new THREE.Color()), prevAlpha = this.renderer.getClearAlpha();
    this.scene.background = null; this.scene.overrideMaterial = this.distMat;
    this.renderer.setClearColor(new THREE.Color(1000, 0, 0), 1);
    this.renderer.setRenderTarget(this.distRT);
    this.renderer.render(this.scene, this.camera);
    this.scene.background = prevBg; this.scene.overrideMaterial = prevOv;
    this.renderer.setClearColor(prevClear, prevAlpha);
    const u = this.dofMat.uniforms;
    u.tColor.value = this.postRT.texture; u.tDist.value = this.distRT.texture;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.dofScene, this.quadCam);
  }

  setupRelight(recon: Reconstruction) {
    const pw = Math.min(1280, recon.photo.width), ph = Math.max(2, Math.round(pw / recon.camera.aspect));
    const mk = () => new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace });
    for (const t of [this.baseRT, this.curRT, this.maskRT]) t?.dispose();
    this.baseRT = mk(); this.curRT = mk(); this.maskRT = mk();
    this.relightPhotoTex?.dispose();
    const t = new THREE.CanvasTexture(recon.photo);
    t.colorSpace = THREE.SRGBColorSpace;
    this.relightPhotoTex = t;
    const pc = this.photoCam;
    pc.position.set(...recon.camera.position);
    pc.quaternion.set(...recon.camera.quaternion);
    pc.fov = recon.camera.fov; pc.aspect = recon.camera.aspect;
    pc.updateProjectionMatrix(); pc.updateMatrixWorld();
    const u = this.quadMat.uniforms;
    u.tPhoto.value = t; u.tBase.value = this.baseRT.texture; u.tCur.value = this.curRT.texture; u.tMask.value = this.maskRT.texture;
    u.photoProj.value.copy(pc.projectionMatrix);
    u.texel.value.set(1 / pw, 1 / ph);
    u.photoRotInv.value.setFromMatrix4(pc.matrixWorld).transpose();
    this.hasBase = false;
    u.relightW.value = 0;
  }

  // riferimento: la scena con le luci lette, come nella foto
  captureBase() {
    if (!this.baseRT) return;
    this.renderer.setRenderTarget(this.baseRT);
    this.renderer.render(this.scene, this.photoCam);
    this.renderer.setRenderTarget(null);
    this.hasBase = true;
    this.dirty = true;
  }

  updateRelight() {
    const u = this.quadMat.uniforms;
    let w = 0;
    if (this.hasBase && this.homePose && this.curRT && this.maskRT && !this.shot) {
      const d = this.camera.position.distanceTo(this.homePose.pos);
      w = 1 - THREE.MathUtils.smoothstep(d, 0.03, 0.4);
    }
    u.relightW.value = w;
    if (w <= 0) return;
    const r = this.renderer;
    r.setRenderTarget(this.curRT);
    r.render(this.scene, this.photoCam);
    // maschera: persone e oggetti aggiunti coprono la foto
    const prevBg = this.scene.background, prevOv = this.scene.overrideMaterial;
    this.scene.background = new THREE.Color(0, 0, 0);
    r.setRenderTarget(this.maskRT);
    this.scene.overrideMaterial = this.maskBlack;
    r.render(this.scene, this.photoCam);
    this.scene.overrideMaterial = this.maskWhite;
    const ac = r.autoClear; r.autoClear = false;
    this.photoCam.layers.set(1);
    r.render(this.scene, this.photoCam);
    this.photoCam.layers.set(0);
    r.autoClear = ac;
    this.scene.overrideMaterial = prevOv; this.scene.background = prevBg;
    u.photoK.value = this.K;
    u.invProj.value.copy(this.camera.projectionMatrixInverse);
    u.camRot.value.setFromMatrix4(this.camera.matrixWorld);
  }

  // ---------------- scatto ----------------
  // Lo scatto è l'anteprima a piena qualità: la foto (o la stanza ricostruita) con le luci
  // lette regolate come nell'anteprima, più le luci aggiunte calcolate in path tracing
  // (ombre morbide, rimbalzi sui colori veri della stanza). Così lo scatto ha gli stessi colori,
  // la stessa esposizione e lo stesso bilanciamento dell'anteprima, solo più pulito.
  async shoot(onProgress: (p: number) => void, samples = 384): Promise<HTMLCanvasElement | null> {
    if (this.shot || !this.snapshot) return null;
    if (this.built) return this.shootBuilt(onProgress, 600);
    const s = this.snapshot;
    const added = s.lights.filter((L) => L.on && L.origin === 'aggiunta' && effectiveLumens(L, 0) > 0);
    if (!added.length) {
      onProgress(1);
      await new Promise((r) => setTimeout(r, 30));
      return this.composeShot(null);
    }
    const ptLights = this.buildPtLights(added);
    this.scene.remove(this.rasterLights);
    this.scene.add(ptLights);
    ptLights.updateMatrixWorld(true);
    this.initPT();
    this.pt.bounces = 4;
    // solo la luce delle sorgenti aggiunte: la stanza non emette (la sua luce è già nella foto)
    const saved: [THREE.MeshStandardMaterial, number][] = [];
    const roomMats = [this.material, this.blurMaterial, (this.room.getObjectByName('scatola') as THREE.Mesh)?.userData.backMat, ...this.panes.map((p) => p.mesh.material), ...this.extraMats.map((x) => x.mat), ...this.boxMats.map((x) => x[0])].filter(Boolean) as THREE.MeshStandardMaterial[];
    for (const m of roomMats) { saved.push([m, m.emissiveIntensity]); m.emissiveIntensity = 0; }
    this.shotRestore = () => { for (const [m, ei] of saved) m.emissiveIntensity = ei; };
    const prevBg = this.scene.background;
    this.scene.background = new THREE.Color(0, 0, 0);
    this.scene.environment = null;
    return this.startPT(onProgress, samples, ptLights, prevBg);
  }

  // stanza costruita: tutta la scena in path tracing (luci, lampade, sole e cielo dalle finestre)
  async shootBuilt(onProgress: (p: number) => void, samples: number): Promise<HTMLCanvasElement | null> {
    const s = this.snapshot!;
    const list = s.lights.filter((L) => L.on && L.origin !== 'finestra' && effectiveLumens(L, 0) > 0);
    const ptLights = this.buildPtLights(list);
    if (this.sun.visible && this.sun.intensity > 0) {
      const d = new THREE.DirectionalLight(this.sun.color.clone(), this.sun.intensity);
      d.position.copy(this.sun.position);
      const t = new THREE.Object3D(); t.position.copy(this.sun.target.position);
      ptLights.add(t); d.target = t;
      ptLights.add(d);
    }
    this.scene.remove(this.rasterLights);
    this.scene.add(ptLights);
    ptLights.updateMatrixWorld(true);
    this.initPT();
    this.pt.bounces = 4;
    // le lampadine stanno dentro la loro luce: nel path tracing la nasconderebbero
    const hidden: THREE.Object3D[] = [];
    for (const o of this.furn.values()) o.obj.traverse((m: any) => { if (m.userData.bulb && m.visible) { m.visible = false; hidden.push(m); } });
    // paralumi: nel path tracing il bagliore emissivo darebbe macchie (lo trova solo per caso);
    // il tessuto lascia invece passare un quarto della luce della lampadina, e il bagliore visibile
    // si aggiunge alla fine come le lampadine
    const shades: { m: THREE.MeshStandardMaterial; t: boolean; o: number }[] = [];
    for (const o of this.furn.values()) o.obj.traverse((x: any) => {
      if (!x.isMesh || !x.userData.glow) return;
      const m = x.material as THREE.MeshStandardMaterial;
      if (shades.some((q) => q.m === m)) return;
      shades.push({ m, t: m.transparent, o: m.opacity });
      m.userData.glowI = m.emissiveIntensity;
      m.emissiveIntensity = 0; m.transparent = true; m.opacity = 0.75;
    });
    // i teli di diffusione: la loro luce è già la sorgente virtuale
    const frameMats: THREE.MeshStandardMaterial[] = [];
    for (const o of this.props.values()) if (o.state.kind === 'diffusore') { const m = (o.obj.getObjectByName('pannello') as THREE.Mesh).material as THREE.MeshStandardMaterial; m.emissiveIntensity = 0; frameMats.push(m); }
    // fotografando da fuori, le pareti tra camera e stanza si tolgono (come le pareti mobili sul set)
    this.camera.updateMatrixWorld();
    this.updateCutaway(true);
    this.room.traverse((m: any) => { if (m.isMesh && m.userData.cut && this.cutaway.has(m.userData.cut) && m.visible) { m.visible = false; hidden.push(m); } });
    const selVis = this.selBox.visible;
    this.selBox.visible = false;
    const prevBg = this.scene.background;
    this.scene.environment = this.skyTex;
    this.scene.environmentIntensity = 1;
    this.shotRestore = () => {
      for (const m of hidden) m.visible = true;
      for (const m of frameMats) m.emissiveIntensity = m.userData.glow || 0;
      for (const q of shades) { q.m.emissiveIntensity = q.m.userData.glowI || 0; q.m.transparent = q.t; q.m.opacity = q.o; }
      this.scene.environment = null;
      this.selBox.visible = selVis;
    };
    return this.startPT(onProgress, samples, ptLights, prevBg);
  }

  initPT() {
    if (!this.pt) {
      this.pt = new WebGLPathTracer(this.renderer);
      this.pt.tiles.set(2, 2);
      this.pt.minSamples = 1;
      this.pt.renderDelay = 0;
      this.pt.fadeDuration = 0;
      this.pt.dynamicLowRes = false;
      this.pt.filterGlossyFactor = 0.5;
      this.pt.textureSize.set(2048, 2048);
      // durante il calcolo resta a schermo l'anteprima
      this.pt.renderToCanvas = false;
      this.pt.rasterizeScene = false;
    }
    this.pt.multipleImportanceSampling = true;
    // leggero per la scheda video: al massimo ~0,9 megapixel calcolati (il resto lo fa il filtro
    // del rumore e l'ingrandimento), a pezzetti piccoli così il computer resta reattivo
    const W = this.rt.width, H = this.rt.height;
    this.pt.renderScale = Math.min(1, Math.sqrt(900000 / Math.max(1, W * H)));
    const px = W * H * this.pt.renderScale * this.pt.renderScale;
    const t = px > 500000 ? 4 : px > 200000 ? 3 : 2;
    this.pt.tiles.set(t, t);
    this.renderer.toneMapping = THREE.NoToneMapping;
  }

  async startPT(onProgress: (p: number) => void, samples: number, ptLights: THREE.Group, prevBg: any): Promise<HTMLCanvasElement | null> {
    this.ambient.visible = false;
    try {
      await new Promise((r) => setTimeout(r, 30));
      this.pt.setScene(this.scene, this.camera);
    } catch (e) {
      console.error(e);
      this.finishShot(ptLights, prevBg);
      return this.composeShot(null);
    }
    this.pt.reset();
    return new Promise((resolve) => {
      this.shot = { target: samples, start: performance.now(), onProgress, resolve, ptLights };
      (this.shot as any).prevBg = prevBg;
    });
  }

  buildPtLights(raw: LightState[]) {
    const ptLights = new THREE.Group();
    const list = this.resolveLights(raw);
    for (const L of list) {
      const fx = fixtureById(L.fixtureId);
      const lm = effectiveLumens(L, 0);
      const color = lightColor(L.kelvin, L.gel);
      const pos = new THREE.Vector3(...L.position), tgt = new THREE.Vector3(...L.target);
      if (fx.kind === 'area') {
        const w = L.size[0] * (1 + L.softness), h = L.size[1] * (1 + L.softness);
        const al = new THREE.RectAreaLight(color, lm / (Math.PI * w * h), w, h);
        al.position.copy(pos);
        al.lookAt(tgt);
        ptLights.add(al);
        // telo di diffusione: illuminato da dietro brilla anche verso la lampada (la parte riflessa)
        if ((L as any).frameId) {
          const back = new THREE.RectAreaLight(color, (lm * 0.4) / (Math.PI * w * h), w, h);
          const out = tgt.clone().sub(pos).normalize();
          back.position.copy(pos).addScaledVector(out, -0.06);
          back.lookAt(back.position.clone().sub(out));
          ptLights.add(back);
        }
      } else if (fx.kind === 'spot') {
        const { beam, field } = spotAngles(L);
        const sl = new PhysicalSpotLight(color, spotCandela(lm, beam));
        sl.angle = THREE.MathUtils.degToRad(Math.min(170, field) / 2);
        sl.penumbra = Math.min(1, Math.max(0.05, 1 - beam / field));
        sl.decay = 2; sl.distance = 0;
        // la diffusione sulla lente rende la sorgente grande quanto la lente
        sl.radius = (fx.radius || 0.05) * (1 + L.softness * 3) + diffusionById(L.diffusion).spread * 0.15;
        sl.position.copy(pos);
        const t = new THREE.Object3D(); t.position.copy(tgt); ptLights.add(t); sl.target = t;
        ptLights.add(sl);
      } else {
        const pl = new THREE.PointLight(color, lm / (4 * Math.PI), 0, 2);
        (pl as any).radius = (fx.radius || 0.03) * (1 + L.softness * 3) + diffusionById(L.diffusion).spread * 0.08;
        pl.position.copy(pos);
        ptLights.add(pl);
      }
    }
    return ptLights;
  }

  tickShot() {
    const sh = this.shot!;
    this.pt.renderSample();
    const smp = this.pt.samples;
    const elapsed = (performance.now() - sh.start) / 1000;
    const cap = Number(new URLSearchParams(location.search).get('cap')) || (this.built ? 45 : 120);
    const p = Math.min(1, Math.max(smp / sh.target, elapsed / cap));
    (window as any).__ptSamples = smp;
    sh.onProgress(Math.min(0.99, p));
    if (p >= 1) {
      const add = this.built ? this.denoisedShot() : this.readAdded();
      const resolve = sh.resolve;
      this.finishShot(sh.ptLights, (sh as any).prevBg);
      resolve(this.composeShot(add));
    }
  }

  // stanza costruita: path tracing ripulito dal rumore con l'aiuto di colore, normali e distanze
  denoisedShot(): THREE.Texture | null {
    try {
      const tgt = this.pt.target as THREE.WebGLRenderTarget;
      const W = tgt.width, H = tgt.height;
      if (!W || !H) return null;
      const mk = () => new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, colorSpace: THREE.LinearSRGBColorSpace });
      const alb = mk(), nrm = mk(), dist = mk();
      const prevBg = this.scene.background, prevEnv = this.scene.environment, prevOv = this.scene.overrideMaterial;
      const prevClear = this.renderer.getClearColor(new THREE.Color()), prevAlpha = this.renderer.getClearAlpha();
      this.scene.background = null; this.scene.environment = null;
      this.camera.updateMatrixWorld();
      // colore delle superfici
      const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
      const basics: THREE.Material[] = [];
      this.scene.traverse((o: any) => {
        if (!o.isMesh || Array.isArray(o.material)) return;
        const m = o.material as THREE.MeshStandardMaterial;
        const b = new THREE.MeshBasicMaterial({ color: m.color ? m.color.clone() : new THREE.Color(1, 1, 1), map: m.map || null, side: m.side, visible: m.visible });
        if (m.emissiveIntensity > 0 && !m.map && (m.color?.r ?? 1) > 0.8) b.color.setRGB(1, 1, 1);
        swapped.push([o, o.material]); basics.push(b);
        o.material = b;
      });
      this.renderer.setClearColor(new THREE.Color(1, 1, 1), 1);
      this.renderer.setRenderTarget(alb); this.renderer.render(this.scene, this.camera);
      for (const [o, m] of swapped) o.material = m;
      basics.forEach((b) => b.dispose());
      // sorgenti visibili che il path tracing non vede direttamente (lampadine, teli di diffusione illuminati)
      const emit = mk();
      const swapped2: [THREE.Mesh, THREE.Material | THREE.Material[], boolean][] = [];
      const black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
      const emitMats: THREE.Material[] = [black];
      this.scene.traverse((o: any) => {
        if (!o.isMesh || Array.isArray(o.material)) return;
        const m = o.material as THREE.MeshStandardMaterial;
        const wasVis = o.visible;
        let mat: THREE.Material = black;
        if (o.userData.bulb) { o.visible = true; mat = new THREE.MeshBasicMaterial({ color: m.emissive.clone().multiplyScalar(m.emissiveIntensity) }); emitMats.push(mat); }
        else if (o.userData.glow && m.userData?.glowI) { mat = new THREE.MeshBasicMaterial({ color: m.emissive.clone().multiplyScalar(m.userData.glowI) }); emitMats.push(mat); }
        else if (o.parent?.userData?.propId && o.name === 'pannello' && m.userData?.glow) { mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(m.userData.glow), side: THREE.DoubleSide }); emitMats.push(mat); }
        swapped2.push([o, o.material, wasVis]);
        o.material = mat;
      });
      this.renderer.setClearColor(new THREE.Color(0, 0, 0), 1);
      this.renderer.setRenderTarget(emit); this.renderer.render(this.scene, this.camera);
      for (const [o, m, v] of swapped2) { o.material = m; o.visible = v; }
      emitMats.forEach((b) => b.dispose());
      // normali e distanze
      const nm = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
      this.scene.overrideMaterial = nm;
      this.renderer.setClearColor(new THREE.Color(0.5, 0.5, 1), 1);
      this.renderer.setRenderTarget(nrm); this.renderer.render(this.scene, this.camera);
      this.scene.overrideMaterial = this.distMat;
      this.renderer.setClearColor(new THREE.Color(1000, 0, 0), 1);
      this.renderer.setRenderTarget(dist); this.renderer.render(this.scene, this.camera);
      nm.dispose();
      this.scene.overrideMaterial = prevOv; this.scene.background = prevBg; this.scene.environment = prevEnv;
      this.renderer.setClearColor(prevClear, prevAlpha);
      const out = denoise(this.renderer, tgt.texture, alb.texture, nrm.texture, dist.texture, W, H, emit.texture, this.pt.samples);
      alb.dispose(); nrm.dispose(); dist.dispose(); emit.dispose();
      this.tmpRT = out;
      return out.texture;
    } catch (e) {
      console.warn(e);
      this.renderer.setRenderTarget(null);
      return this.readAdded();
    }
  }

  // contributo delle luci aggiunte (lineare), ripulito dai puntini isolati
  readAdded(): THREE.DataTexture | null {
    try {
      const tgt = this.pt.target as THREE.WebGLRenderTarget;
      const W = tgt.width, H = tgt.height;
      if (!W || !H) return null;
      const buf = new Float32Array(W * H * 4);
      this.renderer.readRenderTargetPixels(tgt, 0, 0, W, H, buf);
      defirefly(buf, W, H);
      const tex = new THREE.DataTexture(buf, W, H, THREE.RGBAFormat, THREE.FloatType);
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      return tex;
    } catch (e) {
      console.warn(e);
      return null;
    }
  }

  // compone lo scatto: anteprima senza le luci aggiunte + luci aggiunte in path tracing
  composeShot(add: THREE.Texture | null): HTMLCanvasElement | null {
    const s = this.snapshot;
    if (!s) return null;
    const hidden: THREE.Light[] = [];
    const builtPT = !!(this.built && add);
    if (add && !builtPT) {
      for (const o of this.lightObjs.values()) if (o.state.origin === 'aggiunta' && o.raster.visible) { o.raster.visible = false; hidden.push(o.raster); }
      // luce indiretta stimata solo dalle luci rimaste (quella delle aggiunte è nel path tracing)
      this.snapshot = { ...s, lights: s.lights.filter((L) => L.origin !== 'aggiunta') };
      this.updateIndirect();
      this.snapshot = s;
    }
    const u = this.quadMat.uniforms;
    const W = this.rt.width, H = this.rt.height;
    const out = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType });
    let canvas: HTMLCanvasElement | null = null;
    try {
      this.camera.updateMatrixWorld();
      if (builtPT) {
        // l'immagine è tutta nel path tracing
        u.tDiffuse.value = add;
      } else {
        this.renderer.setRenderTarget(this.rt);
        this.renderer.render(this.scene, this.camera);
        this.updateRelight();
        u.tAdd.value = add; u.addW.value = add ? 1 : 0;
      }
      const prevMask = u.maskAlpha.value; u.maskAlpha.value = 1;
      const prevFc = u.falseColor.value; u.falseColor.value = 0;
      this.present(out);
      u.maskAlpha.value = prevMask; u.falseColor.value = prevFc;
      const px = new Uint8Array(W * H * 4);
      this.renderer.readRenderTargetPixels(out, 0, 0, W, H, px);
      const fr = this.frameRect;
      const x0 = Math.round(fr.x0 * W), y0 = Math.round(fr.y0 * H);
      const w = Math.max(1, Math.round((fr.x1 - fr.x0) * W)), h = Math.max(1, Math.round((fr.y1 - fr.y0) * H));
      canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      const img = ctx.createImageData(w, h);
      // il buffer è dal basso verso l'alto; il rettangolo del formato è in coordinate UV (y in basso)
      for (let y = 0; y < h; y++) {
        const src = ((y0 + h - 1 - y) * W + x0) * 4;
        img.data.set(px.subarray(src, src + w * 4), y * w * 4);
      }
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      ctx.putImageData(img, 0, 0);
    } catch (e) {
      console.warn(e);
    } finally {
      this.renderer.setRenderTarget(null);
      out.dispose();
      u.tAdd.value = null; u.addW.value = 0;
      u.tDiffuse.value = this.rt.texture;
      if (this.tmpRT) { this.tmpRT.dispose(); this.tmpRT = null; } else add?.dispose();
      for (const l of hidden) l.visible = true;
      if (add && !builtPT) this.updateIndirect();
      this.dirty = true;
    }
    return canvas;
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

// toglie i puntini isolati (fireflies) rimasti dal path tracing, sul buffer lineare
function defirefly(buf: Float32Array, W: number, H: number) {
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
  const nb = new Float32Array(8);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) nb[n++] = lum[i + dy * W + dx];
    nb.sort();
    const med = (nb[3] + nb[4]) / 2;
    if (lum[i] > med * 3 + 1e-4 && lum[i] > nb[6] * 1.5) {
      const k = lum[i] > 0 ? (nb[6] / lum[i]) : 0;
      for (let c = 0; c < 3; c++) buf[i * 4 + c] *= k;
    }
  }
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
  else if (p.kind === 'diffusore') mat = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
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

// riflettanza media della stanza costruita (per la luce indiretta stimata dell'anteprima)
const WALL_RHO: Record<string, number> = { bianco: 0.72, grigio: 0.42, sabbia: 0.55, salvia: 0.36, terracotta: 0.2, notte: 0.05, nero: 0.03, mattoni: 0.18 };
const FLOOR_RHO: Record<string, number> = { rovere: 0.35, noce: 0.1, cemento: 0.3, piastrelle: 0.6, marmo: 0.7, moquette: 0.15 };
const FLOOR_TINT: Record<string, THREE.Color> = {
  rovere: new THREE.Color(1.08, 0.97, 0.85), noce: new THREE.Color(1.06, 0.97, 0.9), moquette: new THREE.Color(1, 1, 1),
  cemento: new THREE.Color(1, 1, 0.98), piastrelle: new THREE.Color(1.02, 1, 0.97), marmo: new THREE.Color(1, 1, 1),
};
function builtReflectance(r: RoomSpec) {
  const Aw = 2 * (r.width + r.depth) * r.height, Af = r.width * r.depth;
  return Math.min(0.75, ((WALL_RHO[r.wall] ?? 0.5) * Aw + (FLOOR_RHO[r.floor] ?? 0.3) * Af + 0.78 * Af) / (Aw + 2 * Af));
}
