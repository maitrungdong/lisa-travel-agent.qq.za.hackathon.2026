#!/usr/bin/env python3
"""Zino logo mark — chữ Z với nét chéo là kim la bàn."""
import math

# ---- palette ----
TEAL_D = "#0b4f4a"
TEAL = "#0f766e"
TEAL_L = "#14b8a6"
EMER = "#10b981"
AMBER = "#f59e0b"
AMBER_L = "#fbbf24"
WHITE = "#ffffff"

S = 512  # canvas


def squircle(cx, cy, a, n=4.2, steps=180):
    """Superellipse path (iOS-style smooth corner)."""
    pts = []
    for i in range(steps + 1):
        t = 2 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        x = cx + a * math.copysign(abs(ct) ** (2.0 / n), ct)
        y = cy + a * math.copysign(abs(st) ** (2.0 / n), st)
        pts.append((x, y))
    d = "M %.2f %.2f " % pts[0] + " ".join("L %.2f %.2f" % p for p in pts[1:]) + " Z"
    return d


def mark(scale=1.0, dx=0.0, dy=0.0, ring=True):
    """The Z + compass-needle mark, drawn in a 512 box, returns svg fragment."""
    cx = cy = 256.0

    # --- geometry of Z ---
    bar_h = 42.0
    x_l, x_r = 148.0, 364.0
    y_t, y_b = 156.0, 356.0

    # needle axis: top-right -> bottom-left
    ax, ay = x_r, y_t
    bx, by = x_l, y_b
    L = math.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / L, (by - ay) / L
    px, py = -uy, ux
    mx, my = (ax + bx) / 2, (ay + by) / 2
    w = 36.0
    p1 = (mx + w * px, my + w * py)
    p2 = (mx - w * px, my - w * py)

    parts = []

    if ring:
        R = 196.0
        parts.append(
            f'<circle cx="{cx}" cy="{cy}" r="{R}" fill="none" '
            f'stroke="url(#ringGrad)" stroke-width="10" opacity="0.26"/>'
        )
        # cardinal ticks
        for i, ang in enumerate((-90, 0, 90, 180)):
            a = math.radians(ang)
            r1, r2 = R - 6, R + 6
            x1, y1 = cx + r1 * math.cos(a), cy + r1 * math.sin(a)
            x2, y2 = cx + r2 * math.cos(a), cy + r2 * math.sin(a)
            col = AMBER_L if i == 0 else WHITE
            op = 0.95 if i == 0 else 0.45
            parts.append(
                f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                f'stroke="{col}" stroke-width="11" stroke-linecap="round" opacity="{op}"/>'
            )

    # Z bars
    parts.append(
        f'<line x1="{x_l}" y1="{y_t}" x2="{x_r}" y2="{y_t}" stroke="{WHITE}" '
        f'stroke-width="{bar_h}" stroke-linecap="round"/>'
    )
    parts.append(
        f'<line x1="{x_l}" y1="{y_b}" x2="{x_r}" y2="{y_b}" stroke="{WHITE}" '
        f'stroke-width="{bar_h}" stroke-linecap="round"/>'
    )

    # needle — upper half amber, lower half white
    parts.append(
        f'<path d="M {ax:.1f} {ay:.1f} L {p1[0]:.1f} {p1[1]:.1f} '
        f'L {p2[0]:.1f} {p2[1]:.1f} Z" fill="url(#needleWarm)"/>'
    )
    parts.append(
        f'<path d="M {bx:.1f} {by:.1f} L {p1[0]:.1f} {p1[1]:.1f} '
        f'L {p2[0]:.1f} {p2[1]:.1f} Z" fill="url(#needleCool)"/>'
    )
    # pivot
    parts.append(f'<circle cx="{mx:.1f}" cy="{my:.1f}" r="15" fill="{WHITE}"/>')
    parts.append(f'<circle cx="{mx:.1f}" cy="{my:.1f}" r="7.5" fill="{TEAL}"/>')

    g = "\n    ".join(parts)
    return (
        f'<g transform="translate({dx},{dy}) translate({cx},{cy}) scale({scale}) '
        f'translate({-cx},{-cy})">\n    {g}\n  </g>'
    )


DEFS = f"""
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0%"  stop-color="#16a394"/>
      <stop offset="45%" stop-color="{TEAL}"/>
      <stop offset="100%" stop-color="#0a4f4c"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.28" cy="0.16" r="0.85">
      <stop offset="0%"   stop-color="#5eead4" stop-opacity="0.55"/>
      <stop offset="55%"  stop-color="#5eead4" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#5eead4" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vig" cx="0.5" cy="0.62" r="0.78">
      <stop offset="55%"  stop-color="#00201f" stop-opacity="0"/>
      <stop offset="100%" stop-color="#00201f" stop-opacity="0.34"/>
    </radialGradient>
    <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.35"/>
    </linearGradient>
    <linearGradient id="needleWarm" x1="0.15" y1="0" x2="0.9" y2="1">
      <stop offset="0%"   stop-color="#fcd34d"/>
      <stop offset="100%" stop-color="{AMBER}"/>
    </linearGradient>
    <linearGradient id="needleCool" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
  </defs>"""


def icon_svg(size=512, bleed=True):
    sq = squircle(256, 256, 256, n=4.2)
    inner = squircle(256, 256, 240, n=4.2)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 512 512">{DEFS}
  <path d="{sq}" fill="url(#bg)"/>
  <path d="{sq}" fill="url(#glow)"/>
  <path d="{sq}" fill="url(#vig)"/>
  <path d="{inner}" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.16"/>
  {mark(scale=0.92)}
</svg>
"""


def mark_only_svg(size=512, color_mode="onDark"):
    """Mark on transparent background."""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 512 512">{DEFS}
  {mark(scale=1.0)}
</svg>
"""


if __name__ == "__main__":
    import sys, os
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "zino-icon.svg"), "w").write(icon_svg())
    open(os.path.join(out, "zino-mark.svg"), "w").write(mark_only_svg())
    print("ok")
