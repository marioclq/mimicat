#!/usr/bin/env python3
"""Generate the VFD Pet sprite sheet, animation map and Marketplace preview.

The art is original and fully procedural: no third-party sprite is copied.
Frames are 64x64 RGBA, laid out on a 10x9 grid (640x576).

Usage:
    python tools/generate_sprites.py

Requires Pillow (see tools/requirements.txt).
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
PET_DIR = ROOT / "assets" / "pet"
PREVIEW_DIR = ROOT / "assets" / "preview"
FRAME = 64
COLS = 10
ROWS = 9

# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------
OUTLINE = (36, 26, 46, 255)
FUR = (240, 180, 94, 255)
FUR_DARK = (206, 132, 54, 255)
FUR_LIGHT = (255, 216, 156, 255)
BELLY = (255, 243, 220, 255)
EAR = (240, 138, 138, 255)
NOSE = (220, 88, 108, 255)
EYE = (111, 211, 160, 255)
EYE_DARK = (27, 54, 47, 255)
WHITE = (255, 255, 255, 255)
COLLAR = (56, 196, 176, 255)
BELL = (255, 208, 96, 255)
ZZZ = (159, 216, 255, 255)
HEART = (255, 107, 138, 255)
NOTE = (255, 209, 102, 255)
SHADOW = (20, 12, 26, 58)
SWEAT = (126, 202, 255, 255)


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------
def ellipse(d: ImageDraw.ImageDraw, box, fill, outline=OUTLINE, width=2):
    box = tuple(int(v) for v in box)
    if outline is not None:
        d.ellipse(box, fill=outline)
        if width * 2 < min(box[2] - box[0], box[3] - box[1]):
            d.ellipse((box[0] + width, box[1] + width, box[2] - width, box[3] - width), fill=fill)
    else:
        d.ellipse(box, fill=fill)


def rounded(d: ImageDraw.ImageDraw, box, radius, fill, outline=OUTLINE, width=2):
    box = tuple(int(v) for v in box)
    if outline is not None:
        d.rounded_rectangle(box, radius=radius, fill=outline)
        d.rounded_rectangle(
            (box[0] + width, box[1] + width, box[2] - width, box[3] - width),
            radius=max(1, radius - width),
            fill=fill,
        )
    else:
        d.rounded_rectangle(box, radius=radius, fill=fill)


def _inset(points, amount):
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)
    out = []
    for x, y in points:
        dx, dy = x - cx, y - cy
        length = math.hypot(dx, dy) or 1.0
        out.append((x - dx / length * amount, y - dy / length * amount))
    return out


def poly(d: ImageDraw.ImageDraw, points, fill, outline=OUTLINE, width=2):
    points = [(int(x), int(y)) for x, y in points]
    if outline is not None:
        d.polygon(points, fill=outline)
        inner = [(int(x), int(y)) for x, y in _inset(points, width)]
        if len(inner) >= 3:
            d.polygon(inner, fill=fill)
    else:
        d.polygon(points, fill=fill)


def line(d: ImageDraw.ImageDraw, points, fill, width=3, outline=OUTLINE, outline_width=2):
    points = [(int(x), int(y)) for x, y in points]
    if outline is not None and outline_width:
        d.line(points, fill=outline, width=width + outline_width, joint="curve")
    d.line(points, fill=fill, width=width, joint="curve")


def bezier(p0, p1, p2, steps=12):
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))
    return out


def z(d, x, y, size, color=ZZZ):
    points = [(x, y), (x + size, y), (x, y + size), (x + size, y + size)]
    d.line(points, fill=color, width=1)


def heart(d, x, y, size, color=HEART):
    r = max(2, size // 2)
    d.ellipse((x - r, y - r, x, y), fill=color)
    d.ellipse((x, y - r, x + r, y), fill=color)
    d.polygon([(x - r, y - 1), (x + r, y - 1), (x, y + r + 1)], fill=color)


def note(d, x, y, color=NOTE):
    d.ellipse((x, y, x + 4, y + 3), fill=color)
    d.line((x + 4, y + 1, x + 4, y - 8), fill=color, width=1)
    d.line((x + 4, y - 8, x + 8, y - 6), fill=color, width=1)


def spark(d, x, y, color=WHITE):
    d.line((x - 2, y, x + 2, y), fill=color, width=1)
    d.line((x, y - 2, x, y + 2), fill=color, width=1)


# ---------------------------------------------------------------------------
# Cat renderer
# ---------------------------------------------------------------------------
class Cat:
    def render(self, pose):
        img = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        view = pose.get("view", "front")
        if view == "front":
            self.front(d, pose)
        elif view == "back":
            self.back(d, pose)
        elif view == "side":
            self.side(d, pose)
        elif view == "sleep":
            self.sleep(d, pose)
        else:
            raise ValueError(f"unknown view {view!r}")
        if pose.get("flip"):
            img = ImageOps.mirror(img)
            d = ImageDraw.Draw(img)
        self.extras(d, pose)
        return img

    # -- shared pieces ------------------------------------------------------
    def tail_front(self, d, pose):
        dy = pose.get("body_dy", 0)
        kind = pose.get("tail", "up")
        base = (43, 44 + dy)
        curves = {
            "up": ((57, 37 + dy), (53, 21 + dy)),
            "wagL": ((58, 45 + dy), (51, 30 + dy)),
            "wagR": ((59, 37 + dy), (50, 25 + dy)),
            "down": ((57, 50 + dy), (52, 58 + dy)),
            "straight": ((57, 40 + dy), (60, 27 + dy)),
            "curl": ((55, 46 + dy), (43, 55 + dy)),
            "wrap": ((52, 48 + dy), (34, 57 + dy)),
        }
        ctrl, end = curves.get(kind, curves["up"])
        pts = bezier(base, ctrl, end)
        line(d, pts, FUR, width=3, outline_width=2)
        line(d, pts[-4:], FUR_LIGHT, width=3, outline=None)

    def ear(self, d, side, hx, hy, mood="normal"):
        if side == "l":
            base = [(13 + hx, 21 + hy), (16 + hx, 5 + hy), (28 + hx, 18 + hy)]
            inner = [(16 + hx, 18 + hy), (17 + hx, 9 + hy), (25 + hx, 18 + hy)]
        else:
            base = [(36 + hx, 18 + hy), (46 + hx, 5 + hy), (49 + hx, 21 + hy)]
            inner = [(37 + hx, 18 + hy), (45 + hx, 9 + hy), (46 + hx, 18 + hy)]
        if mood == "perk":
            base = [(x, y - 2) for x, y in base]
            inner = [(x, y - 2) for x, y in inner]
        elif mood == "droop":
            base = [(x + (-2 if side == "l" else 2), y + 3) for x, y in base]
            inner = [(x + (-1 if side == "l" else 1), y + 2) for x, y in inner]
        elif mood == "back":
            base = [(x + (-3 if side == "l" else 3), y + 2) for x, y in base]
            inner = [(x + (-2 if side == "l" else 2), y + 2) for x, y in inner]
        poly(d, base, FUR, width=2)
        poly(d, inner, EAR, outline=None)

    def head_front(self, d, pose):
        hx = pose.get("head_dx", 0)
        hy = pose.get("body_dy", 0) + pose.get("head_dy", 0)
        mood = pose.get("ears", "normal")
        self.ear(d, "l", hx, hy, mood)
        self.ear(d, "r", hx, hy, mood)
        ellipse(d, (12 + hx, 12 + hy, 44 + hx, 42 + hy), FUR)
        # cheek tufts
        poly(d, [(12 + hx, 29 + hy), (7 + hx, 33 + hy), (13 + hx, 36 + hy)], FUR, outline=None)
        poly(d, [(44 + hx, 29 + hy), (49 + hx, 33 + hy), (43 + hx, 36 + hy)], FUR, outline=None)
        # forehead stripes
        for sx in (25, 32, 39):
            d.line((sx + hx, 14 + hy, sx + hx, 18 + hy), fill=FUR_DARK, width=1)
        self.face_front(d, hx, hy, pose)

    def face_front(self, d, hx, hy, pose):
        eyes = pose.get("eyes", "open")
        for side, x in (("l", 20), ("r", 34)):
            box = (x + hx, 23 + hy, x + 8 + hx, 31 + hy)
            self.eye(d, box, eyes)
        # nose + mouth
        poly(d, [(29 + hx, 30 + hy), (35 + hx, 30 + hy), (32 + hx, 34 + hy)], NOSE, width=1)
        mouth = pose.get("mouth", "smile")
        if mouth == "open":
            ellipse(d, (27 + hx, 33 + hy, 37 + hx, 41 + hy), NOSE, width=1)
            ellipse(d, (29 + hx, 37 + hy, 35 + hx, 40 + hy), HEART, outline=None)
        elif mouth == "tongue":
            d.line((32 + hx, 34 + hy, 29 + hx, 37 + hy), fill=OUTLINE, width=1)
            d.line((32 + hx, 34 + hy, 35 + hx, 37 + hy), fill=OUTLINE, width=1)
            ellipse(d, (30 + hx, 36 + hy, 34 + hx, 40 + hy), HEART, outline=None)
        else:
            d.line((32 + hx, 34 + hy, 29 + hx, 37 + hy), fill=OUTLINE, width=1)
            d.line((32 + hx, 34 + hy, 35 + hx, 37 + hy), fill=OUTLINE, width=1)
        # whiskers
        for wy in (31, 34):
            d.line((20 + hx, wy + hy, 7 + hx, wy - 2 + hy), fill=WHITE, width=1)
            d.line((44 + hx, wy + hy, 57 + hx, wy - 2 + hy), fill=WHITE, width=1)
        if pose.get("blush"):
            d.ellipse((17 + hx, 33 + hy, 22 + hx, 36 + hy), fill=(255, 130, 150, 90))
            d.ellipse((42 + hx, 33 + hy, 47 + hx, 36 + hy), fill=(255, 130, 150, 90))

    def eye(self, d, box, style):
        x0, y0, x1, y1 = box
        if style == "closed":
            d.arc((x0, y0 + 2, x1, y1), 0, 180, fill=OUTLINE, width=2)
        elif style == "happy":
            d.arc((x0, y0, x1, y1 - 1), 180, 360, fill=OUTLINE, width=2)
        elif style == "wide":
            b = (x0 - 1, y0 - 1, x1 + 1, y1 + 1)
            ellipse(d, b, EYE, width=1)
            cx = (b[0] + b[2]) // 2
            d.ellipse((cx - 1, b[1] + 3, cx + 1, b[3] - 2), fill=EYE_DARK)
            d.rectangle((cx - 1, b[1] + 3, cx, b[1] + 4), fill=WHITE)
        else:
            ellipse(d, box, EYE, width=1)
            cx = (x0 + x1) // 2
            d.ellipse((cx - 1, y0 + 2, cx + 1, y1 - 2), fill=EYE_DARK)
            d.rectangle((cx - 1, y0 + 2, cx, y0 + 3), fill=WHITE)
            if style == "half":
                d.rectangle((x0, y0, x1, y0 + 3), fill=FUR)
                d.line((x0, y0 + 3, x1, y0 + 3), fill=OUTLINE, width=1)

    def front_legs(self, d, pose, body_dy=0):
        legs = pose.get("legs", [0, 0, 0, 0])
        for x, dy in ((23, legs[2]), (36, legs[3])):
            rounded(d, (x, 42 + body_dy + dy, x + 6, 55 + body_dy + dy), 3, FUR)
            d.line((x + 1, 53 + body_dy + dy, x + 2, 53 + body_dy + dy), fill=OUTLINE, width=1)
            d.line((x + 4, 53 + body_dy + dy, x + 5, 53 + body_dy + dy), fill=OUTLINE, width=1)

    def back_legs(self, d, pose, body_dy=0):
        legs = pose.get("legs", [0, 0, 0, 0])
        for x, dy in ((20, legs[0]), (35, legs[1])):
            ellipse(d, (x, 46 + body_dy + dy, x + 9, 55 + body_dy + dy), FUR_DARK, width=1)
            d.line((x + 2, 53 + body_dy + dy, x + 3, 53 + body_dy + dy), fill=OUTLINE, width=1)
            d.line((x + 5, 53 + body_dy + dy, x + 6, 53 + body_dy + dy), fill=OUTLINE, width=1)

    def collar(self, d, box, bell=True):
        x0, y0, x1, y1 = box
        rounded(d, box, 3, COLLAR, width=2)
        if bell:
            ellipse(d, ((x0 + x1) // 2 - 3, y1 - 2, (x0 + x1) // 2 + 3, y1 + 4), BELL, width=1)
            d.line(((x0 + x1) // 2, y1 + 1, (x0 + x1) // 2, y1 + 3), fill=OUTLINE, width=1)

    # -- front / back -------------------------------------------------------
    def front(self, d, pose):
        dy = pose.get("body_dy", 0)
        d.ellipse((16, 54, 48, 58), fill=SHADOW)
        self.tail_front(d, pose)
        self.back_legs(d, pose, dy)
        ellipse(d, (18, 30 + dy, 46, 53 + dy), FUR)
        ellipse(d, (24, 37 + dy, 40, 53 + dy), BELLY, outline=None)
        for sx in (20, 25, 42):
            d.line((sx, 35 + dy, sx + 2, 41 + dy), fill=FUR_DARK, width=1)
        self.collar(d, (19, 37 + dy, 45, 43 + dy))
        self.front_legs(d, pose, dy)
        self.head_front(d, pose)

    def back(self, d, pose):
        dy = pose.get("body_dy", 0)
        d.ellipse((16, 54, 48, 58), fill=SHADOW)
        self.tail_front(d, pose)
        self.back_legs(d, pose, dy)
        ellipse(d, (18, 30 + dy, 46, 53 + dy), FUR)
        for sx in (22, 30, 38):
            d.line((sx, 33 + dy, sx + 1, 42 + dy), fill=FUR_DARK, width=1)
        self.collar(d, (19, 37 + dy, 45, 43 + dy), bell=False)
        self.front_legs(d, pose, dy)
        hy = dy + pose.get("head_dy", 0)
        hx = pose.get("head_dx", 0)
        mood = pose.get("ears", "normal")
        self.ear(d, "l", hx, hy, mood)
        self.ear(d, "r", hx, hy, mood)
        ellipse(d, (12 + hx, 12 + hy, 44 + hx, 42 + hy), FUR)
        for sx in (25, 32, 39):
            d.line((sx + hx, 14 + hy, sx + hx, 21 + hy), fill=FUR_DARK, width=1)
        # back of the head: a small tuft instead of a face
        d.line((28 + hx, 33 + hy, 32 + hx, 30 + hy, 36 + hx, 33 + hy), fill=FUR_DARK, width=1)

    # -- side ---------------------------------------------------------------
    def side(self, d, pose):
        dy = pose.get("body_dy", 0)
        legs = pose.get("legs", [0, 0, 0, 0])
        d.ellipse((14, 54, 50, 58), fill=SHADOW)
        # tail behind the body
        kind = pose.get("tail", "up")
        base = (19, 43 + dy)
        curves = {
            "up": ((7, 39 + dy), (10, 22 + dy)),
            "wagL": ((6, 46 + dy), (10, 34 + dy)),
            "wagR": ((7, 38 + dy), (4, 26 + dy)),
            "down": ((7, 50 + dy), (12, 58 + dy)),
            "straight": ((6, 42 + dy), (2, 30 + dy)),
            "curl": ((8, 48 + dy), (18, 57 + dy)),
            "wrap": ((8, 48 + dy), (24, 58 + dy)),
        }
        ctrl, end = curves.get(kind, curves["up"])
        pts = bezier(base, ctrl, end)
        line(d, pts, FUR, width=3, outline_width=2)
        line(d, pts[-4:], FUR_LIGHT, width=3, outline=None)
        # back legs
        for x, ldy in ((21, legs[0]), (29, legs[1])):
            rounded(d, (x, 43 + dy + ldy, x + 6, 56 + dy + ldy), 3, FUR_DARK)
        ellipse(d, (15, 32 + dy, 47, 52 + dy), FUR)
        ellipse(d, (22, 41 + dy, 42, 52 + dy), BELLY, outline=None)
        for sx in (20, 25, 31):
            d.line((sx, 34 + dy, sx + 3, 40 + dy), fill=FUR_DARK, width=1)
        # front legs
        for x, ldy in ((38, legs[2]), (45, legs[3])):
            rounded(d, (x, 43 + dy + ldy, x + 6, 56 + dy + ldy), 3, FUR)
        self.collar(d, (38, 36 + dy, 49, 43 + dy))
        hx = pose.get("head_dx", 2)
        hy = dy + pose.get("head_dy", 0)
        self.ear_side(d, (39 + hx, 24 + hy), (42 + hx, 9 + hy), (49 + hx, 21 + hy), pose.get("ears", "normal"))
        self.ear_side(d, (50 + hx, 21 + hy), (57 + hx, 13 + hy), (58 + hx, 27 + hy), pose.get("ears", "normal"))
        ellipse(d, (36 + hx, 18 + hy, 57 + hx, 40 + hy), FUR)
        for sx in (40, 44):
            d.line((sx + hx, 20 + hy, sx + hx, 25 + hy), fill=FUR_DARK, width=1)
        self.face_side(d, hx, hy, pose)
        if pose.get("paw") == "right":
            pts = [(46, 41 + dy), (55, 37 + dy), (61, 35 + dy)]
            line(d, pts, FUR, width=4, outline_width=2)
            ellipse(d, (58, 32 + dy, 64, 38 + dy), FUR, width=1)

    def ear_side(self, d, p0, p1, p2, mood="normal"):
        pts = [p0, p1, p2]
        if mood == "perk":
            pts = [(x, y - 2) for x, y in pts]
        elif mood == "droop":
            pts = [(x + 2, y + 3) for x, y in pts]
        poly(d, pts, FUR, width=2)
        inner = _inset(pts, 2)
        poly(d, inner, EAR, outline=None)

    def face_side(self, d, hx, hy, pose):
        eyes = pose.get("eyes", "open")
        box = (49 + hx, 25 + hy, 55 + hx, 31 + hy)
        self.eye(d, box, "closed" if eyes == "closed" else ("happy" if eyes == "happy" else "open"))
        # nose at the tip of the muzzle
        poly(d, [(56 + hx, 29 + hy), (61 + hx, 30 + hy), (57 + hx, 33 + hy)], NOSE, width=1)
        mouth = pose.get("mouth", "smile")
        if mouth in ("open", "tongue"):
            ellipse(d, (54 + hx, 31 + hy, 60 + hx, 37 + hy), NOSE, width=1)
            if mouth == "tongue":
                ellipse(d, (56 + hx, 34 + hy, 59 + hx, 37 + hy), HEART, outline=None)
        else:
            d.line((57 + hx, 33 + hy, 60 + hx, 35 + hy), fill=OUTLINE, width=1)
        for wy in (30, 33):
            d.line((55 + hx, wy + hy, 63 + hx, wy - 2 + hy), fill=WHITE, width=1)

    # -- sleep --------------------------------------------------------------
    def sleep(self, d, pose):
        dy = pose.get("body_dy", 0)
        d.ellipse((10, 54, 54, 58), fill=SHADOW)
        # tail curled around the front
        pts = bezier((18, 47 + dy), (7, 42 + dy), (13, 55 + dy), steps=10)
        pts += [(22, 56 + dy), (30, 56 + dy)]
        line(d, pts, FUR, width=3, outline_width=2)
        ellipse(d, (12, 42 + dy, 50, 56 + dy), FUR)
        ellipse(d, (17, 47 + dy, 38, 56 + dy), BELLY, outline=None)
        for sx in (18, 24, 30):
            d.line((sx, 45 + dy, sx + 3, 50 + dy), fill=FUR_DARK, width=1)
        # head resting on the paws
        ellipse(d, (36, 39 + dy, 56, 54 + dy), FUR)
        self.ear_side(d, (38, 43 + dy), (39, 33 + dy), (45, 41 + dy), "droop")
        self.ear_side(d, (48, 41 + dy), (54, 35 + dy), (55, 44 + dy), "droop")
        d.arc((41, 45 + dy, 49, 51 + dy), 0, 180, fill=OUTLINE, width=2)
        d.arc((50, 45 + dy, 55, 50 + dy), 0, 180, fill=OUTLINE, width=2)
        poly(d, [(53, 49 + dy), (57, 50 + dy), (54, 52 + dy)], NOSE, width=1)
        d.line((54, 52 + dy, 52, 54 + dy), fill=OUTLINE, width=1)
        ellipse(d, (45, 52 + dy, 53, 56 + dy), BELLY, width=1)
        d.line((48, 54 + dy, 49, 54 + dy), fill=OUTLINE, width=1)

    # -- extras -------------------------------------------------------------
    def extras(self, d, pose):
        extras = pose.get("extras", [])
        if "zzz" in extras:
            z(d, 48, 24, 5)
            z(d, 54, 16, 4)
            z(d, 59, 9, 3)
        if "heart" in extras:
            for x, y, s in ((14, 20, 7), (48, 14, 5), (55, 24, 4)):
                heart(d, x, y, s)
        if "note" in extras:
            note(d, 12, 28)
            note(d, 50, 18)
        if "alert" in extras:
            d.line((53, 12, 53, 19), fill=BELL, width=2)
            d.ellipse((52, 21, 54, 23), fill=BELL)
        if "motion" in extras:
            for x, y in ((8, 26), (10, 34), (52, 24)):
                d.line((x, y, x + 4, y), fill=WHITE, width=1)
        if "scratch" in extras:
            for x, y in pose.get("scratch_pos", ((56, 25), (59, 29), (56, 33))):
                d.line((x, y, x + 4, y + 2), fill=WHITE, width=1)
        if "sweat" in extras:
            ellipse(d, (49, 15, 52, 20), SWEAT, outline=None)
        if "spark" in extras:
            spark(d, 55, 20)
            spark(d, 9, 24, NOTE)


# ---------------------------------------------------------------------------
# Animation definitions
# ---------------------------------------------------------------------------
# name, frame count, fps, loop
SPECS = [
    ("idle", 4, 5, True),
    ("blink", 2, 8, False),
    ("alert", 2, 8, True),
    ("sit", 2, 4, True),
    ("walkN", 4, 12, True),
    ("walkNE", 4, 12, True),
    ("walkE", 4, 12, True),
    ("walkSE", 4, 12, True),
    ("walkS", 4, 12, True),
    ("walkSW", 4, 12, True),
    ("walkW", 4, 12, True),
    ("walkNW", 4, 12, True),
    ("sleep", 6, 3, True),
    ("tired", 2, 3, True),
    ("scratchSelf", 4, 8, False),
    ("scratchWallN", 3, 10, False),
    ("scratchWallE", 3, 10, False),
    ("scratchWallS", 3, 10, False),
    ("scratchWallW", 3, 10, False),
    ("drag", 2, 10, True),
    ("happy", 4, 8, False),
    ("groom", 4, 8, False),
    ("yawn", 4, 6, False),
    ("stretch", 4, 6, False),
    ("dance", 6, 10, True),
]

WALK_LEGS = [
    [0, 2, 2, 0],
    [2, 0, 0, 2],
    [0, 2, 2, 0],
    [2, 0, 0, 2],
]

WALK_TAIL = ["up", "wagL", "up", "wagR"]


def pose_for(name, i):
    if name == "idle":
        return dict(
            view="front",
            body_dy=[0, 0, -1, 0][i],
            tail=WALK_TAIL[i],
            eyes="closed" if i == 2 else "open",
            mouth="smile",
            ears="normal",
        )
    if name == "blink":
        return dict(view="front", eyes="closed", tail="up", ears="normal", mouth="smile")
    if name == "alert":
        return dict(
            view="front",
            body_dy=[-1, 0][i],
            head_dy=[-1, 0][i],
            eyes="wide",
            mouth="smile",
            ears="perk",
            tail="up",
            extras=["alert"] if i == 0 else [],
        )
    if name == "sit":
        return dict(
            view="front",
            body_dy=2,
            head_dy=1,
            eyes="open",
            mouth="smile",
            ears="normal",
            tail="curl",
        )
    if name in ("walkN", "walkS"):
        return dict(
            view="back" if name == "walkN" else "front",
            body_dy=[0, -1, 0, -1][i],
            legs=WALK_LEGS[i],
            eyes="open",
            mouth="smile",
            ears="normal",
            tail=WALK_TAIL[i],
        )
    if name in ("walkE", "walkW", "walkNE", "walkSE", "walkNW", "walkSW"):
        up = name in ("walkNE", "walkNW")
        down = name in ("walkSE", "walkSW")
        return dict(
            view="side",
            flip=name in ("walkW", "walkNW", "walkSW"),
            body_dy=(-1 if up else (1 if down else 0)) + [0, -1, 0, -1][i],
            head_dy=(-1 if up else (1 if down else 0)) + [0, -1, 0, -1][i],
            legs=WALK_LEGS[i],
            eyes="open",
            mouth="smile",
            ears="perk" if up else "normal",
            tail=WALK_TAIL[i],
        )
    if name == "sleep":
        return dict(
            view="sleep",
            body_dy=[0, -1, 0, 1, 0, -1][i],
            eyes="closed",
            ears="droop",
            tail="wrap",
            extras=["zzz"],
        )
    if name == "tired":
        return dict(
            view="front",
            body_dy=2,
            head_dy=2,
            eyes="half",
            mouth="smile",
            ears="droop",
            tail="down",
            extras=["sweat"] if i == 1 else [],
        )
    if name == "scratchSelf":
        return dict(
            view="front",
            head_dx=[-1, 0, 1, 0][i],
            legs=[0, 0, 0, -10],
            eyes="happy" if i % 2 else "closed",
            mouth="smile",
            ears="normal",
            tail="wagL" if i % 2 else "wagR",
            extras=["scratch"],
            scratch_pos=((50, 27), (53, 31), (50, 35)),
        )
    if name == "scratchWallN":
        return dict(
            view="back",
            body_dy=[-1, 0, -1][i],
            legs=[0, 0, -10, 0],
            ears="normal",
            tail="up",
            extras=["scratch"],
            scratch_pos=((48, 8), (52, 5), (56, 8)),
        )
    if name == "scratchWallS":
        return dict(
            view="front",
            body_dy=[0, -1, 0][i],
            legs=[0, 0, 0, 2],
            eyes="open",
            mouth="smile",
            ears="normal",
            tail="up",
            extras=["scratch"],
            scratch_pos=((50, 51), (53, 55), (56, 51)),
        )
    if name in ("scratchWallE", "scratchWallW"):
        return dict(
            view="side",
            flip=name == "scratchWallW",
            body_dy=[0, -1, 0][i],
            head_dy=[0, -1, 0][i],
            paw="right",
            eyes="wide",
            mouth="smile",
            ears="perk",
            tail="up",
            extras=["scratch"],
        )
    if name == "drag":
        return dict(
            view="front",
            body_dy=-2,
            head_dy=-1,
            legs=[2, 2, 4, 4],
            eyes="wide",
            mouth="open",
            ears="back",
            tail="straight",
            extras=["motion"],
        )
    if name == "happy":
        return dict(
            view="front",
            body_dy=[0, -2, 0, -1][i],
            head_dy=[0, -1, 0, 0][i],
            eyes="happy",
            mouth="smile",
            ears="perk",
            tail="wagL" if i % 2 else "wagR",
            blush=True,
            extras=["heart"] if i else [],
        )
    if name == "groom":
        return dict(
            view="front",
            head_dx=[1, 2, -1, -2][i],
            legs=[0, 0, 0, -10],
            eyes="closed",
            mouth="tongue",
            ears="normal",
            tail="wagL" if i % 2 else "wagR",
            extras=["spark"] if i == 2 else [],
        )
    if name == "yawn":
        return dict(
            view="front",
            body_dy=[0, -1, 0, 0][i],
            head_dy=[-1, -1, 0, 0][i],
            eyes="closed",
            mouth="open",
            ears="droop",
            tail="down",
        )
    if name == "stretch":
        return dict(
            view="side",
            body_dy=[1, 2, 2, 1][i],
            head_dy=[4, 6, 6, 4][i],
            legs=[0, 0, 2, 2],
            eyes="closed",
            mouth="open",
            ears="normal",
            tail="up",
            extras=["motion"],
        )
    if name == "dance":
        return dict(
            view="front",
            body_dy=[0, -3, 0, -2, 0, -3][i],
            head_dy=[0, -1, 0, -1, 0, -1][i],
            legs=[0, 0, -6 if i % 2 == 0 else 0, 0 if i % 2 == 0 else -6],
            eyes="happy",
            mouth="smile",
            ears="perk",
            tail="wagL" if i % 2 else "wagR",
            blush=True,
            extras=["note"] if i % 2 == 0 else [],
        )
    raise ValueError(f"unknown animation {name!r}")


# ---------------------------------------------------------------------------
# Build outputs
# ---------------------------------------------------------------------------
def font(size, bold=False):
    candidates = []
    if bold:
        candidates += [
            "C:/Windows/Fonts/segoeuib.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ]
    else:
        candidates += [
            "C:/Windows/Fonts/segoeui.ttf",
            "C:/Windows/Fonts/arial.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass
    return ImageFont.load_default()


def background(w, h):
    img = Image.new("RGB", (w, h), (18, 21, 33))
    d = ImageDraw.Draw(img)
    top = (18, 21, 33)
    bottom = (43, 25, 52)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line((0, y, w, y), fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for x in range(0, w, 32):
        od.line((x, 0, x, h), fill=(255, 255, 255, 6), width=1)
    for y in range(0, h, 32):
        od.line((0, y, w, y), fill=(255, 255, 255, 6), width=1)
    od.ellipse((w - 240, -120, w + 80, 200), fill=(56, 196, 176, 22))
    od.ellipse((-100, h - 180, 220, h + 60), fill=(255, 107, 138, 18))
    return Image.alpha_composite(img.convert("RGBA"), overlay)


def paste_cat(base, cat_img, x, y, scale):
    side = int(FRAME * scale)
    scaled = cat_img.resize((side, side), Image.NEAREST)
    base.alpha_composite(scaled, (x, y))


def chip(d, x, y, text, fill=(38, 41, 60, 255)):
    f = font(13)
    box = d.textbbox((0, 0), text, font=f)
    w = box[2] - box[0] + 20
    h = 26
    d.rounded_rectangle((x, y, x + w, y + h), radius=13, fill=fill, outline=(104, 112, 138, 255), width=1)
    d.text((x + 10, y + 6), text, font=f, fill=(244, 246, 250, 255))
    return w


def make_preview(cat):
    w, h = 640, 360
    img = background(w, h)
    d = ImageDraw.Draw(img)
    d.text((36, 38), "VFD Pet", font=font(46, True), fill=(255, 244, 220, 255))
    d.text((38, 96), "Un michi de alta resolución para Spotify", font=font(18), fill=(200, 208, 225, 255))
    d.text((38, 124), "Te sigue, duerme en la barra y reacciona a la música.", font=font(14), fill=(160, 170, 190, 255))
    x = 38
    for text in ("64×64 px", "90 frames", "25 animaciones", "offline"):
        x += chip(d, x, 158, text) + 8
    # sleeping cat on a mock progress bar
    d.rounded_rectangle((34, 286, 606, 338), radius=14, fill=(17, 19, 30, 220), outline=(255, 255, 255, 18), width=1)
    d.rounded_rectangle((54, 309, 440, 314), radius=2, fill=(70, 76, 96, 255))
    d.rounded_rectangle((54, 309, 246, 314), radius=2, fill=(56, 196, 176, 255))
    paste_cat(img, cat.render(pose_for("sleep", 0)), 500, 170, 2)
    paste_cat(img, cat.render(pose_for("idle", 0)), 402, 34, 3)
    d.text((38, 252), "michi.exe", font=font(13, True), fill=(56, 196, 176, 255))
    d.text((38, 268), "sin conexión · sin GIFs remotos", font=font(12), fill=(150, 160, 180, 255))
    return img.convert("RGB")


def make_gif(cat):
    w, h = 480, 270
    bg = background(w, h).convert("RGBA")
    bg_d = ImageDraw.Draw(bg)
    bg_d.text((24, 20), "VFD Pet", font=font(30, True), fill=(255, 244, 220, 255))
    bg_d.text((26, 58), "idle · walk · happy · dance · sleep", font=font(12), fill=(180, 190, 210, 255))
    bg_d.rounded_rectangle((22, 228, 458, 252), radius=12, fill=(17, 19, 30, 220), outline=(255, 255, 255, 18), width=1)
    bug = cat.render(pose_for("idle", 0))
    seq = []
    for i in range(4):
        seq.append((pose_for("idle", i), 300, 46))
    for i in range(4):
        seq.append((pose_for("walkE", i), 300 + i * 4, 46))
    for i in range(4):
        seq.append((pose_for("happy", i), 300, 40 - (2 if i == 1 else 0)))
    for i in range(6):
        seq.append((pose_for("dance", i), 300, 40 - (4 if i in (1, 5) else 0)))
    for i in range(4):
        seq.append((pose_for("sleep", i), 300, 46))
    frames = []
    for pose, x, y in seq:
        frame = bg.copy()
        paste_cat(frame, cat.render(pose), x, y, 3)
        frames.append(frame.convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=128))
    frames[0].save(
        PREVIEW_DIR / "preview.gif",
        save_all=True,
        append_images=frames[1:],
        duration=120,
        loop=0,
        optimize=True,
        disposal=2,
    )
    return len(frames)


def make_contact_sheet(cat):
    names = [
        "idle",
        "blink",
        "alert",
        "sit",
        "walkN",
        "walkE",
        "walkS",
        "walkW",
        "sleep",
        "tired",
        "scratchSelf",
        "scratchWallN",
        "scratchWallE",
        "scratchWallS",
        "drag",
        "happy",
        "groom",
        "yawn",
        "stretch",
        "dance",
    ]
    cols, rows = 5, 4
    cw, ch = 128, 150
    img = Image.new("RGB", (cols * cw, rows * ch), (24, 26, 40))
    d = ImageDraw.Draw(img)
    for index, name in enumerate(names):
        col, row = index % cols, index // cols
        x, y = col * cw, row * ch
        d.rounded_rectangle((x + 6, y + 6, x + cw - 6, y + ch - 6), radius=10, fill=(32, 35, 52), outline=(255, 255, 255, 16), width=1)
        img.paste(cat.render(pose_for(name, 0)).convert("RGB"), (x + 32, y + 14), cat.render(pose_for(name, 0)))
        label = name
        tw = d.textbbox((0, 0), label, font=font(13))[2]
        d.text((x + (cw - tw) // 2, y + ch - 30), label, font=font(13), fill=(220, 226, 240))
    return img


def main():
    PET_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    cat = Cat()
    sheet = Image.new("RGBA", (COLS * FRAME, ROWS * FRAME), (0, 0, 0, 0))
    animations = {}
    index = 0
    for name, count, fps, loop in SPECS:
        frames = []
        for i in range(count):
            if index >= COLS * ROWS:
                raise RuntimeError(f"sheet overflow at {name}[{i}] (max {COLS * ROWS} frames)")
            col, row = index % COLS, index // COLS
            frame = cat.render(pose_for(name, i))
            sheet.alpha_composite(frame, (col * FRAME, row * FRAME))
            frames.append([col, row])
            index += 1
        animations[name] = {"frames": frames, "fps": fps, "loop": loop}
    if index != COLS * ROWS:
        raise RuntimeError(f"frame count is {index}, expected {COLS * ROWS}; adjust SPECS or the grid")
    sheet.save(PET_DIR / "spritesheet.png", optimize=True)
    meta = {
        "frameWidth": FRAME,
        "frameHeight": FRAME,
        "columns": COLS,
        "rows": ROWS,
        "animations": animations,
        "source": "tools/generate_sprites.py",
    }
    (PET_DIR / "animations.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    make_preview(cat).save(PREVIEW_DIR / "preview.png", optimize=True)
    gif_frames = make_gif(cat)
    make_contact_sheet(cat).save(PET_DIR / "contact-sheet.png", optimize=True)
    print(f"sheet: {sheet.width}x{sheet.height}, {index} frames")
    print(f"animations: {len(animations)}")
    print(f"preview: 640x360, gif frames: {gif_frames}")
    print(f"sheet bytes: {(PET_DIR / 'spritesheet.png').stat().st_size}")


if __name__ == "__main__":
    main()



