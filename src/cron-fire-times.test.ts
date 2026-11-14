// cronScheduler must fire at the times node-cron 3.0.3 fired for every CronExpression
// value and every expression and time zone the dyst-no apps use, daylight-saving
// days included. The expected values were recorded from node-cron.
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { RECORDED_SWEEPS, RECORDED_WINDOWS } from './cron-fire-times.recorded';
import { CronExpression, cronScheduler } from './cron-scheduler';

const parse = Bun.cron.parse;

const ZONES = ['UTC', 'Europe/Oslo', 'America/New_York'];
const EXPRESSIONS: string[] = [...Object.values(CronExpression), '0 5 * * *'];
const JULY_OFFSET: Record<string, number> = { UTC: 0, 'Europe/Oslo': -120, 'America/New_York': 240 };

/** Registers the expression through cronScheduler and returns what it handed to Bun.cron. */
async function registered(cronExpression: string) {
  const cron = spyOn(Bun, 'cron').mockImplementation((() => ({ stop() {} })) as any);
  const debug = spyOn(console, 'debug').mockImplementation(() => {});
  try {
    await cronScheduler({ name: 'probe', cronExpression, worker: async () => {} });
    expect(cron).toHaveBeenCalledTimes(1);
    const [expression, , options] = cron.mock.calls[0] as unknown as [string, unknown, Bun.CronOptions | undefined];
    return { expression, options };
  } finally {
    cron.mockRestore();
    debug.mockRestore();
  }
}

/** Next fire times after `from`, as Bun.cron computes them for what cronScheduler registered. */
async function nextFires(cronExpression: string) {
  const { expression, options } = await registered(cronExpression);
  return (from: number) => parse(expression, from, options)!.getTime();
}

function take(next: (from: number) => number, from: string, n: number) {
  const out: string[] = [];
  let t = Date.parse(from);
  while (out.length < n) {
    t = next(t);
    out.push(new Date(t).toISOString());
  }
  return out;
}

function sweep(next: (from: number) => number, from: string, until: string) {
  const end = Date.parse(until);
  const hasher = new Bun.CryptoHasher('sha256');
  let count = 0;
  let first = '';
  let last = '';
  for (let t = next(Date.parse(from)); t < end; t = next(t)) {
    last = new Date(t).toISOString();
    if (!first) first = last;
    hasher.update(`${last}\n`);
    count++;
  }
  return { count, first, last, sha256: hasher.digest('hex') };
}

const originalTz = process.env.TZ;

for (const zone of ZONES) {
  describe(`TZ=${zone}`, () => {
    beforeAll(() => {
      process.env.TZ = zone;
    });
    afterAll(() => {
      process.env.TZ = originalTz;
    });

    for (const expression of EXPRESSIONS) {
      const windows = RECORDED_WINDOWS.filter(([z, e]) => z === zone && e === expression);
      const sweeps = RECORDED_SWEEPS.filter(([z, e]) => z === zone && e === expression);

      test(`${expression} is registered unchanged in the local time zone`, async () => {
        expect(new Date('2026-07-01T00:00:00Z').getTimezoneOffset()).toBe(JULY_OFFSET[zone]!);
        expect(await registered(expression)).toEqual({ expression, options: undefined });
      });

      test(`${expression} fires when node-cron fired around the 2026 and 2027 daylight-saving changes`, async () => {
        expect(windows).toHaveLength(9);
        const next = await nextFires(expression);
        for (const [, , from, fires] of windows) {
          expect({ from, fires: take(next, from, fires.length) }).toEqual({ from, fires });
        }
      });

      test(`${expression} fires when node-cron fired at every fire time in a one- or two-year sweep`, async () => {
        expect(sweeps).toHaveLength(1);
        const next = await nextFires(expression);
        for (const [, , from, until, summary] of sweeps) {
          expect(sweep(next, from, until)).toEqual(summary);
        }
      }, 60_000);
    }
  });
}
