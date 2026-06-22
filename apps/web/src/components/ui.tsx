'use client';

import { useState, type ReactNode } from 'react';

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    APPROVED: ['badge-ok', 'approved'],
    PENDING: ['badge-warn', 'pending'],
    REVOKED: ['badge-err', 'revoked'],
  };
  const [cls, label] = map[status] ?? ['badge-neutral', status.toLowerCase()];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" style={{ color: 'var(--text-muted)' }}>
      <span className="spinner" /> {label}
    </span>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function CopyButton({
  value,
  label = 'Скопировать',
}: {
  value: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard недоступен */
        }
      }}
    >
      {done ? 'Скопировано' : label}
    </button>
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
