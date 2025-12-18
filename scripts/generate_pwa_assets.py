"""
Generate PWA assets for NEAT-AI Explore.

Creates:
- docs/icons/icon-<size>x<size>.png
- docs/screenshots/desktop-screenshot.png
- docs/screenshots/mobile-screenshot.png

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
import os
import socket
import socketserver
import threading
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
ICONS_DIR = DOCS / "icons"
SHOTS_DIR = DOCS / "screenshots"

ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512]


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
    from PIL import Image, ImageDraw, ImageFont

    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    base_size = 1024
    bg = (10, 14, 26)  # matches --bg
    accent = (96, 165, 250)  # matches --accent
    text = (229, 231, 235)  # matches --text

    img = Image.new("RGBA", (base_size, base_size), bg)
    draw = ImageDraw.Draw(img)

    # Simple geometric mark: circle + network-ish nodes.
    pad = int(base_size * 0.12)
    draw.ellipse((pad, pad, base_size - pad, base_size - pad), outline=accent, width=int(base_size * 0.04))

    # Nodes
    nodes = [
        (0.35, 0.35),
        (0.65, 0.35),
        (0.35, 0.65),
        (0.65, 0.65),
        (0.50, 0.50),
    ]
    r = int(base_size * 0.03)
    for x, y in nodes:
        cx = int(base_size * x)
        cy = int(base_size * y)
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=accent)

    # Edges
    for a, b in [(0, 4), (1, 4), (2, 4), (3, 4), (0, 1), (2, 3)]:
        x1, y1 = nodes[a]
        x2, y2 = nodes[b]
        draw.line(
            (int(base_size * x1), int(base_size * y1), int(base_size * x2), int(base_size * y2)),
            fill=(96, 165, 250, 180),
            width=int(base_size * 0.012),
        )

    # Title text (best-effort font).
    title = "NEAT"
    subtitle = "Explore"
    try:
        font_big = ImageFont.truetype("Arial.ttf", int(base_size * 0.14))
        font_small = ImageFont.truetype("Arial.ttf", int(base_size * 0.09))
    except Exception:
        font_big = ImageFont.load_default()
        font_small = ImageFont.load_default()

    tw, th = draw.textbbox((0, 0), title, font=font_big)[2:]
    sw, sh = draw.textbbox((0, 0), subtitle, font=font_small)[2:]

    tx = (base_size - tw) // 2
    ty = int(base_size * 0.70)
    draw.text((tx, ty), title, fill=text, font=font_big)
    draw.text(((base_size - sw) // 2, ty + th - int(base_size * 0.02)), subtitle, fill=text, font=font_small)

    source_path = ICONS_DIR / "icon-source.png"
    img.save(source_path)

    for size in ICON_SIZES:
        out = img.resize((size, size), resample=Image.Resampling.LANCZOS)
        out.save(ICONS_DIR / f"icon-{size}x{size}.png")


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
    """
    desktop_path = SHOTS_DIR / "desktop-screenshot.png"
    mobile_path = SHOTS_DIR / "mobile-screenshot.png"

    # Always ensure output dir exists.
    SHOTS_DIR.mkdir(parents=True, exist_ok=True)

    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except Exception:
        _placeholder_screenshot(desktop_path, (1280, 720), "Desktop")
        _placeholder_screenshot(mobile_path, (720, 1280), "Mobile")
        return

    port = _free_port()
    with _serve_docs(port) as url:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            page.goto(url, wait_until="networkidle")
            page.wait_for_timeout(300)
            page.screenshot(path=str(desktop_path), full_page=True)

            page = browser.new_page(
                viewport={"width": 720, "height": 1280},
                user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            )
            page.goto(url, wait_until="networkidle")
            page.wait_for_timeout(300)
            page.screenshot(path=str(mobile_path), full_page=True)
            browser.close()


def main() -> None:
    if not DOCS.exists():
        raise SystemExit("docs/ folder not found. Run this from the repo root after creating docs/.")

    generate_icons()
    generate_screenshots()
    print("Done.")


if __name__ == "__main__":
    main()


