# Brand asset scripts

Regenerate the empty-state dance from `brand/piccolinoh-cutout.png` (needs Python with Pillow, NumPy and SciPy). Run from the repo root:

```sh
python brand/scripts/dance.py brand/piccolinoh-cutout.png web/public/piccolinoh-dance.webp brand/piccolinoh-dance.gif web/public/piccolinoh-cutout.png /tmp/frames 320
```

- `web/public/piccolinoh-dance.webp` (app, with alpha) / `brand/piccolinoh-dance.gif` (for sharing, matted on the stage colour): the dance loop. Four hops; the image mirrors at the top of the second and fourth, and the arms swing from the shoulders.
- `web/public/piccolinoh-cutout.png`: the same figure standing still, shown instead of the dance when the viewer prefers reduced motion.
