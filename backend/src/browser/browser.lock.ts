import { Injectable } from '@nestjs/common';

class AsyncMutex {
  private tail: Promise<unknown> = Promise.resolve();

  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/**
 * 同一个进程内串行执行浏览器采集，避免同时启动多个浏览器实例。
 */
@Injectable()
export class BrowserLockService {
  private readonly mutex = new AsyncMutex();

  run<T>(fn: () => Promise<T>): Promise<T> {
    return this.mutex.runExclusive(fn);
  }
}
