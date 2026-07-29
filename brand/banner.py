#!/usr/bin/env python3
"""Zino banner 1200x630 — hoàng hôn trên vịnh, nhóm bạn trên vách đá."""
import math, random
from logo import mark, DEFS as LOGO_DEFS

W, H = 1200, 630
HORIZON = 402.0
SUN = (908.0, 344.0, 52.0)  # cx, cy, r

DARK = "#04252b"      # silhouette foreground
RIM = "#f8c66b"


# ---------------------------------------------------------------- people
def person(x0, y0, h, pose="stand", flip=False, fill=DARK, opacity=1.0):
    """Silhouette đứng, chân ở (x0, y0), cao h."""
    s = -1 if flip else 1
    r = 0.062 * h
    head_cy = y0 - h + r
    sh_y = head_cy + 2.55 * r          # vai
    hip_y = y0 - 0.47 * h
    sw = 0.088 * h                     # nửa rộng vai
    hw = 0.068 * h                     # nửa rộng hông
    aw = 0.048 * h                     # dày tay
    lw = 0.068 * h                     # dày chân
    e = []

    def L(pts, width, extra=""):
        d = "M %.1f %.1f " % pts[0] + " ".join("L %.1f %.1f" % p for p in pts[1:])
        return (f'<path d="{d}" fill="none" stroke="{fill}" stroke-width="{width:.1f}" '
                f'stroke-linecap="round" stroke-linejoin="round" {extra}/>')

    # ---- ba lô (một số pose) ----
    if pose in ("point", "walk"):
        bx = x0 - s * (sw + 0.030 * h)
        e.append(f'<rect x="{bx - 0.055*h:.1f}" y="{sh_y + 0.01*h:.1f}" '
                 f'width="{0.115*h:.1f}" height="{0.24*h:.1f}" rx="{0.045*h:.1f}" fill="{fill}"/>')

    # ---- chân ----
    if pose == "walk":
        e.append(L([(x0 - hw * .5, hip_y), (x0 - hw * 1.0 * s, y0 - 0.24 * h), (x0 - hw * 1.6 * s, y0)], lw))
        e.append(L([(x0 + hw * .5, hip_y), (x0 + hw * .9 * s, y0 - 0.24 * h), (x0 + hw * 1.4 * s, y0)], lw))
    elif pose == "sit":
        pass  # xử lý riêng bên dưới
    else:
        e.append(L([(x0 - hw * .55, hip_y), (x0 - hw * .95, y0 - 0.23 * h), (x0 - hw * 1.05, y0)], lw))
        e.append(L([(x0 + hw * .55, hip_y), (x0 + hw * .95, y0 - 0.23 * h), (x0 + hw * 1.05, y0)], lw))

    # ---- thân ----
    e.append(
        f'<path d="M {x0 - sw:.1f} {sh_y:.1f} '
        f'C {x0 - sw:.1f} {sh_y - 0.055*h:.1f} {x0 + sw:.1f} {sh_y - 0.055*h:.1f} {x0 + sw:.1f} {sh_y:.1f} '
        f'L {x0 + hw*1.05:.1f} {hip_y + 0.03*h:.1f} '
        f'L {x0 - hw*1.05:.1f} {hip_y + 0.03*h:.1f} Z" fill="{fill}"/>')

    # ---- cổ + đầu ----
    e.append(f'<rect x="{x0 - 0.019*h:.1f}" y="{head_cy:.1f}" width="{0.038*h:.1f}" '
             f'height="{0.095*h:.1f}" fill="{fill}"/>')
    e.append(f'<circle cx="{x0:.1f}" cy="{head_cy:.1f}" r="{r:.1f}" fill="{fill}"/>')

    # ---- tay theo pose ----
    if pose == "point":   # chỉ tay lên/ra xa
        e.append(L([(x0 + s * sw * .9, sh_y + 0.015 * h),
                    (x0 + s * sw * 2.0, sh_y - 0.05 * h),
                    (x0 + s * sw * 3.3, sh_y - 0.15 * h)], aw))
        e.append(L([(x0 - s * sw * .9, sh_y + 0.015 * h),
                    (x0 - s * sw * 1.15, sh_y + 0.13 * h),
                    (x0 - s * sw * .75, hip_y + 0.02 * h)], aw))
    elif pose == "photo":  # hai tay đưa lên cầm điện thoại
        e.append(L([(x0 - sw * .9, sh_y + 0.02 * h), (x0 - sw * 1.5, sh_y - 0.05 * h),
                    (x0 - sw * .85, head_cy - r * 0.2)], aw))
        e.append(L([(x0 + sw * .9, sh_y + 0.02 * h), (x0 + sw * 1.5, sh_y - 0.05 * h),
                    (x0 + sw * .85, head_cy - r * 0.2)], aw))
        e.append(f'<rect x="{x0 - 0.042*h:.1f}" y="{head_cy - r*1.5:.1f}" width="{0.084*h:.1f}" '
                 f'height="{0.055*h:.1f}" rx="{0.010*h:.1f}" fill="{fill}"/>')
    elif pose == "hug_r":  # tay phải vòng qua vai bạn bên phải
        e.append(L([(x0 + sw * .9, sh_y + 0.01 * h), (x0 + sw * 2.4, sh_y - 0.02 * h),
                    (x0 + sw * 3.6, sh_y + 0.01 * h)], aw))
        e.append(L([(x0 - sw * .9, sh_y + 0.02 * h), (x0 - sw * 1.2, sh_y + 0.14 * h),
                    (x0 - sw * 1.0, hip_y + 0.03 * h)], aw))
    elif pose == "walk":
        e.append(L([(x0 - s * sw * .9, sh_y + 0.02 * h), (x0 - s * sw * 1.6, sh_y + 0.13 * h),
                    (x0 - s * sw * 1.2, hip_y + 0.04 * h)], aw))
        e.append(L([(x0 + s * sw * .9, sh_y + 0.02 * h), (x0 + s * sw * 1.2, sh_y + 0.14 * h),
                    (x0 + s * sw * 1.8, hip_y + 0.02 * h)], aw))
    else:  # stand
        e.append(L([(x0 - sw * .95, sh_y + 0.02 * h), (x0 - sw * 1.35, sh_y + 0.16 * h),
                    (x0 - sw * 1.15, hip_y + 0.10 * h)], aw))
        e.append(L([(x0 + sw * .95, sh_y + 0.02 * h), (x0 + sw * 1.35, sh_y + 0.16 * h),
                    (x0 + sw * 1.15, hip_y + 0.10 * h)], aw))

    g = "".join(e)
    op = f' opacity="{opacity}"' if opacity != 1.0 else ""
    return f"<g{op}>{g}</g>"


def person_sit(x0, y0, h, fill=DARK):
    """Ngồi trên mép vách, co gối, ôm đầu gối, hướng mặt về phía mặt trời."""
    r = 0.062 * h
    lw, aw = 0.066 * h, 0.046 * h
    hip = (x0, y0)
    knee = (x0 + 0.155 * h, y0 - 0.205 * h)
    foot = (x0 + 0.185 * h, y0)
    sh = (x0 - 0.045 * h, y0 - 0.335 * h)
    head_c = (x0 - 0.022 * h, y0 - 0.435 * h)
    e = []

    def L(pts, width):
        d = "M %.1f %.1f " % pts[0] + " ".join("L %.1f %.1f" % p for p in pts[1:])
        return (f'<path d="{d}" fill="none" stroke="{fill}" stroke-width="{width:.1f}" '
                f'stroke-linecap="round" stroke-linejoin="round"/>')

    # chân sau (hơi lệch, tạo chiều sâu)
    e.append(L([(hip[0] - 0.012 * h, hip[1]), (knee[0] - 0.03 * h, knee[1] + 0.03 * h),
                (foot[0] - 0.04 * h, foot[1])], lw))
    # thân
    e.append(f'<path d="M {sh[0] - 0.085*h:.1f} {sh[1]:.1f} '
             f'C {sh[0] - 0.085*h:.1f} {sh[1] - 0.045*h:.1f} {sh[0] + 0.085*h:.1f} {sh[1] - 0.045*h:.1f} '
             f'{sh[0] + 0.085*h:.1f} {sh[1]:.1f} '
             f'L {hip[0] + 0.075*h:.1f} {hip[1] + 0.005*h:.1f} '
             f'L {hip[0] - 0.075*h:.1f} {hip[1] + 0.005*h:.1f} Z" fill="{fill}"/>')
    # cổ + đầu
    e.append(f'<path d="M {head_c[0]-0.028*h:.1f} {head_c[1]:.1f} L {head_c[0]+0.028*h:.1f} {head_c[1]:.1f} '
             f'L {sh[0]+0.03*h:.1f} {sh[1]+0.01*h:.1f} L {sh[0]-0.03*h:.1f} {sh[1]+0.01*h:.1f} Z" fill="{fill}"/>')
    e.append(f'<circle cx="{head_c[0]:.1f}" cy="{head_c[1]:.1f}" r="{r:.1f}" fill="{fill}"/>')
    # chân trước
    e.append(L([hip, knee, foot], lw))
    # tay ôm gối
    e.append(L([(sh[0] + 0.07 * h, sh[1] + 0.02 * h),
                (knee[0] + 0.02 * h, knee[1] + 0.07 * h),
                (knee[0] - 0.01 * h, knee[1] + 0.01 * h)], aw))
    return "<g>" + "".join(e) + "</g>"


# ---------------------------------------------------------------- scenery
def ridge_path(pts, base=H + 10):
    """Đường gờ núi mượt -> path đóng xuống đáy."""
    d = "M %.1f %.1f" % pts[0]
    for i in range(1, len(pts)):
        x0, y0 = pts[i - 1]
        x1, y1 = pts[i]
        cx = (x0 + x1) / 2
        d += " C %.1f %.1f %.1f %.1f %.1f %.1f" % (cx, y0, cx, y1, x1, y1)
    d += f" L {pts[-1][0]:.1f} {base} L {pts[0][0]:.1f} {base} Z"
    return d


def karst(x, base, w, h, fill, op=1.0):
    """Núi đá vôi kiểu vịnh Hạ Long."""
    d = (f"M {x - w/2:.1f} {base:.1f} "
         f"C {x - w/2.1:.1f} {base - h*0.45:.1f} {x - w/3.4:.1f} {base - h*0.78:.1f} {x - w/9:.1f} {base - h:.1f} "
         f"C {x + w/12:.1f} {base - h*0.92:.1f} {x + w/3.0:.1f} {base - h*0.66:.1f} {x + w/2.2:.1f} {base - h*0.30:.1f} "
         f"C {x + w/2.0:.1f} {base - h*0.14:.1f} {x + w/2:.1f} {base - h*0.05:.1f} {x + w/2:.1f} {base:.1f} Z")
    return f'<path d="{d}" fill="{fill}" opacity="{op}"/>'


def build(with_text=True, wide=None):
    random.seed(7)
    sx, sy, sr = SUN
    o = []

    # ---------- trời ----------
    o.append(f'<rect width="{W}" height="{H}" fill="url(#sky)"/>')
    # ánh sáng khuếch tán quanh mặt trời
    o.append(f'<rect width="{W}" height="{HORIZON + 40}" fill="url(#sunHaze)"/>')

    # sao mờ góc trên trái
    for _ in range(26):
        x = random.uniform(20, 560); y = random.uniform(18, 190)
        rr = random.uniform(0.9, 2.0)
        o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rr:.1f}" fill="#dffaf3" opacity="{random.uniform(.18,.5):.2f}"/>')

    # mây dải
    for cx_, cy_, ww, hh, op in [(250, 150, 300, 13, .16), (420, 205, 380, 11, .20),
                                 (980, 168, 330, 12, .14), (760, 240, 300, 10, .17),
                                 (150, 262, 260, 9, .14)]:
        o.append(f'<ellipse cx="{cx_}" cy="{cy_}" rx="{ww/2}" ry="{hh/2}" fill="#ffe9bd" opacity="{op}"/>')

    # mặt trời
    o.append(f'<circle cx="{sx}" cy="{sy}" r="{sr*4.6:.0f}" fill="url(#sunGlow)"/>')
    o.append(f'<circle cx="{sx}" cy="{sy}" r="{sr}" fill="url(#sunDisc)"/>')

    # chim
    for bx, by, bs in [(300, 205, 1.35), (352, 186, 1.0), (262, 172, .85), (1055, 205, 1.0), (1098, 224, .75)]:
        o.append(f'<path d="M {bx-9*bs:.1f} {by:.1f} q {5*bs:.1f} {-6*bs:.1f} {9*bs:.1f} 0 '
                 f'q {4*bs:.1f} {-6*bs:.1f} {9*bs:.1f} 0" fill="none" stroke="#0d3b3f" '
                 f'stroke-width="{2.1*bs:.1f}" stroke-linecap="round" opacity="0.42"/>')

    # ---------- núi xa ----------
    o.append(f'<path d="{ridge_path([(-40,352),(120,296),(300,340),(470,286),(640,332),(820,300),(980,338),(1140,300),(1240,330)], HORIZON+2)}" fill="#2b8f88" opacity="0.42"/>')
    o.append(f'<path d="{ridge_path([(-40,378),(160,332),(340,372),(520,326),(700,368),(900,336),(1060,372),(1240,340)], HORIZON+2)}" fill="#1d7570" opacity="0.60"/>')

    # ---------- biển ----------
    o.append(f'<rect x="0" y="{HORIZON}" width="{W}" height="{H-HORIZON}" fill="url(#sea)"/>')
    # cột phản chiếu mặt trời
    o.append(f'<path d="M {sx-58:.0f} {HORIZON} L {sx+58:.0f} {HORIZON} L {sx+170:.0f} {HORIZON+160} L {sx-170:.0f} {HORIZON+160} Z" fill="url(#sunPath)"/>')
    # gợn sóng
    for i in range(30):
        y = HORIZON + 5 + (i ** 1.42) * 1.5
        if y > 545: break
        n = random.randint(3, 6)
        for _ in range(n):
            cx_ = random.uniform(40, W - 40)
            ln = random.uniform(20, 90) * (1 + i * 0.05)
            near_sun = abs(cx_ - sx) < 170
            col = "#ffe0a3" if near_sun else "#8fe3d6"
            op = random.uniform(.20, .55) if near_sun else random.uniform(.08, .20)
            o.append(f'<rect x="{cx_:.0f}" y="{y:.0f}" width="{ln:.0f}" height="{1.6+i*0.09:.1f}" '
                     f'rx="1" fill="{col}" opacity="{op:.2f}"/>')

    # ---------- núi đá vôi giữa vịnh ----------
    o.append(karst(232, HORIZON + 26, 150, 96, "#12615f", 0.85))
    o.append(karst(330, HORIZON + 20, 96, 62, "#12615f", 0.7))
    o.append(karst(1080, HORIZON + 30, 190, 112, "#0f5a58", 0.9))
    o.append(karst(1168, HORIZON + 24, 110, 70, "#0f5a58", 0.7))
    o.append(karst(640, HORIZON + 14, 84, 46, "#15706b", 0.55))

    # thuyền
    for bx, by, bs, op in [(700, 452, 1.0, .85), (455, 438, 0.66, .7), (860, 470, 1.15, .9)]:
        o.append(
            f'<g opacity="{op}"><path d="M {bx-22*bs:.1f} {by:.1f} q {22*bs:.1f} {11*bs:.1f} {44*bs:.1f} 0 Z" fill="#06373c"/>'
            f'<path d="M {bx+2*bs:.1f} {by-1*bs:.1f} L {bx+2*bs:.1f} {by-30*bs:.1f} L {bx+22*bs:.1f} {by-2*bs:.1f} Z" fill="#06373c"/>'
            f'<path d="M {bx-2*bs:.1f} {by-1*bs:.1f} L {bx-2*bs:.1f} {by-24*bs:.1f} L {bx-18*bs:.1f} {by-2*bs:.1f} Z" fill="#06373c"/></g>')

    # ---------- lớp đồi trung cảnh ----------
    o.append(f'<path d="{ridge_path([(-40,512),(130,494),(300,508),(470,488),(620,504),(760,492),(900,508),(1050,494),(1240,510)])}" fill="#0a4a4e" opacity="0.9"/>')

    # ---------- vách đá tiền cảnh ----------
    cpts = [(-40, 570), (160, 556), (360, 560), (540, 542), (700, 528),
            (850, 512), (1000, 518), (1130, 502), (1240, 508)]
    cliff = ridge_path(cpts)
    # viền sáng chạy dọc mép vách
    edge = "M %.1f %.1f" % cpts[0]
    for i in range(1, len(cpts)):
        x0_, y0_ = cpts[i - 1]; x1_, y1_ = cpts[i]; cx_ = (x0_ + x1_) / 2
        edge += " C %.1f %.1f %.1f %.1f %.1f %.1f" % (cx_, y0_, cx_, y1_, x1_, y1_)
    o.append(f'<path d="{cliff}" fill="url(#cliff)"/>')
    o.append(f'<path d="{edge}" fill="none" stroke="#f2bb6a" stroke-width="2.2" opacity="0.38"/>')

    # ---------- người ----------
    ppl = []
    ppl.append(person(738, 530, 138, pose="walk", flip=False))
    ppl.append(person_sit(812, 520, 152))
    ppl.append(person(884, 514, 152, pose="photo"))
    ppl.append(person(960, 508, 158, pose="hug_r"))
    ppl.append(person(1001, 510, 150, pose="stand"))
    ppl.append(person(1088, 502, 134, pose="point"))
    people = "".join(ppl)
    # viền sáng: bản offset màu ấm nằm dưới
    o.append(f'<g transform="translate(3,-3)" opacity="0.62">'
             + people.replace(DARK, RIM) + '</g>')
    o.append(people)

    # cỏ / lá tiền cảnh
    random.seed(3)
    for i in range(260):
        x = random.uniform(-10, W + 10)
        base = 636.0
        hgt = random.uniform(14, 60)
        bend = random.uniform(-20, 20)
        o.append(f'<path d="M {x:.1f} {base:.1f} Q {x+bend*0.35:.1f} {base-hgt*0.55:.1f} {x+bend:.1f} {base-hgt:.1f}" '
                 f'fill="none" stroke="#021a22" stroke-width="{random.uniform(2.0,3.6):.1f}" stroke-linecap="round"/>')

    # ---------- lớp phủ trái cho chữ ----------
    if with_text:
        o.append(f'<rect width="{W}" height="{H}" fill="url(#scrim)"/>')

        o.append(f'<g transform="translate(76,150) scale(0.203)">{mark(scale=1.0)}</g>')
        o.append('<text x="196" y="228" font-family="Roboto" font-weight="900" font-size="86" '
                 'letter-spacing="5" fill="#ffffff">ZINO</text>')
        o.append('<text x="200" y="272" font-family="Roboto" font-weight="500" font-size="25" '
                 'letter-spacing="5.5" fill="#fbbf24">TRỢ LÝ NHU CẦU</text>')
        o.append('<text x="78" y="360" font-family="Roboto" font-weight="700" font-size="41" '
                 'fill="#ffffff">Cả nhóm đi chơi,</text>')
        o.append('<text x="78" y="410" font-family="Roboto" font-weight="700" font-size="41" '
                 'fill="#ffffff">Zino lo phần còn lại.</text>')
        o.append('<text x="78" y="462" font-family="Roboto" font-weight="400" font-size="23" '
                 'fill="#bfeee4">Lên lịch trình · Chia chi phí · Lưu kỷ niệm</text>')
        # pill
        o.append('<rect x="76" y="492" width="286" height="46" rx="23" fill="#ffffff" opacity="0.10"/>')
        o.append('<rect x="76.75" y="492.75" width="284.5" height="44.5" rx="22.25" fill="none" stroke="#ffffff" stroke-width="1.5" opacity="0.28"/>')
        o.append('<circle cx="102" cy="515" r="6" fill="#34d399"/>')
        o.append('<text x="118" y="522" font-family="Roboto" font-weight="500" font-size="19" '
                 'fill="#e6fffa">Sống ngay trong nhóm Zalo</text>')

    defs = f"""
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0.15" y2="1">
      <stop offset="0%"   stop-color="#03202b"/>
      <stop offset="18%"  stop-color="#063b48"/>
      <stop offset="34%"  stop-color="#0a5760"/>
      <stop offset="46%"  stop-color="#137a6f"/>
      <stop offset="54%"  stop-color="#31977c"/>
      <stop offset="59%"  stop-color="#7fb679"/>
      <stop offset="62%"  stop-color="#e2ab55"/>
      <stop offset="64%"  stop-color="#fbc047"/>
      <stop offset="100%" stop-color="#fbc047"/>
    </linearGradient>
    <radialGradient id="sunHaze" cx="{sx/W:.3f}" cy="{sy/(HORIZON+40):.3f}" r="0.62">
      <stop offset="0%"   stop-color="#ffd98a" stop-opacity="0.55"/>
      <stop offset="45%"  stop-color="#ffc978" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#ffc978" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="sunGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%"   stop-color="#fff3c4" stop-opacity="0.90"/>
      <stop offset="26%"  stop-color="#ffdc8a" stop-opacity="0.45"/>
      <stop offset="60%"  stop-color="#ffcd6b" stop-opacity="0.13"/>
      <stop offset="100%" stop-color="#ffcd6b" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="sunDisc" cx="0.5" cy="0.42" r="0.6">
      <stop offset="0%"   stop-color="#fffdf2"/>
      <stop offset="70%"  stop-color="#ffe9a8"/>
      <stop offset="100%" stop-color="#ffd06a"/>
    </radialGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#f0c47c"/>
      <stop offset="7%"   stop-color="#8ec3a4"/>
      <stop offset="20%"  stop-color="#2f8e83"/>
      <stop offset="48%"  stop-color="#0f6266"/>
      <stop offset="100%" stop-color="#05323c"/>
    </linearGradient>
    <linearGradient id="sunPath" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#ffe6ab" stop-opacity="0.85"/>
      <stop offset="45%"  stop-color="#ffd489" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#ffd489" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="cliff" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0%"   stop-color="#042630"/>
      <stop offset="55%"  stop-color="#02171f"/>
      <stop offset="100%" stop-color="#010f15"/>
    </linearGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#02272c" stop-opacity="0.92"/>
      <stop offset="34%"  stop-color="#03343a" stop-opacity="0.76"/>
      <stop offset="56%"  stop-color="#04424a" stop-opacity="0.30"/>
      <stop offset="72%"  stop-color="#04424a" stop-opacity="0"/>
    </linearGradient>
  </defs>"""

    body = "\n  ".join(o)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
            f'viewBox="0 0 {W} {H}">{defs}{LOGO_DEFS}\n  {body}\n</svg>\n')


if __name__ == "__main__":
    import sys, os
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "zino-banner.svg"), "w").write(build(True))
    open(os.path.join(out, "zino-scene.svg"), "w").write(build(False))
    print("ok")
