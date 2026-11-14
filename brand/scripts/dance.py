"""Render the empty-state dance loop from the original cutout.

usage: dance.py cutout.png out.webp out.gif still.png frames_dir [size]

Four beats per loop: hop, hop-and-flip, hop (mirrored), hop-and-flip back. On the flip beats
the image is mirrored at the top of the hop (a plain horizontal flip, no turning), so the face and
arms swap sides. still.png is the unanimated figure on the same canvas, for reduced motion.
"""
import os, sys, math, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

src, out_webp, out_gif, out_still, frames_dir = sys.argv[1:6]
OUT = int(sys.argv[6]) if len(sys.argv) > 6 else 320
os.makedirs(frames_dir, exist_ok=True)

char = Image.open(src).convert("RGBA")
S = char.width
A = np.asarray(char).copy()
F = A.astype(np.float32) / 255
r, g, b, alpha = F[..., 0], F[..., 1], F[..., 2], F[..., 3]
Yn, Xn = np.mgrid[0:S, 0:S] / S
solid = alpha > 0.02
lum = (r + g + b) / 3
dark = (lum < 0.3) & ~((g > r + 0.1) & (g > 0.2))  # navy/black sleeve, not the green hair
pale = (lum > 0.7) & (b > g - 0.18)                # glove (the face is yellow: blue well under green)
face = (lum > 0.35) & (b < g - 0.2)

def arm(region, outer):
    """The sleeve (biggest dark blob in the region) plus the glove blobs out past it."""
    cl, n = ndi.label(ndi.binary_opening(solid & dark & region, iterations=2))
    m = cl == 1 + int(np.argmax(ndi.sum(np.ones(cl.shape), cl, range(1, n + 1))))
    cl, n = ndi.label(solid & pale & region)
    for k, (cy, cx) in enumerate(ndi.center_of_mass(np.ones(cl.shape), cl, range(1, n + 1))):
        if outer(cx / S):
            m |= cl == k + 1
    m = ndi.binary_closing(m, iterations=8)
    # take the soft edge around it too, but never face pixels
    return ndi.binary_dilation(m, iterations=10) & solid & region & ~face

left = arm((Xn < 0.3) & (Yn < 0.55), lambda x: x < 0.15)
right = arm((Xn > 0.74) & (Yn > 0.28) & (Yn < 0.65), lambda x: x > 0.86)
# anything the cut left stranded off the main body goes with its arm
cl, n = ndi.label(solid & ~(left | right))
if n > 1:
    main = 1 + int(np.argmax(ndi.sum(np.ones(cl.shape), cl, range(1, n + 1))))
    stray = (cl > 0) & (cl != main)
    left |= stray & (Xn < 0.5)
    right |= stray & (Xn >= 0.5)

def layer(m):
    a = A.copy(); a[..., 3] = np.where(m, a[..., 3], 0); return Image.fromarray(a)

arm_l, arm_r, body = layer(left), layer(right), layer(~(left | right))
PIV_L, PIV_R = (0.24 * S, 0.37 * S), (0.80 * S, 0.48 * S)
SLEEVE_RGB = tuple(int(v) for v in np.median(A[(left | right) & dark][:, :3], 0)) + (255,)
# sleeve-coloured shoulder stubs under the head so a rotating sleeve never opens a gap
for img, (x, y), dx in ((arm_l, PIV_L, 0.02), (arm_r, PIV_R, -0.025)):
    x, y, rr = x + dx * S, y - 0.015 * S, 0.028 * S  # nudged in under the face so it never shows
    ImageDraw.Draw(img).ellipse([x - rr, y - rr, x + rr, y + rr], fill=SLEEVE_RGB)
FEET = (0.47 * S, 0.88 * S)
CW = int(S * 1.2)

def sticker(canvas):
    """White outline so the dark edges read on the dark stage."""
    dist = ndi.distance_transform_edt(np.asarray(canvas)[..., 3] < 128)
    ring = (np.clip((S * 0.016 - dist) / 2, 0, 1) * 255).astype(np.uint8)
    halo = Image.new("RGBA", canvas.size, (255, 255, 255, 0)); halo.putalpha(Image.fromarray(ring))
    halo.alpha_composite(canvas)
    return halo.resize((OUT, OUT), Image.LANCZOS)

still = Image.new("RGBA", (CW, CW)); still.alpha_composite(char, (int(CW / 2 - FEET[0]), int(CW * 0.90 - FEET[1])))
sticker(still).save(out_still, optimize=True)

BEATS, PER_BEAT = 4, 12
N = BEATS * PER_BEAT
frames = []
for i in range(N):
    bt, beat = divmod(i / PER_BEAT, 1)
    bt = int(bt)
    mirrored_start = bt >= 2             # beats 0-1 start facing right, 2-3 start mirrored
    flipping = bt in (1, 3)
    hop = math.sin(math.pi * beat)       # 0 on the ground, 1 at the apex
    # facing: +1 normal, -1 mirrored; a flip beat mirrors the image at the apex
    face_dir = -1 if mirrored_start else 1
    if flipping and beat >= 0.5:
        face_dir = -face_dir
    lean = face_dir * 8 * hop
    land = max(0.0, 1 - beat / 0.2) + max(0.0, (beat - 0.85) / 0.15)
    sy = 1 - 0.10 * land + 0.06 * hop
    sx = 1 + 0.08 * land - 0.03 * hop
    pump = math.sin(2 * math.pi * beat)
    al = -10 * pump - 3
    ar = 10 * pump + 2

    fig = Image.new("RGBA", (S, S))
    fig.alpha_composite(arm_l.rotate(al, resample=Image.BICUBIC, center=PIV_L))
    fig.alpha_composite(arm_r.rotate(ar, resample=Image.BICUBIC, center=PIV_R))
    fig.alpha_composite(body)
    feet_x = FEET[0]
    if face_dir < 0:
        fig = fig.transpose(Image.FLIP_LEFT_RIGHT)
        feet_x = S - FEET[0]
    wx = round(S * sx)
    fig = fig.resize((wx, round(S * sy)), Image.LANCZOS)

    canvas = Image.new("RGBA", (CW, CW))
    fx, fy = CW / 2, CW * 0.90 - hop * S * 0.11
    canvas.alpha_composite(fig, (int(fx - feet_x * wx / S), int(fy - FEET[1] * sy)))
    canvas = canvas.rotate(lean, resample=Image.BICUBIC, center=(fx, fy))
    f = sticker(canvas)
    f.save(f"{frames_dir}/{i:02d}.png")
    frames.append(f)

dur = 50  # 20 fps: 0.6s per beat (~100 bpm), 2.4s loop
frames[0].save(out_webp, save_all=True, append_images=frames[1:], duration=dur, loop=0, lossless=False, quality=80, method=6)
# GIF for sharing: matte onto the empty-stage surface colour
gif = []
for f in frames:
    bg = Image.new("RGBA", f.size, (25, 26, 31, 255)); bg.alpha_composite(f)
    gif.append(bg.convert("RGB").quantize(colors=128, method=Image.MEDIANCUT, dither=Image.NONE))
gif[0].save(out_gif, save_all=True, append_images=gif[1:], duration=dur, loop=0, optimize=True)
