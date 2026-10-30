"""Traces a bitmap logo into one SVG path, so the shape is the original's rather than drawn."""
import sys
from PIL import Image

def mask_of(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    inked = [[False] * (w + 2) for _ in range(h + 2)]
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            inked[y + 1][x + 1] = a > 128 and (r + g + b) / 3 < 200
    return inked, w + 2, h + 2

def segments(inked, w, h):
    """Marching squares: one segment per cell boundary between ink and paper."""
    found = {}
    for y in range(h - 1):
        for x in range(w - 1):
            tl, tr = inked[y][x], inked[y][x + 1]
            bl, br = inked[y + 1][x], inked[y + 1][x + 1]
            top, right = (x + 0.5, y + 0.0), (x + 1.0, y + 0.5)
            bottom, left = (x + 0.5, y + 1.0), (x + 0.0, y + 0.5)
            case = (tl << 3) | (tr << 2) | (br << 1) | bl
            edges = {
                1: [(left, bottom)], 2: [(bottom, right)], 3: [(left, right)],
                4: [(right, top)], 5: [(left, top), (bottom, right)], 6: [(bottom, top)],
                7: [(left, top)], 8: [(top, left)], 9: [(top, bottom)],
                10: [(top, right), (bottom, left)], 11: [(top, right)], 12: [(right, left)],
                13: [(right, bottom)], 14: [(bottom, left)],
            }.get(case, [])
            for a, b in edges:
                found.setdefault(a, []).append(b)
    return found

def loops(links):
    """Chains the segments into closed rings."""
    rings = []
    remaining = {a: list(bs) for a, bs in links.items()}
    while remaining:
        start = next(iter(remaining))
        ring = [start]
        at = start
        while True:
            nexts = remaining.get(at)
            if not nexts:
                break
            step = nexts.pop()
            if not nexts:
                remaining.pop(at, None)
            ring.append(step)
            at = step
            if at == start:
                break
        if len(ring) > 8:
            rings.append(ring)
    return rings

def simplify(points, epsilon):
    """Douglas-Peucker, so a ring is a handful of points rather than one per pixel."""
    if len(points) < 3:
        return points
    first, last = points[0], points[-1]
    worst, index = 0.0, 0
    for i in range(1, len(points) - 1):
        d = distance(points[i], first, last)
        if d > worst:
            worst, index = d, i
    if worst <= epsilon:
        return [first, last]
    return simplify(points[: index + 1], epsilon)[:-1] + simplify(points[index:], epsilon)

def distance(point, start, end):
    (px, py), (x1, y1), (x2, y2) = point, start, end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
    t = max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    return ((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2) ** 0.5

def main():
    source, size, epsilon = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    inked, w, h = mask_of(source)
    rings = [simplify(ring, epsilon) for ring in loops(segments(inked, w, h))]
    xs = [p[0] for ring in rings for p in ring]
    ys = [p[1] for ring in rings for p in ring]
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    scale = (size - 2) / span
    ox, oy = min(xs), min(ys)
    # Centre what is narrower than the box, so the mark sits in the middle.
    padx = (size - (max(xs) - min(xs)) * scale) / 2
    pady = (size - (max(ys) - min(ys)) * scale) / 2

    parts = []
    for ring in rings:
        moved = [f"{(x - ox) * scale + padx:.2f} {(y - oy) * scale + pady:.2f}" for x, y in ring]
        parts.append("M" + "L".join(moved) + "Z")
    print(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size:g} {size:g}" '
          f'width="{size:g}" height="{size:g}">')
    print(f'  <path fill="currentColor" fill-rule="evenodd" d="{"".join(parts)}"/>')
    print("</svg>")

main()
