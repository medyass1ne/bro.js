#!/usr/bin/env node

import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { register } from 'tsx/esm/api';

register();

import { createServer } from '../src/server.js';
import { colors, printBanner, printRoute, printHotReload } from '../src/logger.js';
import { generateSDK } from '../src/sdk.js';
import dotenv from 'dotenv';
import chokidar from 'chokidar';

dotenv.config();

const command = process.argv[2] || 'dev';

async function bootstrap() {
  const startTime = performance.now();
  const configPath = path.resolve(process.cwd(), 'bro.config.js');
  let globalConfig = {};
  
  if (fs.existsSync(configPath)) {
    try {
      const configModule = await import(pathToFileURL(configPath).href);
      globalConfig = configModule.default || configModule;
    } catch (err) {
      console.error('[bro.js] Error loading bro.config.js:', err);
      process.exit(1);
    }
  }

  const routesDir = globalConfig.routesDir || path.resolve(process.cwd(), 'routes');
  const localeDir = globalConfig.locale?.directory || path.resolve(process.cwd(), 'locale');
  const tasksDir = globalConfig.tasksDir || path.resolve(process.cwd(), 'tasks');
  const port = globalConfig.server?.port || process.env.PORT || 3000;

  let db = null;
  // Initialize db from globalConfig if provided (mocked here for CLI boot)
  if (globalConfig.db && typeof globalConfig.db === 'function') {
    db = await globalConfig.db();
  } else {
    db = globalConfig.db;
  }

  const { app, server, routes, reload, reloadLocale, shutdown } = await createServer(globalConfig, routesDir, db);
  let currentRoutes = routes;

  server.listen(port, () => {
    if (command === 'dev') {
      console.clear();
      printBanner(port, performance.now() - startTime);

      if (process.argv.includes('--ui')) {
        import('../src/dashboard.js').then(({ startDashboard }) => {
          startDashboard(globalConfig, currentRoutes);
        }).catch(err => console.error('[bro.js] Error starting dashboard:', err));
      }
    } else if (command === 'start') {
      console.log(`[bro.js] Server running in production on port ${port}`);
    }
  
    if (command === 'dev') {
      const printCurrentRoutes = (routesToPrint) => {
        if (routesToPrint.length > 0) {
          routesToPrint.forEach((r, i) => {
            printRoute(r.method, r.path, r.auth, i === routesToPrint.length - 1);
          });
          console.log("");
        } else {
          console.log("  No routes found.\n");
        }
      };
      
      printCurrentRoutes(currentRoutes);

      const localeGlob = localeDir.replace(/\\/g, '/') + '/*.{js,mjs,ts,json}';
      const watcher = chokidar.watch([routesDir, localeGlob, tasksDir], { ignoreInitial: true });
      
      watcher.on('all', async (event, filepath) => {
        const isValidFile = filepath.match(/\.(js|ts|mjs|json)$/);
        if (!isValidFile) return;
        const relLocale = path.relative(path.resolve(localeDir), filepath);
        const isLocaleFile = !relLocale.startsWith('..') && !path.isAbsolute(relLocale);
        
        const relTask = path.relative(path.resolve(tasksDir), filepath);
        const isTaskFile = !relTask.startsWith('..') && !path.isAbsolute(relTask);

        try {
          const reloadStartTime = performance.now();
          if (isLocaleFile) {
            await reloadLocale();
          } else if (isTaskFile) {
            // Tasks reload
          } else {
            currentRoutes = await reload();
          }
          const reloadTimeMs = performance.now() - reloadStartTime;
          
          const fileType = isTaskFile ? 'Task' : (isLocaleFile ? 'Locale' : 'Route');
          printHotReload(path.basename(filepath), event, reloadTimeMs, fileType);
          printCurrentRoutes(currentRoutes);
        } catch (err) {
          const fileType = isTaskFile ? 'tasks' : (isLocaleFile ? 'locale' : 'routes');
          console.error(`\n  ✗ Error hot-reloading ${fileType}:`, err);
        }
      });
    }

    const handleShutdown = async (signal) => {
      console.log(`\n[bro.js] Received ${signal}. Shutting down gracefully...`);
      if (shutdown) await shutdown();
      console.log('[bro.js] HTTP server closed.');
      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  });
}


  if (command === 'test') {
    const hasVitest = fs.existsSync(path.resolve(process.cwd(), 'node_modules', 'vitest'));
    if (!hasVitest) {
      console.error(colors.red + 'Vitest is not installed. Please run: npm install -D vitest' + colors.reset);
      process.exit(1);
    }

  import('child_process').then(cp => {
    console.log('\x1b[36m[bro.js]\x1b[0m Starting tests via vitest...');
    cp.spawn('npx', ['vitest', ...process.argv.slice(3)], { stdio: 'inherit' });
  });

} else if (command === 'init') {
  const configPath = path.resolve(process.cwd(), 'bro.config.js');
  const envPath = path.resolve(process.cwd(), '.env.example');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, `import { defineConfig } from 'bro-framework';

export default defineConfig({
  // Server Settings
  server: {
    port: 5000,
    cors: process.env.NODE_ENV === 'production' ? ['https://yourdomain.com'] : true, // Set to true to allow all, or pass a CORS options object
    helmet: true // Enable security headers
  },

  // Authentication Settings
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'dev_secret_please_change', // Must be at least 32 characters in production
    expiresIn: '7d',
    //apiKey: process.env.API_KEY || ['dev_key_1', 'dev_key_2'] // Supports array for zero-downtime rotation
  },

  // Trust reverse proxy IP headers (Nginx/Cloudflare)
  trustProxy: true,

  // Observability & Telemetry
  observability: {
    // Output structured JSON logs with request IDs and execution timing (ideal for CloudWatch/Datadog)
    // Options: 'json' | 'pretty' (default: 'pretty' in dev, 'json' in production)
    logging: 'json',

    // Enable OpenTelemetry W3C trace propagation and HTTP span generation
    openTelemetry: true
  }

  // Optional file-based API translations
  // Add locale/en.js, locale/fr.js, etc.
  locale: {
    defaultLocale: 'en'
  },
  
  // API Documentation (Scalar UI)
  docs: process.env.NODE_ENV !== 'production', // Set to false to disable completely, or true to force in prod

  // Rate Limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  },

  // Redis Configuration (Auto-scales WebSockets, distributed caches & rate-limiting)
  redisUrl: process.env.REDIS_URL, // e.g., 'redis://localhost:6379'

  // WebSockets Setup
  sockets: async (io, db) => {
    io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);
    });
  },

  // Database Context Injection
  // This instance will be injected into every route's ctx.db (if defined)
  db: async () => {
    // If you use a database, set up your connection here
    // and return the connection instance or an object of your models.
    // Could be MongoDB, MySQL, etc. (your choice)
    // --- MONGOOSE EXAMPLE ---
    // import mongoose from 'mongoose';
    
    // await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/bro_database');
    // console.log("Connected to MongoDB");
    
    // You can return mongoose itself, or an object of your models 
    // to access them instantly in your routes without importing them!
    // Example: return { User, Post };
    
    // return mongoose.connection; 
    // --------------------------
    return null;
  },

  // Graceful Teardown Hook
  onShutdown: async (db) => {
    // Close application-owned database resources gracefully here
  }
});
`);
    console.log('[bro.js] Created bro.config.js');
  }
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, 'JWT_SECRET=your_jwt_secret_here\nNODE_ENV=development\nREDIS_URL=redis://localhost:6379\n');
    console.log('[bro.js] Created .env.example');
  }
} else if (command === 'doctor') {
  console.log('[bro.js] Running doctor...');
  const configPath = path.resolve(process.cwd(), 'bro.config.js');
  if (!fs.existsSync(configPath)) {
    console.error('✗ No bro.config.js found.');
  } else {
    import(pathToFileURL(configPath).href).then(m => {
      const config = m.default || m;
      if (config.server?.cors === true) console.error('✗ Permissive CORS is enabled (cors: true). Use an array of allowed origins.');
      else console.log('✓ CORS is strict.');
      
      if (['dev_secret_please_change', 'bro_default_secret_key', 'your_jwt_secret_here', ''].includes(config.auth?.jwtSecret?.trim())) {
        console.error('✗ Hardcoded insecure JWT secret detected.');
      } else {
        console.log('✓ Secrets look ok.');
      }
    });
  }
} else if (command === 'sdk' || command === 'client' || command === 'generate-client') {
    const sdkOutPath = process.argv[3] || './client.ts';
    const configPath = path.resolve(process.cwd(), 'bro.config.js');
    let globalConfig = {};
    if (fs.existsSync(configPath)) {
      try {
        const configModule = await import(configPath);
        globalConfig = configModule.default || configModule;
      } catch (e) {}
    }
    const routesDir = globalConfig.routesDir || path.resolve(process.cwd(), 'routes');
    generateSDK(routesDir, sdkOutPath).then(() => {
    console.log(`\x1b[32m✓ SDK successfully generated at ${sdkOutPath}\x1b[0m`);
  }).catch(err => {
    console.error('\x1b[31m✗ Failed to generate SDK:\x1b[0m', err);
  });
} else if (command === 'studio') {
  import('../src/studio.js').then(({ startStudio }) => {
    startStudio(process.cwd());
  }).catch(err => console.error('[bro.js] Error starting studio:', err));
} else if (command === 'dev' || command === 'start') {
  bootstrap();
} else if (!['init', 'doctor'].includes(command)) {
  console.log(`\n  ${colors.bold}${colors.green}bro.js CLI${colors.reset}\n`);
  console.log(`  ${colors.bold}Usage:${colors.reset} bro <command>\n`);
  console.log(`  ${colors.bold}Commands:${colors.reset}`);
  console.log(`    ${colors.cyan}dev${colors.reset}      Start the development server with hot-reload`);
  console.log(`    ${colors.cyan}start${colors.reset}    Start the production server gracefully`);
  console.log(`    ${colors.cyan}init${colors.reset}     Scaffold a new bro.config.js workspace`);
  console.log(`    ${colors.cyan}sdk${colors.reset}      Generate a typed frontend client`);
  console.log(`    ${colors.cyan}studio${colors.reset}   Generate TS client, OpenAPI, and MSW mocks`);
  console.log(`    ${colors.cyan}doctor${colors.reset}   Diagnose security and configuration issues`);
  console.log(`    ${colors.cyan}test${colors.reset}     Run tests using vitest\n`);
}
