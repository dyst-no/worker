import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { CronExpression, cronScheduler } from './cron-scheduler';

type Tick = () => unknown;

let cronSpy: ReturnType<typeof spyOn<typeof Bun, 'cron'>>;
let jobs: Bun.CronJob[];
let debug: ReturnType<typeof spyOn<Console, 'debug'>>;
let error: ReturnType<typeof spyOn<Console, 'error'>>;

beforeEach(() => {
  const realCron = Bun.cron;
  jobs = [];
  // Register with the real Bun.cron (so it validates the expression), then stop
  // the job at once; the test drives ticks through the captured handler.
  cronSpy = spyOn(Bun, 'cron').mockImplementation(((schedule: string, handler: Tick, options?: Bun.CronOptions) => {
    const job = realCron(schedule, handler, options);
    job.stop();
    jobs.push(job);
    return job;
  }) as typeof Bun.cron);
  debug = spyOn(console, 'debug').mockImplementation(() => {});
  error = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cronSpy.mockRestore();
  debug.mockRestore();
  error.mockRestore();
});

function tick() {
  expect(cronSpy).toHaveBeenCalledTimes(1);
  const handler = cronSpy.mock.calls[0]![1] as unknown as Tick;
  return handler();
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('cronScheduler', () => {
  test('registers the expression with Bun.cron in the local time zone and logs it', async () => {
    const worker = mock(async () => {});
    await cronScheduler({ name: 'nightly', cronExpression: CronExpression.EVERY_MIDNIGHT, worker });

    expect(cronSpy).toHaveBeenCalledTimes(1);
    expect(cronSpy.mock.calls[0]![0]).toBe('0 0 * * *');
    expect(cronSpy.mock.calls[0]![2]).toBeUndefined();
    expect(jobs[0]!.cron).toBe('0 0 * * *');
    expect(debug).toHaveBeenCalledWith('Worker nightly will run on cron expression 0 0 * * *');
    expect(worker).not.toHaveBeenCalled();
  });

  test('accepts a plain string expression', async () => {
    await cronScheduler({ name: 'five', cronExpression: '0 5 * * *', worker: async () => {} });
    expect(jobs[0]!.cron).toBe('0 5 * * *');
  });

  test('runs the worker on startup when runOnStartUp is set', async () => {
    const worker = mock(async () => {});
    await cronScheduler({ name: 'startup', cronExpression: CronExpression.EVERY_HOUR, worker, runOnStartUp: true });
    expect(worker).toHaveBeenCalledTimes(1);
  });

  test('runs the worker on each tick and does not hand Bun.cron a promise to wait for', async () => {
    const worker = mock(async () => {});
    await cronScheduler({ name: 'tick', cronExpression: CronExpression.EVERY_MINUTE, worker });

    expect(tick()).toBeUndefined();
    expect(worker).toHaveBeenCalledTimes(1);
  });

  test('returns a function that runs the worker', async () => {
    const worker = mock(async () => {});
    const run = await cronScheduler({ name: 'manual', cronExpression: CronExpression.EVERY_MINUTE, worker });
    await run();
    expect(worker).toHaveBeenCalledTimes(1);
  });

  test('skips and logs a tick while the previous run is still in flight, then runs again', async () => {
    const gate = deferred();
    const worker = mock(() => gate.promise);
    const run = await cronScheduler({ name: 'slow', cronExpression: CronExpression.EVERY_MINUTE, worker });

    const first = run();
    tick();
    expect(worker).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith('Worker slow skipped because previous run is still in flight');

    gate.resolve();
    await first;
    await run();
    expect(worker).toHaveBeenCalledTimes(2);
  });

  test('logs an Error thrown by the worker and keeps scheduling', async () => {
    const failure = new Error('boom');
    const worker = mock(async () => {
      throw failure;
    });
    const run = await cronScheduler({ name: 'failing', cronExpression: CronExpression.EVERY_MINUTE, worker });

    await expect(run()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(failure);
    expect(error).toHaveBeenCalledWith('Error running worker failing.', 'boom');

    await run();
    expect(worker).toHaveBeenCalledTimes(2);
  });

  test('logs a non-Error rejection as a string', async () => {
    const run = await cronScheduler({
      name: 'odd',
      cronExpression: CronExpression.EVERY_MINUTE,
      worker: () => Promise.reject('plain string'),
    });

    await run();
    expect(error).toHaveBeenCalledWith('Error running worker odd.', 'plain string');
  });

  test('a run that exceeds timeoutMs is logged and frees the overlap guard', async () => {
    const worker = mock(() => new Promise<void>(() => {}));
    const run = await cronScheduler({
      name: 'stuck',
      cronExpression: CronExpression.EVERY_MINUTE,
      worker,
      timeoutMs: 5,
    });

    await run();
    expect(error).toHaveBeenCalledWith('Error running worker stuck.', 'Worker stuck run timed out after 5ms');

    void run();
    expect(worker).toHaveBeenCalledTimes(2);
  });

  test('rejects, without running the worker, an expression Bun.cron rejects', async () => {
    const worker = mock(async () => {});
    await expect(
      cronScheduler({ name: 'seconds', cronExpression: '*/5 * * * * *', worker, runOnStartUp: true }),
    ).rejects.toThrow('seconds are not supported');
    await expect(cronScheduler({ name: 'feb30', cronExpression: '0 0 30 2 *', worker })).rejects.toThrow(
      'no future occurrences',
    );
    expect(worker).not.toHaveBeenCalled();
  });
});
