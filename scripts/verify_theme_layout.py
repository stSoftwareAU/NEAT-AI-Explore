"""
Verify theme + responsive layout in a real browser (Playwright).

Captures viewport screenshots for:
- iPhone / iPad / Desktop
- Theme modes: auto/light/dark

Outputs to a dot-folder so git ignores it: .verify_screens/

Australian English note:
- This is a developer verification tool (not runtime code).

Last updated: 21-Dec-2025
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
OUT_DIR = ROOT / ".verify_screens"


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
        yield f"http://127.0.0.1:{port}/"
    finally:
        with contextlib.suppress(Exception):
            httpd.shutdown()
            httpd.server_close()
        os.chdir(cwd)


def _slug(s: str) -> str:
    return "".join(ch if ch.isalnum() else "-" for ch in s.strip().lower()).strip("-")


def main() -> int:
    from playwright.sync_api import sync_playwright

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    port = _free_port()

    viewports = [
        ("iphone", {"width": 390, "height": 844}, {"is_mobile": True, "has_touch": True}),
        ("ipad", {"width": 768, "height": 1024}, {"is_mobile": True, "has_touch": True}),
        (
            "desktop",
            {"width": 1280, "height": 800},
            {"is_mobile": False, "has_touch": False},
        ),
    ]

    # For auto mode, we want to see both outcomes (system light/system dark).
    scenarios: list[dict] = [
        {"mode": "light", "colourScheme": "light", "label": "light"},
        {"mode": "dark", "colourScheme": "dark", "label": "dark"},
        {"mode": "auto", "colourScheme": "light", "label": "auto-light"},
        {"mode": "auto", "colourScheme": "dark", "label": "auto-dark"},
    ]

    with _serve_docs(port) as base_url:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)

            try:
                for vp_name, viewport, device_opts in viewports:
                    for s in scenarios:
                        mode = s["mode"]
                        colour_scheme = s["colourScheme"]
                        label = s["label"]

                        context = browser.new_context(
                            viewport=viewport,
                            color_scheme=colour_scheme,  # type: ignore[arg-type]
                            **device_opts,
                        )
                        try:
                            context.add_init_script(
                                f"localStorage.setItem('themeMode', '{mode}');"
                            )
                            page = context.new_page()
                            page.goto(base_url, wait_until="domcontentloaded")

                            # Give the app time to load and render.
                            page.wait_for_timeout(1500)

                            out_name = f"{vp_name}-{_slug(label)}.png"
                            out_path = OUT_DIR / out_name
                            page.screenshot(path=str(out_path), full_page=False)
                            print(f"Wrote {out_path.relative_to(ROOT)}")

                            # Extra verification states for key layouts:
                            # - iPhone: touch tooltip + modal
                            # - Desktop: modal
                            wants_extras = label in {"light", "dark"}

                            if wants_extras and vp_name == "iphone":
                                # Show a touch tooltip via press-and-hold on an element with a title.
                                try:
                                    page.wait_for_selector(".hasTooltip", timeout=3000)
                                    page.dispatch_event(".hasTooltip", "touchstart")
                                    page.wait_for_timeout(520)
                                    out_tt = OUT_DIR / f"{vp_name}-{_slug(label)}-tooltip.png"
                                    page.screenshot(path=str(out_tt), full_page=False)
                                    print(f"Wrote {out_tt.relative_to(ROOT)}")
                                finally:
                                    with contextlib.suppress(Exception):
                                        page.dispatch_event(".hasTooltip", "touchend")

                                # Open the impact allocation modal.
                                try:
                                    page.wait_for_selector("button.impactBreakdownBtn", timeout=3000)
                                    page.click("button.impactBreakdownBtn")
                                    page.wait_for_timeout(250)
                                    out_modal = OUT_DIR / f"{vp_name}-{_slug(label)}-modal.png"
                                    page.screenshot(path=str(out_modal), full_page=False)
                                    print(f"Wrote {out_modal.relative_to(ROOT)}")
                                finally:
                                    with contextlib.suppress(Exception):
                                        page.click("#pathModalClose")

                            if wants_extras and vp_name == "desktop":
                                try:
                                    page.wait_for_selector("button.impactBreakdownBtn", timeout=3000)
                                    page.click("button.impactBreakdownBtn")
                                    page.wait_for_timeout(250)
                                    out_modal = OUT_DIR / f"{vp_name}-{_slug(label)}-modal.png"
                                    page.screenshot(path=str(out_modal), full_page=False)
                                    print(f"Wrote {out_modal.relative_to(ROOT)}")
                                finally:
                                    with contextlib.suppress(Exception):
                                        page.click("#pathModalClose")
                        finally:
                            context.close()
            finally:
                browser.close()

    # Small pause to ensure file buffers flush on slower filesystems.
    time.sleep(0.1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


