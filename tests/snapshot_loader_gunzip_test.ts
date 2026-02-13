import { assert, assertEquals } from "./test_helpers.ts";

import {
  gunzipToText,
  readSnapshotFile,
} from "../docs/shared/snapshot_loader.js";

// --- gunzipToText ---

Deno.test("gunzipToText decompresses gzipped data", async () => {
  const original = '{"hello":"world"}';
  const encoded = new TextEncoder().encode(original);
  // Compress using the CompressionStream API (available in Deno).
  const stream = new Blob([encoded]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const result = await gunzipToText(compressed);
  assertEquals(result, original);
});

Deno.test("gunzipToText rejects invalid data", async () => {
  const garbage = new Uint8Array([0, 1, 2, 3, 4, 5]);
  try {
    await gunzipToText(garbage);
    assert(false, "Should have thrown");
  } catch (e) {
    assert(e instanceof Error, "Should throw an Error");
  }
});

// --- readSnapshotFile ---

Deno.test("readSnapshotFile parses plain JSON file", async () => {
  const json = '{"meta":{"version":"1.0"}}';
  const file = new File([json], "snapshot.json", {
    type: "application/json",
  });
  const result = await readSnapshotFile(file);
  assertEquals(result.meta.version, "1.0");
});

Deno.test("readSnapshotFile parses gzipped JSON file", async () => {
  const json = '{"meta":{"version":"2.0"}}';
  const encoded = new TextEncoder().encode(json);
  const stream = new Blob([encoded]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const file = new File([compressed], "snapshot.json.gz", {
    type: "application/gzip",
  });
  const result = await readSnapshotFile(file);
  assertEquals(result.meta.version, "2.0");
});
