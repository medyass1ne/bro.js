import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import cron from 'node-cron';
import { colors } from './logger.js';

export async function scanTasks(ctx) {
  const tasksDir = path.join(process.cwd(), 'tasks');
  if (!fs.existsSync(tasksDir)) return;
  
  const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.js'));
  if (files.length === 0) return;
  
  let count = 0;
  for (const file of files) {
    const filePath = path.join(tasksDir, file);
    try {
      const moduleUrl = pathToFileURL(filePath).href;
      const taskModule = await import(moduleUrl);
      
      if (taskModule.cron && typeof taskModule.handler === 'function') {
        cron.schedule(taskModule.cron, async () => {
          try {
            await taskModule.handler(ctx);
          } catch (err) {
            console.error(`\n  ${colors.red}❌ Task Error (${file}):${colors.reset}`, err);
          }
        });
        count++;
      }
    } catch (err) {
      console.error(`\n  ${colors.red}❌ Failed to load task ${file}:${colors.reset}`, err);
    }
  }
  
  if (count > 0) {
    console.log(`  ${colors.dim}├──${colors.reset} ${colors.cyan}Scheduled ${count} background task(s)${colors.reset}`);
  }
}
