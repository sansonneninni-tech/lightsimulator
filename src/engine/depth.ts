// Stima della profondità da una foto, nel browser.
// Usa Depth Anything V2 (ONNX Runtime Web, WebGPU o WASM). Se il modello non è raggiungibile,
// ripiega su una stima geometrica "a stanza" così l'app funziona sempre.

export interface DepthResult {
  width: number;
  height: number;
  data: Float32Array; // disparità relativa (più grande = più vicino) oppure profondità metrica se metric=true
  metric: boolean;
  source: 'modello' | 'stima';
}

const MODEL_URLS_GPU = [
  './models/depth.onnx',
  'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_fp16.onnx',
  'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx',
];
const MODEL_URLS_CPU = [
  './models/depth.onnx',
  'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx',
  'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx',
];

let sessionPromise: Promise<any> | null = null;

async function fetchModel(url: string, onProgress?: (p: number, msg: string) => void): Promise<ArrayBuffer> {
  const cache = typeof caches !== 'undefined' ? await caches.open('lightsim-models').catch(() => null) : null;
  const abs = new URL(url, location.href).href;
  const hit = cache ? await cache.match(abs) : null;
  if (hit) return hit.arrayBuffer();
  const res = await fetch(abs);
  if (!res.ok || !res.body) throw new Error(`modello non trovato: ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (type.includes('text/html')) throw new Error('non è un modello');
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); loaded += value.length;
    if (total) onProgress?.(loaded / total, 'Preparo il lettore di profondità');
  }
  const buf = new Uint8Array(loaded);
  let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
  if (loaded < 1e6) throw new Error('modello troppo piccolo');
  cache?.put(abs, new Response(buf.slice().buffer)).catch(() => {});
  return buf.buffer;
}

async function getSession(onProgress?: (p: number, msg: string) => void) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort: any = await import('onnxruntime-web/webgpu');
      ort.env.wasm.numThreads = (self as any).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
      const gpu = 'gpu' in navigator && !!(await (navigator as any).gpu?.requestAdapter?.().catch(() => null));
      const custom = new URLSearchParams(location.search).get('model');
      const urls = custom ? [custom] : gpu ? MODEL_URLS_GPU : MODEL_URLS_CPU;
      let lastErr: any;
      for (const url of urls) {
        try {
          const buf = await fetchModel(url, onProgress);
          for (const ep of gpu ? ['webgpu', 'wasm'] : ['wasm']) {
            try {
              const s = await ort.InferenceSession.create(buf, { executionProviders: [ep], graphOptimizationLevel: 'all' });
              return { ort, s };
            } catch (e) { lastErr = e; console.warn('Sessione non creata con', ep, e); }
          }
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error('nessun modello');
    })();
    sessionPromise.catch(() => { sessionPromise = null; });
  }
  return sessionPromise;
}

async function runModel(canvas: HTMLCanvasElement, onProgress?: (p: number, msg: string) => void): Promise<DepthResult> {
  const { ort, s } = await withTimeout(getSession(onProgress), 180000);
  onProgress?.(1, 'Leggo la profondità');
  const meta = s.inputMetadata?.[0] || (s.inputMetadata && s.inputMetadata[s.inputNames[0]]);
  const shape = meta?.shape as any[] | undefined;
  let H = 518, W = 518;
  const fixed = shape && typeof shape[2] === 'number' && typeof shape[3] === 'number';
  if (fixed) { H = shape![2]; W = shape![3]; }
  else {
    const aspect = canvas.width / canvas.height;
    if (aspect >= 1) { H = 518; W = Math.round((518 * aspect) / 14) * 14; } else { W = 518; H = Math.round(518 / aspect / 14) * 14; }
  }
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const input = new Float32Array(3 * W * H);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < W * H; i++) for (let ch = 0; ch < 3; ch++) input[ch * W * H + i] = (px[i * 4 + ch] / 255 - mean[ch]) / std[ch];
  const feeds: any = { [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, H, W]) };
  const out = await s.run(feeds);
  const t = out[s.outputNames[0]];
  const dims = t.dims;
  const oh = dims[dims.length - 2], ow = dims[dims.length - 1];
  let data: Float32Array;
  if (t.type === 'float16') {
    const u = t.data as Uint16Array; data = new Float32Array(u.length);
    for (let i = 0; i < u.length; i++) data[i] = half(u[i]);
  } else data = Float32Array.from(t.data as Float32Array);
  return { width: ow, height: oh, data, metric: false, source: 'modello' };
}

function half(h: number) {
  const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

export async function estimateDepth(canvas: HTMLCanvasElement, onProgress?: (p: number, msg: string) => void): Promise<DepthResult> {
  const forced = new URLSearchParams(location.search).get('depth');
  if (forced !== 'stima') {
    try {
      return await runModel(canvas, onProgress);
    } catch (e) {
      console.warn('Profondità dal modello non disponibile, uso la stima geometrica', e);
    }
  }
  return geometricDepth(canvas);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const id = setTimeout(() => rej(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(id); res(v); }, (e) => { clearTimeout(id); rej(e); });
  });
}

export function downscale(src: HTMLCanvasElement | HTMLImageElement | ImageBitmap, maxSide: number) {
  const w = (src as any).width, h = (src as any).height;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src as any, 0, 0, c.width, c.height);
  return c;
}

// Stima geometrica: stanza a scatola vista da una camera a 1.6 m, orizzonte al centro.
function geometricDepth(canvas: HTMLCanvasElement): DepthResult {
  const w = 256, h = Math.max(2, Math.round((256 * canvas.height) / canvas.width));
  const data = new Float32Array(w * h);
  const aspect = canvas.width / canvas.height;
  const tanH = Math.tan((65 * Math.PI) / 360);
  const tanV = tanH / aspect;
  const camH = 1.6, ceil = 2.8, halfW = 2.6, depth = 5.5;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const dx = ((i + 0.5) / w) * 2 - 1;
      const dy = 1 - ((j + 0.5) / h) * 2;
      const rx = dx * tanH, ry = dy * tanV; // raggio (rx, ry, -1)
      let t = depth;
      if (ry < 0) t = Math.min(t, camH / -ry);
      if (ry > 0) t = Math.min(t, (ceil - camH) / ry);
      if (rx !== 0) t = Math.min(t, halfW / Math.abs(rx));
      data[j * w + i] = t; // profondità lungo -Z
    }
  }
  return { width: w, height: h, data, metric: true, source: 'stima' };
}

// Lettura EXIF minima: FocalLengthIn35mmFilm (0xA405) e Orientation (0x0112)
export function readExif(buf: ArrayBuffer): { focal35?: number; orientation?: number } {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return {};
    let off = 2;
    while (off < v.byteLength - 4) {
      const marker = v.getUint16(off);
      const len = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {
        const tiff = off + 10;
        const le = v.getUint16(tiff) === 0x4949;
        const u16 = (o: number) => v.getUint16(o, le);
        const u32 = (o: number) => v.getUint32(o, le);
        const res: { focal35?: number; orientation?: number } = {};
        const readIFD = (ifd: number, cb: (tag: number, entry: number) => void) => {
          const n = u16(ifd);
          for (let k = 0; k < n; k++) cb(u16(ifd + 2 + k * 12), ifd + 2 + k * 12);
        };
        let exifIFD = 0;
        readIFD(tiff + u32(tiff + 4), (tag, e) => {
          if (tag === 0x0112) res.orientation = u16(e + 8);
          if (tag === 0x8769) exifIFD = tiff + u32(e + 8);
        });
        if (exifIFD) readIFD(exifIFD, (tag, e) => { if (tag === 0xa405) res.focal35 = u16(e + 8); });
        return res;
      }
      if ((marker & 0xff00) !== 0xff00) break;
      off += 2 + len;
    }
  } catch { /* ignora */ }
  return {};
}
