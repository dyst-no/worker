import { withTimeout } from './with-timeout';

export enum CronExpression {
  EVERY_MINUTE = '* * * * *',
  EVERY_HOUR = '0 * * * *',
  EVERY_MIDNIGHT = '0 0 * * *',
}

type CronSchedulerOptions = {
  name: string;
  cronExpression: CronExpression | string;
  worker: () => Promise<unknown>;
  runOnStartUp?: boolean;
  /** See WorkerOptions.timeoutMs — prevents a never-settling run from wedging isRunning forever. */
  timeoutMs?: number;
};

export async function cronScheduler(opts: CronSchedulerOptions) {
  console.debug(`Worker ${opts.name} will run on cron expression ${opts.cronExpression}`);

  let isRunning = false;

  // Wrap the worker in a try catch to avoid crashing the cron job
  async function runCronWorkerFn() {
    if (isRunning) {
      console.debug(`Worker ${opts.name} skipped because previous run is still in flight`);
      return;
    }
    isRunning = true;

    try {
      await withTimeout(opts.name, opts.worker, opts.timeoutMs);
    } catch (error) {
      console.error(error);
      console.error(`Error running worker ${opts.name}.`, error instanceof Error ? error.message : String(error));
    } finally {
      isRunning = false;
    }
  }

  // Bun.cron waits for a returned promise before it schedules the next fire. Not
  // returning it keeps node-cron's behaviour: every tick calls runCronWorkerFn,
  // which skips and logs while a run is still in flight. runCronWorkerFn never
  // rejects, so nothing is left unhandled.
  Bun.cron(opts.cronExpression, () => {
    void runCronWorkerFn();
  });

  if (opts.runOnStartUp) {
    await runCronWorkerFn();
  }
  return runCronWorkerFn;
}
