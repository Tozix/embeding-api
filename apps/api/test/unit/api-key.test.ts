import { expect, test } from 'bun:test';
import {
  generateApiKey,
  hashApiKey,
  safeEqualHex,
} from '../../src/common/crypto/api-key';

test('generateApiKey: формат и одноразовость', () => {
  const a = generateApiKey();
  const b = generateApiKey();
  expect(a.raw.startsWith('sk-emb-')).toBe(true);
  expect(a.prefix.startsWith('sk-emb-')).toBe(true);
  expect(a.prefix.length).toBeLessThan(a.raw.length);
  expect(a.raw).not.toBe(b.raw); // высокая энтропия
});

test('hashApiKey: детерминирован и зависит от pepper', () => {
  const h1 = hashApiKey('sk-emb-abc', 'pepper-one-0123456789abcdef');
  const h2 = hashApiKey('sk-emb-abc', 'pepper-one-0123456789abcdef');
  const h3 = hashApiKey('sk-emb-abc', 'pepper-two-0123456789abcdef');
  expect(h1).toBe(h2);
  expect(h1).not.toBe(h3); // pepper меняет хэш
  expect(h1).toMatch(/^[0-9a-f]{64}$/);
});

test('safeEqualHex: равные/неравные/разной длины', () => {
  const h = hashApiKey('x', 'p0123456789abcdef0123456789abcdef');
  expect(safeEqualHex(h, h)).toBe(true);
  expect(safeEqualHex(h, hashApiKey('y', 'p0123456789abcdef0123456789abcdef'))).toBe(
    false,
  );
  expect(safeEqualHex('aa', 'aabb')).toBe(false);
});
