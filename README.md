# @dyst-no/worker

A simple TypeScript library providing helper functions for scheduling background workers in Node.js applications.

## Features

### Cron Scheduler
Schedule workers to run on cron expressions with built-in error handling and optional startup execution.

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
  logger: pinoLogger
});
```
