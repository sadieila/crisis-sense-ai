export type RetryOptions = {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitterRatio?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
};

type RetryableErrorShape = {
  code?: string;
  status?: number;
  retryable?: boolean;
};

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasRetryableStatus(error: RetryableErrorShape): boolean {
  if (typeof error.status !== "number") {
    return false;
  }

  return error.status === 429 || (error.status >= 500 && error.status <= 599);
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as RetryableErrorShape;

  if (candidate.retryable === true) {
    return true;
  }

  if (hasRetryableStatus(candidate)) {
    return true;
  }

  if (typeof candidate.code === "string" && RETRYABLE_NETWORK_CODES.has(candidate.code)) {
    return true;
  }

  return false;
}

export async function retryWithExponentialBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  const initialDelayMs = options.initialDelayMs ?? 400;
  const maxDelayMs = options.maxDelayMs ?? 6000;
  const backoffMultiplier = options.backoffMultiplier ?? 2;
  const jitterRatio = options.jitterRatio ?? 0.25;
  const shouldRetry = options.shouldRetry ?? ((error: unknown) => isRetryableError(error));

  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const finalAttempt = attempt >= maxAttempts;

      if (finalAttempt || !shouldRetry(error, attempt)) {
        throw error;
      }

      const jitter = delayMs * jitterRatio * Math.random();
      const waitMs = Math.min(maxDelayMs, Math.round(delayMs + jitter));

      options.onRetry?.(error, attempt, waitMs);
      await sleep(waitMs);

      delayMs = Math.min(maxDelayMs, Math.round(delayMs * backoffMultiplier));
    }
  }

  throw new Error("Retry loop exited unexpectedly");
}