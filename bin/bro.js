#!/usr/bin/env node

import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { register } from 'tsx/esm/api';

register();

import { createServer } from '../src/server.js';
import { colors, printBanner, printRoute, printHotReload } from '../src/logger.js';
import { scanTasks } from '../src/tasks.js';
import { generateSDK } from '../src/sdk.js';
import dotenv from 'dotenv';
import chokidar from 'chokidar';

dotenv.config();

const command = process.argv[2] || 'dev';

if (command === 'dev') {
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
} else if (command === 'start') {
  process.env.NODE_ENV = 'production';
}

const CONFIG_TEMPLATE = `import { defineConfig } from 'bro-framework';

export default defineConfig({
  // Server Settings
  server: {
    port: 5000,
    cors: true // Set to true to allow all, or pass a CORS options object
  },

  // Authentication Settings
  auth: {
    jwtSecret: 'dev_secret_please_change',
    expiresIn: '7d'
  },
  
  // API Documentation (Scalar UI)
  docs: process.env.NODE_ENV !== 'production', // Set to false to disable completely, or true to force in prod

  // Rate Limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
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
  
  // WebSockets Setup
  sockets: async (io, db) => {
    io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);
    });
  }
});
`;

function scaffoldConfig() {
  const configPath = path.join(process.cwd(), 'bro.config.js');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, CONFIG_TEMPLATE, 'utf-8');
    console.log(`\n  ${colors.green} Created default bro.config.js${colors.reset}\n`);
  }
}

function ensureTypeModule() {
  const pkgPath = path.join(process.cwd(), 'package.json');
  
  if (fs.existsSync(pkgPath)) {
    try {
      const pkgRaw = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgRaw);
      
      if (pkg.type !== 'module') {
        pkg.type = 'module';
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
        console.log(`\n  ${colors.green} Auto-configured package.json for ES Modules${colors.reset}`);
      }
    } catch (err) {
      console.error(`\n  ${colors.red} Failed to parse package.json for ES Modules setup${colors.reset}`, err);
    }
  } else {
    const defaultPkg = {
      name: "bro-app",
      version: "1.0.0",
      type: "module",
      private: true
    };
    fs.writeFileSync(pkgPath, JSON.stringify(defaultPkg, null, 2), 'utf-8');
    console.log(`\n  ${colors.green} Created package.json with ES Modules enabled${colors.reset}`);
  }
}

if (command === 'init') {
  ensureTypeModule();
  scaffoldConfig();
  process.exit(0);
}

if (['sdk', 'generate-client', 'client'].includes(command)) {
  generateSDK().then(() => {
    console.log(`\n  ${colors.green}✨ bro-client.js generated successfully!${colors.reset}\n`);
    process.exit(0);
  }).catch(err => {
    console.error(`\n  ${colors.red}❌ Error generating SDK:${colors.reset}`, err.message);
    process.exit(1);
  });
}

async function bootstrap() {
  if (command === 'dev') {
    ensureTypeModule();
    scaffoldConfig();
  }

  const startTime = performance.now();
  
  const cwd = process.cwd();
  const configPath = path.join(cwd, 'bro.config.js');
  const routesDir = path.join(cwd, 'routes');
  
  let globalConfig = {
    port: process.env.PORT || 5000,
    jwtSecret: process.env.JWT_SECRET || 'dev_secret_please_change'
  };

  let db = null;

  if (fs.existsSync(configPath)) {
    try {
      const configModule = await import(pathToFileURL(configPath).href);
      const userConfig = configModule.default || configModule.config || {};
      
      if (userConfig.server?.port) globalConfig.port = userConfig.server.port;
      if (userConfig.auth?.jwtSecret) globalConfig.jwtSecret = userConfig.auth.jwtSecret;
      
      globalConfig = { ...globalConfig, ...userConfig };
      
      if (typeof globalConfig.db === 'function') {
        db = await globalConfig.db();
      } else if (globalConfig.db && typeof globalConfig.db.init === 'function') {
        db = await globalConfig.db.init();
      } else if (globalConfig.db) {
        db = globalConfig.db;
        if (db instanceof Promise) db = await db;
      }
    } catch (err) {
      console.error('✗ Failed to load bro.config.js:', err);
    }
  }

  if (globalConfig.env) {
    const envResult = globalConfig.env.safeParse(process.env);
    if (!envResult.success) {
      console.error(`\n  ${colors.red}❌ Environment Validation Failed${colors.reset}`);
      envResult.error.errors.forEach(err => {
        console.error(`  ${colors.dim}-${colors.reset} ${colors.bold}${err.path.join('.')}${colors.reset}: ${err.message}`);
      });
      console.error("");
      process.exit(1);
    }
  }

  if (!fs.existsSync(routesDir)) {
    console.error(`✗ Error: 'routes' directory not found in ${cwd}`);
    console.error(`  Please create a 'routes/' folder and add your first route.`);
    process.exit(1);
  }

  const { app, server, routes: initialRoutes, reload, io } = await createServer(globalConfig, routesDir, db);
  const port = globalConfig.port;
  
  let currentRoutes = initialRoutes;
  
  server.listen(port, async () => {
    if (command === 'dev') {
      console.clear();
      printBanner(port, performance.now() - startTime);
    } else if (command === 'start') {
      console.log(`[bro.js] Server running in production on port ${port}`);
    }
    
    await scanTasks({ db, io });
    
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

      const watcher = chokidar.watch(routesDir, { ignoreInitial: true });
      
      watcher.on('all', async (event, filepath) => {
        if (!filepath.endsWith('.js') && !filepath.endsWith('.ts')) return;
        
        try {
          const reloadStartTime = performance.now();
          currentRoutes = await reload();
          const reloadTimeMs = performance.now() - reloadStartTime;
          
          printHotReload(path.basename(filepath), event, reloadTimeMs);
          printCurrentRoutes(currentRoutes);
        } catch (err) {
          console.error(`\n  ✗ Error hot-reloading routes:`, err);
        }
      });
    }
  });
}

if (command === 'dev' || command === 'start') {
  bootstrap();
} else {
  console.log(`Usage: bro dev | bro start | bro init`);
}
