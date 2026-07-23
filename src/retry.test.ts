import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, retryWithBackoff } from './retry.ts';

const opts = { minDelayMs: 100, maxDelayMs: 2000, factor: 2 };

test('backoffDelay grows exponentially and is capped', () => {
    assert.equal(backoffDelay(1, opts), 100);
    assert.equal(backoffDelay(2, opts), 200);
    assert.equal(backoffDelay(3, opts), 400);
    assert.equal(backoffDelay(4, opts), 800);
    assert.equal(backoffDelay(5, opts), 1600);
    assert.equal(backoffDelay(6, opts), 2000); // capped at maxDelayMs
    assert.equal(backoffDelay(100, opts), 2000); // stays capped
});

test('retryWithBackoff returns immediately on first success', async () => {
    let calls = 0;
    const result = await retryWithBackoff(
        async () => {
            calls += 1;
            return 'ok';
        },
        { ...opts, retries: 5, sleep: async () => {} },
    );
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
});

test('retryWithBackoff succeeds after transient failures', async () => {
    let calls = 0;
    const errors: number[] = [];
    const result = await retryWithBackoff(
        async () => {
            calls += 1;
            if (calls < 3) {
                throw new Error(`fail ${calls}`);
            }
            return 'recovered';
        },
        {
            ...opts,
            retries: 5,
            sleep: async () => {},
            onAttemptError: (_error, attempt) => errors.push(attempt),
        },
    );
    assert.equal(result, 'recovered');
    assert.equal(calls, 3);
    assert.deepEqual(errors, [1, 2]); // two failed attempts were reported
});

test('retryWithBackoff rethrows after exhausting retries', async () => {
    let calls = 0;
    await assert.rejects(
        retryWithBackoff(
            async () => {
                calls += 1;
                throw new Error('always fails');
            },
            { ...opts, retries: 3, sleep: async () => {} },
        ),
        /always fails/,
    );
    assert.equal(calls, 3); // exactly `retries` attempts
});

test('retryWithBackoff can retry many times (Infinity) until success', async () => {
    let calls = 0;
    const result = await retryWithBackoff(
        async () => {
            calls += 1;
            if (calls < 20) {
                throw new Error('not yet');
            }
            return calls;
        },
        { ...opts, retries: Infinity, sleep: async () => {} },
    );
    assert.equal(result, 20);
});
