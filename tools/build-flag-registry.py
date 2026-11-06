#!/usr/bin/env python3
"""Rebuild the shortcut registry from the bundled BabelStone 4.13 fonts.

Requires fonttools and brotli: python -m pip install fonttools brotli
The mapping file lists some unsupported PUA slots; intersect with the actual
PUA face's cmap rather than assuming every listed code has an available glyph.
"""
import json
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
font = TTFont(ROOT / 'assets/fonts-lazy/babelstone/flags.woff2')
inverse_cmap = {name: code for code, name in font.getBestCmap().items()}
regions, subdivisions = set(), set()
for lookup in font['GSUB'].table.LookupList.Lookup:
    for subtable in lookup.SubTable:
        for first, ligatures in getattr(subtable, 'ligatures', {}).items():
            for ligature in ligatures:
                codes = [inverse_cmap.get(glyph) for glyph in [first, *ligature.Component]]
                if len(codes) == 2 and all(c is not None and 0x1F1E6 <= c <= 0x1F1FF for c in codes):
                    regions.add(''.join(chr(c - 0x1F1E6 + ord('a')) for c in codes))
                if codes[0] == 0x1F3F4 and codes[-1] == 0xE007F and all(c is not None and 0xE0030 <= c <= 0xE007A for c in codes[1:-1]):
                    tag = ''.join(chr(c - 0xE0000) for c in codes[1:-1])
                    subdivisions.add(tag[:2] + '-' + tag[2:])

pua_cmap = TTFont(ROOT / 'assets/fonts-lazy/babelstone/flags-pua.ttf').getBestCmap()
pua = {}
for line in (ROOT / 'assets/fonts-lazy/licenses/babelstone-flags-pua-mapping.txt').read_text().splitlines():
    fields = line.split('\t')
    if len(fields) < 3:
        continue
    code = int(fields[0][2:], 16)
    if code in pua_cmap and 0xE000 <= code <= 0xE43F:
        pua[fields[2].lower().replace('_', '-')] = f'{code:04x}'

text = '''// BabelStone Flags 4.13 registry. RI/tag IDs were extracted from the bundled
// font's GSUB ligatures; PUA names/codes are the upstream mapping filtered by
// the actual cmap of the bundled PUA face. The mapping file contains codes for
// unsupported flags too, so it must not be treated as a support list.
export const regionalFlags = new Set(REGIONAL.split(' '));
export const subdivisionFlags = new Set(SUBDIVISION.split(' '));
export const puaFlags = Object.freeze(PUA);
'''.replace('REGIONAL', json.dumps(' '.join(sorted(regions)))) \
   .replace('SUBDIVISION', json.dumps(' '.join(sorted(subdivisions)))) \
   .replace('PUA)', json.dumps(pua, ensure_ascii=False, sort_keys=True, indent=2) + ')')
(ROOT / 'js/flag-registry.js').write_text(text)
print(f'{len(regions)} regional sequences, {len(subdivisions)} tag sequences, {len(pua)} PUA glyphs')
