import { expect, test } from 'bun:test';
import { SystemMetricsService } from '../../src/system/system-metrics.service';

test('snapshot: валидная структура даже без сэмплов', () => {
  const svc = new SystemMetricsService();
  const s = svc.snapshot();
  expect(s.cpuCount).toBeGreaterThan(0);
  expect(s.current.memTotal).toBeGreaterThan(0);
  expect(s.current.memUsed).toBeGreaterThanOrEqual(0);
  expect(typeof s.current.cpu).toBe('number');
  expect(Array.isArray(s.history)).toBe(true);
});

test('после onModuleInit история наполняется; cpu в [0,100]', () => {
  const svc = new SystemMetricsService();
  svc.onModuleInit();
  const s = svc.snapshot();
  expect(s.history.length).toBeGreaterThanOrEqual(1);
  expect(s.current.cpu).toBeGreaterThanOrEqual(0);
  expect(s.current.cpu).toBeLessThanOrEqual(100);
  svc.onModuleDestroy();
});
