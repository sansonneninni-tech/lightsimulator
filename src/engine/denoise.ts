// Pulizia del rumore del path tracing (stile SVGF, solo spaziale): si separa la luce dal colore
// delle superfici, si sfuma la luce rispettando bordi, normali, distanze e ombre, poi si rimette il colore.
import * as THREE from 'three';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DEMOD = `
precision highp float;
uniform sampler2D tPT; uniform sampler2D tAlb; uniform sampler2D tDist; uniform vec2 texel;
varying vec2 vUv;
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 irr(vec2 uv){
  vec3 a = texture2D(tAlb, uv).rgb;
  return texture2D(tPT, uv).rgb / max(a, vec3(0.03));
}
void main(){
  float d = texture2D(tDist, vUv).r;
  vec3 c = irr(vUv);
  if (d > 500.0) { gl_FragColor = vec4(texture2D(tPT, vUv).rgb, 0.0); return; }
  // varianza locale della luminanza (3x3) e taglio dei puntini isolati
  float m = 0.0, m2 = 0.0, mx = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
    if (i == 0 && j == 0) continue;
    float l = lum(irr(vUv + vec2(float(i), float(j)) * texel));
    m += l; m2 += l * l; mx = max(mx, l);
  }
  m /= 8.0; m2 /= 8.0;
  float l0 = lum(c);
  float cap = max(mx, m * 3.0) + 1e-6;
  if (l0 > cap) c *= cap / l0;
  float l = lum(c);
  float v = max(0.0, (m2 + l * l) / 2.0 - pow((m * 8.0 + l) / 9.0, 2.0));
  gl_FragColor = vec4(c, v);
}`;

const ATROUS = `
precision highp float;
uniform sampler2D tIn; uniform sampler2D tNrm; uniform sampler2D tDist; uniform vec2 texel; uniform float stepW; uniform float sigL;
varying vec2 vUv;
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main(){
  vec4 cp = texture2D(tIn, vUv);
  float zp = texture2D(tDist, vUv).r;
  if (zp > 500.0) { gl_FragColor = cp; return; }
  vec3 np = texture2D(tNrm, vUv).rgb * 2.0 - 1.0;
  // varianza ammorbidita 3x3
  float vb = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) vb += texture2D(tIn, vUv + vec2(float(i), float(j)) * texel).a;
  vb /= 9.0;
  float lp = lum(cp.rgb);
  float k[3]; k[0] = 0.375; k[1] = 0.25; k[2] = 0.0625;
  vec3 sum = vec3(0.0); float wsum = 0.0; float vsum = 0.0;
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
    vec2 uv = vUv + vec2(float(i), float(j)) * texel * stepW;
    vec4 cq = texture2D(tIn, uv);
    float zq = texture2D(tDist, uv).r;
    if (zq > 500.0) continue;
    vec3 nq = texture2D(tNrm, uv).rgb * 2.0 - 1.0;
    float h = k[abs(i)] * k[abs(j)];
    float wz = exp(-abs(zp - zq) / (0.012 * zp * stepW + 0.002));
    float wn = pow(max(0.0, dot(np, nq)), 48.0);
    float wl = exp(-abs(lp - lum(cq.rgb)) / (sigL * sqrt(vb) + 1e-5 + 0.002 * lp));
    float w = h * wz * wn * wl;
    sum += cq.rgb * w; wsum += w; vsum += w * w * cq.a;
  }
  if (wsum < 1e-8) { gl_FragColor = cp; return; }
  gl_FragColor = vec4(sum / wsum, vsum / (wsum * wsum));
}`;

const REMOD = `
precision highp float;
uniform sampler2D tIn; uniform sampler2D tAlb; uniform sampler2D tDist; uniform sampler2D tEmit;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tIn, vUv).rgb;
  vec3 e = texture2D(tEmit, vUv).rgb;
  if (texture2D(tDist, vUv).r > 500.0) { gl_FragColor = vec4(c + e, 1.0); return; }
  gl_FragColor = vec4(c * max(texture2D(tAlb, vUv).rgb, vec3(0.03)) + e, 1.0);
}`;

export function denoise(renderer: THREE.WebGLRenderer, pt: THREE.Texture, alb: THREE.Texture, nrm: THREE.Texture, dist: THREE.Texture, W: number, H: number, emit: THREE.Texture, samples = 1000) {
  const mk = () => new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, colorSpace: THREE.LinearSRGBColorSpace });
  const A = mk(), B = mk();
  // il risultato si ingrandisce alla risoluzione dello schermo: filtro lineare
  if (renderer.extensions.has('OES_texture_float_linear')) for (const t of [A, B]) { t.texture.magFilter = THREE.LinearFilter; t.texture.minFilter = THREE.LinearFilter; }
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const texel = new THREE.Vector2(1 / W, 1 / H);
  const run = (frag: string, uniforms: Record<string, any>, target: THREE.WebGLRenderTarget) => {
    const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    quad.material = m;
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
    m.dispose();
  };
  run(DEMOD, { tPT: { value: pt }, tAlb: { value: alb }, tDist: { value: dist }, texel: { value: texel } }, A);
  let src = A, dst = B;
  // con pochi passaggi (schede video lente) il rumore è più forte: filtro più largo e più tollerante
  const few = samples < 150;
  const steps = few ? [1, 2, 4, 8, 16, 32, 64] : [1, 2, 4, 8, 16];
  const sigL = few ? 4 + 8 * (1 - samples / 150) : 4;
  for (let i = 0; i < steps.length; i++) {
    run(ATROUS, { tIn: { value: src.texture }, tNrm: { value: nrm }, tDist: { value: dist }, texel: { value: texel }, stepW: { value: steps[i] }, sigL: { value: sigL } }, dst);
    [src, dst] = [dst, src];
  }
  run(REMOD, { tIn: { value: src.texture }, tAlb: { value: alb }, tDist: { value: dist }, tEmit: { value: emit } }, dst);
  renderer.setRenderTarget(null);
  src.dispose();
  quad.geometry.dispose();
  return dst;
}
