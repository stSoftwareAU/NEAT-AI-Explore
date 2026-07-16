/**
 * Tests for recording diagnostics scan (docs/shared/diagnostics_scan.js).
 *
 * These are "what" tests: import the module, call functions with test data,
 * assert results.
 */

import {
  computeErrorConcentrationIssues,
  computeNonFiniteIssues,
  computeNotRecordedIssues,
  scan1d,
  scan2d,
} from "../docs/shared/diagnostics_scan.js";
import { assert, assertEquals } from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// scan1d
// ---------------------------------------------------------------------------

Deno.test("scan1d returns zero count for all-finite array", () => {
  const result = scan1d([1, 2, 3, 4, 5]);
  assertEquals(result.count, 0);
  assertEquals(result.firstPos, null);
});

Deno.test("scan1d counts NaN values", () => {
  const result = scan1d([1, NaN, 3, NaN, 5]);
  assertEquals(result.count, 2);
  assertEquals(result.firstPos, 1);
});

Deno.test("scan1d counts Infinity values", () => {
  const result = scan1d([Infinity, 2, -Infinity]);
  assertEquals(result.count, 2);
  assertEquals(result.firstPos, 0);
});

// Issue #507 (business-logic change, documented): `null`/`undefined` mean
// "value not recorded", NOT a non-finite number — JSON cannot carry
// NaN/Infinity, so a non-finite always serialises to `null`. This test
// previously asserted `null` counted as non-finite (count 2); it now asserts
// the corrected split: unexpected junk (`"text"`) is non-finite, `null` is
// absent.
Deno.test("scan1d separates non-numeric junk from absent (null) entries", () => {
  const arr = [1, "text" as unknown as number, null as unknown as number, 4];
  const result = scan1d(arr);
  assertEquals(result.count, 1); // "text" — genuinely non-finite / junk
  assertEquals(result.firstPos, 1);
  assertEquals(result.absentCount, 1); // null — not recorded
  assertEquals(result.firstAbsentPos, 2);
});

Deno.test("scan1d counts null/undefined as absent, not non-finite", () => {
  const arr = [1, null as unknown as number, undefined as unknown as number, 4];
  const result = scan1d(arr);
  assertEquals(result.count, 0);
  assertEquals(result.firstPos, null);
  assertEquals(result.absentCount, 2);
  assertEquals(result.firstAbsentPos, 1);
});

Deno.test("scan1d keeps NaN/Infinity as non-finite (not absent)", () => {
  const result = scan1d([1, NaN, Infinity, null as unknown as number]);
  assertEquals(result.count, 2);
  assertEquals(result.firstPos, 1);
  assertEquals(result.absentCount, 1);
  assertEquals(result.firstAbsentPos, 3);
});

Deno.test("scan1d returns zero count for empty array", () => {
  const result = scan1d([]);
  assertEquals(result.count, 0);
  assertEquals(result.firstPos, null);
});

Deno.test("scan1d returns zero count for non-array input", () => {
  const result = scan1d(null as unknown as number[]);
  assertEquals(result.count, 0);
  assertEquals(result.firstPos, null);
});

// ---------------------------------------------------------------------------
// scan2d
// ---------------------------------------------------------------------------

Deno.test("scan2d returns zero count for all-finite 2D array", () => {
  const result = scan2d([[1, 2], [3, 4]]);
  assertEquals(result.count, 0);
  assertEquals(result.firstPos, null);
});

Deno.test("scan2d counts NaN values across rows", () => {
  const result = scan2d([[1, NaN], [NaN, NaN], [5, 6]]);
  assertEquals(result.count, 3);
  assertEquals(result.firstPos, 0); // first NaN is in row 0
});

Deno.test("scan2d skips non-array rows", () => {
  const arr = [[1, 2], null as unknown as number[], [NaN]];
  const result = scan2d(arr);
  assertEquals(result.count, 1);
  assertEquals(result.firstPos, 2);
});

Deno.test("scan2d returns zero count for non-array input", () => {
  const result = scan2d(null as unknown as number[][]);
  assertEquals(result.count, 0);
  assertEquals(result.firstPos, null);
});

Deno.test("scan2d returns zero count for empty 2D array", () => {
  const result = scan2d([]);
  assertEquals(result.count, 0);
  assertEquals(result.firstPos, null);
});

Deno.test("scan2d counts null cells as absent, not non-finite", () => {
  const arr = [[1, null], [null, 2], [3, 4]] as unknown as number[][];
  const result = scan2d(arr);
  assertEquals(result.count, 0);
  assertEquals(result.firstPos, null);
  assertEquals(result.absentCount, 2);
  assertEquals(result.firstAbsentPos, 0); // first absent is in row 0
});

Deno.test("scan2d separates absent cells from genuine NaN cells", () => {
  const arr = [[1, null], [NaN, 2]] as unknown as number[][];
  const result = scan2d(arr);
  assertEquals(result.count, 1); // NaN
  assertEquals(result.firstPos, 1);
  assertEquals(result.absentCount, 1); // null
  assertEquals(result.firstAbsentPos, 0);
});

// ---------------------------------------------------------------------------
// computeNonFiniteIssues
// ---------------------------------------------------------------------------

Deno.test("computeNonFiniteIssues returns empty map for clean data", () => {
  const recording = {
    neurons: {
      "output-0": {
        activation: [1, 2, 3],
        value: [0.5, 0.6, 0.7],
        errors: [[0.1, 0.2], [0.3, 0.4]],
      },
    },
  };
  const result = computeNonFiniteIssues({ recording });
  assertEquals(result.size, 0);
});

Deno.test("computeNonFiniteIssues detects NaN in activation", () => {
  const recording = {
    neurons: {
      "hidden-0": {
        activation: [1, NaN, 3],
        value: [0.5, 0.6, 0.7],
        errors: [],
      },
    },
  };
  const result = computeNonFiniteIssues({ recording });
  assertEquals(result.size, 1);
  const issue = result.get("hidden-0")!;
  assertEquals(issue.activation.count, 1);
  assertEquals(issue.activation.firstObsIndex, 1);
  assertEquals(issue.value.count, 0);
});

Deno.test("computeNonFiniteIssues detects Infinity in value", () => {
  const recording = {
    neurons: {
      "output-0": {
        activation: [1, 2],
        value: [Infinity, 0.6],
        errors: [],
      },
    },
  };
  const result = computeNonFiniteIssues({ recording });
  const issue = result.get("output-0")!;
  assertEquals(issue.value.count, 1);
  assertEquals(issue.value.firstObsIndex, 0);
});

Deno.test("computeNonFiniteIssues detects NaN in 2D errors", () => {
  const recording = {
    neurons: {
      "hidden-1": {
        activation: [1, 2],
        value: [0.5, 0.6],
        errors: [[0.1, 0.2], [NaN, 0.4], [0.5, NaN]],
      },
    },
  };
  const result = computeNonFiniteIssues({ recording });
  const issue = result.get("hidden-1")!;
  assertEquals(issue.errors.count, 2);
  assertEquals(issue.errors.firstObsIndex, 1);
});

Deno.test("computeNonFiniteIssues uses obsIndices for mapping", () => {
  const recording = {
    obsIndices: [100, 200, 300],
    neurons: {
      "hidden-0": {
        activation: [1, NaN, 3],
        value: [0.5, 0.6, 0.7],
        errors: [],
      },
    },
  };
  const result = computeNonFiniteIssues({ recording });
  const issue = result.get("hidden-0")!;
  // Position 1 maps to obsIndices[1] = 200
  assertEquals(issue.activation.firstObsIndex, 200);
});

Deno.test("computeNonFiniteIssues returns empty map for null recording", () => {
  const result = computeNonFiniteIssues({ recording: null });
  assertEquals(result.size, 0);
});

Deno.test("computeNonFiniteIssues skips non-object neuron entries", () => {
  const recording = {
    neurons: {
      "bad-entry": null,
      "also-bad": "string",
    },
  };
  const result = computeNonFiniteIssues({ recording });
  assertEquals(result.size, 0);
});

Deno.test("computeNonFiniteIssues computes correct total", () => {
  const recording = {
    neurons: {
      "n-0": {
        activation: [NaN, NaN],
        value: [Infinity],
        errors: [[NaN]],
      },
    },
  };
  const result = computeNonFiniteIssues({ recording });
  const issue = result.get("n-0")!;
  assertEquals(issue.total, 4);
  assertEquals(issue.activation.count, 2);
  assertEquals(issue.value.count, 1);
  assertEquals(issue.errors.count, 1);
});

// Issue #507 regression: absent (null) value entries must NOT be reported as
// non-finite. Before the fix, a series of JSON nulls produced a non-zero
// `total` and flagged the neuron as "NaN/Infinity". Now they contribute to
// `absentTotal` only, and `total` (genuine non-finite) stays zero.
Deno.test("computeNonFiniteIssues reports null value entries as absent, not non-finite", () => {
  const recording = {
    neurons: {
      "hidden-0": {
        activation: [0.1, 0.2, 0.3],
        value: [null, null, 0.7],
        errors: [[0.1], [0.2], [0.3]],
      },
    },
  };
  const result = computeNonFiniteIssues({ recording });
  assertEquals(result.size, 1);
  const issue = result.get("hidden-0")!;
  assertEquals(issue.total, 0); // no genuine non-finite numbers
  assertEquals(issue.absentTotal, 2); // two not-recorded values
  assertEquals(issue.value.count, 0);
  assertEquals(issue.value.absentCount, 2);
  assertEquals(issue.value.firstAbsentObsIndex, 0);
  assertEquals(issue.value.length, 3);
});

Deno.test("computeNonFiniteIssues maps first absent through obsIndices", () => {
  const recording = {
    obsIndices: [10, 20, 30],
    neurons: {
      "hidden-1": {
        activation: [1, 2, 3],
        value: [0.5, null, null],
        errors: [],
      },
    },
  };
  const issue = computeNonFiniteIssues({ recording }).get("hidden-1")!;
  assertEquals(issue.value.absentCount, 2);
  assertEquals(issue.value.firstAbsentObsIndex, 20); // obsIndices[1]
});

Deno.test("computeNonFiniteIssues separates non-finite total from absent total", () => {
  const recording = {
    neurons: {
      "n-0": {
        activation: [NaN, 2, 3],
        value: [null, null, 0.7],
        errors: [[null], [0.2]],
      },
    },
  };
  const issue = computeNonFiniteIssues({ recording }).get("n-0")!;
  assertEquals(issue.total, 1); // one NaN activation
  assertEquals(issue.absentTotal, 3); // two null values + one null error cell
  assertEquals(issue.activation.count, 1);
  assertEquals(issue.value.absentCount, 2);
  assertEquals(issue.errors.absentCount, 1);
});

Deno.test("computeNonFiniteIssues keeps skipping entirely clean neurons", () => {
  const recording = {
    neurons: {
      "clean": {
        activation: [1, 2, 3],
        value: [0.5, 0.6, 0.7],
        errors: [[0.1], [0.2], [0.3]],
      },
    },
  };
  const result = computeNonFiniteIssues({ recording });
  assertEquals(result.size, 0);
});

// ---------------------------------------------------------------------------
// Absent (not-recorded) vs genuine non-finite classification (issue #507)
// ---------------------------------------------------------------------------

Deno.test("scan1d classifies null/undefined as absent, not non-finite", () => {
  const arr = [1, null as unknown as number, undefined as unknown as number, 4];
  const result = scan1d(arr);
  assertEquals(result.count, 2); // total anomalies (backward compat)
  assertEquals(result.absentCount, 2);
  assertEquals(result.nonFiniteCount, 0);
  assertEquals(result.firstAbsentPos, 1);
  assertEquals(result.firstNonFinitePos, null);
});

Deno.test("scan1d separates absent nulls from genuine non-finite", () => {
  const arr = [1, null as unknown as number, NaN, Infinity, 5];
  const result = scan1d(arr);
  assertEquals(result.count, 3);
  assertEquals(result.absentCount, 1);
  assertEquals(result.nonFiniteCount, 2);
  assertEquals(result.firstAbsentPos, 1);
  assertEquals(result.firstNonFinitePos, 2);
});

Deno.test("scan2d separates absent nulls from genuine non-finite", () => {
  const arr = [
    [1, null as unknown as number],
    [NaN, 4],
    [null as unknown as number, 6],
  ];
  const result = scan2d(arr);
  assertEquals(result.absentCount, 2);
  assertEquals(result.nonFiniteCount, 1);
  assertEquals(result.firstAbsentPos, 0);
  assertEquals(result.firstNonFinitePos, 1);
});

Deno.test("computeNonFiniteIssues ignores absent (null) value entries", () => {
  // All null: the error walk did not traverse — must NOT be flagged as
  // NaN/Infinity (issue #507).
  const recording = {
    neurons: {
      "hidden-0": {
        activation: [1, 2, 3],
        value: [null, null, null],
        errors: [[null], [null]],
      },
    },
  };
  const result = computeNonFiniteIssues({ recording });
  assertEquals(result.size, 0);
});

Deno.test("computeNonFiniteIssues still flags genuine NaN alongside nulls", () => {
  const recording = {
    neurons: {
      "hidden-0": {
        activation: [1, NaN, 3],
        value: [null, null, 0.5],
        errors: [],
      },
    },
  };
  const result = computeNonFiniteIssues({ recording });
  assertEquals(result.size, 1);
  const issue = result.get("hidden-0")!;
  assertEquals(issue.total, 1); // only the NaN, not the two nulls
  assertEquals(issue.activation.count, 1);
  assertEquals(issue.value.count, 0);
});

// ---------------------------------------------------------------------------
// computeNotRecordedIssues (issue #507)
// ---------------------------------------------------------------------------

Deno.test("computeNotRecordedIssues counts absent value entries with denominator", () => {
  const recording = {
    neurons: {
      "hidden-0": {
        activation: [1, 2, 3, 4],
        value: [null, 0.5, null, null],
        errors: [],
      },
    },
  };
  const result = computeNotRecordedIssues({ recording });
  const issue = result.get("hidden-0")!;
  assertEquals(issue.value.count, 3);
  assertEquals(issue.value.length, 4); // k/N framing
  assertEquals(issue.value.firstObsIndex, 0);
  assertEquals(issue.activation.count, 0);
  assertEquals(issue.total, 3);
});

Deno.test("computeNotRecordedIssues ignores genuine non-finite values", () => {
  const recording = {
    neurons: {
      "hidden-0": {
        activation: [NaN, Infinity],
        value: [0.5, 0.6],
        errors: [],
      },
    },
  };
  // NaN/Infinity are not "absent" — nothing to report here.
  const result = computeNotRecordedIssues({ recording });
  assertEquals(result.size, 0);
});

Deno.test("computeNotRecordedIssues maps first absent index via obsIndices", () => {
  const recording = {
    obsIndices: [10, 20, 30],
    neurons: {
      "hidden-0": {
        activation: [1, 2, 3],
        value: [0.5, null, null],
        errors: [],
      },
    },
  };
  const result = computeNotRecordedIssues({ recording });
  const issue = result.get("hidden-0")!;
  assertEquals(issue.value.firstObsIndex, 20); // position 1 → obsIndices[1]
});

Deno.test("computeNotRecordedIssues counts absent 2D error rows", () => {
  const recording = {
    neurons: {
      "hidden-0": {
        activation: [1, 2],
        value: [0.5, 0.6],
        errors: [[null, null], [0.1, 0.2], [null]],
      },
    },
  };
  const result = computeNotRecordedIssues({ recording });
  const issue = result.get("hidden-0")!;
  assertEquals(issue.errors.count, 3);
  assertEquals(issue.errors.rows, 3);
  assertEquals(issue.errors.firstObsIndex, 0);
});

Deno.test("computeNotRecordedIssues returns empty map for clean data", () => {
  const recording = {
    neurons: {
      "output-0": {
        activation: [1, 2, 3],
        value: [0.5, 0.6, 0.7],
        errors: [[0.1], [0.2]],
      },
    },
  };
  const result = computeNotRecordedIssues({ recording });
  assertEquals(result.size, 0);
});

Deno.test("computeNotRecordedIssues returns empty map for null recording", () => {
  const result = computeNotRecordedIssues({ recording: null });
  assertEquals(result.size, 0);
});

// ---------------------------------------------------------------------------
// computeErrorConcentrationIssues
// ---------------------------------------------------------------------------

Deno.test("computeErrorConcentrationIssues returns empty map for no errors", () => {
  const recording = {
    neurons: {
      "output-0": { errors: [] },
    },
  };
  const result = computeErrorConcentrationIssues({ recording });
  assertEquals(result.size, 0);
});

Deno.test("computeErrorConcentrationIssues computes concentration for single neuron", () => {
  // One row with large errors, rest with small errors → concentrated
  const errors = [];
  for (let i = 0; i < 10; i++) {
    errors.push(i === 0 ? [10, 10, 10] : [0.01, 0.01, 0.01]);
  }
  const recording = {
    neurons: {
      "output-0": { errors },
    },
  };
  const result = computeErrorConcentrationIssues({ recording });
  if (result.size > 0) {
    const issue = result.get("output-0")!;
    assert(issue.total > 0, "total should be positive");
    assert(issue.topK.length > 0, "should have topK entries");
    assert(issue.topKShare > 0, "topK share should be positive");
    // The first row should dominate
    assert(
      issue.topK[0].shareOfTotal > 0.5,
      "concentrated error should dominate",
    );
  }
});

Deno.test("computeErrorConcentrationIssues uses obsIndices mapping", () => {
  const errors = [[10, 10], [0.01, 0.01]];
  const recording = {
    obsIndices: [42, 99],
    neurons: {
      "n-0": { errors },
    },
  };
  const result = computeErrorConcentrationIssues({ recording });
  if (result.size > 0) {
    const issue = result.get("n-0")!;
    // The obsIndex in topK should be mapped through obsIndices
    for (const entry of issue.topK) {
      assert(
        entry.obsIndex === 42 || entry.obsIndex === 99,
        `obsIndex ${entry.obsIndex} should be mapped`,
      );
    }
  }
});

Deno.test("computeErrorConcentrationIssues handles empty rows", () => {
  const errors = [[], [1, 2], []];
  const recording = {
    neurons: {
      "n-0": { errors },
    },
  };
  // Should not throw
  const result = computeErrorConcentrationIssues({ recording });
  assert(result instanceof Map);
});

Deno.test("computeErrorConcentrationIssues skips non-object neuron entries", () => {
  const recording = {
    neurons: {
      "bad": null,
    },
  };
  const result = computeErrorConcentrationIssues({ recording });
  assertEquals(result.size, 0);
});

Deno.test("computeErrorConcentrationIssues returns empty for null recording", () => {
  const result = computeErrorConcentrationIssues({ recording: null });
  assertEquals(result.size, 0);
});

Deno.test("computeErrorConcentrationIssues skips non-finite error values", () => {
  const errors = [[NaN, Infinity], [1, 2]];
  const recording = {
    neurons: {
      "n-0": { errors },
    },
  };
  // Should not throw; non-finite values are skipped in MSE computation
  const result = computeErrorConcentrationIssues({ recording });
  assert(result instanceof Map);
});
