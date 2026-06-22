import { expect, test } from 'bun:test';
import { parseDurationMs, parseDurationSec } from '../../src/common/crypto/ms';

test('parseDurationMs: единицы', () => {
  expect(parseDurationMs('500ms')).toBe(500);
  expect(parseDurationMs('15m')).toBe(15 * 60_000);
  expect(parseDurationMs('1h')).toBe(3_600_000);
  expect(parseDurationMs('30d')).toBe(30 * 86_400_000);
  expect(parseDurationMs(' 2h ')).toBe(2 * 3_600_000); // trim
});

test('parseDurationSec', () => {
  expect(parseDurationSec('15m')).toBe(900);
  expect(parseDurationSec('1h')).toBe(3600);
});

test('parseDurationMs: некорректный формат бросает', () => {
  expect(() => parseDurationMs('1h30m')).toThrow();
  expect(() => parseDurationMs('abc')).toThrow();
  expect(() => parseDurationMs('10')).toThrow();
});
