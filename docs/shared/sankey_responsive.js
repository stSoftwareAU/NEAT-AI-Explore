/**
 * Responsive layout constants for the Sankey contribution-flow view (#540).
 *
 * The view as first merged was laid out for a desktop canvas and merely shrank
 * to fit a phone: 12 nodes per layer, 22-character labels and 1.5 px bands, all
 * scaled down until nothing was legible. The fix is to pick a *different* set
 * of layout constants at phone width rather than to shrink one set, and to keep
 * that choice DOM-free so the narrow-viewport decisions are unit-testable.
 *
 * Geometry consumes these constants in `sankey_layout.js`; the browser view
 * only turns the result into SVG.
 */

import { MOBILE_MAX } from "./responsive.js";

/**
 * Viewport width (CSS px) at or below which the phone layout applies. Shared
 * with the CSS `@media (max-width: 640px)` rules in `docs/sankey/sankey.css`.
 */
export const PHONE_MAX_WIDTH = MOBILE_MAX;

/**
 * @typedef {object} SankeyLayout
 * @property {boolean} isNarrow — true when the phone layout is in force.
 * @property {number} maxNodesPerLayer — per-layer fold budget for the flow.
 * @property {number} columnWidth — horizontal budget per layer, in view units.
 * @property {number} minViewWidth — floor for the SVG view width.
 * @property {number} viewHeight — SVG view height.
 * @property {number} padX — horizontal padding reserved for labels.
 * @property {number} padY — vertical padding.
 * @property {number} nodeWidth — node rectangle width (also the tap target).
 * @property {number} nodeGap — vertical gap between nodes in a column.
 * @property {number} minBand — floor for a positive band's thickness.
 * @property {number} labelMinHeight — node height below which the label is cut.
 * @property {number} labelMaxChars — label truncation length.
 */

/** Desktop layout — the pre-#540 constants, kept byte-for-byte. */
const DESKTOP = Object.freeze({
  isNarrow: false,
  maxNodesPerLayer: 12,
  columnWidth: 220,
  minViewWidth: 640,
  viewHeight: 620,
  padX: 140,
  padY: 24,
  nodeWidth: 16,
  nodeGap: 10,
  minBand: 1.5,
  labelMinHeight: 8,
  labelMaxChars: 22,
});

/**
 * Phone layout. Fewer nodes per layer is what buys legibility: the same
 * vertical space split six ways instead of twelve roughly doubles each band, so
 * labels clear the visibility threshold instead of being dropped. Bands and
 * node rectangles are widened so a tap lands on something, and the remaining
 * thin bands are reachable by pinch-zoom or through the node picker.
 */
const PHONE = Object.freeze({
  isNarrow: true,
  maxNodesPerLayer: 6,
  columnWidth: 132,
  minViewWidth: 360,
  viewHeight: 520,
  padX: 60,
  padY: 16,
  nodeWidth: 14,
  nodeGap: 8,
  minBand: 3,
  labelMinHeight: 10,
  labelMaxChars: 12,
});

/**
 * Pick the layout constants for a viewport width.
 *
 * Throws on a width that is not a finite positive number — guessing a layout
 * from a missing viewport would silently ship the desktop canvas to a phone,
 * which is the very regression this module exists to prevent (Issue #3234).
 *
 * @param {number} viewportWidth — viewport width in CSS pixels.
 * @returns {SankeyLayout}
 */
export function sankeyLayoutForWidth(viewportWidth) {
  const width = Number(viewportWidth);
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(
      `sankeyLayoutForWidth requires a positive viewport width, got ${viewportWidth}`,
    );
  }
  return width <= PHONE_MAX_WIDTH ? PHONE : DESKTOP;
}

/**
 * SVG view width for a diagram of `columnCount` layers under `layout`.
 *
 * @param {SankeyLayout} layout
 * @param {number} columnCount
 * @returns {number}
 */
export function sankeyViewWidth(layout, columnCount) {
  const columns = Math.max(0, Math.floor(Number(columnCount) || 0));
  return Math.max(layout.minViewWidth, columns * layout.columnWidth);
}
