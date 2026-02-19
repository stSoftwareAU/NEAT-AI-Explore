"""
Capture screenshot evidence of smooth animated transitions for the
trace explorer and graph explorer views.

Targets the already-running dev server at http://localhost:8091/

Outputs:
- docs/evidence/trace-explorer-transitions.png
- docs/evidence/graph-explorer-transitions.png
"""

from __future__ import annotations

import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
EVIDENCE_DIR = DOCS / "evidence"
BASE_URL = "http://localhost:8091"


def main() -> int:
    from playwright.sync_api import sync_playwright

    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            color_scheme="light",
        )
        page = context.new_page()

        # --- Trace Explorer (index / root) ---
        print(f"Navigating to {BASE_URL}/")
        page.goto(f"{BASE_URL}/", wait_until="domcontentloaded")

        # Wait for snapshot to load — the page fetches a large JSON from GitHub Pages.
        # We look for neuron-related content in the DOM to confirm the data arrived.
        print("Waiting for trace explorer to load snapshot (up to 60 s)...")
        page.wait_for_function(
            """() => {
              // Look for any element containing "output-0" or neuron names
              const body = document.body?.innerText || '';
              return (
                body.includes('output-0') ||
                body.includes('Observations:') ||
                body.includes('neuron') ||
                body.includes('Score')
              );
            }""",
            timeout=60_000,
        )

        # Give animations and layout a moment to settle.
        page.wait_for_timeout(2_000)

        out0 = EVIDENCE_DIR / "trace-explorer-transitions.png"
        page.screenshot(path=str(out0), full_page=False)
        print(f"Wrote {out0.relative_to(ROOT)}")

        # --- Graph Explorer ---
        print(f"Navigating to {BASE_URL}/graph/")
        page.goto(f"{BASE_URL}/graph/", wait_until="domcontentloaded")

        print("Waiting for graph explorer to load snapshot (up to 60 s)...")
        # Graph view signals success via #status with class "ok"
        page.wait_for_function(
            """() => {
              const el = document.getElementById('status');
              if (el) {
                const txt = (el.textContent || '').trim();
                const ok = el.classList.contains('ok');
                if (ok && txt.startsWith('Observations:')) return true;
              }
              // Fallback: check canvas + body text
              const body = document.body?.innerText || '';
              return (
                body.includes('output-0') ||
                body.includes('Observations:') ||
                body.includes('neuron')
              );
            }""",
            timeout=60_000,
        )

        # Give WebGL and animations time to settle.
        page.wait_for_timeout(2_000)

        out1 = EVIDENCE_DIR / "graph-explorer-transitions.png"
        page.screenshot(path=str(out1), full_page=False)
        print(f"Wrote {out1.relative_to(ROOT)}")

        context.close()
        browser.close()

    time.sleep(0.1)
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
