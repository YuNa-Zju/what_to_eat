"""Vendor a fixed OFL WenKai build and split it for on-demand browser loading.

Requires fonttools[woff]. The core subset follows this app's UI/seed characters;
all other supported characters remain available through unicode-range subsets.
"""
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from urllib.request import urlopen
from fontTools.ttLib import TTFont
from fontTools import subset
import io
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'frontend/public/fonts'
URL = 'https://registry.npmjs.org/@fontsource/lxgw-wenkai/-/lxgw-wenkai-5.3.0.tgz'

def save_part(task):
    source, name, points = task
    font = TTFont(source)
    options = subset.Options()
    options.flavor = 'woff2'
    options.drop_tables += ['FFTM', 'feat', 'morx']
    options.recalc_timestamp = False
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=points)
    sub.subset(font)
    font.flavor = 'woff2'
    font.save(OUT / name)
    ranges = ','.join(f'U+{c:X}' for c in points)
    return f"@font-face{{font-family:'LXGW WenKai';font-style:normal;font-weight:500;font-display:swap;src:url('/fonts/{name}') format('woff2');unicode-range:{ranges};}}\n"

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    cached = Path(tempfile.gettempdir()) / 'lxgw-wenkai-5.3.0.tgz'
    if not cached.exists():
        cached.write_bytes(urlopen(URL, timeout=90).read())
    with tarfile.open(fileobj=io.BytesIO(cached.read_bytes())) as archive, tempfile.TemporaryDirectory() as work:
        source = Path(work) / 'source.woff2'
        source.write_bytes(archive.extractfile('package/files/lxgw-wenkai-latin-500-normal.woff2').read())
        (OUT / 'LXGW-OFL.txt').write_bytes(archive.extractfile('package/LICENSE').read())
        font = TTFont(source)
        points = set(font.getBestCmap())
        # Decode Brotli just once; workers subset the uncompressed font.
        font.flavor = None
        source = Path(work) / 'source.ttf'
        font.save(source)
        text = ''.join(p.read_text() for base in ['frontend/src', 'resources'] for p in (ROOT/base).rglob('*') if p.suffix in {'.tsx','.ts','.json','.txt'})
        core = (set(map(ord, text)) | set(range(32, 256))) & points
        chunks = [sorted(core)]
        remaining = sorted(points-core)
        chunks.extend(remaining[i:i+384] for i in range(0, len(remaining), 384))
        tasks = [(str(source),f'wenkai-{i:03}.woff2',chunk) for i,chunk in enumerate(chunks)]
        with ProcessPoolExecutor(max_workers=4) as pool:
            css = ''.join(pool.map(save_part, tasks))
        (OUT / 'lxgw-wenkai.css').write_text(css)
        original = OUT / 'lxgw-wenkai-latin-500-normal.woff2'
        if original.exists(): original.unlink()
        print(f'Vendored {len(chunks)} subsets; core {len(core)} characters, {(OUT / "wenkai-000.woff2").stat().st_size} bytes')
