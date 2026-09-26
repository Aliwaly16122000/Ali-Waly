import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, histogram, letterGrade } from '../src/lib/stats.js';

test('describe computes mean, median, spread and pass rate', () => {
  const d = describe([2, 4, 6, 8, null], 10);
  assert.equal(d.count, 4);
  assert.equal(d.mean, 5);
  assert.equal(d.median, 5);
  assert.equal(d.min, 2);
  assert.equal(d.max, 8);
  assert.equal(d.pass_rate, 50);
  assert.equal(describe([], 10).mean, null);
});

test('histogram buckets percentages into ten bins, 100% in the last one', () => {
  const h = histogram([0, 5, 10, 100], 10);
  assert.equal(h[0].count, 1);
  assert.equal(h[5].count, 1);
  assert.equal(h[9].count, 2);
});

test('letter grades follow the Egyptian scale', () => {
  assert.equal(letterGrade(90), 'امتياز');
  assert.equal(letterGrade(80), 'جيد جداً');
  assert.equal(letterGrade(70), 'جيد');
  assert.equal(letterGrade(55), 'مقبول');
  assert.equal(letterGrade(40), 'ضعيف');
  assert.equal(letterGrade(null), null);
});
