import cron from 'node-cron';

/**
 * Upgraded Task/Worker Model
 * Supports concurrency, retries, leases, and dead-letter queues.
 */
export class TaskManager {
  constructor(config = {}) {
    this.tasks = new Map();
    this.redisClient = config.redisClient || null;
    this.logger = config.logger || console;
  }

  register(name, schedule, handler, options = {}) {
    const defaultOptions = { retries: 3, concurrency: 1, deadLetter: true, timeoutMs: 30000 };
    const taskDef = { name, schedule, handler, options: { ...defaultOptions, ...options } };
    
    let taskJob;
    if (schedule) {
      taskJob = cron.schedule(schedule, async () => {
         await this.execute(name);
      }, { scheduled: false });
    }
    
    this.tasks.set(name, { ...taskDef, job: taskJob });
  }

  startAll() {
    for (const [name, task] of this.tasks.entries()) {
      if (task.job) {
        task.job.start();
        this.logger.info(`[bro.js/tasks] Task '${name}' scheduled (${task.schedule})`);
      }
    }
  }

  stopAll() {
    for (const task of this.tasks.values()) {
      if (task.job) task.job.stop();
    }
  }

  async execute(name) {
    const task = this.tasks.get(name);
    if (!task) throw new Error(`Task '${name}' not found`);

    const leaseKey = `bro:task_lease:${name}`;
    if (this.redisClient) {
       const acquired = await this.redisClient.set(leaseKey, 'locked', { NX: true, PX: task.options.timeoutMs });
       if (!acquired) {
         this.logger.debug(`[bro.js/tasks] Task '${name}' skipped (locked)`);
         return;
       }
    }

    let attempt = 0;
    while (attempt < task.options.retries) {
      try {
        await Promise.race([
          task.handler(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Task Timeout')), task.options.timeoutMs))
        ]);
        break; // Success
      } catch (err) {
        attempt++;
        this.logger.error(`[bro.js/tasks] Task '${name}' attempt ${attempt} failed: ${err.message}`);
        if (attempt >= task.options.retries) {
          if (task.options.deadLetter && this.redisClient) {
            await this.redisClient.rPush('bro:dead_letter_queue', JSON.stringify({ name, error: err.message, time: Date.now() }));
          }
        } else {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000)); // Exponential backoff
        }
      }
    }
    if (this.redisClient) await this.redisClient.del(leaseKey);
  }

  async _handleDeadLetter(name, error) {
    if (!this.redisClient) return;
    const dlqKey = `bro:dlq:${name}`;
    try {
      await this.redisClient.lPush(dlqKey, JSON.stringify({ error: error.message, time: new Date().toISOString() }));
    } catch (e) {
      this.logger.error(`[bro.js/tasks] Failed to push dead letter for '${name}':`, e);
    }
  }
}
