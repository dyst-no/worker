import nodeCron from 'node-cron';

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
      await opts.worker();
    } catch (error) {
      console.error(error);
      console.error(`Error running worker ${opts.name}.`, error instanceof Error ? error.message : String(error));
    } finally {
      isRunning = false;
    }
  }

  nodeCron.schedule(opts.cronExpression, runCronWorkerFn);

  if (opts.runOnStartUp) {
    await runCronWorkerFn();
  }
  return runCronWorkerFn;
}
