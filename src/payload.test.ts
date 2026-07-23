import test from 'node:test';
import assert from 'node:assert/strict';
import { toJsonPayload } from './payload.js';

test('keeps a valid JSON object unchanged', () => {
    const raw = '{"temp":21.5,"unit":"C"}';
    const result = toJsonPayload(raw);
    assert.equal(result, raw);
    assert.deepEqual(JSON.parse(result), { temp: 21.5, unit: 'C' });
});

test('keeps valid JSON scalars unchanged', () => {
    assert.equal(toJsonPayload('42'), '42');
    assert.equal(toJsonPayload('true'), 'true');
    assert.equal(toJsonPayload('null'), 'null');
    assert.equal(toJsonPayload('"already a json string"'), '"already a json string"');
});

test('wraps plain text as a JSON string', () => {
    const result = toJsonPayload('hello world');
    assert.equal(result, '"hello world"');
    assert.equal(JSON.parse(result), 'hello world');
});

test('escapes double quotes so output stays valid JSON', () => {
    const raw = 'he said "hi"';
    const result = toJsonPayload(raw);
    // The old `"${message}"` approach produced `"he said "hi""` (invalid JSON).
    assert.equal(JSON.parse(result), raw);
});

test('escapes newlines and control characters', () => {
    const raw = 'line1\nline2\ttabbed';
    const result = toJsonPayload(raw);
    assert.equal(JSON.parse(result), raw);
});

test('empty string is stored as an empty JSON string', () => {
    const result = toJsonPayload('');
    assert.equal(result, '""');
    assert.equal(JSON.parse(result), '');
});
