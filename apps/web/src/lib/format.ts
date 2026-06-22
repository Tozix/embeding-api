export const nf = new Intl.NumberFormat('ru-RU');

export function num(n: number | null | undefined): string {
  return nf.format(n ?? 0);
}

export function ms(n: number | null | undefined): string {
  const v = n ?? 0;
  return v >= 1000 ? `${(v / 1000).toFixed(1)} с` : `${Math.round(v)} мс`;
}

export function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s} с назад`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(iso).toLocaleDateString('ru-RU');
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
