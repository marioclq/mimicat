#!/usr/bin/env python3
"""Build the VFD Pet sprite sheet from the reference art of the real cat.

Input:  assets/source/reference.png — 4x4 poses painted on a fake checkerboard
        (no alpha channel). Rows: lying, walking left, sitting, sleeping.
Output: assets/pet/spritesheet.png, assets/pet/animations.json,
        assets/pet/contact-sheet.png, assets/preview/preview.png/.gif

Poses that the reference does not contain are derived from the real frames
(mirror, shift, tilt, decorations). The decorations reuse the helpers of
tools/generate_sprites.py.

Usage:
    python tools/import_sprites.py

Requires Pillow and numpy (see tools/requirements.txt).
"""
from __future__ import annotations

import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps

from generate_sprites import HEART, NOTE, ZZZ, WHITE, background, chip, font, heart, note, z

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "source" / "reference.png"
# Views the reference lacks, generated with PixelLab from the reference itself
# (see PLAN-sprites.md). Frames are stored as downloaded: <folder>/<i>.png.
PIXELLAB = ROOT / "assets" / "source" / "pixellab"
PET_DIR = ROOT / "assets" / "pet"
PREVIEW_DIR = ROOT / "assets" / "preview"

FRAME = 80
COLS = 8
BASELINE = FRAME - 3          # every pose stands on this row
SOURCE_GRID = (4, 4)          # columns, rows in the reference
NATIVE_PIXEL = 4.45           # reference pixels per art pixel (measured by autocorrelation)
MIN_BAND = 100                # a pose row is at least this tall in the reference
MIN_PART = 150                # keep detached parts (tail motion lines) at least this big
PART_REACH = 40               # ...and this close to the cat, in reference pixels
WALK_STRIDE = 11              # art pixels walked per walk frame
WALK_LEG_TOP = BASELINE - 16  # rows below this are legs in the walk frames

MOUTH = (92, 38, 48, 255)
MOUTH_IN = (214, 110, 124, 255)


# ---------------------------------------------------------------------------
# Cutting the reference
# ---------------------------------------------------------------------------
def background_mask(rgb: np.ndarray) -> np.ndarray:
    """Flood the painted checkerboard from the image border.

    Checker squares are light and neutral (white / ~217 grey, b >= r). The
    cat's cream fur is warmer, and the dark outline closes every pose, so the
    flood never reaches the fur.
    """
    h, w, _ = rgb.shape
    lo = rgb.min(axis=2)
    hi = rgb.max(axis=2)
    checker = (lo >= 195) & ((hi - lo) <= 12) & (rgb[..., 2] >= rgb[..., 0] - 3)
    bg = np.zeros((h, w), dtype=bool)
    queue = deque()
    for x in range(w):
        queue.append((0, x))
        queue.append((h - 1, x))
    for y in range(h):
        queue.append((y, 0))
        queue.append((y, w - 1))
    while queue:
        y, x = queue.popleft()
        if bg[y, x] or not checker[y, x]:
            continue
        bg[y, x] = True
        if x > 0:
            queue.append((y, x - 1))
        if x < w - 1:
            queue.append((y, x + 1))
        if y > 0:
            queue.append((y - 1, x))
        if y < h - 1:
            queue.append((y + 1, x))
    return bg


def bands(profile: np.ndarray, min_len: int) -> list[tuple[int, int]]:
    out = []
    start = None
    for i, value in enumerate(profile):
        if value and start is None:
            start = i
        if not value and start is not None:
            if i - start >= min_len:
                out.append((start, i))
            start = None
    if start is not None and len(profile) - start >= min_len:
        out.append((start, len(profile)))
    return out


def components(mask: np.ndarray) -> list[tuple[int, tuple[int, int, int, int], np.ndarray]]:
    """4-connected components as (area, bbox, mask)."""
    h, w = mask.shape
    seen = np.zeros_like(mask)
    found = []
    for sy, sx in zip(*np.nonzero(mask)):
        if seen[sy, sx]:
            continue
        part = np.zeros_like(mask)
        queue = deque([(sy, sx)])
        seen[sy, sx] = True
        while queue:
            y, x = queue.popleft()
            part[y, x] = True
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((ny, nx))
        ys, xs = np.nonzero(part)
        found.append((len(ys), (xs.min(), ys.min(), xs.max(), ys.max()), part))
    return found


def clean(mask: np.ndarray) -> np.ndarray:
    """Keep the cat and the parts drawn next to it; drop checker specks."""
    parts = sorted(components(mask), key=lambda item: -item[0])
    if not parts:
        raise ValueError("clean: empty pose cell")
    area, (x0, y0, x1, y1), keep = parts[0]
    keep = keep.copy()
    for area, (px0, py0, px1, py1), part in parts[1:]:
        near = px1 >= x0 - PART_REACH and px0 <= x1 + PART_REACH and py1 >= y0 - PART_REACH and py0 <= y1 + PART_REACH
        if area >= MIN_PART and near:
            keep |= part
    return keep


def downscale(rgba: Image.Image) -> Image.Image:
    """Area-average down to the native art size, then binary alpha."""
    w = round(rgba.width / NATIVE_PIXEL)
    h = round(rgba.height / NATIVE_PIXEL)
    small = rgba.convert("RGBa").resize((w, h), Image.BOX).convert("RGBA")
    px = np.asarray(small).copy()
    opaque = px[..., 3] >= 128
    px[..., 3] = np.where(opaque, 255, 0)
    px[~opaque, :3] = 0
    return Image.fromarray(px, "RGBA")


def cut_reference(path: Path) -> list[list[Image.Image]]:
    if not path.exists():
        raise FileNotFoundError(f"reference art not found: {path}")
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    h, w, _ = rgb.shape
    fg = ~background_mask(rgb)
    rows = bands(fg.sum(axis=1) > 20, MIN_BAND)
    cols_n, rows_n = SOURCE_GRID
    if len(rows) != rows_n:
        raise ValueError(f"expected {rows_n} pose rows in {path.name}, found {len(rows)}: {rows}")
    cell_w = w / cols_n
    pad = 8
    grid = []
    for y0, y1 in rows:
        y0, y1 = max(0, y0 - pad), min(h, y1 + pad)
        row = []
        for c in range(cols_n):
            x0, x1 = round(c * cell_w), round((c + 1) * cell_w)
            mask = clean(fg[y0:y1, x0:x1])
            pixels = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
            pixels[..., :3] = rgb[y0:y1, x0:x1]
            pixels[..., 3] = np.where(mask, 255, 0)
            row.append(downscale(Image.fromarray(pixels, "RGBA")))
        grid.append(row)
    return grid


def load_frames(folder: Path, count: int) -> list[Image.Image]:
    paths = [folder / f"{i}.png" for i in range(count)]
    missing = [str(p) for p in paths if not p.exists()]
    if missing:
        raise FileNotFoundError(f"load_frames: missing PixelLab frames {missing}")
    return [Image.open(p).convert("RGBA") for p in paths]


def place_row(row: list[Image.Image], in_place: bool = False) -> list[Image.Image]:
    """Every pose on the baseline.

    By default the whole row shares one horizontal offset (the artist's
    placement). in_place aligns each frame on its left edge instead: in the
    walk row the nose drifts ~5 px across the cycle, which reads as a lurch
    back on every loop once the sprite itself is moving.
    """
    boxes = [img.getbbox() for img in row]
    if any(box is None for box in boxes):
        raise ValueError("place_row: a pose came out empty after downscaling")
    if in_place:
        widest = max(box[2] - box[0] for box in boxes)
        offsets = [(FRAME - widest) // 2 - box[0] for box in boxes]
        span = widest
    else:
        left = min(box[0] for box in boxes)
        span = max(box[2] for box in boxes) - left
        offsets = [(FRAME - span) // 2 - left] * len(boxes)
    if span > FRAME or max(box[3] - box[1] for box in boxes) > BASELINE:
        raise ValueError(f"place_row: poses do not fit a {FRAME}px cell: width {span}")
    out = []
    for img, box, dx in zip(row, boxes, offsets):
        cell = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
        cell.alpha_composite(img, (dx, BASELINE - box[3]))
        out.append(cell)
    return out


# ---------------------------------------------------------------------------
# Derived poses
# ---------------------------------------------------------------------------
def shift(img: Image.Image, dx: int, dy: int) -> Image.Image:
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (dx, dy), img)
    return out


def tilt(img: Image.Image, degrees: float, pivot: tuple[int, int], ground: bool = True) -> Image.Image:
    turned = img.rotate(degrees, resample=Image.NEAREST, center=pivot)
    if not ground:
        return turned
    box = turned.getbbox()
    return shift(turned, 0, BASELINE - box[3])


def squash(img: Image.Image, sx: float, sy: float) -> Image.Image:
    """Squash (sy < 1) or stretch (sy > 1), standing on the baseline."""
    box = img.getbbox()
    part = img.crop(box)
    w, h = round(part.width * sx), round(part.height * sy)
    if w > FRAME or h > BASELINE:
        raise ValueError(f"squash: {w}x{h} does not fit a {FRAME}px cell")
    part = part.resize((w, h), Image.NEAREST)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(part, ((box[0] + box[2]) // 2 - w // 2, BASELINE - h))
    return out


def lift_body(img: Image.Image, cut: int, px: int = 1) -> Image.Image:
    """Raise everything above row `cut` while the paws stay planted.

    The rows just above the cut are repeated to fill the gap, so the legs
    stretch by `px` instead of the body floating off them.
    """
    arr = np.asarray(img).copy()
    arr[:cut - px] = arr[px:cut]
    return Image.fromarray(arr, "RGBA")


def decorate(img: Image.Image, draw) -> Image.Image:
    out = img.copy()
    draw(ImageDraw.Draw(out), out.getbbox())
    return out


def nose(img: Image.Image) -> tuple[int, int]:
    """Centre of the pink nose of a front-facing pose.

    The inner ears are pink too, so only the face band (below the ears, above
    the chest) is searched.
    """
    px = np.asarray(img).astype(int)
    r, g, b, a = px[..., 0], px[..., 1], px[..., 2], px[..., 3]
    pink = (a > 0) & (r > 190) & (r - g > 45) & (r - b > 25)
    face = np.zeros_like(pink)
    box = img.getbbox()
    height = box[3] - box[1]
    face[box[1] + height // 4:box[1] + height // 2, :] = True
    ys, xs = np.nonzero(pink & face)
    if len(xs) == 0:
        raise ValueError(f"nose: no pink pixels in the face band of a pose with bbox {box}")
    return int(round(xs.mean())), int(round(ys.mean()))


def yawn(img: Image.Image, size: int) -> Image.Image:
    x, y = nose(img)

    def draw(d, _box):
        d.ellipse((x - size, y + 2, x + size, y + 2 + size * 2), fill=MOUTH)
        if size > 1:
            d.ellipse((x - size + 1, y + 3 + size, x + size - 1, y + 1 + size * 2), fill=MOUTH_IN)

    return decorate(img, draw)


def hearts(img: Image.Image, rise: int) -> Image.Image:
    def draw(d, box):
        top = box[1]
        heart(d, box[2] - 6, top + 8 - rise, 6, HEART)
        if rise > 2:
            heart(d, box[2] - 2, top + 20 - rise, 4, HEART)

    return decorate(img, draw)


def notes(img: Image.Image, rise: int, side: str = "E") -> Image.Image:
    """Music notes floating up beside the cat; `rise` moves them up (px).

    `side` is where the main note goes: the tail side, away from the head.
    Facing west the head reaches the cell edge, so there is no room for the
    second note on that side.
    """
    def draw(d, box):
        note(d, box[2] - 4 if side == "E" else box[0] - 2, box[1] + 14 - rise, NOTE)
        if rise >= 4 and side == "E":
            note(d, box[0] + 2, box[1] + 22 - rise, NOTE)

    return decorate(img, draw)


def zzz(img: Image.Image, step: int) -> Image.Image:
    def draw(d, box):
        base_x, base_y = box[0] + 8, box[1] - 4
        for i in range(step + 1):
            size = 3 + i
            z(d, base_x + i * 6, base_y - i * 7, size, ZZZ)

    return decorate(img, draw)


def scratch_marks(img: Image.Image, side: str) -> Image.Image:
    def draw(d, box):
        x = box[2] - 2 if side == "E" else box[0] + 2
        for i in range(3):
            d.line((x, box[1] + 10 + i * 4, x + (3 if side == "E" else -3), box[1] + 14 + i * 4), fill=WHITE, width=1)

    return decorate(img, draw)


# ---------------------------------------------------------------------------
# Animation map
# ---------------------------------------------------------------------------
def build_frames(grid: list[list[Image.Image]]):
    lie, sit, sleep = (place_row(grid[i]) for i in (0, 2, 3))
    front, closed, right, swish = sit
    # Walk in place, with the body 1 px higher on the two passing frames (1, 3:
    # fewest paws on the ground) so every step has a rise and fall.
    raw_walk = place_row(grid[1], in_place=True)
    walk = [lift_body(img, WALK_LEG_TOP) if i % 2 else img for i, img in enumerate(raw_walk)]
    walk_e = [ImageOps.mirror(img) for img in walk]
    rear = (FRAME - 18, BASELINE)

    # Front and back walks (PixelLab, 8 frames each) and getting up from the
    # front sitting pose: frames 0-4 of the "stand up and walk" clip.
    walk_s = place_row(load_frames(PIXELLAB / "standing" / "walk_south", 8))
    walk_n = place_row(load_frames(PIXELLAB / "standing" / "walk_north_skeleton", 8))
    get_up = place_row(load_frames(PIXELLAB / "sitting" / "get_up_walk_south", 8)[:5])
    # 8 frames per cycle instead of 4, so each frame covers about half the distance.
    walking_8 = {"stride": WALK_STRIDE // 2}
    # PixelLab clips keep only their clean frames: grooming drops 8, 10 and 11
    # (a magenta blob for a tongue); the jump drops 0 and 7 (flattened) and 3
    # (headless), leaving crouch, rise, up on the hind legs, land.
    groom = place_row(load_frames(PIXELLAB / "sitting" / "groom_south", 12))
    jump = place_row(load_frames(PIXELLAB / "standing" / "jump_south", 8))

    # Dance: anticipation (squash), hop (stretch), landing, sway, then the same
    # to the other side, ending with a happy eyes-closed hop. On a ~240 ms beat.
    left, left_swish = ImageOps.mirror(right), ImageOps.mirror(swish)
    feet = (FRAME // 2, BASELINE)

    def hop(img, height):
        return shift(squash(img, 0.96, 1.05), 0, -height)

    dance = [
        (right, 200),
        (squash(right, 1.06, 0.92), 160),
        (notes(hop(right, 4), 0), 180),
        (squash(right, 1.03, 0.96), 120),
        (notes(tilt(right, 6, feet), 3), 240),
        (notes(tilt(right, -6, feet), 6), 240),
        (squash(left, 1.06, 0.92), 160),
        (notes(hop(left, 4), 0, "W"), 180),
        (squash(left, 1.03, 0.96), 120),
        (notes(tilt(left_swish, 6, feet), 3, "W"), 240),
        (notes(tilt(left_swish, -6, feet), 6, "W"), 240),
        (squash(closed, 1.06, 0.92), 160),
        (notes(hop(closed, 5), 2), 220),
        (closed, 240),
    ]

    # Walk cycles advance with distance: one frame per WALK_STRIDE art pixels.
    # The reference frames have no planted-foot reference to measure, so 11 px
    # keeps the old look at the default speed and scale (130 px/s, 8 fps, 1.5x).
    walking = {"stride": WALK_STRIDE}

    # name -> (frames, fps, loop[, extras]); frames are images, deduplicated
    # below. extras: "durations" (ms per frame) and/or "stride" (art px).
    specs = {
        "idle": ([front, closed], 4, True, {"durations": [2600, 150]}),
        "blink": ([front, closed], 8, False, {"durations": [60, 150]}),
        "alert": ([right, swish], 4, True, {"durations": [550, 700]}),
        "sit": ([lie[0], lie[2], lie[3], lie[1], lie[0]], 2, False, {"durations": [700, 900, 450, 1100, 600]}),
        "walkN": (walk_n, 8, True, walking_8),
        "walkNE": (walk_e, 8, True, walking),
        "walkE": (walk_e, 8, True, walking),
        "walkSE": (walk_e, 8, True, walking),
        "walkS": (walk_s, 8, True, walking_8),
        "walkSW": (walk, 8, True, walking),
        "walkW": (walk, 8, True, walking),
        "walkNW": (walk, 8, True, walking),
        "sleep": ([zzz(sleep[0], 0), zzz(sleep[1], 1), zzz(sleep[0], 2), sleep[1]], 2, True, {"durations": [650, 650, 650, 1100]}),
        "tired": ([lie[3], lie[1]], 2, True),
        "scratchSelf": ([shift(swish, -1, 0), scratch_marks(swish, "E"), shift(swish, 1, 0), swish], 8, False),
        "scratchWallN": ([right, swish, right], 6, False),
        "scratchWallE": ([walk_e[0], scratch_marks(walk_e[0], "E"), walk_e[0]], 6, False),
        "scratchWallS": ([front, closed, front], 6, False),
        "scratchWallW": ([walk[0], scratch_marks(walk[0], "W"), walk[0]], 6, False),
        "drag": ([tilt(swish, 7, (FRAME // 2, 8), False), tilt(swish, -7, (FRAME // 2, 8), False)], 6, True),
        "happy": ([hearts(closed, 0), hearts(shift(closed, 0, -2), 3), hearts(closed, 6), closed], 6, False, {"durations": [110, 150, 220, 300]}),
        "groom": ([groom[i] for i in (0, 1, 2, 3, 4, 5, 6, 7, 9, 0)], 8, False,
                  {"durations": [150, 110, 110, 150, 150, 150, 150, 110, 150, 200]}),
        "yawn": ([closed, yawn(closed, 1), yawn(closed, 2), yawn(closed, 2), closed], 4, False, {"durations": [200, 220, 650, 350, 250]}),
        "stretch": ([walk[0], tilt(walk[0], -6, rear), tilt(walk[0], -10, rear), tilt(walk[0], -6, rear)], 3, False, {"durations": [250, 300, 900, 350]}),
        "dance": ([img for img, _ in dance], 6, True, {"durations": [ms for _, ms in dance]}),
        "danceJump": ([jump[1], jump[2], notes(jump[4], 4), jump[5], jump[6]], 6, True,
                      {"durations": [140, 110, 300, 120, 180]}),
        # Transitions between rows of the reference, so poses do not pop.
        "lieDown": ([closed, lie[1], sleep[0]], 4, False, {"durations": [180, 420, 300]}),
        "wakeUp": ([sleep[1], lie[3], lie[0], front], 4, False, {"durations": [250, 300, 300, 200]}),
        "getUp": (get_up, 10, False, {"durations": [80, 80, 80, 80, 100]}),
        "sitDown": (list(reversed(get_up)), 10, False, {"durations": [80, 80, 80, 80, 120]}),
    }
    return specs


def assemble(specs):
    cells: list[Image.Image] = []
    index_of: dict[bytes, int] = {}
    animations = {}
    for name, (frames, fps, loop, *rest) in specs.items():
        extras = rest[0] if rest else {}
        unknown = set(extras) - {"durations", "stride"}
        if unknown:
            raise ValueError(f"assemble: {name} has unknown extras {sorted(unknown)}")
        if "durations" in extras and len(extras["durations"]) != len(frames):
            raise ValueError(f"assemble: {name} has {len(frames)} frames but {len(extras['durations'])} durations")
        refs = []
        for img in frames:
            key = img.tobytes()
            if key not in index_of:
                index_of[key] = len(cells)
                cells.append(img)
            i = index_of[key]
            refs.append([i % COLS, i // COLS])
        animations[name] = {"frames": refs, "fps": fps, "loop": loop, **extras}
    rows = -(-len(cells) // COLS)
    sheet = Image.new("RGBA", (COLS * FRAME, rows * FRAME), (0, 0, 0, 0))
    for i, img in enumerate(cells):
        sheet.alpha_composite(img, ((i % COLS) * FRAME, (i // COLS) * FRAME))
    meta = {
        "frameWidth": FRAME,
        "frameHeight": FRAME,
        "columns": COLS,
        "rows": rows,
        "animations": animations,
        "source": "tools/import_sprites.py",
    }
    return sheet, meta, len(cells)


# ---------------------------------------------------------------------------
# Review and Marketplace images
# ---------------------------------------------------------------------------
def frame_of(sheet: Image.Image, meta, name: str, i: int = 0) -> Image.Image:
    col, row = meta["animations"][name]["frames"][i]
    return sheet.crop((col * FRAME, row * FRAME, (col + 1) * FRAME, (row + 1) * FRAME))


def paste_frame(base: Image.Image, img: Image.Image, x: int, y: int, scale: int):
    base.alpha_composite(img.resize((FRAME * scale, FRAME * scale), Image.NEAREST), (x, y))


def make_preview(sheet, meta, frame_count):
    w, h = 640, 360
    img = background(w, h)
    d = ImageDraw.Draw(img)
    d.text((36, 38), "VFD Pet", font=font(46, True), fill=(255, 244, 220, 255))
    d.text((38, 96), "Tu michi en pixel art para Spotify", font=font(18), fill=(200, 208, 225, 255))
    d.text((38, 124), "Te sigue, duerme en la barra y reacciona a la música.", font=font(14), fill=(160, 170, 190, 255))
    x = 38
    for text in (f"{FRAME}×{FRAME} px", f"{frame_count} frames", f"{len(meta['animations'])} animaciones", "offline"):
        x += chip(d, x, 158, text) + 8
    d.rounded_rectangle((34, 286, 606, 338), radius=14, fill=(17, 19, 30, 220), outline=(255, 255, 255, 18), width=1)
    d.rounded_rectangle((54, 309, 440, 314), radius=2, fill=(70, 76, 96, 255))
    d.rounded_rectangle((54, 309, 246, 314), radius=2, fill=(56, 196, 176, 255))
    paste_frame(img, frame_of(sheet, meta, "sleep", 1), 452, 160, 2)
    paste_frame(img, frame_of(sheet, meta, "idle"), 440, 8, 2)
    d.text((38, 252), "michi.exe", font=font(13, True), fill=(56, 196, 176, 255))
    d.text((38, 268), "sin conexión · sin GIFs remotos", font=font(12), fill=(150, 160, 180, 255))
    return img.convert("RGB")


def make_gif(sheet, meta):
    w, h = 480, 270
    bg = background(w, h).convert("RGBA")
    bd = ImageDraw.Draw(bg)
    bd.text((24, 20), "VFD Pet", font=font(30, True), fill=(255, 244, 220, 255))
    bd.text((26, 58), "idle · walk · happy · dance · sleep", font=font(12), fill=(180, 190, 210, 255))
    bd.rounded_rectangle((22, 228, 458, 252), radius=12, fill=(17, 19, 30, 220), outline=(255, 255, 255, 18), width=1)
    seq = []
    for name, repeat, dx in (("idle", 1, 0), ("walkE", 2, 6), ("happy", 1, 0), ("dance", 2, 0), ("sleep", 2, 0)):
        count = len(meta["animations"][name]["frames"])
        for r in range(repeat):
            for i in range(count):
                seq.append((frame_of(sheet, meta, name, i), 250 + (r * count + i) * dx))
    frames = []
    for img, x in seq:
        frame = bg.copy()
        paste_frame(frame, img, x, 70, 2)
        frames.append(frame.convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=128))
    frames[0].save(PREVIEW_DIR / "preview.gif", save_all=True, append_images=frames[1:], duration=160, loop=0, optimize=True, disposal=2)
    return len(frames)


def make_contact_sheet(sheet, meta):
    names = list(meta["animations"])
    cols = 5
    rows = -(-len(names) // cols)
    cw, ch = 128, 150
    img = Image.new("RGB", (cols * cw, rows * ch), (24, 26, 40))
    d = ImageDraw.Draw(img)
    for index, name in enumerate(names):
        x, y = (index % cols) * cw, (index // cols) * ch
        d.rounded_rectangle((x + 6, y + 6, x + cw - 6, y + ch - 6), radius=10, fill=(32, 35, 52), outline=(255, 255, 255, 16), width=1)
        frame = frame_of(sheet, meta, name, len(meta["animations"][name]["frames"]) // 2)
        big = frame.resize((FRAME + FRAME // 4, FRAME + FRAME // 4), Image.NEAREST)
        img.paste(big.convert("RGB"), (x + (cw - big.width) // 2, y + 12), big)
        tw = d.textbbox((0, 0), name, font=font(13))[2]
        d.text((x + (cw - tw) // 2, y + ch - 30), name, font=font(13), fill=(220, 226, 240))
    return img


def main():
    PET_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    grid = cut_reference(SOURCE)
    sheet, meta, frame_count = assemble(build_frames(grid))
    # Indexed PNG with a transparency table: ~4x smaller than RGBA. Lossy: the
    # downscaled art has ~10k colours; mean channel error ~2/255, max ~28.
    sheet.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(PET_DIR / "spritesheet.png", optimize=True)
    (PET_DIR / "animations.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    make_preview(sheet, meta, frame_count).save(PREVIEW_DIR / "preview.png", optimize=True)
    gif_frames = make_gif(sheet, meta)
    make_contact_sheet(sheet, meta).save(PET_DIR / "contact-sheet.png", optimize=True)
    print(f"sheet: {sheet.width}x{sheet.height}, {frame_count} frames")
    print(f"animations: {len(meta['animations'])}")
    print(f"preview: 640x360, gif frames: {gif_frames}")
    print(f"sheet bytes: {(PET_DIR / 'spritesheet.png').stat().st_size}")


if __name__ == "__main__":
    main()
