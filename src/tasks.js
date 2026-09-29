import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import crypto from 'node:crypto';
import { colors } from './logger.js';
import { scanDir } from './router.js';
import { TaskManager } from './task-engine.js';

export async function scanTasks(ctx) {
  const manager = new TaskManager({ redisClient: ctx.redis, logger: ctx.logger || console });
  const tasksDir = path.join(process.cwd(), 'tasks');
  if (!fs.existsSync(tasksDir)) return manager;
  
  const files = scanDir(tasksDir);
  if (files.length === 0) return manager;
  
  let count = 0;
  for (const file of files) {
    try {
      const moduleUrl = `${pathToFileURL(file).href}?update=${crypto.randomUUID()}`;
      const taskModule = await import(moduleUrl);
      
      if (taskModule.cron && typeof taskModule.handler === 'function') {
        const taskName = path.basename(file, '.js');
        manager.register(taskName, taskModule.cron, async () => {
           try {
             await taskModule.handler(ctx);
           } catch (err) {
             console.error(`\n  ${colors.red}❌ Task Error (${file}):${colors.reset}`, err);
             throw err; // Re-throw so TaskManager can handle retries/DLQ
           }
        }, taskModule.options || {});
        count++;
      }
    } catch (err) {
      console.error(`\n  ${colors.red}❌ Failed to load task ${file}:${colors.reset}`, err);
    }
  }
  
  if (count > 0) {
    manager.startAll();
    console.log(`  ${colors.dim}├──${colors.reset} ${colors.cyan}Scheduled ${count} background task(s)${colors.reset}`);
  }
  
  return manager;
}
