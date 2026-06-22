'use client';

import { useEffect, useState } from 'react';
import { api, streamSse } from '../lib/api';
import { clockTime, ms, num } from '../lib/format';
import { TimeseriesChart, TopBars } from './charts';
import { Spinner } from './ui';

type Summary = {
  requests: number;
  errors: number;
  avgLatencyMs: number;
  avgQueueWaitMs: number;
  totalTokens: number;
};
type Point = {
  bucket: string;
  requests: number;
  errors: number;
  avgLatencyMs: number;
  totalTokens: number;
};
type TopItem = { key: string; label: string; requests: number; totalTokens: number };
type Counts = { waiting: number; active: number; delayed: number; failed: number };
type Queues = { chat: Counts; embeddings: Counts };
type FeedItem = {
  id: string;
  endpoint: string;
  modelName: string;
  status: number;
  ok: boolean;
  latencyMs: number;
  totalTokens: number;
  createdAt: string;
};

const TOPS = [
  { v: 'model', label: 'Модели' },
  { v: 'user', label: 'Пользователи' },
  { v: 'apiKey', label: 'Ключи' },
] as const;

function Metric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="metric">
      <span className="label">{label}</span>
      <span className={`value${accent ? ' accent' : ''}`}>{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

export function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [series, setSeries] = useState<Point[]>([]);
  const [topBy, setTopBy] = useState<'model' | 'user' | 'apiKey'>('model');
  const [top, setTop] = useState<TopItem[]>([]);
  const [queues, setQueues] = useState<Queues | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [liveOn, setLiveOn] = useState(false);

  const loadAggregates = async () => {
    try {
      const [s, ts] = await Promise.all([
        api<Summary>('/admin/analytics/summary'),
        api<Point[]>('/admin/analytics/timeseries?bucket=hour'),
      ]);
      setSummary(s);
      setSeries(ts);
    } catch {
      /* топбар покажет состояние; молча игнорируем тик */
    }
  };

  useEffect(() => {
    void loadAggregates();
    const t = setInterval(loadAggregates, 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    void api<TopItem[]>(`/admin/analytics/top?by=${topBy}`)
      .then(setTop)
      .catch(() => setTop([]));
  }, [topBy]);

  useEffect(() => {
    const ac = new AbortController();
    streamSse(
      '/admin/analytics/live',
      (data) => {
        const ev = data as { type: string; event?: FeedItem; queues?: Queues };
        setLiveOn(true);
        if (ev.type === 'usage' && ev.event) {
          const e = ev.event;
          setFeed((f) => [e, ...f].slice(0, 40));
          setSummary((s) =>
            s
              ? {
                  ...s,
                  requests: s.requests + 1,
                  errors: s.errors + (e.ok ? 0 : 1),
                  totalTokens: s.totalTokens + (e.totalTokens || 0),
                }
              : s,
          );
        } else if (ev.type === 'queues' && ev.queues) {
          setQueues(ev.queues);
        }
      },
      ac.signal,
    ).catch(() => setLiveOn(false));
    return () => ac.abort();
  }, []);

  const qChat = queues ? queues.chat.active + queues.chat.waiting : 0;
  const qEmbed = queues ? queues.embeddings.active + queues.embeddings.waiting : 0;
  const errRate = summary && summary.requests > 0
    ? `${((summary.errors / summary.requests) * 100).toFixed(1)}%`
    : '0%';

  if (!summary) {
    return (
      <div className="page">
        <Spinner label="Загрузка метрик…" />
      </div>
    );
  }

  return (
    <div className="page stack gap-3">
      <div className="page-head">
        <div>
          <h1>Дашборд нагрузки</h1>
          <p>Вызовы /v1 за 24 часа, очереди и живой поток событий.</p>
        </div>
        <span className="row gap-1 muted" style={{ fontSize: '0.82rem' }}>
          <span className="live-dot" style={{ opacity: liveOn ? 1 : 0.3 }} />
          {liveOn ? 'в реальном времени' : 'подключение…'}
        </span>
      </div>

      <div className="metrics">
        <Metric label="Вызовы (24ч)" value={num(summary.requests)} accent />
        <Metric label="Ошибки" value={num(summary.errors)} sub={`${errRate} от вызовов`} />
        <Metric label="Латентность (avg)" value={ms(summary.avgLatencyMs)} sub={`очередь ${ms(summary.avgQueueWaitMs)}`} />
        <Metric label="Токены (24ч)" value={num(summary.totalTokens)} />
        <Metric
          label="Очередь chat"
          value={String(qChat)}
          sub={queues ? `${queues.chat.active} в работе · ${queues.chat.waiting} ждут` : '—'}
        />
        <Metric
          label="Очередь embeddings"
          value={String(qEmbed)}
          sub={
            queues ? `${queues.embeddings.active} в работе · ${queues.embeddings.waiting} ждут` : '—'
          }
        />
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Вызовы по часам</h2>
          <span className="row gap-2 muted" style={{ fontSize: '0.78rem' }}>
            <span className="row gap-1">
              <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--accent)' }} /> запросы
            </span>
            <span className="row gap-1">
              <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--err)' }} /> ошибки
            </span>
            <span className="row gap-1">
              <span style={{ width: 12, height: 2, background: 'var(--live)' }} /> латентность
            </span>
          </span>
        </div>
        <div className="panel-body">
          <TimeseriesChart points={series} />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.1fr)',
          gap: '1rem',
        }}
      >
        <div className="panel">
          <div className="panel-head">
            <h2>Топ нагрузки</h2>
            <div className="row gap-1">
              {TOPS.map((t) => (
                <button
                  key={t.v}
                  className={`btn btn-sm ${topBy === t.v ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setTopBy(t.v)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-body">
            <TopBars items={top} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Живой поток</h2>
            <span className="muted mono">{feed.length}</span>
          </div>
          <div className="panel-body">
            {feed.length === 0 ? (
              <div className="empty">Ждём вызовов…</div>
            ) : (
              <div className="feed">
                {feed.map((f) => (
                  <div key={f.id} className="feed-row">
                    <span className="faint">{clockTime(f.createdAt)}</span>
                    <span>
                      <span className="muted">{f.endpoint}</span> {f.modelName}
                    </span>
                    <span className="muted">{ms(f.latencyMs)}</span>
                    <span className={`badge ${f.ok ? 'badge-ok' : 'badge-err'}`}>{f.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
