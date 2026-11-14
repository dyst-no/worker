// TEMPORARY: compares node-cron 3.0.3 with the Bun.cron path of cronScheduler.
// Replaced by plain tests with recorded values once node-cron is removed.
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
// @ts-expect-error node-cron ships no types for its internals
import TimeMatcher from 'node-cron/src/time-matcher.js';
import { CronExpression, cronScheduler } from './cron-scheduler';

const parse = Bun.cron.parse;
const MINUTE = 60_000;

const ZONES = ['UTC', 'Europe/Oslo', 'America/New_York'];
const EXPRESSIONS: string[] = [...Object.values(CronExpression), '0 5 * * *'];
// Daylight-saving transitions in 2026 and 2027, plus an ordinary day.
const INSTANTS = [
  '2026-03-08T07:00:00.000Z', // America/New_York springs forward 02:00 -> 03:00
  '2026-03-29T01:00:00.000Z', // Europe/Oslo springs forward 02:00 -> 03:00
  '2026-10-25T01:00:00.000Z', // Europe/Oslo falls back 03:00 -> 02:00
  '2026-11-01T06:00:00.000Z', // America/New_York falls back 02:00 -> 01:00
  '2027-03-14T07:00:00.000Z',
  '2027-03-28T01:00:00.000Z',
  '2027-10-31T01:00:00.000Z',
  '2027-11-07T06:00:00.000Z',
  '2026-07-15T12:00:00.000Z',
];
const SWEEP_FROM = '2026-01-01T00:00:00.000Z';
const SWEEP_UNTIL: Record<string, string> = {
  [CronExpression.EVERY_MINUTE]: '2027-01-01T00:00:00.000Z',
  [CronExpression.EVERY_HOUR]: '2028-01-01T00:00:00.000Z',
  [CronExpression.EVERY_MIDNIGHT]: '2028-01-01T00:00:00.000Z',
  '0 5 * * *': '2028-01-01T00:00:00.000Z',
};

/** Registers the expression through cronScheduler and returns what it handed to Bun.cron. */
async function registered(cronExpression: string) {
  const spy = spyOn(Bun, 'cron').mockImplementation((() => ({ stop() {} })) as any);
  try {
    await cronScheduler({ name: 'probe', cronExpression, worker: async () => {} });
    expect(spy).toHaveBeenCalledTimes(1);
    const [expression, , options] = spy.mock.calls[0] as unknown as [string, unknown, Bun.CronOptions | undefined];
    return { expression, options };
  } finally {
    spy.mockRestore();
  }
}

function bunNext(expression: string, options: Bun.CronOptions | undefined) {
  return (from: number) => parse(expression, from, options)!.getTime();
}

// node-cron checks every second whether the local wall clock matches; with a
// 5-field expression the seconds field is 0, so only whole minutes can match.
function nodeCronNext(expression: string) {
  const matcher = new TimeMatcher(expression);
  return (from: number) => {
    let t = Math.floor(from / MINUTE) * MINUTE + MINUTE;
    while (!matcher.match(new Date(t))) t += MINUTE;
    return t;
  };
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

function windowFor(expression: string, instant: string) {
  const t = Date.parse(instant);
  if (expression === CronExpression.EVERY_MINUTE) return { from: new Date(t - 150_000).toISOString(), n: 5 };
  if (expression === CronExpression.EVERY_HOUR) return { from: new Date(t - 150 * MINUTE).toISOString(), n: 5 };
  return { from: new Date(t - 36 * 60 * MINUTE).toISOString(), n: 3 };
}

const recorded: { windows: unknown[]; sweeps: unknown[] } = { windows: [], sweeps: [] };
const originalTz = process.env.TZ;

afterAll(async () => {
  if (process.env.RECORD) await Bun.write(process.env.RECORD, JSON.stringify(recorded, null, 1));
});

for (const zone of ZONES) {
  describe(`TZ=${zone}`, () => {
    beforeAll(() => {
      process.env.TZ = zone;
    });
    afterEach(() => {
      process.env.TZ = zone;
    });
    afterAll(() => {
      process.env.TZ = originalTz;
    });

    for (const expression of EXPRESSIONS) {
      test(`${expression} is registered unchanged in the local time zone`, async () => {
        expect(new Date('2026-07-01T00:00:00Z').getTimezoneOffset()).toBe(
          { UTC: 0, 'Europe/Oslo': -120, 'America/New_York': 240 }[zone]!,
        );
        expect(await registered(expression)).toEqual({ expression, options: undefined });
      });

      test(`${expression} fires when node-cron fires around daylight-saving changes`, async () => {
        const { expression: e, options } = await registered(expression);
        for (const instant of INSTANTS) {
          const { from, n } = windowFor(expression, instant);
          const expected = take(nodeCronNext(expression), from, n);
          expect({ from, fires: take(bunNext(e, options), from, n) }).toEqual({ from, fires: expected });
          recorded.windows.push([zone, expression, from, expected]);
        }
      });

      test(`${expression} fires when node-cron fires from ${SWEEP_FROM} to ${SWEEP_UNTIL[expression]}`, async () => {
        const { expression: e, options } = await registered(expression);
        const expected = sweep(nodeCronNext(expression), SWEEP_FROM, SWEEP_UNTIL[expression]!);
        expect(sweep(bunNext(e, options), SWEEP_FROM, SWEEP_UNTIL[expression]!)).toEqual(expected);
        recorded.sweeps.push([zone, expression, SWEEP_FROM, SWEEP_UNTIL[expression], expected]);
      }, 120_000);
    }
  });
}
