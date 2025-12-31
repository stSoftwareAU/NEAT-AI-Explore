# NEAT-AI Explore

A static HTML/JS/CSS viewer for exploring a **NEAT network snapshot** (neurons,
synapses, impacts, and recorded activations). This is a debug tool for
investigating why discovery candidates fail or succeed.

## Try it now (example snapshot)

- **Trace explorer**:
  [Open Explorer on GitHub Pages](https://stsoftwareau.github.io/NEAT-AI-Explore/)
- **Graph explorer (3D neighbourhood view)**:
  [Open Graph Explorer on GitHub Pages](https://stsoftwareau.github.io/NEAT-AI-Explore/graph/)
- **Snapshot repo (default example snapshot)**:
  [NEAT-AI-Snapshot](https://github.com/stSoftwareAU/NEAT-AI-Snapshot)
  (published via GitHub Pages as
  `https://stsoftwareau.github.io/NEAT-AI-Snapshot/`)

Both views **auto-load the default snapshot** on first open, so you can click
straight in.

## GitHub Pages + PWA

This repo is configured to deploy a **Progressive Web App (PWA)** to **GitHub
Pages**. The published site lives in `docs/` (mirrors the approach used in
`../GRQ-health`).

- **Published folder**: `docs/` (contains `index.html`, `app.js`, `styles.css`,
  etc.)
- **PWA files**: `docs/manifest.webmanifest`, `docs/sw.js`, `docs/icons/*`,
  `docs/screenshots/*`
- **Shared JS modules**: `impact_attribution.js` and `impact_diagnostics.js`
  live at the repo root (used by tests) and are copied to `docs/` for deployment
- **Deploy workflow**: `.github/workflows/deploy.yml` (push to `Develop`)

## Versioning (SemVer)

This repo uses **Semantic Versioning** (**SemVer**, `MAJOR.MINOR.PATCH`) as the
human-facing version number. See [SemVer](https://semver.org/).

- **Source of truth**: `version.json`
- **PR automation**: if a PR targets `Develop` and does not change
  `version.json`, a GitHub Action will automatically bump the **patch** version
  and push it to the PR branch.
- **Deploy cache busting**: GitHub Pages deploy replaces a `__BUILD_ID__`
  placeholder in `docs/index.html` and `docs/sw.js` with the commit SHA, so
  users receive updated assets without needing to clear caches.

## Quick Start

1. **Export a snapshot** from NEAT-AI-Discovery using
   `export_visualisation_snapshot`:
   ```json
   {
     "parquetFile": "/path/to/records.parquet",
     "creature": { ... },
     "outFile": "./snapshot.json"
   }
   ```

2. **Serve the `docs/` folder** with any HTTP server:
   ```bash
   cd docs
   python3 -m http.server 8000
   ```

3. **Open in browser**: `http://localhost:8000`

4. **Load your snapshot**:
   - Use the file picker to load a local JSON file
   - Or use `?snapshotUrl=./snapshot.json` (alias: `?file=...`)
   - For presigned URLs (recommended): use
     `?snapshotUrlB64=<base64url(utf8(url))>`
   - Or copy your snapshot to `docs/` and click "Fetch" with the default path

### Default snapshot (PWA-friendly)

When opened with **no query parameters**, the app now **auto-loads** the default
snapshot URL (hosted via GitHub Pages). This makes the installed PWA usable on
iPhone/iPad without needing the file picker.

### Tooltips (single-file snapshots)

The viewer can display human-friendly observation names and descriptions using a
`tooltips` object embedded in the snapshot (e.g.
`snapshot.tooltips["input-0"] =
{ label, description }`). This avoids needing a
separate `Tooltips.json` file.

Optional fields:

- **group**: a short group name used for clustering/summary in the Observations
  dashboard (e.g. `macro`, `rates`, `equities`). Example:
  `snapshot.tooltips["input-0"] = { label, description, group: "rates" }`.

### Loading snapshots from S3 (presigned URLs)

If you load a snapshot via a presigned S3 URL from GitHub Pages, the S3 bucket
must allow **CORS** for the GitHub Pages origin, otherwise the browser will
block the request.

- **Allowed origin**: `https://stsoftwareau.github.io`
- **Allowed methods**: `GET`, `HEAD`
- **Allowed headers**: `*`

Also note:

- If you upload `snapshot.json.gz`, either:
  - **Recommended**: set object metadata `Content-Encoding: gzip` and
    `Content-Type: application/json` so browsers transparently decompress, or
  - Ensure your browser supports `DecompressionStream` (the app will decompress
    `.gz` client-side when possible).

## Features

- **Trace explorer**: Click an output neuron → see inbound synapses → click to
  go upstream toward observations → repeat until you reach inputs. Builds a
  breadcrumb trail.
- **Synapse Sorting**: Sort inbound synapses by |weight|, weight, or |mean
  contribution|.
- **Neuron Details**: Shows type, squash, bias, impact score, and recorded
  stats.
- **Reconstruction Checks**: If enabled in export, shows max value/activation
  deltas to identify recording or squash function mismatches.
- **Graph explorer**: A 3D neighbourhood view of the NEAT network to build
  intuition about local connectivity and high-impact pathways.

## What the Explorer shows (example snapshot)

The published app auto-loads a default snapshot (hosted separately so this repo
doesn't churn with large snapshot artefacts).

Some interesting findings from that snapshot:

- **output-0 is dominated by a single upstream hidden neuron**:
  `hidden-discovery-739a5119-b981-4ae6-91d1-ca8cc33abc5a → output-0` receives
  ~74.6% of the inbound allocated impact (using the viewer’s heuristic
  allocation).
- **A second hidden neuron is the next biggest contributor**:
  `hidden-discovery-6aae3201-115b-4dc4-beee-2d7428399e14 → output-0` receives
  ~14.1% of the inbound allocated impact.
- **There are prunable candidates**: ~7.6% of non-input neurons have exported
  impact < 1e-8 (highlighted as “suspicious” in the UI).

Snapshot metadata:

- **exportedAt**: 20251219T043800Z
- **discoveryVersion**: 0.2.12
- **Network size**: 471 neurons, 16,719 synapses

## Responsiveness (PWA screenshots)

These screenshots are generated from a real browser at iPhone/iPad/desktop
viewports (see `scripts/generate_pwa_assets.py`).

### iPhone (neurons)

![iPhone screenshot](docs/screenshots/iphone-screenshot.png)

### iPhone (inbound impact allocation modal)

![iPhone inbound modal](docs/screenshots/iphone-inbound-modal.png)

### iPad (neurons)

![iPad screenshot](docs/screenshots/ipad-screenshot.png)

### iPad (inbound impact allocation modal)

![iPad inbound modal](docs/screenshots/ipad-inbound-modal.png)

### Desktop (inbound impact allocation modal)

![Desktop inbound modal](docs/screenshots/desktop-inbound-modal.png)

## Graph explorer (3D neighbourhood view)

The graph explorer is an intuition-building alternative visualisation for large
NEAT networks.

- **Entry point**: `docs/graph/index.html`
- **Controls**:
  - Drag to look
  - Mouse wheel to zoom
  - WASD / arrow keys to fly
  - Click a neuron to focus it (HUD shows key properties + flags)
- **Layout**: focus-centric neighbourhood view (directly linked neurons are
  closest; moving focus recomputes the local neighbourhood layout)

### Graph explorer (desktop)

![Graph explorer desktop](docs/screenshots/graph-desktop.png)

### Graph explorer (click-to-focus HUD)

![Graph explorer focus HUD](docs/screenshots/graph-desktop-focus.png)

### Graph explorer (tilt + zoom)

![Graph explorer tilt](docs/screenshots/graph-desktop-tilt.png)

## Direction terminology (to avoid confusion)

- **Dataflow direction (network computation)**: observations/inputs → outputs
- **Navigation direction (this explorer UI)**: outputs → observations/inputs
- **Inbound synapses (UI)**: synapses that flow from an upstream neuron into the
  currently selected neuron (i.e. arrows point _toward_ the current neuron)

## Snapshot JSON Format

The expected format matches the output of NEAT-AI-Discovery's
`export_visualisation_snapshot` function:

```json
{
  "meta": {
    "exportedAt": "20251218T...",
    "discoveryVersion": "0.2.10",
    "parquetFile": "/path/to/records.parquet"
  },
  "creature": {
    "neurons": [...],
    "synapses": [...],
    "input": 20,
    "output": 1
  },
  "recording": {
    "obsIndices": [0, 1, 2, ...],
    "neurons": {
      "output-0": {
        "activation": [...],
        "value": [...],
        "errors": [[...], ...],
        "stats": { ... }
      }
    }
  },
  "derived": {
    "impactsByNeuronUuid": { "output-0": 1.0, ... },
    "synapses": {
      "hidden-0→output-0": {
        "fromUuid": "hidden-0",
        "toUuid": "output-0",
        "weight": 2.0,
        "contribution": [...],
        "stats": { "meanContribution": 1.5, ... }
      }
    },
    "reconstructionChecks": [...]
  }
}
```

## Australian English

Comments and documentation use Australian English spelling (e.g., "colour",
"behaviour", "organisation").

## PWA asset generation (icons + screenshots)

Icons and screenshots are generated by starting a local web server and opening
the app in a headless browser (Playwright).

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install pillow playwright
python -m playwright install chromium
python scripts/generate_pwa_assets.py
```

Outputs:

- `docs/favicon.ico`
- `docs/icons/icon-<size>x<size>.png`
- `docs/icons/icon-source.png`
- `docs/screenshots/desktop-screenshot.png`
- `docs/screenshots/desktop-inbound-modal.png`
- `docs/screenshots/mobile-screenshot.png`
- `docs/screenshots/iphone-screenshot.png`
- `docs/screenshots/iphone-inbound-modal.png`
- `docs/screenshots/ipad-screenshot.png`
- `docs/screenshots/ipad-inbound-modal.png`

Last updated: 31-Dec-2025

## Licence

Apache Licence 2.0
