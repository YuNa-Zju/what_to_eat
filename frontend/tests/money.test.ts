import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCost, costInput, formatCost } from '../src/lib/money.ts';

test('meal amounts distinguish unspecified and free, preserving decimal cents', () => {
  assert.equal(parseCost('  '), null);
  assert.equal(parseCost('0'), 0);
  assert.equal(parseCost('0.29'), 29);
  assert.equal(parseCost('12.3'), 1230);
  assert.equal(parseCost('１２．３０'), 1230);
  assert.equal(parseCost('12.'), 1200);
  assert.equal(parseCost('999999.99'), 99_999_999);
  assert.equal(costInput(null), '');
  assert.equal(costInput(undefined), '');
  assert.equal(formatCost(0), '¥0.00');
  assert.equal(formatCost(1230), '¥12.30');
});

test('meal amounts reject negatives, imprecise values and unsupported formats', () => {
  for (const value of [
    '-1',
    '12.345',
    '1e2',
    '1,000',
    'NaN',
    'Infinity',
    '1000000',
    '999999999999999',
  ])
    assert.throws(() => parseCost(value));
});
