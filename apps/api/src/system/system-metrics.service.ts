import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import * as os from 'node:os';

export type SystemPoint = {
  ts: number; // unix ms
  cpu: number; // загрузка CPU, %
  memUsed: number; // байты
  memTotal: number;
  load1: number; // load average за 1 мин
};

/**
 * Сэмплер метрик хоста (в контейнере /proc виден хостовый): CPU% по дельтам os.cpus(),
 * память и loadavg. Держит кольцевой буфер истории в памяти для графика «за период».
 */
@Injectable()
export class SystemMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly history: SystemPoint[] = [];
  private readonly maxPoints = 300; // ~15 минут при шаге 3с
  private readonly intervalMs = 3000;
  private timer: ReturnType<typeof setInterval> | null = null;
  private prev = SystemMetricsService.cpuTimes();

  onModuleInit(): void {
    this.sample();
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private static cpuTimes(): { idle: number; total: number } {
    let idle = 0;
    let total = 0;
    for (const c of os.cpus()) {
      const t = c.times;
      idle += t.idle;
      total += t.user + t.nice + t.sys + t.idle + t.irq;
    }
    return { idle, total };
  }

  private sample(): void {
    const cur = SystemMetricsService.cpuTimes();
    const dIdle = cur.idle - this.prev.idle;
    const dTotal = cur.total - this.prev.total;
    this.prev = cur;
    const cpu =
      dTotal > 0 ? Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100)) : 0;
    const memTotal = os.totalmem();
    this.history.push({
      ts: Date.now(),
      cpu: Math.round(cpu * 10) / 10,
      memUsed: memTotal - os.freemem(),
      memTotal,
      load1: Math.round((os.loadavg()[0] ?? 0) * 100) / 100,
    });
    if (this.history.length > this.maxPoints) this.history.shift();
  }

  snapshot(): { cpuCount: number; current: SystemPoint; history: SystemPoint[] } {
    const memTotal = os.totalmem();
    const current =
      this.history[this.history.length - 1] ??
      ({
        ts: Date.now(),
        cpu: 0,
        memUsed: memTotal - os.freemem(),
        memTotal,
        load1: os.loadavg()[0] ?? 0,
      } satisfies SystemPoint);
    return { cpuCount: os.cpus().length, current, history: [...this.history] };
  }
}
