export function withTimeout(name: string, worker: () => Promise<unknown>, timeoutMs?: number): Promise<unknown> {
  if (!timeoutMs) {
    return worker();
  }
  // Promise.race attaches handlers to both promises, so a late rejection from
  // the losing promise never becomes an unhandled rejection.
  return Promise.race([
    worker(),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`Worker ${name} run timed out after ${timeoutMs}ms`)), timeoutMs);
      timer.unref?.();
    }),
  ]);
}
