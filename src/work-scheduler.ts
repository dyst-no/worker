import type postgres from 'postgres';
import type { Logger } from 'pino';
type WorkerOptions = {
  name: string;
  postgres?: {
    client: postgres.Sql<any>;
    topics: string[];
  };
  atLeastEveryMs?: number;
  runOnStartUp?: boolean;
  logger?: Logger;
  worker: () => Promise<unknown>;
};

export async function workScheduler(opts: WorkerOptions) {
  let timeout: Timer;

  let isRunning = false;

  async function runWorker() {
    if (isRunning) {
      return;
    }
    isRunning = true;

    if (timeout) {
      clearTimeout(timeout);
    }

    try {
      await opts.worker();
    } catch (err) {
      opts.logger?.error(err, 'Error running worker');
    } finally {
      isRunning = false;
      if (opts.atLeastEveryMs) {
        if (timeout) {
          clearTimeout(timeout);
        }
        timeout = setTimeout(runWorker, opts.atLeastEveryMs) as unknown as Timer;
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
    timeout = setTimeout(runWorker, opts.atLeastEveryMs) as unknown as Timer;
  }

  return runWorker;
}
