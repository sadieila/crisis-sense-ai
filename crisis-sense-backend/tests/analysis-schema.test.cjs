const test = require("node:test");
const assert = require("node:assert/strict");
const { isAnalysisResult } = require("../dist/types/analysis");

test("isAnalysisResult accepts valid payload", () => {
  const value = {
    summary: "Operations disrupted in two zones.",
    risks: [
      {
        description: "Road closure delays emergency transport",
        severity: "high",
        reason: "Main route is blocked by flood waters",
      },
    ],
    recommendations: [
      {
        action: "Dispatch traffic diversion team immediately",
        confidence: 0.72,
        priority: 1,
      },
    ],
    overall_severity: 7,
  };

  assert.equal(isAnalysisResult(value), true);
});

test("isAnalysisResult rejects invalid confidence range", () => {
  const value = {
    summary: "Test",
    risks: [],
    recommendations: [
      {
        action: "Test action",
        confidence: 1.2,
        priority: 1,
      },
    ],
    overall_severity: 5,
  };

  assert.equal(isAnalysisResult(value), false);
});
