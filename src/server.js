import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { apiReference } from '@scalar/express-api-reference';
import { verifyJwt, signJwt } from './auth.js';
import { loadLocale } from './locale.js';
import { loadRoutes } from './router.js';
import { scanTasks } from './tasks.js';

/**
 * Creates and configures the core Express server.
 * @param {Object} globalConfig - User's bro.config.js configurations.
 * @param {string} routesDir - Path to the target routes directory.
 * @param {any} db - Initialized database instance.
 * @returns {Promise<{ app: import('express').Application, server: http.Server, routes: Array, reload: Function, reloadLocale: Function, io: import('socket.io').Server, shutdown: Function }>}
 */
export async function createServer(globalConfig, routesDir, db) {
  if (process.env.NODE_ENV === 'production' && ['dev_secret_please_change', 'bro_default_secret_key'].includes(globalConfig.jwtSecret)) {
    throw new Error('CRITICAL SECURITY ERROR: You are running in production with a default JWT secret! Please set auth.jwtSecret in bro.config.js or via JWT_SECRET environment variable.');
  }

  const app = express();
  const server = http.createServer(app);
  const localeDirectory = globalConfig.locale?.directory || path.join(process.cwd(), 'locale');
  let locale = await loadLocale(localeDirectory, globalConfig.locale);
  
  const corsConfig = globalConfig.server?.cors !== undefined ? globalConfig.server.cors : true;
  
  if (corsConfig !== false) {
    app.use(cors(typeof corsConfig === 'object' ? corsConfig : {}));
  }
  
  app.use(express.json());
  
  if (globalConfig.rateLimit) {
    app.use(rateLimit(globalConfig.rateLimit));
  }
  
  const io = new Server(server, { cors: typeof corsConfig === 'object' ? corsConfig : undefined });
  
  if (globalConfig.sockets) {
    await globalConfig.sockets(io, db);
  }
  const createHandler = (routeConfig) => {
    const middlewares = [];
    if (routeConfig.schema) {
      throw new Error("Nested 'schema' object is no longer supported in bro.js v2.3.0+. Please use flat, top-level properties (body, query, params) instead.");
    }
    const bodySchema = routeConfig.body;
    const paramsSchema = routeConfig.params;
    const querySchema = routeConfig.query;
    
    if (routeConfig.rateLimit) {
      middlewares.push(rateLimit(routeConfig.rateLimit));
    }
    
    if (routeConfig.upload) {
      const defaultLimits = { fileSize: 10 * 1024 * 1024, files: 5, fields: 20, parts: 25, fieldSize: 1024 * 1024 };
      const routeMulterConfig = {
        limits: { ...defaultLimits, ...(globalConfig.upload?.limits || {}) }
      };
      if (typeof routeConfig.upload === 'object') {
        if (routeConfig.upload.limits) {
          routeMulterConfig.limits = { ...routeMulterConfig.limits, ...routeConfig.upload.limits };
        }
        if (routeConfig.upload.fileFilter) routeMulterConfig.fileFilter = routeConfig.upload.fileFilter;
        if (routeConfig.upload.storage) routeMulterConfig.storage = routeConfig.upload.storage;
      }
      
      const uploadParser = multer(routeMulterConfig);
      
      if (typeof routeConfig.upload === 'object' && routeConfig.upload.fields) {
        middlewares.push(uploadParser.fields(routeConfig.upload.fields));
      } else if (typeof routeConfig.upload === 'object' && routeConfig.upload.single) {
        middlewares.push(uploadParser.single(routeConfig.upload.single));
      } else if (typeof routeConfig.upload === 'object' && routeConfig.upload.array) {
        middlewares.push(uploadParser.array(routeConfig.upload.array));
      } else {
        middlewares.push(uploadParser.any());
      }
    }
    
    middlewares.push(async (req, res) => {
      try {
        const requestLocale = locale.resolveLocale(req);
        const ctx = {
          env: globalConfig.envData || process.env,
          db,
          io,
          body: req.body,
          params: req.params,
          query: req.query,
          files: req.files || req.file,
          locale: requestLocale,
          t: (key, values) => locale.translate(requestLocale, key, values),
          user: null,
          jwt: { sign: (payload, opts) => signJwt(payload, globalConfig.jwtSecret, opts || { expiresIn: globalConfig.auth?.expiresIn || '1d' }) },
          error: (status, message) => {
             const err = new Error(message);
             err.status = status;
             throw err;
          }
        };

        const authHeader = req.headers.authorization;
        if ((!authHeader || !authHeader.startsWith('Bearer ')) && routeConfig.auth) {
          return res.status(401).json({ error: 'Unauthorized', details: 'Missing or invalid Bearer token' });
        }
        
        const token = authHeader?.split(' ')[1] ?? '';
        const authResult = verifyJwt(token, globalConfig.jwtSecret);
        
        if (!authResult.valid && routeConfig.auth) {
          return res.status(401).json({ error: 'Unauthorized', details: authResult.error });
        }
        ctx.user = authResult?.payload ?? null;

        if (paramsSchema) {
          const result = paramsSchema.safeParse(req.params);
          if (!result.success) {
            return res.status(400).json({ error: 'Invalid URL Parameters', details: result.error.flatten() });
          }
          ctx.params = result.data;
        }
        
        if (bodySchema) {
          const result = bodySchema.safeParse(req.body);
          if (!result.success) {
            return res.status(400).json({ error: 'Invalid Request Body', details: result.error.flatten() });
          }
          ctx.body = result.data;
        }

        if (querySchema) {
           const result = querySchema.safeParse(req.query);
           if (!result.success) {
             return res.status(400).json({ error: 'Invalid Query Parameters', details: result.error.flatten() });
           }
           ctx.query = result.data;
        }

        if (typeof routeConfig.handler !== 'function') {
           throw new Error('Route "handler" is missing or is not a function');
        }

        const responseData = await routeConfig.handler(ctx);
        
        if (!res.headersSent) {
           res.status(200).json(responseData);
        }

      } catch (err) {
        const status = err.status || 500;
        const message = status === 500 ? 'Internal Server Error' : err.message;
        
        if (status === 500) {
          console.error(`[bro.js] Execution Error in route:`);
          console.error(err.stack);
        }
        
        if (!res.headersSent) {
          res.status(status).json({ 
            error: message, 
            ...(status !== 500 && err.details ? { details: err.details } : {}) 
          });
        }
      }
    });
    
    return middlewares;
  };

  let openApiSpec = {
    openapi: '3.0.0',
    info: { title: 'bro.js API', version: '1.0.0' },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      responses: {
        BadRequest: { description: 'Bad Request', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
        Unauthorized: { description: 'Unauthorized', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
        NotFound: { description: 'Not Found', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
        ServerError: { description: 'Internal Server Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } }
      }
    },
    paths: {}
  };

  const shouldMountDocs = globalConfig.docs !== false && (globalConfig.docs === true || typeof globalConfig.docs === 'object' || process.env.NODE_ENV !== 'production');

  if (shouldMountDocs) {
    const docsAuthMiddleware = (req, res, next) => {
      if (typeof globalConfig.docs === 'object' && globalConfig.docs.auth) {
        const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
        const [user, pass] = Buffer.from(b64auth, 'base64').toString().split(':');
        
        if (user === globalConfig.docs.auth.user && pass === globalConfig.docs.auth.pass) {
          return next();
        }
        
        res.set('WWW-Authenticate', 'Basic realm="bro.js API Docs"');
        return res.status(401).send('Authentication required.');
      }
      next();
    };

    app.get('/docs/json', docsAuthMiddleware, (req, res) => res.json(openApiSpec));
    app.use('/docs', docsAuthMiddleware, apiReference({ spec: { url: '/docs/json' } }));
  }

  let routeStack = express.Router();
  
  app.use((req, res, next) => {
    routeStack(req, res, next);
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  app.use((err, req, res, next) => {
    console.error(`[bro.js] Uncaught Error:`, err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  });

  const reload = async () => {
    const newRouter = express.Router();
    const tempSpec = { paths: {} };
    const routes = await loadRoutes(newRouter, routesDir, createHandler, tempSpec);
    openApiSpec.paths = tempSpec.paths;
    routeStack = newRouter;
    return routes;
  };

  const reloadLocale = async () => {
    locale = await loadLocale(localeDirectory, globalConfig.locale);
    return locale;
  };

  const initialRoutes = await reload();

  const taskManager = await scanTasks({ db, io });

  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    if (taskManager) taskManager.stopAll();
    if (io) io.close();
    
    if (typeof globalConfig.onShutdown === 'function') {
      try {
        await globalConfig.onShutdown(db);
      } catch (err) {
        console.error('[bro.js] Error during database teardown hook:', err);
      }
    }

    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  };

  return { app, server, routes: initialRoutes, reload, reloadLocale, io, shutdown };
}
