import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadQueue } from '../src/lib/photo-upload.ts';

test('photo queue bounds concurrent work and releases slots after failure', async () => {
  const run = uploadQueue(2);
  let active = 0;
  let peak = 0;
  const started: number[] = [];
  const release: (() => void)[] = [];
  const jobs = Array.from({ length: 5 }, (_, index) =>
    run(async () => {
      active++;
      peak = Math.max(peak, active);
      started.push(index);
      await new Promise<void>((resolve) => release.push(resolve));
      active--;
      if (index === 1) throw new Error('network failed');
      return index;
    }),
  );
  const settled = Promise.allSettled(jobs);
  assert.deepEqual(started, [0, 1]);
  for (let i = 0; i < 5; i++) {
    release.shift()!();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(active <= 2);
  }
  const results = await settled;
  assert.equal(peak, 2);
  assert.deepEqual(started, [0, 1, 2, 3, 4]);
  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled'],
  );
});
