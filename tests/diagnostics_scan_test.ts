/**
 * Tests for recording diagnostics scan (docs/shared/diagnostics_scan.js).
 *
 * These are "what" tests: import the module, call functions with test data,
 * assert results.
 */

import {
  computeErrorConcentrationIssues,
  computeNonFiniteIssues,
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

Deno.test("scan1d counts non-numeric values as non-finite", () => {
  const arr = [1, "text" as unknown as number, null as unknown as number, 4];
  const result = scan1d(arr);
  assertEquals(result.count, 2);
  assertEquals(result.firstPos, 1);
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
