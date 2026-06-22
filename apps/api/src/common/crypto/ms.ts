const RE = /^(\d+)\s*(ms|s|m|h|d)$/i;
const MULT: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Парсит длительность вида "15m" | "1h" | "30d" в миллисекунды. */
export function parseDurationMs(input: string): number {
  const m = RE.exec(input.trim());
  if (!m) {
    throw new Error(
      `Некорректный формат длительности: "${input}" (ожидается напр. 15m, 1h, 30d)`,
    );
  }
  return Number(m[1]!) * MULT[m[2]!.toLowerCase()]!;
}

/** То же, но в секундах (для поля expiresIn / JWT exp). */
export function parseDurationSec(input: string): number {
  return Math.floor(parseDurationMs(input) / 1000);
}
