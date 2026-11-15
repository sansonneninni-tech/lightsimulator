# Ritocca le texture dei personaggi perché non si vedano cuciture né aloni:
# - abiti, scarpe, cappello, pelle: il colore delle isole UV viene allargato oltre i bordi
#   (altrimenti il fondo grigio della texture affiora lungo le cuciture, per esempio sul colletto);
# - capelli, sopracciglia, ciglia: i pixel trasparenti prendono il colore dei peli vicini
#   (altrimenti ai bordi del ritaglio compare un alone chiaro).
# Va eseguito una sola volta, dopo convert.py e delogo.py. Uso: python3 tools/makehuman/fixtex.py public/human
import json
import sys
import cv2
import numpy as np

D = sys.argv[1]
man = json.load(open(f'{D}/base.json'))


def bleed(rgb, mask):
    """riempie i pixel fuori da mask con il colore dei pixel dentro più vicini (spinta-tira a più scale)"""
    rgb = rgb.astype(np.float32)
    m = (mask > 0).astype(np.float32)
    out = rgb.copy()
    todo = m < 0.5
    for s in [2, 4, 8, 16, 32, 64, 128]:
        k = s * 4 + 1
        num = cv2.GaussianBlur(rgb * m[..., None], (k, k), s)
        den = cv2.GaussianBlur(m, (k, k), s)
        ok = todo & (den > 1e-3)
        out[ok] = num[ok] / den[ok][:, None]
        todo &= ~ok
        if not todo.any():
            break
    return np.clip(out, 0, 255).astype(np.uint8)


def uv_mask(uv, idx, w, h):
    mask = np.zeros((h, w), np.uint8)
    p = np.stack([uv[:, 0] * w, (1 - uv[:, 1]) * h], 1)
    tris = (p[idx.reshape(-1, 3)] * 16).astype(np.int32)  # sub-pixel
    cv2.fillPoly(mask, list(tris), 255, lineType=cv2.LINE_8, shift=4)
    return cv2.dilate(mask, np.ones((5, 5), np.uint8))  # un poco di margine dentro il tessuto


def fix_opaque(file, uv, idx):
    im = cv2.imread(f'{D}/{file}', cv2.IMREAD_UNCHANGED)
    h, w = im.shape[:2]
    mask = uv_mask(uv, idx, w, h)
    im[:, :, :3] = bleed(im[:, :, :3], mask)
    cv2.imwrite(f'{D}/{file}', im, [cv2.IMWRITE_WEBP_QUALITY, 85])
    return int((mask == 0).sum())


def fix_alpha(file):
    im = cv2.imread(f'{D}/{file}', cv2.IMREAD_UNCHANGED)
    if im.ndim < 3 or im.shape[2] < 4:
        return 0
    a = im[:, :, 3]
    mask = (a > 160).astype(np.uint8)
    im[:, :, :3] = np.where((a > 160)[..., None], im[:, :, :3], bleed(im[:, :, :3], mask))
    cv2.imwrite(f'{D}/{file}', im, [cv2.IMWRITE_WEBP_QUALITY, 101 if im.shape[0] <= 512 else 90])
    return int((a <= 160).sum())


for it in man['items']:
    buf = open(f"{D}/p-{it['kind']}-{it['name']}.bin", 'rb').read()
    uv = np.frombuffer(buf, np.float32, it['nr'] * 2, it['uv']).reshape(-1, 2)
    idx = np.frombuffer(buf, np.uint32, it['ni'], it['idx'])
    if it['kind'] in ('capelli', 'sopracciglia', 'ciglia'):
        if it.get('map'):
            print(it['map'], fix_alpha(it['map']))
    elif it['kind'] in ('abito', 'scarpe', 'cappello'):
        for f in (it.get('map'), it.get('normal')):
            if f:
                print(f, fix_opaque(f, uv, idx))

base = open(f'{D}/base.bin', 'rb').read()
buv = np.frombuffer(base, np.float32, man['nr'] * 2, man['bodyUV']).reshape(-1, 2)
bidx = np.frombuffer(base, np.uint32, man['ni'], man['bodyIdx'])
for f in sorted(set(man['skins'].values())):
    print(f, fix_opaque(f, buv, bidx))

# occhi: bianco dell'occhio meno rosato; iridi castane verso il marrone (lontano sembravano rosse)
for name, f in man['eyes'].items():
    im = cv2.imread(f'{D}/{f}', cv2.IMREAD_UNCHANGED)
    hsv = cv2.cvtColor(np.ascontiguousarray(im[:, :, :3]), cv2.COLOR_BGR2HSV).astype(np.float32)
    s = hsv[:, :, 1]
    sclera = s < 70
    hsv[:, :, 1] = np.where(sclera, s * 0.35, s)
    if name.startswith('brown'):
        iris = ~sclera
        hsv[:, :, 0] = np.where(iris & ((hsv[:, :, 0] < 14) | (hsv[:, :, 0] > 170)), 13, hsv[:, :, 0])
        hsv[:, :, 1] = np.where(iris, s * 0.8, hsv[:, :, 1])
    im[:, :, :3] = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR)
    cv2.imwrite(f'{D}/{f}', im, [cv2.IMWRITE_WEBP_QUALITY, 101])
    print(f)

# carnagioni: ogni tono con lo stesso colore medio a ogni età (la scura anziana tirava al rosso,
# la media era quasi uguale alla chiara)
TONE = {'chiara': (178, 142.5, 149.5), 'media': (138, 146, 156), 'scura': (72, 143, 146)}
for key, f in man['skins'].items():
    tone = key.split('-')[1]
    im = cv2.imread(f'{D}/{f}')
    lab = cv2.cvtColor(im, cv2.COLOR_BGR2LAB).astype(np.float32)
    m = lab[:, :, 0] > 20
    for c in range(3):
        ch = lab[:, :, c]
        ch[m] += TONE[tone][c] - ch[m].mean()
    im = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
    cv2.imwrite(f'{D}/{f}', im, [cv2.IMWRITE_WEBP_QUALITY, 85])
    print(f)
