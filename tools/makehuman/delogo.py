# Toglie il logo MakeHuman stampato su alcune magliette (riempie con il tessuto attorno).
# Uso: python3 tools/makehuman/delogo.py public/human
import sys
import cv2
import numpy as np

D = sys.argv[1]
BOXES = {  # riquadro del logo in coordinate 0..1 della texture (x0, y0, x1, y1)
    'female_casualsuit01': (0.70, 0.12, 0.89, 0.36),
    'female_casualsuit02': (0.70, 0.12, 0.92, 0.37),
    'male_casualsuit02': (0.44, 0.11, 0.64, 0.34),
    'male_casualsuit04': (0.44, 0.11, 0.64, 0.34),
    'male_casualsuit06': (0.08, 0.02, 0.82, 0.22),
}
for name, (x0, y0, x1, y1) in BOXES.items():
    f = f'{D}/p-abito-{name}.webp'
    im = cv2.imread(f, cv2.IMREAD_UNCHANGED)
    h, w = im.shape[:2]
    X0, Y0, X1, Y1 = int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)
    roi = im[Y0:Y1, X0:X1, :3].astype(np.float32)
    med = np.median(roi.reshape(-1, 3), axis=0)
    dist = np.linalg.norm(roi - med, axis=2)
    mask = np.zeros((h, w), np.uint8)
    mask[Y0:Y1, X0:X1] = (dist > (18 if med.mean() > 180 else 38)).astype(np.uint8) * 255
    mask = cv2.dilate(mask, np.ones((7, 7), np.uint8))
    rgb = cv2.inpaint(np.ascontiguousarray(im[:, :, :3]), mask, 9, cv2.INPAINT_TELEA)
    im[:, :, :3] = rgb
    cv2.imwrite(f, im, [cv2.IMWRITE_WEBP_QUALITY, 82])
    print(name, int(mask.sum() / 255), 'pixel ripuliti')
