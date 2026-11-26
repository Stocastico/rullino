#!/usr/bin/env python3
"""reference.json for colour-space.test.ts: the CSS Color 4 gamut-mapping algorithm, written here
from the specification's pseudocode (https://www.w3.org/TR/css-color-4/#binsearch), on Björn
Ottosson's OKLab matrices (the ones rullino uses), into sRGB, Display P3, Adobe RGB and Rec. 2020.
The space matrices come from colour-science (normalised_primary_matrix on each space's primaries).
"""
import json, math, os, warnings
warnings.filterwarnings('ignore')
import numpy as np
from colour.models import normalised_primary_matrix as npm

W = np.array([0.3127, 0.3290])
SRGB = npm(np.array([[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]]), W)
SPACES = {
    'srgb': np.eye(3),
    'display-p3': np.linalg.inv(npm(np.array([[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]]), W)) @ SRGB,
    'adobe-rgb': np.linalg.inv(npm(np.array([[0.64, 0.33], [0.21, 0.71], [0.15, 0.06]]), W)) @ SRGB,
    'rec2020': np.linalg.inv(npm(np.array([[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]]), W)) @ SRGB,
}

def to_oklab(r, g, b):
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l, m, s = (math.copysign(abs(v) ** (1 / 3), v) for v in (l, m, s))
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]

def from_oklab(L, a, b):
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]

def gamut_map(space, L, C, h):
    """The specification's algorithm, step by step, on OKLCh."""
    M = SPACES[space]
    Minv = np.linalg.inv(M)
    def dest(L, C, h):
        rgb = from_oklab(L, C * math.cos(h), C * math.sin(h))
        return list(M @ np.array(rgb))
    def lab_of(rgb):
        s = Minv @ np.array(rgb)
        return to_oklab(*s)
    def in_gamut(rgb):
        return all(0 <= v <= 1 for v in rgb)
    def clip(rgb):
        return [min(1, max(0, v)) for v in rgb]
    def delta(lab1, lab2):
        return math.dist(lab1, lab2)
    if L >= 1: return [1, 1, 1]
    if L <= 0: return [0, 0, 0]
    origin = dest(L, C, h)
    if in_gamut(origin): return origin
    jnd, epsilon = 0.02, 0.0001
    min_in_gamut = True
    clipped = clip(origin)
    E = delta(lab_of(clipped), [L, C * math.cos(h), C * math.sin(h)])
    if E < jnd: return clipped
    lo, hi = 0.0, C
    while hi - lo > epsilon:
        chroma = (lo + hi) / 2
        current = dest(L, chroma, h)
        if min_in_gamut and in_gamut(current):
            lo = chroma
            continue
        clipped = clip(current)
        E = delta(lab_of(clipped), [L, chroma * math.cos(h), chroma * math.sin(h)])
        if E < jnd:
            if jnd - E < epsilon: return clipped
            min_in_gamut = False
            lo = chroma
        else:
            hi = chroma
    return clipped

cases = []
for L in [0.02, 0.15, 0.35, 0.5, 0.65, 0.8, 0.93, 0.995, 1.0, 1.05]:
    for hdeg in range(0, 360, 20):
        for C in [0.03, 0.12, 0.25, 0.4]:
            h = math.radians(hdeg)
            lab = [L, C * math.cos(h), C * math.sin(h)]
            cases.append({'lab': lab, 'out': {s: gamut_map(s, L, C, h) for s in SPACES}})
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference.json'), 'w') as f:
    json.dump(cases, f, separators=(',', ':'))
print(len(cases))
