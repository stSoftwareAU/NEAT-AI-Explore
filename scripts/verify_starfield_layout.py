"""
Verify the Starfield view in a real browser (Playwright).

Captures key screenshots showing:
- Initial render (starfield)
- Click-to-focus (HUD visible)
- 3D interaction (drag-to-look + wheel zoom)

Outputs:
- docs/screenshots/starfield-desktop.png
- docs/screenshots/starfield-desktop-focus.png
- docs/screenshots/starfield-desktop-tilt.png

Last updated: 30-Dec-2025
"""

from __future__ import annotations

import contextlib
import os
import socket
import socketserver
import threading
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@contextlib.contextmanager
def _serve_docs(port: int):
    import http.server

    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_args, **_kwargs):  # noqa: N802 - stdlib signature
            pass

    cwd = os.getcwd()
    os.chdir(str(DOCS))
    try:
        httpd = socketserver.TCPServer(("127.0.0.1", port), QuietHandler)
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        try:
            yield f"http://127.0.0.1:{port}/"
        finally:
            with contextlib.suppress(Exception):
                httpd.shutdown()
                httpd.server_close()
    finally:
        os.chdir(cwd)


def main() -> int:
    from playwright.sync_api import sync_playwright

    out_dir = DOCS / "screenshots"
    out_dir.mkdir(parents=True, exist_ok=True)

    port = _free_port()

    with _serve_docs(port) as base_url:
        url = base_url + "starfield/index.html"
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                color_scheme="dark",  # show the space vibe by default
            )
            page = context.new_page()
            page.goto(url, wait_until="domcontentloaded")

            # Wait for the canvas to exist and for the renderer to have a moment
            # to draw a frame.
            page.wait_for_selector("#glCanvas", timeout=5000)

            # The key: do not screenshot until the snapshot has loaded.
            #
            # In starfield.js, successful loads set:
            # - #status text to "Observations: ..."
            # - and kind "ok" (class: statusInline ok)
            page.wait_for_function(
                """() => {
                  const el = document.getElementById('status');
                  if (!el) return false;
                  const txt = (el.textContent || '').trim();
                  const ok = el.classList.contains('ok');
                  return ok && txt.startsWith('Observations:');
                }""",
                timeout=60_000,
            )

            # Give WebGL a couple of frames to settle so point sprites are visible.
            page.wait_for_timeout(300)

            out0 = out_dir / "starfield-desktop.png"
            page.screenshot(path=str(out0), full_page=False)
            print(f"Wrote {out0.relative_to(ROOT)}")

            # Click centre to focus a star and populate the HUD.
            page.click("#glCanvas", position={"x": 640, "y": 400})
            page.wait_for_function(
                """() => {
                  const hud = document.getElementById('hud');
                  if (!hud) return false;
                  const txt = (hud.textContent || '');
                  return txt.includes('Focus:') && !txt.includes('No focus');
                }""",
                timeout=10_000,
            )

            out1 = out_dir / "starfield-desktop-focus.png"
            page.screenshot(path=str(out1), full_page=False)
            print(f"Wrote {out1.relative_to(ROOT)}")

            # Tilt the view and zoom a bit to demonstrate 3D control.
            page.mouse.move(640, 400)
            page.mouse.down()
            page.mouse.move(820, 520, steps=12)
            page.mouse.up()
            page.mouse.wheel(0, -480)
            page.wait_for_timeout(300)

            out2 = out_dir / "starfield-desktop-tilt.png"
            page.screenshot(path=str(out2), full_page=False)
            print(f"Wrote {out2.relative_to(ROOT)}")

            context.close()
            browser.close()

    # Small pause to ensure file buffers flush on slower filesystems.
    time.sleep(0.1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


