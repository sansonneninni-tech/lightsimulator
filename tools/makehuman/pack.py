# Comprime con gzip i .bin dei personaggi (l'app li decomprime da sé: GitHub Pages non comprime i binari).
# Ultimo passo, dopo convert.py, delogo.py e fixtex.py. Uso: python3 tools/makehuman/pack.py public/human
import glob
import gzip
import sys

tot = [0, 0]
for f in sorted(glob.glob(sys.argv[1].rstrip('/') + '/*.bin')):
    raw = open(f, 'rb').read()
    if raw[:2] == b'\x1f\x8b':
        continue
    z = gzip.compress(raw, 9, mtime=0)
    open(f, 'wb').write(z)
    tot[0] += len(raw)
    tot[1] += len(z)
print(f'{tot[0] / 1e6:.1f} MB -> {tot[1] / 1e6:.1f} MB')
