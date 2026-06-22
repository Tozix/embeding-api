import { Injectable } from '@nestjs/common';

type Item<T> =
  | { type: 'data'; value: T }
  | { type: 'end' }
  | { type: 'error'; error: string };

/**
 * Буферизированный канал «один писатель → один читатель». Worker (процессор очереди)
 * пишет чанки, HTTP-обработчик читает их как async-iterable. Буфер на случай, если
 * писатель стартовал раньше, чем читатель начал итерацию.
 */
export class Channel<T> {
  private readonly buffer: Item<T>[] = [];
  private resolver: ((item: Item<T>) => void) | null = null;
  private done = false;

  // Обрыв клиента → abort.abort() → воркер прекращает генерацию (не жжём CPU впустую).
  readonly abort = new AbortController();
  get signal(): AbortSignal {
    return this.abort.signal;
  }

  push(value: T): void {
    this.enqueue({ type: 'data', value });
  }
  end(): void {
    this.enqueue({ type: 'end' });
  }
  fail(error: string): void {
    this.enqueue({ type: 'error', error });
  }

  private enqueue(item: Item<T>): void {
    if (this.done) return;
    if (item.type !== 'data') this.done = true;
    if (this.resolver) {
      const r = this.resolver;
      this.resolver = null;
      r(item);
    } else {
      this.buffer.push(item);
    }
  }

  private next(): Promise<Item<T>> {
    const buffered = this.buffer.shift();
    if (buffered) return Promise.resolve(buffered);
    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (;;) {
      const item = await this.next();
      if (item.type === 'end') return;
      if (item.type === 'error') throw new Error(item.error);
      yield item.value;
    }
  }
}

/** Реестр активных стрим-каналов по bridgeId. Работает в пределах одного процесса API. */
@Injectable()
export class StreamHub {
  private readonly channels = new Map<string, Channel<unknown>>();

  create<T>(id: string): Channel<T> {
    const channel = new Channel<T>();
    this.channels.set(id, channel as Channel<unknown>);
    return channel;
  }

  get<T>(id: string): Channel<T> | undefined {
    return this.channels.get(id) as Channel<T> | undefined;
  }

  remove(id: string): void {
    this.channels.delete(id);
  }
}
