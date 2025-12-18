# NEAT-AI Explore

A static HTML/JS/CSS viewer for exploring NEAT-AI creature snapshots. This is a
debug tool for investigating why discovery candidates fail or succeed.

## Quick Start

1. **Export a snapshot** from NEAT-AI-Discovery using `export_visualisation_snapshot`:
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
   - Or use `?file=./snapshot.json` query parameter
   - Or click "Load ./snapshot.json" if you've placed the file in this directory

## Features

- **Trace Explorer**: Click on output neuron → see inbound synapses → click to go
  upstream → repeat until you reach inputs. Builds a breadcrumb trail.
- **Synapse Sorting**: Sort inbound synapses by |weight|, weight, or |mean contribution|.
- **Neuron Details**: Shows type, squash, bias, impact score, and recorded stats.
- **Reconstruction Checks**: If enabled in export, shows max value/activation deltas
  to identify recording or squash function mismatches.

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

## Licence

MIT
