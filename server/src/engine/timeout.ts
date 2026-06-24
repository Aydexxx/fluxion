/** Error thrown when an executor exceeds its time budget. */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Races a promise against a deadline. If `ms` isn't a positive finite number the
 * promise is returned unguarded (no timeout). The timer is always cleared so a
 * settled promise doesn't keep the event loop alive. Note this bounds how long
 * the executor *waits* — pair it with an AbortSignal where the underlying work
 * can actually be cancelled (e.g. fetch).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Per-node timeout: an explicit positive `config.timeoutMs` wins, else the run-level fallback. */
export function resolveTimeout(configValue: unknown, fallbackMs: number): number {
  return typeof configValue === "number" && configValue > 0 ? configValue : fallbackMs;
}
