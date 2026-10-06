'use strict';
const test = require('node:test');
const assert = require('node:assert');
const picker = require('../webview/effort-picker');
const { stepLevel } = picker;
// Claude's session.setModel wants the whole model entry (it reads .value), never a bare string.
const nextModel = (...a) => picker.nextModel(...a)?.value ?? null;

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

test('stepLevel moves one level and stops at the ends', () => {
  assert.strictEqual(stepLevel(LEVELS, 'medium', 1), 'high');
  assert.strictEqual(stepLevel(LEVELS, 'medium', -1), 'low');
  assert.strictEqual(stepLevel(LEVELS, 'max', 1), null);
  assert.strictEqual(stepLevel(LEVELS, 'low', -1), null);
});

test('stepLevel treats Auto (undefined) as medium', () => {
  assert.strictEqual(stepLevel(LEVELS, undefined, 1), 'high');
  assert.strictEqual(stepLevel(['low', 'high'], undefined, 1), 'high');
});

const MODELS = [
  { value: 'default', resolvedModel: 'claude-opus-5-5' },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5' },
  { value: 'opus', resolvedModel: 'claude-opus-5-5' },
  { value: 'opus[1m]', resolvedModel: 'claude-opus-5-5[1m]' },
  { value: 'fable', resolvedModel: 'claude-fable-5-1' },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5' },
];

test('nextModel steps sonnet < opus < fable and stops at the ends', () => {
  assert.strictEqual(nextModel(MODELS, MODELS[1], 1), 'opus');
  assert.strictEqual(nextModel(MODELS, MODELS[2], 1), 'fable');
  assert.strictEqual(nextModel(MODELS, MODELS[2], -1), 'sonnet');
  assert.strictEqual(nextModel(MODELS, MODELS[4], 1), null);
  assert.strictEqual(nextModel(MODELS, MODELS[1], -1), null);
});

test('nextModel resolves Default and 1M variants by family', () => {
  assert.strictEqual(nextModel(MODELS, MODELS[0], 1), 'fable');
  assert.strictEqual(nextModel(MODELS, MODELS[3], -1), 'sonnet');
});

test('nextModel from Haiku joins the cycle at the low end, skips missing families', () => {
  assert.strictEqual(nextModel(MODELS, MODELS[5], 1), 'sonnet');
  assert.strictEqual(nextModel(MODELS, MODELS[5], -1), null);
  const noFable = MODELS.filter((m) => m.value !== 'fable');
  assert.strictEqual(nextModel(noFable, noFable[2], 1), null);
});

test('nextModel picks a full-ID entry when no alias exists', () => {
  const ids = [{ value: 'claude-sonnet-5-5' }, { value: 'claude-opus-5-5' }];
  assert.strictEqual(nextModel(ids, ids[0], 1), 'claude-opus-5-5');
});

test('nextModel returns the model entry itself, the shape session.setModel needs', () => {
  assert.strictEqual(picker.nextModel(MODELS, MODELS[1], 1), MODELS[2]);
  assert.strictEqual(picker.nextModel(MODELS, MODELS[4], 1), null);
});
