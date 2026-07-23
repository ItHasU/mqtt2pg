export interface BackoffOptions {
    /** Delay before the first retry, in milliseconds. */
    minDelayMs: number;
    /** Upper bound for the delay, in milliseconds. */
    maxDelayMs: number;
    /** Multiplier applied to the delay after each attempt (e.g. 2 = double). */
    factor: number;
}

/**
 * Exponential backoff delay for a given 1-based attempt number, capped at
 * `maxDelayMs`. Pure function, so it is easy to unit-test.
 *
 * attempt 1 -> minDelayMs, attempt 2 -> minDelayMs*factor, ... (clamped).
 */
export function backoffDelay(attempt: number, opts: BackoffOptions): number {
    const raw = opts.minDelayMs * opts.factor ** Math.max(0, attempt - 1);
    return Math.min(Math.round(raw), opts.maxDelayMs);
}

export interface RetryOptions extends BackoffOptions {
    /** Maximum number of attempts. Use `Infinity` to retry until it succeeds. */
    retries: number;
    /** Called after each failed attempt that will be retried. */
    onAttemptError?: (error: unknown, attempt: number, delayMs: number) => void;
    /** Injectable sleep, for tests. Defaults to a real timer. */
    sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying with exponential backoff when it rejects. Rethrows the
 * last error once `retries` attempts have been exhausted. When `retries` is
 * `Infinity`, it keeps retrying forever (used to wait for a dependency such as
 * the database to come back).
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
    const sleep = opts.sleep ?? realSleep;
    let attempt = 0;
    for (;;) {
        attempt += 1;
        try {
            return await fn();
        } catch (error) {
            if (attempt >= opts.retries) {
                throw error;
            }
            const delayMs = backoffDelay(attempt, opts);
            opts.onAttemptError?.(error, attempt, delayMs);
            await sleep(delayMs);
        }
    }
}
