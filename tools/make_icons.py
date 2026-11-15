#!/usr/bin/env python3
"""ساخت آیکون‌های PNG افزونه بدون وابستگی خارجی (zlib + struct).

استفاده:  python3 tools/make_icons.py
"""
import os
import struct
import zlib


def write_png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(v for x in range(w) for v in px[y][x]) for y in range(h))

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    data = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(data)


def lerp(a, b, t):
    return a + (b - a) * t


def rounded_mask(size, x, y, r):
    """آیا نقطه داخل مستطیل با گوشه‌های گرد است؟"""
    if r <= 0:
        return True
    cx = min(max(x, r), size - 1 - r)
    cy = min(max(y, r), size - 1 - r)
    # نقاط در ناحیه‌ی مستقیم‌الاضلاع
    if (r <= x <= size - 1 - r) or (r <= y <= size - 1 - r):
        return True
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def make(size):
    px = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]
    r = size * 0.23
    c1, c2 = (37, 99, 235), (79, 70, 229)
    cx = cy = (size - 1) / 2
    r_out = size * 0.37
    r_in = size * 0.24
    for y in range(size):
        for x in range(size):
            if not rounded_mask(size, x, y, r):
                continue
            t = (x + y) / (2 * (size - 1))
            col = (int(lerp(c1[0], c2[0], t)), int(lerp(c1[1], c2[1], t)), int(lerp(c1[2], c2[2], t)), 255)
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            ring = r_in <= d <= r_out

            bolt = False
            if not ring:
                bx = (x - cx) / (size * 0.115)
                by = (y - cy) / (size * 0.21)
                slant = -0.6 * by
                if abs(bx - slant) < 0.62 and -1 < by < 1:
                    bolt = True

            if ring:
                # کمی نازک‌تر در لبه‌ها برای ضدلبه
                px[y][x] = (255, 255, 255, 255)
            elif bolt:
                px[y][x] = (253, 240, 110, 255)
            else:
                px[y][x] = col
    return px


def main():
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'extension', 'icons')
    os.makedirs(out, exist_ok=True)
    for s in (16, 32, 48, 128):
        write_png(os.path.join(out, f'icon{s}.png'), s, s, make(s))
        print('saved icon%d.png' % s)


if __name__ == '__main__':
    main()
