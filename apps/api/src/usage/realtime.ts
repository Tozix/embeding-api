import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { LiveUsageEvent } from './usage.types';

/** In-process шина live-событий аналитики: recorder публикует, SSE-эндпоинт подписывается. */
@Injectable()
export class AnalyticsLive {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(1000);
  }

  publish(event: LiveUsageEvent): void {
    this.emitter.emit('usage', event);
  }

  subscribe(listener: (event: LiveUsageEvent) => void): () => void {
    this.emitter.on('usage', listener);
    return () => this.emitter.off('usage', listener);
  }
}
