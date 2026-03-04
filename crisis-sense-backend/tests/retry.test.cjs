const test = require("node:test");
const assert = require("node:assert/strict");
const { retryWithExponentialBackoff } = require("../dist/utils/retry");

test("retryWithExponentialBackoff retries then succeeds", async () => {
  let attempts = 0;

  const result = await retryWithExponentialBackoff(
    async () => {
      attempts += 1;

      if (attempts < 3) {
        const error = new Error("temporary outage");
        error.retryable = true;
        throw error;
      }

      return "ok";
    },
    {
      maxAttempts: 4,
      initialDelayMs: 1,
      maxDelayMs: 2,
      jitterRatio: 0,
    },
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("retryWithExponentialBackoff stops on non-retryable error", async () => {
  let attempts = 0;

  await assert.rejects(
    retryWithExponentialBackoff(
      async () => {
        attempts += 1;
        throw new Error("validation error");
      },
      {
        maxAttempts: 4,
        initialDelayMs: 1,
        maxDelayMs: 2,
        jitterRatio: 0,
      },
    ),
    /validation error/,
  );

  assert.equal(attempts, 1);
});
