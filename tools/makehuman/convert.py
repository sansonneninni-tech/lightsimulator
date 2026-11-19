# Converte gli asset MakeHuman 1.1 (tutti CC0, settembre 2020) nei file compatti che l'app carica:
#   public/human/base.json + base.bin      maglia base, UV, pesi dello scheletro, ossa
#   public/human/t-<pacchetto>.bin         forme (targets): delta sparsi in Int16 (unità 1e-5 m)
#   public/human/p-<oggetto>.bin + .webp   capelli, abiti, occhi, sopracciglia...: maglia + aggancio alla base
# Uso: python3 tools/makehuman/convert.py <cartella data di MakeHuman> public/human
import json, os, struct, sys
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
S = 0.1  # MakeHuman lavora in decimetri
DU = 1e-5  # unità dei delta salvati


def read_obj(path):
    v, vt, faces, groups = [], [], [], []
    g = None
    for line in open(path, encoding='utf-8', errors='ignore'):
        if line.startswith('v '):
            v.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vt '):
            vt.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('g '):
            g = line.split()[1]
        elif line.startswith('f '):
            f = []
            for t in line.split()[1:]:
                p = t.split('/')
                f.append((int(p[0]) - 1, int(p[1]) - 1 if len(p) > 1 and p[1] else -1))
            faces.append(f)
            groups.append(g)
    return np.array(v, np.float64), np.array(vt, np.float64) if vt else np.zeros((0, 2)), faces, groups


def unweld(faces):
    """vertici di disegno = coppie (vertice, uv) uniche; triangoli"""
    key, rv, ruv, tri = {}, [], [], []
    for f in faces:
        ids = []
        for (a, b) in f:
            k = (a, b)
            if k not in key:
                key[k] = len(rv)
                rv.append(a)
                ruv.append(b)
            ids.append(key[k])
        for i in range(1, len(ids) - 1):
            tri += [ids[0], ids[i], ids[i + 1]]
    return np.array(rv, np.int64), np.array(ruv, np.int64), np.array(tri, np.uint32)


class Bin:
    def __init__(self):
        self.parts, self.size = [], 0

    def add(self, arr):
        b = np.ascontiguousarray(arr).tobytes()
        off = self.size
        self.parts.append(b)
        self.size += len(b)
        pad = (-self.size) % 4
        if pad:
            self.parts.append(b'\0' * pad)
            self.size += pad
        return off

    def write(self, path):
        with open(path, 'wb') as f:
            for p in self.parts:
                f.write(p)


# ---------- maglia base ----------
v, vt, faces, groups = read_obj(f'{SRC}/3dobjs/base.obj')
NV = len(v)
body_faces = [f for f, g in zip(faces, groups) if g == 'body']
rv, ruv, tri = unweld(body_faces)
skel = json.load(open(f'{SRC}/rigs/default.mhskel'))
wts = json.load(open(f'{SRC}/rigs/default_weights.mhw'))['weights']
bone_names = list(skel['bones'].keys())
# ordine: genitori prima dei figli
order, seen = [], set()
def visit(n):
    if n in seen:
        return
    p = skel['bones'][n]['parent']
    if p:
        visit(p)
    seen.add(n)
    order.append(n)
for n in bone_names:
    visit(n)
bidx = {n: i for i, n in enumerate(order)}
W = [[] for _ in range(NV)]
for n, lst in wts.items():
    for vi, w in lst:
        W[vi].append((w, bidx[n]))
wi = np.zeros((NV, 4), np.uint8)
ww = np.zeros((NV, 4), np.uint8)
for i, l in enumerate(W):
    l.sort(reverse=True)
    l = l[:4]
    tot = sum(w for w, _ in l) or 1
    q = [int(round(255 * w / tot)) for w, _ in l]
    if q:
        q[0] += 255 - sum(q)
    for k, (w, b) in enumerate(l):
        wi[i, k] = b
        ww[i, k] = q[k]
joints = skel['joints']
bones = []
for n in order:
    b = skel['bones'][n]
    bones.append({'name': n, 'parent': bidx[b['parent']] if b['parent'] else -1, 'head': joints[b['head']], 'tail': joints[b['tail']]})

bb = Bin()
man = {'nv': NV, 'bones': bones}
man['pos'] = bb.add((v * S).astype(np.float32))
man['bodyVert'] = bb.add(rv.astype(np.uint16)); man['nr'] = len(rv)
man['bodyUV'] = bb.add(vt[ruv].astype(np.float32))
man['bodyIdx'] = bb.add(tri); man['ni'] = len(tri)
man['skinIdx'] = bb.add(wi)
man['skinW'] = bb.add(ww)
bb.write(f'{OUT}/base.bin')


# ---------- forme ----------
def read_target(path):
    idx, d = [], []
    for line in open(path):
        if line.startswith('#'):
            continue
        p = line.split()
        if len(p) == 4:
            idx.append(int(p[0]))
            d.append([float(x) for x in p[1:]])
    d = np.round(np.array(d) * S / DU)
    if len(d) == 0:
        return np.zeros(0, np.uint16), np.zeros((0, 3), np.int16)
    assert np.abs(d).max() < 32767, path
    return np.array(idx, np.uint16), d.astype(np.int16)


def pack(name, files):
    b = Bin()
    m = {}
    for key, path in files.items():
        i, d = read_target(f'{SRC}/targets/{path}')
        m[key] = [b.add(i), b.add(d), len(i)]
    b.write(f'{OUT}/t-{name}.bin')
    return m

packs = {}
for g, gn in (('male', 'uomo'), ('female', 'donna')):
    files = {}
    for a in ('young', 'old'):
        for mu in ('minmuscle', 'averagemuscle', 'maxmuscle'):
            for we in ('minweight', 'averageweight', 'maxweight'):
                files[f'u-{a}-{mu}-{we}'] = f'macrodetails/universal-{g}-{a}-{mu}-{we}.target'
        for r in ('african', 'asian', 'caucasian'):
            files[f'r-{r}-{a}'] = f'macrodetails/{r}-{g}-{a}.target'
    if g == 'female':
        files['breast-max'] = 'breast/female-young-averagemuscle-averageweight-maxcup-averagefirmness.target'
        files['breast-min'] = 'breast/female-young-averagemuscle-averageweight-mincup-averagefirmness.target'
    packs[gn] = pack(gn, files)

# cursori (coppie meno/più); i lati sinistro e destro si muovono insieme
SL = {
    'spalle': ['torso/torso-vshape-decr', 'torso/torso-vshape-incr'],
    'torace': ['torso/torso-scale-horiz-decr', 'torso/torso-scale-horiz-incr'],
    'fianchi': ['hip/hip-scale-horiz-decr', 'hip/hip-scale-horiz-incr'],
    'pancia': ['stomach/stomach-pregnant-decr', 'stomach/stomach-pregnant-incr'],
    'glutei': ['buttocks/buttocks-volume-decr', 'buttocks/buttocks-volume-incr'],
    'collo': ['neck/neck-scale-horiz-decr', 'neck/neck-scale-horiz-incr'],
    'testa': ['head/head-scale-horiz-decr', 'head/head-scale-horiz-incr'],
    'guanceTesta': ['head/head-fat-decr', 'head/head-fat-incr'],
    'fronte': ['forehead/forehead-scale-vert-decr', 'forehead/forehead-scale-vert-incr'],
    'sopracciglia': ['eyebrows/eyebrows-trans-down', 'eyebrows/eyebrows-trans-up'],
    'sopraccigliaAng': ['eyebrows/eyebrows-angle-down', 'eyebrows/eyebrows-angle-up'],
    'occhi': [['eyes/l-eye-scale-decr', 'eyes/r-eye-scale-decr'], ['eyes/l-eye-scale-incr', 'eyes/r-eye-scale-incr']],
    'occhiDist': [['eyes/l-eye-trans-in', 'eyes/r-eye-trans-in'], ['eyes/l-eye-trans-out', 'eyes/r-eye-trans-out']],
    'occhiAng': [['eyes/l-eye-eyefold-angle-down', 'eyes/r-eye-eyefold-angle-down'], ['eyes/l-eye-eyefold-angle-up', 'eyes/r-eye-eyefold-angle-up']],
    'palpebre': [['eyes/l-eye-height2-decr', 'eyes/r-eye-height2-decr'], ['eyes/l-eye-height2-incr', 'eyes/r-eye-height2-incr']],
    'naso': ['nose/nose-scale-horiz-decr', 'nose/nose-scale-horiz-incr'],
    'nasoLung': ['nose/nose-scale-vert-decr', 'nose/nose-scale-vert-incr'],
    'nasoPunta': ['nose/nose-point-width-decr', 'nose/nose-point-width-incr'],
    'nasoGobba': ['nose/nose-hump-decr', 'nose/nose-hump-incr'],
    'narici': ['nose/nose-nostrils-width-decr', 'nose/nose-nostrils-width-incr'],
    'bocca': ['mouth/mouth-scale-horiz-decr', 'mouth/mouth-scale-horiz-incr'],
    'labbroSup': ['mouth/mouth-upperlip-volume-decr', 'mouth/mouth-upperlip-volume-incr'],
    'labbroInf': ['mouth/mouth-lowerlip-volume-decr', 'mouth/mouth-lowerlip-volume-incr'],
    'angoliBocca': ['mouth/mouth-angles-down', 'mouth/mouth-angles-up'],
    'mento': ['chin/chin-prominent-decr', 'chin/chin-prominent-incr'],
    'mentoLargo': ['chin/chin-width-decr', 'chin/chin-width-incr'],
    'mascella': ['chin/chin-bones-decr', 'chin/chin-bones-incr'],
    'fossetta': [None, 'chin/chin-cleft-incr'],
    'zigomi': [['cheek/l-cheek-bones-decr', 'cheek/r-cheek-bones-decr'], ['cheek/l-cheek-bones-incr', 'cheek/r-cheek-bones-incr']],
    'guance': [['cheek/l-cheek-volume-decr', 'cheek/r-cheek-volume-decr'], ['cheek/l-cheek-volume-incr', 'cheek/r-cheek-volume-incr']],
    'orecchie': [['ears/l-ear-scale-decr', 'ears/r-ear-scale-decr'], ['ears/l-ear-scale-incr', 'ears/r-ear-scale-incr']],
    'orecchieAp': [['ears/l-ear-wing-decr', 'ears/r-ear-wing-decr'], ['ears/l-ear-wing-incr', 'ears/r-ear-wing-incr']],
}
FORMS = ['oval', 'round', 'rectangular', 'square', 'triangular', 'invertedtriangular', 'diamond']
EXPR_UNITS = ['eye-left-closure', 'eye-right-closure', 'eye-left-slit', 'eye-right-slit', 'eye-left-opened-up', 'eye-right-opened-up',
              'eyebrows-left-down', 'eyebrows-right-down', 'eyebrows-left-up', 'eyebrows-right-up', 'eyebrows-left-inner-up', 'eyebrows-right-inner-up',
              'mouth-open', 'mouth-corner-puller', 'mouth-depression', 'mouth-compression', 'mouth-parling', 'mouth-elevation', 'mouth-pursing',
              'nose-left-elevation', 'nose-right-elevation']
files = {}
sliders = {}
for k, (lo, hi) in SL.items():
    side = []
    for part in (lo, hi):
        if part is None:
            side.append([])
            continue
        lst = part if isinstance(part, list) else [part]
        keys = []
        for p in lst:
            files[p] = p + '.target'
            keys.append(p)
        side.append(keys)
    sliders[k] = side
for f in FORMS:
    files['head/head-' + f] = f'head/head-{f}.target'
for u in EXPR_UNITS:
    files['x/' + u] = f'expression/units/caucasian/{u}.target'
packs['dettagli'] = pack('dettagli', files)
man['packs'] = packs
man['sliders'] = sliders
man['forms'] = FORMS


# ---------- oggetti agganciati alla base (capelli, abiti, occhi...) ----------
def tex(src, dst, size, mode='rgb', quality=82):
    im = Image.open(src)
    if mode == 'gray':  # capelli: luminosità normalizzata, il colore lo dà l'app
        im = im.convert('RGBA')
        a = np.asarray(im).astype(np.float32)
        lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
        m = a[..., 3] > 128
        ref = np.percentile(lum[m], 70) if m.any() else 128
        g = np.clip(lum / max(ref, 1) * 200, 0, 255)
        out = np.dstack([g, g, g, a[..., 3]]).astype(np.uint8)
        im = Image.fromarray(out, 'RGBA')
    elif im.mode in ('RGBA', 'LA', 'P') and mode == 'rgba':
        im = im.convert('RGBA')
    else:
        im = im.convert('RGB')
    im = im.resize((size, size), Image.LANCZOS)
    im.save(f'{OUT}/{dst}', 'WEBP', quality=quality, method=6)
    return dst


def mhmat(path):
    d = {}
    for line in open(path, encoding='utf-8', errors='ignore'):
        p = line.split(None, 1)
        if len(p) == 2 and not p[0].startswith('#'):
            d[p[0]] = p[1].strip()
    return d


def proxy(kind, name, folder, tsize=1024, tmode='rgb', normal=0):
    clo = f'{folder}/{name}.mhclo'
    head, refs, wts_, offs, dele = {}, [], [], [], []
    mode = None
    for line in open(clo, encoding='utf-8', errors='ignore'):
        if line.startswith('#'):
            continue
        p = line.split()
        if not p:
            continue
        if p[0] == 'verts':
            mode = 'v'; continue
        if p[0] == 'delete_verts':
            mode = 'd'; continue
        if mode == 'v' and p[0].lstrip('-').isdigit():
            if len(p) == 1:
                refs.append([int(p[0])] * 3); wts_.append([1, 0, 0]); offs.append([0, 0, 0])
            else:
                refs.append([int(x) for x in p[:3]]); wts_.append([float(x) for x in p[3:6]]); offs.append([float(x) for x in p[6:9]])
            continue
        if mode == 'd' and p[0].isdigit():
            toks = line.split()
            i = 0
            while i < len(toks):
                if i + 2 < len(toks) and toks[i + 1] == '-':
                    dele.append([int(toks[i]), int(toks[i + 2])]); i += 3
                else:
                    dele.append([int(toks[i]), int(toks[i])]); i += 1
            continue
        head.setdefault(p[0], []).append(p[1:])
    obj = f'{folder}/{head["obj_file"][0][0]}'
    pv, pvt, pf, _ = read_obj(obj)
    assert len(pv) == len(refs), (name, len(pv), len(refs))
    prv, pruv, ptri = unweld(pf)
    b = Bin()
    m = {'kind': kind, 'name': name, 'nv': len(pv), 'nr': len(prv), 'ni': len(ptri)}
    m['refs'] = b.add(np.array(refs, np.uint16))
    m['w'] = b.add(np.array(wts_, np.float32))
    m['off'] = b.add((np.array(offs, np.float32)))
    m['vert'] = b.add(prv.astype(np.uint16))
    m['uv'] = b.add(pvt[pruv].astype(np.float32) if len(pvt) else np.zeros((len(prv), 2), np.float32))
    m['idx'] = b.add(ptri)
    m['scale'] = {ax: [int(head[k][0][0]), int(head[k][0][1]), float(head[k][0][2])] for ax, k in (('x', 'x_scale'), ('y', 'y_scale'), ('z', 'z_scale')) if k in head}
    if dele:
        m['del'] = dele
    b.write(f'{OUT}/p-{kind}-{name}.bin')
    mat = mhmat(f'{folder}/{head["material"][0][0]}') if 'material' in head else {}
    if 'diffuseTexture' in mat and os.path.exists(f'{folder}/{os.path.basename(mat["diffuseTexture"])}'):
        m['map'] = tex(f'{folder}/{os.path.basename(mat["diffuseTexture"])}', f'p-{kind}-{name}.webp', tsize, tmode)
    if normal and 'normalmapTexture' in mat and os.path.exists(f'{folder}/{os.path.basename(mat["normalmapTexture"])}'):
        m['normal'] = tex(f'{folder}/{os.path.basename(mat["normalmapTexture"])}', f'p-{kind}-{name}-n.webp', normal, 'rgb', 88)
    m['transparent'] = mat.get('transparent', 'False') == 'True'
    return m


items = []
for h in ['short01', 'short02', 'short03', 'short04', 'bob01', 'bob02', 'long01', 'ponytail01', 'braid01', 'afro01']:
    items.append(proxy('capelli', h, f'{SRC}/hair/{h}', 1024, 'gray'))
for c in ['male_casualsuit01', 'male_casualsuit02', 'male_casualsuit03', 'male_casualsuit04', 'male_casualsuit05', 'male_casualsuit06', 'male_elegantsuit01', 'male_worksuit01',
          'female_casualsuit01', 'female_casualsuit02', 'female_elegantsuit01', 'female_sportsuit01']:
    items.append(proxy('abito', c, f'{SRC}/clothes/{c}', 1024, 'rgba', 512))
for c in ['shoes01', 'shoes02', 'shoes03', 'shoes04', 'shoes05', 'shoes06']:
    items.append(proxy('scarpe', c, f'{SRC}/clothes/{c}', 512, 'rgba', 256))
for c in ['fedora01']:
    items.append(proxy('cappello', c, f'{SRC}/clothes/{c}', 512, 'rgba'))
for e in ['eyebrow001', 'eyebrow002', 'eyebrow003', 'eyebrow006', 'eyebrow009', 'eyebrow010', 'eyebrow011', 'eyebrow012']:
    items.append(proxy('sopracciglia', e, f'{SRC}/eyebrows/{e}', 512, 'rgba'))
items.append(proxy('ciglia', 'eyelashes01', f'{SRC}/eyelashes/eyelashes01', 256, 'rgba'))
items.append(proxy('occhi', 'high-poly', f'{SRC}/eyes/high-poly', 256))
items.append(proxy('denti', 'teeth_base', f'{SRC}/teeth/teeth_base', 512))
man['items'] = items

eyes = {}
for c in ['brown', 'brownlight', 'green', 'blue', 'lightblue', 'grey']:
    eyes[c] = tex(f'{SRC}/eyes/materials/{c}_eye.png', f'occhi-{c}.webp', 256, 'rgba')
man['eyes'] = eyes

skins = {}
for age in ('young', 'middleage', 'old'):
    for race, tone in (('caucasian', 'chiara'), ('asian', 'media'), ('african', 'scura')):
        for g, gn in (('male', 'uomo'), ('female', 'donna')):
            d = f'{SRC}/skins/{age}_{race}_{g}'
            mat = mhmat(f'{d}/{age}_{race}_{g}.mhmat')
            skins[f'{gn}-{tone}-{age}'] = tex(f'{d}/{os.path.basename(mat["diffuseTexture"])}', f'pelle-{gn}-{tone}-{age}.webp', 1024)
man['skins'] = skins
json.dump(man, open(f'{OUT}/base.json', 'w'), separators=(',', ':'))
print('ok', NV, 'vertici', len(tri) // 3, 'triangoli', len(items), 'oggetti')
