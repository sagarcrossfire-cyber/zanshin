#!/usr/bin/env python3
"""Build the tiny kanji font (2.0). The display face's Japanese file is ~1 MB;
the app uses only a handful of kanji (残心, the Shu-Ha-Ri marks, hub marks).
This scans src/ for CJK characters and writes a subset of Shippori Mincho B1
ExtraBold (SIL OFL 1.1, from @fontsource/shippori-mincho-b1) under the family
name "Zanshin Kanji", plus the list of characters it holds. A unit test fails
when src/ uses a kanji the subset lacks: rerun `python3 scripts/subset-kanji.py`.
"""
import pathlib
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
FONT = ROOT / 'node_modules/@fontsource/shippori-mincho-b1/files/shippori-mincho-b1-japanese-800-normal.woff2'
OUT = SRC / 'styles/fonts/zanshin-kanji-800.woff2'
LIST = SRC / 'styles/fonts/kanji-subset.txt'

def is_cjk(ch: str) -> bool:
    o = ord(ch)
    return 0x3040 <= o <= 0x30FF or 0x3400 <= o <= 0x9FFF or 0xF900 <= o <= 0xFAFF

chars = set()
for path in SRC.rglob('*'):
    if path.is_file() and path.suffix in {'.ts', '.tsx', '.css', '.json'} and path != LIST:
        chars.update(ch for ch in path.read_text(encoding='utf-8', errors='ignore') if is_cjk(ch))
text = ''.join(sorted(chars))

options = subset.Options()
options.flavor = 'woff2'
options.name_IDs = ['*']
options.layout_features = ['*']
font = subset.load_font(str(FONT), options)
subsetter = subset.Subsetter(options)
subsetter.populate(text=text)
subsetter.subset(font)
# Rename the family: a modified OFL font must not carry the original name if reserved.
for record in font['name'].names:
    if record.nameID in (1, 4, 16):
        record.string = 'Zanshin Kanji'
    elif record.nameID == 6:
        record.string = 'ZanshinKanji-ExtraBold'
font.flavor = 'woff2'
font.save(str(OUT))
LIST.write_text(text + '\n', encoding='utf-8')
print(f'{len(text)} glyphs: {text} -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)')
