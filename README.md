# NEAT-AI Explore

A static HTML/JS/CSS viewer for exploring NEAT-AI creature snapshots. This is a
debug tool for investigating why discovery candidates fail or succeed.

[Example](https://stsoftwareau.github.io/NEAT-AI-Explore/?snapshotUrlB64=aHR0cHM6Ly9ncnEtYXAtc291dGhlYXN0LTIuczMuYXAtc291dGhlYXN0LTIuYW1hem9uYXdzLmNvbS9ORUFULUFJLUV4cGxvcmUvc25hcHNob3RzLzIwMjUxMjE5VDA0MzgwM1pfZDIzYTM2OGMtODYxNy01NzliLWJiNWMtNmFmMjJhMTA2YmJjLnNuYXBzaG90Lmpzb24uZ3o_WC1BbXotQWxnb3JpdGhtPUFXUzQtSE1BQy1TSEEyNTYmWC1BbXotQ3JlZGVudGlhbD1BU0lBVE9NVEhCWFRQWVFDWFJJUCUyRjIwMjUxMjE5JTJGYXAtc291dGhlYXN0LTIlMkZzMyUyRmF3czRfcmVxdWVzdCZYLUFtei1EYXRlPTIwMjUxMjE5VDA0MzgyM1omWC1BbXotRXhwaXJlcz02MDQ4MDAmWC1BbXotU2lnbmVkSGVhZGVycz1ob3N0JlgtQW16LVNlY3VyaXR5LVRva2VuPUlRb0piM0pwWjJsdVgyVmpFTjMlMkYlMkYlMkYlMkYlMkYlMkYlMkYlMkYlMkYlMkZ3RWFEbUZ3TFhOdmRYUm9aV0Z6ZEMweUlrZ3dSZ0loQU9KbXRkZjNObzRuOXhmYjBtcnlLa1ZQNnJ6S3F0c0YlMkYyaUVPV3dFd1E0WEFpRUF0aU9vamVBVG9jdzhYa3RwUjRnZlpxMU1CdiUyRlZLWlFVJTJGdW1XQzNKOWRqd3FvZ0lJcHYlMkYlMkYlMkYlMkYlMkYlMkYlMkYlMkYlMkYlMkZBUkFDR2d3eU16Y3dOamc0TVRVNE5EWWlESWxvZURFbVM4eXU2enBSRnlyMkFmTDBpV1olMkY2TjZNMklRQnJBRGtVb3VtVGVlSEdtckFucmhydEdqaE9heTNMRnk3ODhneTlmdVVGcFFiaVc4aHdWM1VETVQlMkJ5Zks0YTA5T28yVSUyQktra1k3Qk13ZHJBbkF3bWZ1a3hPUE1mWnV2eU1ZJTJCalV4OFZaQ09rWEZyeDlHZTFNRkpIYkJuTUpmd1ZpMlBwQnZNbE41YzhZV0FHbG90TEFDamJVZ3M2bUJ0bnJwWlhIMWNDUlhSNTc2VXVHOGFXVFRmQk42Z1hVcldzZ01peDdWTTl6dks2dG1ndU53eVJmZlU1akxFMEx4SEVVU0ZVY29xV09UeGdBS2p1UU9TYkg5cG83NjNBWXJ3ZG1BYUVoNWxubkx0ZnFrdlg2ZmRWVDZhdVhURnBWNjJJYUtsODJkVmMxU2MlMkY1S0lWZDNmY1lObVZIOUREVXJKUEtCanFjQVdUYTYwUEp3UnFjd3dOV2JLWDd1MEdFRG1WSmo0RU1vNmY4WDVCbFBrSTE5T2ZKWTFoTmRTa2Z1bWMxd0h6OXg2N3RucSUyRmNlemxNVWpScXVURjI0MUNHRnBpOU1VQ0VxNmkwWXlTeHRMcGpraER5NEdFMU5UYW14SlZYSDB1U1FxRlFIYkVnYXZGVCUyQjNHclN0WEZZRzlrejFXd2RkeDdyR1ljZkYlMkJxcjk4M2FuRWRIaGJJaHJFQnQ4JTJGRnMlMkI5aTRzTnh0OEZ4cldyS0N1TjhOdyUzRCUzRCZYLUFtei1TaWduYXR1cmU9ODM1NTAwZDNkNDc0Yjk3ODgzODIzZjI4MDk0ZDBiYzc3ODJiMTBhM2FjYTY4Mjk5NjA2NmZiMzhlNmY2ZmFiYw)
## GitHub Pages + PWA

This repo is configured to deploy a **Progressive Web App (PWA)** to **GitHub
Pages**. The published site lives in `docs/` (mirrors the approach used in
`../GRQ-health`).

- **Published folder**: `docs/`
- **PWA files**: `docs/manifest.webmanifest`, `docs/sw.js`, `docs/icons/*`,
  `docs/screenshots/*`
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

2. **Serve this directory** with any HTTP server:
   ```bash
   # Python 3
   python3 -m http.server 8000

   # Node.js (npx)
   npx serve .
   ```

3. **Open in browser**: `http://localhost:8000`

4. **Load your snapshot**:
   - Use the file picker to load a local JSON file
   - Or use `?snapshotUrl=./snapshot.json` (alias: `?file=...`)
   - For presigned URLs (recommended): use
     `?snapshotUrlB64=<base64url(utf8(url))>`
   - Or click "Load ./snapshot.json" if you've placed the file in this directory

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

### Quick Start (GitHub Pages / PWA build)

For local testing of the GitHub Pages site (what actually deploys), serve
`docs/`:

```bash
cd docs
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Features

- **Trace Explorer**: Click an output neuron → see inbound synapses → click to
  go upstream toward observations → repeat until you reach inputs. Builds a
  breadcrumb trail.
- **Synapse Sorting**: Sort inbound synapses by |weight|, weight, or |mean
  contribution|.
- **Neuron Details**: Shows type, squash, bias, impact score, and recorded
  stats.
- **Reconstruction Checks**: If enabled in export, shows max value/activation
  deltas to identify recording or squash function mismatches.

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

- `docs/icons/icon-<size>x<size>.png`
- `docs/screenshots/desktop-screenshot.png`
- `docs/screenshots/mobile-screenshot.png`

Last updated: 18-Dec-2025

## Creating a public GitHub repo (next to `../NEAT-AI`)

This folder already exists at: `/Users/nigelleck/Develop/NEAT-AI-Explore`

To publish it as a **public** GitHub repo:

1. Create a new repo on GitHub (e.g. `NEAT-AI-Explore`) or use the GitHub CLI.
2. From this directory:

```bash
cd /Users/nigelleck/Develop/NEAT-AI-Explore
git init
git add .
git commit -m "Initial commit"

# Option A (recommended): GitHub CLI
gh repo create NEAT-AI-Explore --public --source=. --remote=origin --push

# Option B: manual remote
# git remote add origin git@github.com:stSoftwareAU/NEAT-AI-Explore.git
# git branch -M Develop
# git push -u origin Develop
```

Then enable GitHub Pages:

- Repo → **Settings** → **Pages** → **Build and deployment** → **Source: GitHub
  Actions**

### Fixing `configure-pages` "HttpError: Not Found" on first deploy

If the workflow fails with: `Get Pages site failed ... HttpError: Not Found`

It usually means GitHub Pages has not been enabled for the repository yet (or
the organisation requires it to be enabled manually).

Fix:

- Repo → **Settings** → **Pages** → **Build and deployment** → **Source: GitHub
  Actions**

Then re-run the workflow (or push again to `Develop`).

## Licence

Apache Licence 2.0
