#!/usr/bin/env python3
"""Buntar src/ till dist/index.html med all JS inline.
Kör: python3 build.py
fallback.js hoppas över om både art.js och audio.js finns."""
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
DIST = os.path.join(ROOT, 'dist')


def main():
    with open(os.path.join(SRC, 'index.html'), encoding='utf-8') as f:
        html = f.read()
    have_real = all(os.path.isfile(os.path.join(SRC, n)) for n in ('art.js', 'audio.js'))
    missing = []

    def repl(m):
        name = m.group(1)
        path = os.path.join(SRC, name)
        if name == 'fallback.js' and have_real:
            return ''
        if not os.path.isfile(path):
            missing.append(name)
            return ''
        with open(path, encoding='utf-8') as f:
            code = f.read()
        code = re.sub(r'</script', r'<\\/script', code, flags=re.I)
        return '<script>/* ' + name + ' */\n' + code + '\n</script>'

    out = re.sub(r'<script\s+src="([^"]+)"\s*>\s*</script>', repl, html)
    os.makedirs(DIST, exist_ok=True)
    dst = os.path.join(DIST, 'index.html')
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(out)
    print('Skrev %s (%d kB)%s' % (dst, len(out.encode('utf-8')) // 1024,
                                  '' if have_real else ' – med fallback.js'))
    if missing:
        print('Saknade filer (hoppades över): ' + ', '.join(missing), file=sys.stderr)
        if 'fallback.js' not in missing and not have_real:
            pass


if __name__ == '__main__':
    main()
