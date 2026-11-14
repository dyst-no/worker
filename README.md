# @dyst-no/worker

A simple TypeScript library providing helper functions for scheduling background workers in Bun applications. `cronScheduler` needs Bun 1.4 or newer.

Install with:

```bash
bun add @dyst-no/worker
```

## Features

### Cron Scheduler
Schedule workers to run on cron expressions with built-in error handling and optional startup execution.
A tick that arrives while the previous run is still in flight is skipped and logged.

Schedules run on `Bun.cron` in the process's local time zone (set `TZ` to choose it).
Expressions have five fields, `minute hour day-of-month month day-of-week`; see
[Next minor release](#next-minor-release-040-breaking-changes) for how this differs from earlier versions.

```typescript
import { cronScheduler, CronExpression } from '@dyst-no/worker';

// Run every hour
await cronScheduler({
  name: 'hourly-cleanup',
  cronExpression: CronExpression.EVERY_HOUR,
  worker: async () => {
    // Your worker logic here
  },
  runOnStartUp: true
});
```

### Work Scheduler
A flexible scheduler that supports:
- PostgreSQL pub/sub topic listening
- Recurring execution with minimum intervals
- Startup execution
- Optional logging

```typescript
import { workScheduler } from '@dyst-no/worker';

// Run on PostgreSQL notifications and at least every 5 minutes
await workScheduler({
  name: 'data-processor',
  postgres: {
    client: postgresClient,
    topics: ['data-updated']
  },
  atLeastEveryMs: 5 * 60 * 1000, // 5 minutes
  worker: async () => {
    // Your worker logic here
  },
  logger: pinoLogger, // optional: pino, console, or anything with debug, error and trace
});
```

## Next minor release (0.4.0): breaking changes

`cronScheduler` now schedules with `Bun.cron` instead of `node-cron` 3. `node-cron` is no longer a peer dependency
and `cronScheduler` no longer runs on Node.js (`workScheduler` is unchanged). The `cronScheduler` options, the `CronExpression` values, the overlap guard,
the logging and the returned run function are unchanged, and `CronExpression.EVERY_MINUTE`, `EVERY_HOUR` and
`EVERY_MIDNIGHT` fire at the same times as before. Other expressions can behave differently:

- **Bun 1.4 or newer only.** `cronScheduler` calls the global `Bun.cron` and fails with a `ReferenceError` on Node.js.
  Bun 1.3 evaluated `Bun.cron` schedules in UTC; from 1.4 they use the local time zone, as `node-cron` did.
- **Five fields only.** A seconds field is no longer accepted: `*/5 * * * * *` now throws
  `seconds are not supported` instead of firing every five seconds.
- **Day of month OR day of week.** When both fields are restricted the job fires when either matches (POSIX cron).
  `0 0 13 * 5` used to fire only on Friday the 13th; it now fires on every 13th and on every Friday.
- **Step ranges count from the start of the range.** `1-30/2 * * * *` used to fire at minutes 2, 4, ..., 30; it now
  fires at minutes 1, 3, ..., 29.
- **Weekday ranges that end in 7 are read as ending on Sunday.** `0 0 * * 5-7` used to fire on every day except
  Saturday; it now fires on Friday, Saturday and Sunday.
- **Daylight-saving changes.** A job set for a time that does not exist on the spring-forward day used to be skipped
  that day; it now runs when the clock has moved past the gap (`30 2 * * *` in Europe/Oslo runs at 03:30 on
  2026-03-29). A job set for a fixed time in the repeated hour on the fall-back day used to run twice; it now runs
  once, at the first occurrence (`30 2 * * *` in Europe/Oslo on 2026-10-25, `0 1 * * *` in America/New_York on
  2026-11-01, and each minute of `*/20 2 * * *`). Expressions with `*` in the minute or hour field fire through both
  occurrences, as before.
- **Some expressions switch between valid and invalid.** `cronScheduler` now rejects, before it runs the worker:
  expressions with no future occurrence such as `0 0 30 2 *` (previously accepted and never fired), six- and
  seven-field expressions, descending ranges such as `5-1`, `#` such as `1#2`, and hexadecimal or decimal numbers
  such as `0x5` and `1.5`. It now accepts nicknames such as `@daily` and `@hourly`, steps without a range such as
  `5/10`, and tabs between fields, which `node-cron` rejected.

## Releasing

Run the `Release` GitHub Actions workflow and choose one of:

- `patch` for fixes and small non-breaking changes
- `minor` for new backward-compatible features
- `major` for breaking changes

The release flow builds, typechecks, updates `CHANGELOG.md` from commit messages since the previous tag, creates a release commit and tag, and publishes to npm.

You can also run releases locally:

```bash
bun run release:patch
bun run release:minor
bun run release:major
```
