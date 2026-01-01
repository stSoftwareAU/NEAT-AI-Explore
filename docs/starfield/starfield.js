/**
 * Starfield page entrypoint.
 *
 * The Starfield renderer currently lives in `docs/graph/graph.js` (historical
 * naming: the "graph explorer" is rendered as a starfield). This thin module
 * exists so `docs/starfield/index.html` can import a stable, local entrypoint
 * without duplicating the large renderer bundle.
 *
 * Issue #44 (1-Jan-2026): `docs/starfield/index.html` referenced `starfield.js`,
 * but the file was missing, causing a 404 and a non-functional page.
 *
 * Note (1-Jan-2026):
 * Keep this file intentionally tiny. If we embed a full renderer implementation
 * here, the Starfield page can silently drift behind the main graph explorer
 * (`docs/graph/graph.js`) and miss new features/fixes.
 */

import "../graph/graph.js";
