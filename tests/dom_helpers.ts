/**
 * Shared DOM-parsing helpers for markup tests.
 *
 * Several tests need to assert structural / accessibility invariants of the
 * published `docs/index.html`. Parsing into a real document and querying it
 * semantically (by id, class, attribute) keeps those tests pinned to the
 * user-observable contract rather than to raw source text. DOM queries
 * tolerate attribute reordering, class renames, and whitespace changes while
 * still catching genuine regressions (Issue #312).
 */

import { DOMParser } from "@b-fuze/deno-dom";
import type { HTMLDocument } from "@b-fuze/deno-dom";

/** Parses an HTML string into a queryable document. */
export function parseHtml(html: string): HTMLDocument {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) throw new Error("Failed to parse HTML into a document");
  return doc;
}

/** Reads a file and parses it into a queryable document. */
export async function loadDocument(path: URL | string): Promise<HTMLDocument> {
  return parseHtml(await Deno.readTextFile(path));
}

/** Reads and parses the published `docs/index.html`. */
export function loadIndexDocument(): Promise<HTMLDocument> {
  return loadDocument(new URL("../docs/index.html", import.meta.url));
}
