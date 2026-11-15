# Prepara il catalogo degli arredi a modello 3D.
# Uso: python3 tools/catalog/build.py <cartella glb> <info.json>
#   <cartella glb>: i modelli già ottimizzati (gltf-transform optimize --compress meshopt
#                   --texture-compress webp --texture-size 1024), uno per sorgente: <Sorgente>.glb
#   <info.json>:    ingombri misurati dei modelli ({size, min} in metri, origine del file)
# Scrive public/catalog/<id>.glb e src/engine/catalog.ts. Le miniature si fanno con thumbs.js.
import json
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(__file__))
from items import ITEMS  # noqa: E402

src, info = sys.argv[1], json.load(open(sys.argv[2]))
root = os.path.join(os.path.dirname(__file__), '..', '..')
out = os.path.join(root, 'public', 'catalog')
os.makedirs(out, exist_ok=True)


def slug(n):
    return re.sub(r'[^a-z0-9]+', '-', n.lower()).strip('-')


rows = []
for name, label, cat, o in ITEMS:
    i = info[name]
    s = o.get('s', 1)
    w, h, d = (round(v * s, 3) for v in i['size'])
    mid = slug(name)
    shutil.copyfile(os.path.join(src, name + '.glb'), os.path.join(out, mid + '.glb'))
    e = {'id': 'm-' + mid, 'name': label, 'cat': cat, 'size': [w, d], 'height': h, 'model': mid, 'finishes': [], 'icon': ''}
    if s != 1:
        e['scale'] = s
    if o.get('top'):
        e['surface'] = h
    if o.get('on'):
        e['onTop'] = True
    if 'wall' in o:
        e['wall'] = o['wall']
    if o.get('ceil'):
        e['ceiling'] = True
    if 'light' in o:
        fx, k, frac = o['light']
        # quota della lampadina: dal soffitto in giù per quelle appese, da terra per le altre
        y = round(-h + frac * h, 3) if o.get('ceil') else round(frac * h, 3)
        e['light'] = {'offset': [0, y, 0], 'fixture': fx, 'kelvin': k, 'name': label}
    rows.append(e)

ts = ['// Generato da tools/catalog/build.py: arredi a modello 3D (CC0, vedi public/catalog/LICENSE.txt)',
      "import type { FurnitureKind } from './furniture';",
      '',
      'export const CATALOG: FurnitureKind[] = [']
for e in rows:
    ts.append('  ' + json.dumps(e, ensure_ascii=False) + ',')
ts.append('];')
open(os.path.join(root, 'src', 'engine', 'catalog.ts'), 'w').write('\n'.join(ts) + '\n')
print(len(rows), 'arredi')
