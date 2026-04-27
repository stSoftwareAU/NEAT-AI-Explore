# 🧠 NEAT-AI Explore

[![Licence: Apache 2.0](https://img.shields.io/badge/Licence-Apache%202.0-blue.svg)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/Demo-GitHub%20Pages-brightgreen)](https://stsoftwareau.github.io/NEAT-AI-Explore/)
[![Deno](https://img.shields.io/badge/Tests-Deno-000000?logo=deno)](https://deno.com/)
[![Version](https://img.shields.io/badge/Version-0.1.0-orange)](version.json)

A static HTML/JS/CSS viewer for exploring a **NEAT network snapshot** (neurons,
synapses, impacts, and recorded activations). This is a debug tool for
investigating why discovery candidates fail or succeed.

---

## 🚀 Try it now (example snapshot)

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

---

## 📱 GitHub Pages + PWA

This repo is configured to deploy a **Progressive Web App (PWA)** to **GitHub
Pages**. The published site lives in `docs/` (mirrors the approach used in
`../GRQ-health`).

- **Published folder**: `docs/` (contains `index.html`, `app.js`, `styles.css`,
  etc.)
- **PWA files**: `docs/manifest.webmanifest`, `docs/sw.js`, `docs/icons/*`,
  `docs/screenshots/*`
- **Shared JS modules**: `docs/impact_attribution.js` and
  `docs/impact_diagnostics.js` are the single source of truth (imported by both
  the app and tests)
- **Deploy workflow**: `.github/workflows/deploy.yml` (push to `Develop`)

---

## 🏗️ Architecture Overview

```mermaid
graph TD
    subgraph repo["📁 Repository"]
        direction TB
        subgraph docs_dir["docs/ — Published PWA"]
            direction TB
            index["index.html<br/>(Trace Explorer)"]
            appjs["app.js"]
            styles["styles.css"]
            sw["sw.js<br/>(Service Worker)"]
            manifest["manifest.webmanifest"]

            subgraph shared["shared/ — Reusable Modules"]
                direction TB
                snap_loader["snapshot_loader.js"]
                graph_analysis["graph_analysis.js"]
                colour_maps["colour_maps.js"]
                creature_overview["creature_overview.js"]
                theme_mod["theme.js"]
                correlation["correlation.js"]
                diagnostics["diagnostics_scan.js"]
                sparkline["sparkline.js"]
                discovery["discovery.js"]
            end

            impact_attr["impact_attribution.js"]
            impact_diag["impact_diagnostics.js"]

            subgraph graph_dir["graph/ — 3D Explorer"]
                graph_html["index.html"]
                graph_js["graph.js"]
                graph_css["graph.css"]
            end
        end

        subgraph tests_dir["tests/ — Deno Tests"]
            test_files["*_test.ts files"]
        end

        quality["quality.sh"]
    end

    index --> appjs
    appjs --> shared
    appjs --> impact_attr
    appjs --> impact_diag
    graph_js --> shared
    test_files -.->|import & test| shared
    test_files -.->|import & test| impact_attr
    test_files -.->|import & test| impact_diag
    quality -.->|fmt + lint + test| tests_dir

    style docs_dir fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20
    style shared fill:#e3f2fd,stroke:#1565c0,color:#0d47a1
    style graph_dir fill:#fff3e0,stroke:#e65100,color:#bf360c
    style tests_dir fill:#fce4ec,stroke:#c62828,color:#b71c1c
    style quality fill:#f3e5f5,stroke:#6a1b9a,color:#4a148c
```

---

## 🔖 Versioning (SemVer)

This repo uses **Semantic Versioning** (**SemVer**, `MAJOR.MINOR.PATCH`) as the
human-facing version number. See [SemVer](https://semver.org/).

- **Source of truth**: `version.json`
- **PR automation**: if a PR targets `Develop` and does not change
  `version.json`, a GitHub Action will automatically bump the **patch** version
  and push it to the PR branch.
- **Deploy cache busting**: GitHub Pages deploy replaces a `__BUILD_ID__`
  placeholder in `docs/index.html` and `docs/sw.js` with the commit SHA, so
  users receive updated assets without needing to clear caches.

---

## ⚡ Quick Start

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

### ☁️ Loading snapshots from S3 (presigned URLs)

If you load a snapshot via a presigned S3 URL from GitHub Pages, the S3 bucket
must allow **CORS** for the GitHub Pages origin, otherwise the browser will
block the request.

- **Allowed origin**: `https://stsoftwareau.github.io`
- **Allowed methods**: `GET`, `HEAD`
- **Allowed headers**: `*`

> **💡 Tip:** If you upload `snapshot.json.gz`, either set object metadata
> `Content-Encoding: gzip` and `Content-Type: application/json` so browsers
> transparently decompress, _or_ ensure your browser supports
> `DecompressionStream` (the app will decompress `.gz` client-side when
> possible).

---

## ✨ Features

- **Creature overview dashboard**: After loading a snapshot, see an at-a-glance
  summary of the neural network — neuron/synapse counts, activation function
  distribution, network depth, and an interactive mini topology diagram. Click
  any layer to navigate into the trace explorer.
- **Trace explorer**: Click an output neuron → see inbound synapses → click to
  go upstream toward observations → repeat until you reach inputs. Builds a
  breadcrumb trail.
- **Synapse Sorting**: Sort inbound synapses by |weight|, weight, or |mean
  contribution|.
- **Synapse Colour Coding**: Synapse edges and rows are colour-coded by weight
  strength — green for excitatory (positive), red for inhibitory (negative),
  grey for weak/near-zero. A collapsible colour legend explains the scale.
- **Neuron Detail Cards**: Shows type, squash (colour-coded badge), bias, impact
  score, and recorded stats in themed card components with inline sparkline
  charts for activation history and error distribution histograms.
- **Reconstruction Checks**: If enabled in export, shows max value/activation
  deltas to identify recording or squash function mismatches.
- **Graph explorer**: A 3D neighbourhood view of the NEAT network to build
  intuition about local connectivity and high-impact pathways.

---

## 🔍 What the Explorer shows (example snapshot)

The published app auto-loads a default snapshot (hosted separately so this repo
doesn't churn with large snapshot artefacts).

Some interesting findings from that snapshot:

- **output-0 is dominated by a single upstream hidden neuron**:
  `hidden-discovery-739a5119-b981-4ae6-91d1-ca8cc33abc5a → output-0` receives
  ~74.6% of the inbound allocated impact (using the viewer's heuristic
  allocation).
- **A second hidden neuron is the next biggest contributor**:
  `hidden-discovery-6aae3201-115b-4dc4-beee-2d7428399e14 → output-0` receives
  ~14.1% of the inbound allocated impact.
- **There are prunable candidates**: ~7.6% of non-input neurons have exported
  impact < 1e-8 (highlighted as "suspicious" in the UI).

Snapshot metadata:

- **exportedAt**: 20251219T043800Z
- **discoveryVersion**: 0.2.12
- **Network size**: 471 neurons, 16,719 synapses

---

## 📱 Responsiveness (PWA screenshots)

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

---

## 🎮 Graph explorer (3D neighbourhood view)

The graph explorer is an intuition-building alternative visualisation for large
NEAT networks.

- **Entry point**: `docs/graph/index.html`
- **Controls**:
  - Drag to look
  - Mouse wheel to zoom
  - WASD / arrow keys to fly
  - Click a neuron to focus it (HUD shows key properties + flags)
  - **Touch**: single tap to focus (with ripple), long press for tooltip, pinch
    to zoom toward midpoint, two-finger pan with momentum, swipe left/right to
    cycle neurons in the trace path
- **Layout**: focus-centric neighbourhood view (directly linked neurons are
  closest; moving focus recomputes the local neighbourhood layout)
- **Legend**: includes mapping notes (size/colour/bias/degree)

### Graph explorer (desktop)

![Graph explorer desktop](docs/screenshots/graph-desktop.png)

### Graph explorer (click-to-focus HUD)

![Graph explorer focus HUD](docs/screenshots/graph-desktop-focus.png)

### Graph explorer (tilt + zoom)

![Graph explorer tilt](docs/screenshots/graph-desktop-tilt.png)

---

## 🧭 Direction terminology (to avoid confusion)

The NEAT network computation direction and the explorer navigation direction are
**opposite**:

```mermaid
graph LR
    subgraph computation["🧠 Network Computation Direction"]
        direction LR
        obs["Observations<br/>(Inputs)"]
        hidden["Hidden<br/>Neurons"]
        out["Output<br/>Neurons"]
        obs -->|"activation<br/>flows forward"| hidden
        hidden -->|"weighted<br/>signals"| out
    end

    subgraph navigation["🔍 Explorer Navigation Direction"]
        direction RL
        out2["Output<br/>Neurons"]
        hidden2["Hidden<br/>Neurons"]
        obs2["Observations<br/>(Inputs)"]
        out2 -->|"click to<br/>trace upstream"| hidden2
        hidden2 -->|"follow inbound<br/>synapses"| obs2
    end

    style computation fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20
    style navigation fill:#e3f2fd,stroke:#1565c0,color:#0d47a1
    style obs fill:#fff9c4,stroke:#f9a825,color:#f57f17
    style out fill:#c8e6c9,stroke:#388e3c,color:#1b5e20
    style obs2 fill:#fff9c4,stroke:#f9a825,color:#f57f17
    style out2 fill:#c8e6c9,stroke:#388e3c,color:#1b5e20
```

- **Inbound synapses (UI)**: synapses that flow from an upstream neuron into the
  currently selected neuron (i.e. arrows point _toward_ the current neuron)

---

## 📥 Snapshot Loading Flow

How snapshots reach the viewer through `snapshot_loader.js`:

```mermaid
graph TD
    subgraph sources["📥 Snapshot Sources"]
        file_picker["File Picker<br/>(local JSON)"]
        url_param["?snapshotUrl=<br/>or ?file="]
        b64_param["?snapshotUrlB64=<br/>(base64url encoded)"]
        default["No params<br/>(auto-load default)"]
    end

    file_picker -->|"blob: URL"| normalise
    url_param -->|"raw URL"| normalise
    b64_param -->|"decode base64url<br/>→ UTF-8 URL"| decode["decodeBase64UrlToUtf8"]
    decode --> security
    default -->|"DEFAULT_SNAPSHOT_URL<br/>from config.js"| normalise

    security["isDangerousUrlScheme?"]
    normalise["normaliseSnapshotUrl"]
    normalise --> security

    security -->|"❌ javascript: / data:"| blocked["Blocked<br/>(security)"]
    security -->|"✅ safe"| fetch_snap["fetch() snapshot"]

    fetch_snap --> gzip{"gzip<br/>compressed?"}
    gzip -->|"yes (.gz)"| decompress["DecompressionStream<br/>(client-side gunzip)"]
    gzip -->|"no"| parse["JSON.parse"]
    decompress --> parse

    parse --> normalise_creature["normaliseCreature"]
    normalise_creature --> viewer["🖥️ Explorer renders<br/>the snapshot"]

    style sources fill:#fff3e0,stroke:#e65100,color:#bf360c
    style blocked fill:#ffcdd2,stroke:#c62828,color:#b71c1c
    style viewer fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20
    style security fill:#fff9c4,stroke:#f9a825,color:#f57f17
```

---

## 📦 Snapshot JSON Format

The expected format matches the output of NEAT-AI-Discovery's
`export_visualisation_snapshot` function:

```mermaid
classDiagram
    class Snapshot {
        meta
        creature
        recording
        derived
        tooltips?
    }

    class Meta {
        exportedAt : string
        discoveryVersion : string
        parquetFile : string
    }

    class Creature {
        neurons : Neuron[]
        synapses : Synapse[]
        input : number
        output : number
    }

    class Neuron {
        uuid : string
        type : input | hidden | output
        squash : string
        bias : number
    }

    class Synapse {
        from : string
        to : string
        weight : number
    }

    class Recording {
        obsIndices : number[]
        neurons : NeuronRecording map
    }

    class NeuronRecording {
        activation : number[]
        value : number[]
        errors : number[][]
        stats : object
    }

    class Derived {
        impactsByNeuronUuid : number map
        synapses : DerivedSynapse map
        reconstructionChecks : object[]
    }

    class DerivedSynapse {
        fromUuid : string
        toUuid : string
        weight : number
        contribution : number[]
        stats : object
    }

    Snapshot --> Meta
    Snapshot --> Creature
    Snapshot --> Recording
    Snapshot --> Derived
    Creature --> "0..*" Neuron
    Creature --> "0..*" Synapse
    Recording --> "0..*" NeuronRecording
    Derived --> "0..*" DerivedSynapse
```

```json
{
  "meta": {
    "exportedAt": "20251218T...",
    "discoveryVersion": "0.2.10",
    "parquetFile": "/path/to/records.parquet"
  },
  "creature": {
    "neurons": ["..."],
    "synapses": ["..."],
    "input": 20,
    "output": 1
  },
  "recording": {
    "obsIndices": [0, 1, 2, "..."],
    "neurons": {
      "output-0": {
        "activation": ["..."],
        "value": ["..."],
        "errors": [["..."], "..."],
        "stats": { "...": "..." }
      }
    }
  },
  "derived": {
    "impactsByNeuronUuid": { "output-0": 1.0, "...": "..." },
    "synapses": {
      "hidden-0→output-0": {
        "fromUuid": "hidden-0",
        "toUuid": "output-0",
        "weight": 2.0,
        "contribution": ["..."],
        "stats": { "meanContribution": 1.5, "...": "..." }
      }
    },
    "reconstructionChecks": ["..."]
  }
}
```

---

## 🧪 Testing

Tests use [Deno](https://deno.com/) and live in `tests/`. Run them with:

```bash
deno test -A
```

Or use the quality gate (format + lint + test):

```bash
./quality.sh
```

### Quality gate pipeline

```mermaid
graph LR
    start["./quality.sh"] --> fmt

    subgraph pipeline["Quality Gate Pipeline"]
        direction LR
        fmt["📐 deno fmt<br/>--check"]
        lint["🔍 deno lint"]
        test["🧪 deno test -A"]
        fmt -->|"pass"| lint
        lint -->|"pass"| test
    end

    test -->|"all pass"| ok["✅ OK"]
    fmt -->|"fail"| fix_fmt["Fix formatting"]
    lint -->|"fail"| fix_lint["Fix lint issues"]
    test -->|"fail"| fix_test["Fix failing tests"]

    style pipeline fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20
    style ok fill:#c8e6c9,stroke:#388e3c,color:#1b5e20
    style fix_fmt fill:#ffcdd2,stroke:#c62828,color:#b71c1c
    style fix_lint fill:#ffcdd2,stroke:#c62828,color:#b71c1c
    style fix_test fill:#ffcdd2,stroke:#c62828,color:#b71c1c
```

### Unit tests vs benchmarks

- **Unit tests verify correctness** — import a module, call a function with
  known inputs, assert the result. They must not measure performance.
- **Benchmarks verify performance** — use `deno bench` or a dedicated script to
  measure execution time. Benchmarks are expected to be slow and must not run as
  part of the unit-test suite.
- Unit tests run in parallel, so any timing-based assertion is unreliable by
  design.

### "What" tests vs "how" tests

Write **"what" tests** — tests that exercise real behaviour:

```ts
import { myFunction } from "../module.js";
Deno.test("myFunction doubles positive numbers", () => {
  assertEquals(myFunction(3), 6);
});
```

Do **not** write **"how" tests** — tests that read source files as text and grep
for implementation patterns:

```ts
// BAD — breaks on any refactor and tests nothing useful
const src = await Deno.readTextFile("module.js");
assert(src.includes("Math.pow"));
```

> **⚠️ Note:** If you swap quicksort for mergesort, "what" tests still pass
> (correct results). "How" tests break even though behaviour is unchanged, or
> worse, they pass while the code is actually broken.

### What can be unit-tested

Only pure, DOM-free modules can be tested in Deno:

| Module                             | Testable functions                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/impact_attribution.js`       | `computeImpactBreakdownToOutputs`, `computeInboundSynapseImpactAllocation`                                                                |
| `docs/impact_diagnostics.js`       | `squashDerivative`, `computeGradientProxyImpact`, `summariseSeriesStats`, etc.                                                            |
| `docs/shared/config.js`            | `DEFAULT_SNAPSHOT_URL`, `SNAPSHOT_FALLBACK_URLS`, `ALLOWED_SNAPSHOT_ORIGINS`                                                              |
| `docs/shared/graph_analysis.js`    | `buildGraphIndex`, `computeReachableToOutputs`, `computeTopContributingInputs`                                                            |
| `docs/shared/snapshot_loader.js`   | `normaliseSnapshotUrl`, `decodeBase64UrlToUtf8`, `isDangerousUrlScheme`, `normaliseCreature`                                              |
| `docs/shared/colour_maps.js`       | `hash32`, `u01ToSigned`, `u32ToU01`, `neuronColourRgb01`, `synapseWeightStrength01`, `synapseWeightColourRgb01`, `synapseWeightColourCss` |
| `docs/shared/creature_overview.js` | `computeNeuronBreakdown`, `computeSynapseStats`, `computeNetworkDepth`, `computeActivationDistribution`, `computeLayerTopology`           |
| `docs/shared/transitions.js`       | `prefersReducedMotion`, `synapseStaggerDelay`, duration constants                                                                         |
| `docs/shared/touch_gestures.js`    | `classifyTouch`, `detectSwipeDirection`, `momentumStep`, `clampMomentum`, `pinchZoomToward`, `clampZoomDistance`                          |
| `docs/shared/sparkline.js`         | `computeSparklinePoints`, `computeErrorHistogram`, `squashBadge`, `flattenErrors`                                                         |
| `docs/shared/correlation.js`       | `pearsonCorrelation`, `sampleSeries`, `computeTopInputCorrelations`                                                                       |
| `docs/shared/discovery.js`         | `normaliseCandidate`, `extractDiscoveryCandidates`                                                                                        |
| `docs/shared/diagnostics_scan.js`  | `scan1d`, `scan2d`, `computeNonFiniteIssues`, `computeErrorConcentrationIssues`                                                           |
| `docs/shared/theme.js`             | `normaliseThemeMode`, `cycleThemeMode`, `themeModeLabel`, `themeModeGlyph`                                                                |
| `docs/shared/ui_helpers.js`        | `escapeHtml`, `extractTooltips`                                                                                                           |

> **💡 Tip:** Browser-only code (DOM, WebGL, Service Worker) cannot be
> unit-tested in Deno — skip it rather than faking it with grep-based
> assertions.

---

## 🇦🇺 Australian English

Comments and documentation use Australian English spelling (e.g., "colour",
"behaviour", "organisation").

> **⚠️ Note:** CSS properties like `prefers-color-scheme` and JavaScript API
> names retain American English spelling as they are web standards.

---

## 🖼️ PWA asset generation (icons + screenshots)

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

Last updated: 15-Jan-2026

---

## 🔗 Related Repositories

The NEAT-AI project is split across seven public repositories. Each focuses on
one concern and composes with the others as shown below.

| Repository                                                             | Role                                                                                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [NEAT-AI](https://github.com/stSoftwareAU/NEAT-AI)                     | Primary Deno/TypeScript neural-network engine (evolution, training, WASM activation).                             |
| [NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core)           | Shared native Rust library (`neat-core`) with numerics, topology helpers, and the chunked `.bin` training stream. |
| [NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery) | Rust discovery module invoked by NEAT-AI via Deno FFI to search architectures and hyper-parameters.               |
| [NEAT-AI-Snapshot](https://github.com/stSoftwareAU/NEAT-AI-Snapshot)   | Creature/genome snapshot format and fixtures produced by NEAT-AI and consumed by downstream tools.                |
| [NEAT-AI-scorer](https://github.com/stSoftwareAU/NEAT-AI-scorer)       | Production forward-only scoring application built on `neat-core` via a path dependency.                           |
| [NEAT-AI-Explore](https://github.com/stSoftwareAU/NEAT-AI-Explore)     | Visualiser for creatures that reads NEAT-AI-Snapshot data.                                                        |
| [NEAT-AI-Examples](https://github.com/stSoftwareAU/NEAT-AI-Examples)   | Worked examples and tutorials that depend on NEAT-AI.                                                             |

### Dependency graph

```mermaid
graph TD
    Core[NEAT-AI-core<br/>Rust shared lib]
    Main[NEAT-AI<br/>Deno/TypeScript engine]
    Discovery[NEAT-AI-Discovery<br/>Rust, via Deno FFI]
    Snapshot[NEAT-AI-Snapshot<br/>creature data]
    Scorer[NEAT-AI-scorer<br/>Rust scorer app]
    Explore[NEAT-AI-Explore<br/>visualiser]
    Examples[NEAT-AI-Examples<br/>tutorials]

    Main -->|Deno FFI| Discovery
    Main -->|produces| Snapshot
    Scorer -->|path dependency| Core
    Explore -->|reads| Snapshot
    Examples -->|depends on| Main
```

---

## 📄 Licence

Apache Licence 2.0
