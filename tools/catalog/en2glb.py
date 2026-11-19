# model.json + mesh.bin (+jpg/png) -> .glb  (formato enlistedv2: header 12B 'NSM1',nv,ni; vert 12 float: pos3 nrm3 tan4 uv2; idx u32)
import json, os, struct, sys
import numpy as np
FLIPV = int(os.environ.get('FLIPV', '0'))
def conv(d, out):
    m = json.load(open(os.path.join(d, 'model.json')))
    b = open(os.path.join(d, 'mesh.bin'), 'rb').read()
    _, nv, ni = struct.unpack('<3I', b[:12])
    v = np.frombuffer(b[12:12 + nv * 48], np.float32).reshape(nv, 12).copy()
    idx = np.frombuffer(b[12 + nv * 48:12 + nv * 48 + ni * 4], np.uint32)
    pos, nrm, tan, uv = v[:, 0:3], v[:, 3:6], v[:, 6:10], v[:, 10:12].copy()
    if FLIPV: uv[:, 1] = 1 - uv[:, 1]
    nl = np.linalg.norm(nrm, axis=1, keepdims=True); nl[nl == 0] = 1; nrm = nrm / nl
    tl = np.linalg.norm(tan[:, :3], axis=1, keepdims=True); tl[tl == 0] = 1; tan[:, :3] /= tl
    tan[:, 3] = np.where(tan[:, 3] < 0, -1, 1)
    blob = bytearray(); views = []; acc = []
    def add(arr, target=None):
        while len(blob) % 4: blob.append(0)
        o = len(blob); bb = arr.tobytes(); blob.extend(bb)
        vw = {'buffer': 0, 'byteOffset': o, 'byteLength': len(bb)}
        if target: vw['target'] = target
        views.append(vw); return len(views) - 1
    def accessor(arr, typ, ctype, target, mm=False):
        a = {'bufferView': add(arr, target), 'componentType': ctype, 'count': len(arr), 'type': typ}
        if mm: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        acc.append(a); return len(acc) - 1
    aP = accessor(pos.astype(np.float32), 'VEC3', 5126, 34962, True)
    aN = accessor(nrm.astype(np.float32), 'VEC3', 5126, 34962)
    aT = accessor(tan.astype(np.float32), 'VEC4', 5126, 34962)
    aU = accessor(uv.astype(np.float32), 'VEC2', 5126, 34962)
    images = []; textures = []; imgmap = {}
    def tex(fn):
        if fn in imgmap: return imgmap[fn]
        p = os.path.join(d, fn)
        if not os.path.exists(p): return None
        iv = add(np.frombuffer(open(p, 'rb').read(), np.uint8))
        images.append({'bufferView': iv, 'mimeType': 'image/png' if fn.endswith('.png') else 'image/jpeg'})
        textures.append({'source': len(images) - 1}); imgmap[fn] = len(textures) - 1; return imgmap[fn]
    mats = []; prims = []
    for p in m['parts']:
        mm = m['materials'][p['mat']]
        mat = {'name': mm.get('name', 'm'), 'pbrMetallicRoughness': {'baseColorFactor': p['base'], 'metallicFactor': p['metal'], 'roughnessFactor': p['rough']}}
        if p.get('textured', True):
            if mm.get('albedo') and tex(mm['albedo']) is not None: mat['pbrMetallicRoughness']['baseColorTexture'] = {'index': tex(mm['albedo'])}
            if mm.get('mr') and tex(mm['mr']) is not None:
                mat['pbrMetallicRoughness']['metallicRoughnessTexture'] = {'index': tex(mm['mr'])}
                mat['occlusionTexture'] = {'index': tex(mm['mr'])}
            if mm.get('normal') and tex(mm['normal']) is not None: mat['normalTexture'] = {'index': tex(mm['normal'])}
        if mm.get('cutout'): mat['alphaMode'] = 'MASK'; mat['alphaCutoff'] = 0.5; mat['doubleSided'] = True
        mats.append(mat)
        sub = idx[p['first']:p['first'] + p['count']].astype(np.uint32)
        aI = accessor(sub, 'SCALAR', 5125, 34963)
        prims.append({'attributes': {'POSITION': aP, 'NORMAL': aN, 'TANGENT': aT, 'TEXCOORD_0': aU}, 'indices': aI, 'material': len(mats) - 1})
    while len(blob) % 4: blob.append(0)
    g = {'asset': {'version': '2.0', 'generator': 'en2glb'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
         'nodes': [{'mesh': 0, 'name': os.path.basename(d)}], 'meshes': [{'primitives': prims}], 'materials': mats,
         'accessors': acc, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
    if images: g['images'] = images; g['textures'] = textures; g['samplers'] = [{}]
    js = json.dumps(g).encode();
    while len(js) % 4: js += b' '
    with open(out, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(blob)
    return [round(float(x), 4) for x in (pos.max(0) - pos.min(0))], [round(float(x), 4) for x in pos.min(0)]
if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
    info = {}
    for n in sorted(os.listdir(src)):
        try:
            s, mn = conv(os.path.join(src, n), os.path.join(dst, n + '.glb')); info[n] = {'size': s, 'min': mn}
        except Exception as e: print('FAIL', n, e)
    json.dump(info, open(os.path.join(dst, 'info.json'), 'w'), indent=0)
    print(len(info))
