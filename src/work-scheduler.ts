import type { Logger } from 'pino';
import type postgres from 'postgres';
import { withTimeout } from './with-timeout';

type WorkerOptions = {
  name: string;
  postgres?: {
    client: postgres.Sql<any>;
    topics: string[];
  };
  atLeastEveryMs?: number;
  runOnStartUp?: boolean;
  logger?: Logger;
  /**
   * Reject a run that exceeds this many milliseconds. Without it, a run whose
   * promise never settles (e.g. a query on a dead database connection) leaves
   * isRunning set forever, permanently disabling both the topic listeners and
   * the atLeastEveryMs timer until the process restarts.
   *
   * Note: a timed-out run is abandoned, not cancelled. If it resurrects it may
   * overlap the next run, so only set this on workers that tolerate concurrent
   * runs.
   */
  timeoutMs?: number;
  worker: () => Promise<unknown>;
};

export async function workScheduler(opts: WorkerOptions) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  let isRunning = false;

  async function runWorker() {
    if (isRunning) {
      return;
    }
    isRunning = true;

    if (timeout) {
      clearTimeout(timeout);
    }

    const start = performance.now();
    try {
      await withTimeout(opts.name, opts.worker, opts.timeoutMs);
      opts.logger?.debug(`Worker ${opts.name} run finished in ${Math.round(performance.now() - start)}ms`);
    } catch (err) {
      opts.logger?.error(err, `Error running worker ${opts.name} after ${Math.round(performance.now() - start)}ms`);
    } finally {
      isRunning = false;
      if (opts.atLeastEveryMs) {
        if (timeout) {
          clearTimeout(timeout);
        }
        timeout = setTimeout(runWorker, opts.atLeastEveryMs);
        opts.logger?.trace(`Worker ${opts.name} will run again in ${opts.atLeastEveryMs}ms`);
      }
    }
  }

  if (opts.postgres?.topics) {
    for (const topic of opts.postgres.topics) {
      await opts.postgres.client.listen(topic, runWorker);
      opts.logger?.trace(`Worker ${opts.name} will run on topic ${topic}`);
    }
  }

  if (opts.runOnStartUp) {
    await runWorker();
  } else {
    timeout = setTimeout(runWorker, opts.atLeastEveryMs);
  }

  return runWorker;
}
