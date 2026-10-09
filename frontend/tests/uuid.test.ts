import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from '../src/lib/uuid.ts';

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('安全上下文生成有效的 UUID v4', () => {
  assert.match(randomUUID(), uuidV4);
});

test('HTTP 缺少原生 randomUUID 时仍生成有效且不同的记录 ID', () => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
  try {
    const ids = Array.from({ length: 1000 }, () => randomUUID());
    for (const id of ids) assert.match(id, uuidV4);
    assert.equal(new Set(ids).size, ids.length);
  } finally {
    if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor);
    else Reflect.deleteProperty(crypto, 'randomUUID');
  }
});
