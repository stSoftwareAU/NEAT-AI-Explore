"""
Generate PWA assets for NEAT-AI Explore.

Creates:
- docs/icons/icon-<size>x<size>.png
- docs/screenshots/desktop-screenshot.png
- docs/screenshots/mobile-screenshot.png
  - plus extra screenshots used by the README (iPhone/iPad + modal views)

If Playwright is installed, screenshots are captured from a real browser by
starting a local web server and opening the app. If not, placeholder screenshots
are generated (still useful for manifest completeness).

Australian English note:
- This is a developer tool; the screenshots are primarily for PWA metadata.

Last updated: 18-Dec-2025
"""

from __future__ import annotations

import contextlib
import datetime as _dt
import http.server
import math
import os
import random
import socket
import socketserver
import threading
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
ICONS_DIR = DOCS / "icons"
SHOTS_DIR = DOCS / "screenshots"

# Extra small sizes are used for traditional browser favicons (tabs/bookmarks).
ICON_SIZES = [16, 32, 48, 72, 96, 128, 144, 152, 192, 384, 512]


def _now_stamp() -> str:
    # e.g. 18-Dec-2025
    return _dt.datetime.now().strftime("%d-%b-%Y")


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@contextlib.contextmanager
def _serve_docs(port: int):
    """
    Start a tiny HTTP server for the docs folder (required for service worker).
    """

    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_args, **_kwargs):  # noqa: N802 - stdlib signature
            pass

    cwd = os.getcwd()
    os.chdir(str(DOCS))
    try:
        httpd = socketserver.TCPServer(("127.0.0.1", port), QuietHandler)
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        yield f"http://127.0.0.1:{port}/"
    finally:
        with contextlib.suppress(Exception):
            httpd.shutdown()
            httpd.server_close()
        os.chdir(cwd)


def generate_icons() -> None:
    from PIL import Image, ImageDraw, ImageFilter

    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    base_size = 1024
    bg_top = (10, 14, 26)  # deep navy
    bg_bottom = (2, 6, 14)  # abyss
    accent = (96, 165, 250)  # blue glow
    accent2 = (45, 212, 191)  # teal glow

    # Deterministic: generated assets should be stable between runs.
    rng = random.Random(1337)

    # Background gradient (deep sea).
    img = Image.new("RGBA", (base_size, base_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    for y in range(base_size):
        t = y / (base_size - 1)
        r = int(bg_top[0] * (1 - t) + bg_bottom[0] * t)
        g = int(bg_top[1] * (1 - t) + bg_bottom[1] * t)
        b = int(bg_top[2] * (1 - t) + bg_bottom[2] * t)
        draw.line((0, y, base_size, y), fill=(r, g, b, 255))

    # Subtle "plankton" specks.
    for _ in range(600):
        x = rng.randrange(0, base_size)
        y = rng.randrange(0, base_size)
        a = rng.randrange(10, 45)
        c = rng.choice([accent, accent2, (229, 231, 235)])
        draw.point((x, y), fill=(c[0], c[1], c[2], a))

    # Explorer "lamp" origin + beam (discovery cone into the network).
    lamp_x = int(base_size * 0.28)
    lamp_y = int(base_size * 0.72)
    beam_tip_x = int(base_size * 0.74)
    beam_tip_y = int(base_size * 0.36)
    near_w = int(base_size * 0.08)
    far_w = int(base_size * 0.42)

    # Beam polygon (a trapezoid).
    beam_poly = [
        (lamp_x, lamp_y - near_w // 2),
        (lamp_x, lamp_y + near_w // 2),
        (beam_tip_x, beam_tip_y + far_w // 2),
        (beam_tip_x, beam_tip_y - far_w // 2),
    ]

    beam_mask = Image.new("L", (base_size, base_size), 0)
    beam_mask_draw = ImageDraw.Draw(beam_mask)
    beam_mask_draw.polygon(beam_poly, fill=255)
    beam_mask = beam_mask.filter(ImageFilter.GaussianBlur(radius=int(base_size * 0.018)))

    beam_overlay = Image.new("RGBA", (base_size, base_size), (0, 0, 0, 0))
    bo = ImageDraw.Draw(beam_overlay)
    bo.polygon(beam_poly, fill=(accent2[0], accent2[1], accent2[2], 46))
    bo.polygon(
        [
            (lamp_x, lamp_y - int(near_w * 0.35)),
            (lamp_x, lamp_y + int(near_w * 0.35)),
            (beam_tip_x, beam_tip_y + int(far_w * 0.30)),
            (beam_tip_x, beam_tip_y - int(far_w * 0.30)),
        ],
        fill=(accent[0], accent[1], accent[2], 62),
    )
    img = Image.alpha_composite(img, beam_overlay)
    draw = ImageDraw.Draw(img)

    # "Neural net depths": nodes + edges, brighter within the beam.
    nodes: list[tuple[int, int]] = []
    for _ in range(34):
        # Bias nodes toward the mid-right where the beam points.
        x = int(base_size * (0.26 + 0.66 * rng.random()))
        y = int(base_size * (0.18 + 0.68 * rng.random()))
        nodes.append((x, y))

    def _node_brightness(x: int, y: int) -> float:
        # Deeper = darker, beam = brighter.
        depth = y / (base_size - 1)
        in_beam = beam_mask.getpixel((x, y)) / 255.0
        return max(0.0, min(1.0, (0.22 + 0.65 * in_beam) * (1.0 - 0.35 * depth)))

    # Edges: connect to nearest neighbours.
    for i, (x1, y1) in enumerate(nodes):
        dists = []
        for j, (x2, y2) in enumerate(nodes):
            if i == j:
                continue
            dx = x2 - x1
            dy = y2 - y1
            dists.append((dx * dx + dy * dy, j))
        dists.sort(key=lambda t: t[0])
        for _, j in dists[:2]:
            x2, y2 = nodes[j]
            b = (_node_brightness(x1, y1) + _node_brightness(x2, y2)) / 2
            a = int(20 + 140 * b)
            col = (
                int(accent[0] * b + 229 * (1 - b)),
                int(accent2[1] * b + 231 * (1 - b)),
                int(accent[2] * b + 235 * (1 - b)),
                a,
            )
            draw.line((x1, y1, x2, y2), fill=col, width=int(base_size * 0.006))

    # Nodes on top.
    for x, y in nodes:
        b = _node_brightness(x, y)
        r = int(base_size * (0.012 + 0.010 * b))
        fill = (
            int(accent2[0] * b + 90 * (1 - b)),
            int(accent2[1] * b + 120 * (1 - b)),
            int(accent[2] * b + 150 * (1 - b)),
            int(110 + 145 * b),
        )
        draw.ellipse((x - r, y - r, x + r, y + r), fill=fill)

    # Lamp "submersible" silhouette.
    hull_r = int(base_size * 0.055)
    draw.ellipse(
        (lamp_x - hull_r, lamp_y - hull_r, lamp_x + hull_r, lamp_y + hull_r),
        fill=(17, 24, 39, 240),
        outline=(255, 255, 255, 18),
        width=max(1, int(base_size * 0.004)),
    )
    # Lamp glow.
    glow_r = int(base_size * 0.030)
    draw.ellipse(
        (lamp_x - glow_r, lamp_y - glow_r, lamp_x + glow_r, lamp_y + glow_r),
        fill=(accent2[0], accent2[1], accent2[2], 210),
    )
    # Sonar rings.
    for k in range(1, 4):
        rr = int(hull_r * (1.25 + 0.55 * k))
        aa = max(0, 70 - 14 * k)
        draw.ellipse(
            (lamp_x - rr, lamp_y - rr, lamp_x + rr, lamp_y + rr),
            outline=(accent[0], accent[1], accent[2], aa),
            width=max(1, int(base_size * 0.004)),
        )

    source_path = ICONS_DIR / "icon-source.png"
    img.save(source_path)

    for size in ICON_SIZES:
        out = img.resize((size, size), resample=Image.Resampling.LANCZOS)
        out.save(ICONS_DIR / f"icon-{size}x{size}.png")

    # Traditional favicon for browsers (tabs / bookmarks).
    favicon_path = DOCS / "favicon.ico"
    img.save(
        favicon_path,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )


def _placeholder_screenshot(path: Path, size: tuple[int, int], label: str) -> None:
    from PIL import Image, ImageDraw, ImageFont

    w, h = size
    bg = (10, 14, 26)
    panel = (17, 24, 39)
    accent = (96, 165, 250)
    text = (229, 231, 235)
    muted = (156, 163, 175)

    img = Image.new("RGBA", (w, h), bg)
    draw = ImageDraw.Draw(img)

    # Fake header
    header_h = max(56, int(h * 0.09))
    draw.rectangle((0, 0, w, header_h), fill=panel)
    draw.rectangle((0, header_h - 1, w, header_h), fill=(255, 255, 255, 30))

    try:
        font_h = ImageFont.truetype("Arial.ttf", 22)
        font_b = ImageFont.truetype("Arial.ttf", 18)
    except Exception:
        font_h = ImageFont.load_default()
        font_b = ImageFont.load_default()

    draw.text((16, 16), "NEAT-AI Explore", fill=text, font=font_h)
    draw.text((16, header_h + 18), f"{label} screenshot (generated { _now_stamp() })", fill=muted, font=font_b)

    # Accent line
    draw.rectangle((0, header_h, w, header_h + 3), fill=accent)

    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)


def generate_screenshots() -> None:
    """
    Try to capture real screenshots using Playwright; otherwise make placeholders.

    Note: We keep `desktop-screenshot.png` and `mobile-screenshot.png` because the
    web manifest references them. Additional screenshots are for documentation.
    """
    desktop_path = SHOTS_DIR / "desktop-screenshot.png"
    mobile_path = SHOTS_DIR / "mobile-screenshot.png"
    ipad_path = SHOTS_DIR / "ipad-screenshot.png"

    desktop_modal_path = SHOTS_DIR / "desktop-inbound-modal.png"
    iphone_path = SHOTS_DIR / "iphone-screenshot.png"
    iphone_modal_path = SHOTS_DIR / "iphone-inbound-modal.png"
    ipad_modal_path = SHOTS_DIR / "ipad-inbound-modal.png"

    # Always ensure output dir exists.
    SHOTS_DIR.mkdir(parents=True, exist_ok=True)

    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except Exception:
        _placeholder_screenshot(desktop_path, (1280, 720), "Desktop")
        _placeholder_screenshot(mobile_path, (720, 1280), "Mobile")
        _placeholder_screenshot(ipad_path, (820, 1180), "iPad")
        return

    port = _free_port()
    with _serve_docs(port) as url:
        with sync_playwright() as p:
            browser = p.chromium.launch()

            def load_app(page, viewport_label: str) -> None:
                # Use an explicit URL parameter so the screenshots are stable even
                # if the app default changes in future.
                page.goto(url + "?snapshotUrl=./snapshot.json.gz", wait_until="domcontentloaded")
                # Wait until the app reports a successful load.
                page.wait_for_function(
                    "() => document.getElementById('status')?.classList.contains('ok')",
                    timeout=60_000,
                )
                # Give the layout a beat to settle.
                page.wait_for_timeout(250)

                # Sanity check for responsiveness: avoid obvious horizontal overflow.
                # We don't fail the script if this trips; screenshots still help debug.
                try:
                    overflow = page.evaluate(
                        "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2",
                    )
                    if overflow:
                        print(f"Warning: horizontal overflow detected in {viewport_label}")
                except Exception:
                    pass

            def open_inbound_modal(page) -> None:
                # "Inspect" button is created once a neuron is rendered.
                page.click(".impactBreakdownBtn")
                page.wait_for_selector("#pathModal.isOpen", timeout=10_000)
                page.wait_for_timeout(150)

            # Desktop (manifest)
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            load_app(page, "Desktop")
            page.screenshot(path=str(desktop_path), full_page=True)
            open_inbound_modal(page)
            page.screenshot(path=str(desktop_modal_path), full_page=True)

            # Mobile (manifest) - keep existing dimensions for manifest metadata.
            page = browser.new_page(
                viewport={"width": 720, "height": 1280},
                user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            )
            load_app(page, "Mobile")
            page.screenshot(path=str(mobile_path), full_page=True)

            # iPhone (README)
            page = browser.new_page(
                viewport={"width": 390, "height": 844},
                device_scale_factor=3,
                is_mobile=True,
                has_touch=True,
                user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            )
            load_app(page, "iPhone")
            page.screenshot(path=str(iphone_path), full_page=True)
            open_inbound_modal(page)
            page.screenshot(path=str(iphone_modal_path), full_page=True)

            # iPad (README)
            page = browser.new_page(
                viewport={"width": 820, "height": 1180},
                device_scale_factor=2,
                is_mobile=True,
                has_touch=True,
                user_agent="Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            )
            load_app(page, "iPad")
            page.screenshot(path=str(ipad_path), full_page=True)
            open_inbound_modal(page)
            page.screenshot(path=str(ipad_modal_path), full_page=True)

            browser.close()


def main() -> None:
    if not DOCS.exists():
        raise SystemExit("docs/ folder not found. Run this from the repo root after creating docs/.")

    generate_icons()
    generate_screenshots()
    print("Done.")


if __name__ == "__main__":
    main()


