'use client';

type Point = {
  bucket: string;
  requests: number;
  errors: number;
  avgLatencyMs: number;
};

/** Бар-чарт вызовов (ошибки — тёмной долей сверху) + линия латентности поверх. SVG, без либ. */
export function TimeseriesChart({ points }: { points: Point[] }) {
  const W = 760;
  const H = 200;
  const pad = { l: 8, r: 8, t: 12, b: 18 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  if (points.length === 0) {
    return <div className="empty">Нет данных за период</div>;
  }
  const maxReq = Math.max(1, ...points.map((p) => p.requests));
  const maxLat = Math.max(1, ...points.map((p) => p.avgLatencyMs));
  const bw = iw / points.length;
  const barW = Math.max(2, bw * 0.62);

  const linePts = points
    .map((p, i) => {
      const x = pad.l + i * bw + bw / 2;
      const y = pad.t + ih - (p.avgLatencyMs / maxLat) * ih;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          className="grid-line"
          x1={pad.l}
          x2={W - pad.r}
          y1={pad.t + ih * f}
          y2={pad.t + ih * f}
          opacity={0.5}
        />
      ))}
      {points.map((p, i) => {
        const x = pad.l + i * bw + (bw - barW) / 2;
        const h = (p.requests / maxReq) * ih;
        const eh = (p.errors / maxReq) * ih;
        const y = pad.t + ih - h;
        return (
          <g key={i}>
            <rect className="bar" x={x} y={y} width={barW} height={Math.max(0, h - eh)} rx={2} />
            {eh > 0 && (
              <rect className="bar err" x={x} y={y} width={barW} height={eh} rx={2} />
            )}
          </g>
        );
      })}
      <polyline className="line" points={linePts} />
    </svg>
  );
}

/** Мини-спарклайн для метрики. */
export function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <svg className="chart" viewBox="0 0 100 28" />;
  const max = Math.max(1, ...data);
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * 100},${28 - (v / max) * 26 - 1}`)
    .join(' ');
  return (
    <svg className="chart" viewBox="0 0 100 28" preserveAspectRatio="none" height={28}>
      <polyline className="line" points={pts} />
    </svg>
  );
}

/** Горизонтальный «топ» список с долевыми полосками. */
export function TopBars({
  items,
}: {
  items: { key: string; label: string; requests: number }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.requests));
  if (items.length === 0) return <div className="empty">Пока нет вызовов</div>;
  return (
    <div className="stack" style={{ gap: '0.55rem' }}>
      {items.map((it) => (
        <div key={it.key} className="stack" style={{ gap: '0.3rem' }}>
          <div className="row between" style={{ fontSize: '0.84rem' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {it.label}
            </span>
            <span className="mono muted">{it.requests}</span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: 'var(--surface-2)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${(it.requests / max) * 100}%`,
                height: '100%',
                background: 'var(--accent)',
                borderRadius: 3,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** График CPU% (область) и RAM% (линия) за период — как в Grafana. SVG, без либ. */
export function SystemChart({
  points,
}: {
  points: { cpu: number; memUsed: number; memTotal: number }[];
}) {
  const W = 760;
  const H = 180;
  const pad = { l: 8, r: 8, t: 10, b: 12 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  if (points.length < 2) return <div className="empty">Сбор метрик…</div>;
  const n = points.length;
  const xy = (val: number, i: number) => {
    const x = pad.l + (i / (n - 1)) * iw;
    const y = pad.t + ih - (Math.max(0, Math.min(100, val)) / 100) * ih;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const cpuPts = points.map((p, i) => xy(p.cpu, i)).join(' ');
  const memPts = points
    .map((p, i) => xy(p.memTotal ? (p.memUsed / p.memTotal) * 100 : 0, i))
    .join(' ');
  const cpuArea = `${pad.l},${pad.t + ih} ${cpuPts} ${pad.l + iw},${pad.t + ih}`;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          className="grid-line"
          x1={pad.l}
          x2={W - pad.r}
          y1={pad.t + ih * f}
          y2={pad.t + ih * f}
          opacity={0.5}
        />
      ))}
      <polygon points={cpuArea} fill="var(--accent)" opacity={0.12} />
      <polyline points={cpuPts} fill="none" stroke="var(--accent)" strokeWidth={1.6} />
      <polyline points={memPts} fill="none" stroke="var(--live)" strokeWidth={1.6} />
    </svg>
  );
}
