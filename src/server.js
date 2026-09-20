import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { Server } from 'socket.io';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import helmet from 'helmet';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { apiReference } from '@scalar/express-api-reference';
import { verifyJwt, signJwt } from './auth.js';
import { loadLocale } from './locale.js';
import { loadRoutes } from './router.js';
import { executeRequest, resolveIdentity, RouteRegistry } from './engine.js';

export function hashIdentity(identity) { return crypto.createHash('sha256').update(String(identity)).digest('hex'); }
export function generateRateLimitKey(req, config, prefix = 'route') { const identity = resolveIdentity(req, config); return `bro:rate_limit:${prefix}:${req.originalUrl || req.url}:${hashIdentity(identity)}`; }
export function generateCacheKey(req, config, locale) { const identity = resolveIdentity(req, config); return `bro:cache:${req.method}:${req.originalUrl || req.url}:${locale}:${hashIdentity(identity)}`; }
import { createLogger } from './logger.js';
import { PluginManager } from './plugins.js';
import { scanTasks } from './tasks.js';

/**
 * Creates and configures the core Express server.
 * @param {Object} globalConfig - User's bro.config.js configurations.
 * @param {string} routesDir - Path to the target routes directory.
 * @param {any} db - Initialized database instance.
 * @returns {Promise<{ app: import('express').Application, server: http.Server, routes: Array, reload: Function, reloadLocale: Function, io: import('socket.io').Server, shutdown: Function }>}
 */
export async function createServer(globalConfig, routesDir, db) {
  if (db && typeof db.isReady !== 'function') {
     throw new Error('[bro.js] CRITICAL: In v3.0.0, the \'db\' passed to createServer MUST extend BaseDatabaseAdapter and implement isReady(), transaction(), healthCheck(), and shutdown().');
  }
  const globalLogger = createLogger(globalConfig.logger || { level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' });

  if (process.env.NODE_ENV === 'production' && (!globalConfig.jwtSecret || globalConfig.jwtSecret.length < 32 || ['dev_secret_please_change', 'bro_default_secret_key', 'your_jwt_secret_here'].includes(globalConfig.jwtSecret))) {
    throw new Error('CRITICAL SECURITY ERROR: You are running in production without a secure JWT secret! Provide a secret of at least 32 characters.');
  }

    const routeRegistry = new RouteRegistry();
    const pluginManager = new PluginManager();
  if (Array.isArray(globalConfig.plugins)) {
    for (const plugin of globalConfig.plugins) {
      pluginManager.register(plugin);
    }
  }

  const app = express();
  await pluginManager.runOnInit(globalConfig, app);
  if (db) {
    if (!await db.isReady()) {
      throw new Error('[bro.js] Database adapter failed readiness check during boot.');
    }
  }
  const server = http.createServer(app);
  server.requestTimeout = globalConfig.server?.timeoutMs || 30000;
  server.headersTimeout = globalConfig.server?.headersTimeoutMs || 35000;
  const localeDirectory = globalConfig.locale?.directory || path.join(process.cwd(), 'locale');
  let locale = await loadLocale(localeDirectory, globalConfig.locale);
  
  const helmetConfig = globalConfig.server?.helmet !== undefined ? globalConfig.server.helmet : true;
  if (helmetConfig !== false) {
    const userConfig = typeof helmetConfig === 'object' ? helmetConfig : {};
    app.use(helmet({
      ...userConfig,
      contentSecurityPolicy: userConfig.contentSecurityPolicy ?? {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          "script-src": ["'self'", "'unsafe-inline'"],
          "style-src": ["'self'", "'unsafe-inline'"],
        },
      }
    }));
  }

  const corsConfig = globalConfig.server?.cors !== undefined ? globalConfig.server.cors : false;
  if (corsConfig === true) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL SECURITY ERROR: Permissive CORS (cors: true) is forbidden in production in v3.0.0. Provide an explicit origin allowlist.');
    }
    app.use(cors());
  } else if (corsConfig) {
    app.use(cors(corsConfig));
  }
  
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  const sendError = (res, status, message, details = null, req) => {
    let finalMessage = message;
    let finalDetails = details;
    if (status >= 500 && process.env.NODE_ENV === 'production') {
      finalMessage = 'Internal Server Error';
      finalDetails = null;
    }
    const codeMap = { 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 429: 'TOO_MANY_REQUESTS' };
    const code = codeMap[status] || (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');

    // v3.0.0 ALWAYS uses RFC 9457 Problem Details
    const payload = {
      type: `errors/${code.toLowerCase()}`,
      title: finalMessage,
      status,
      instance: req.originalUrl || req.url,
      requestId: req.id
    };
    if (finalDetails) {
      if (typeof finalDetails === 'string') payload.detail = finalDetails;
      else payload.errors = finalDetails;
    }
    return res.status(status).type('application/problem+json').json(payload);
  };

  const formatZodError = (error) => error.issues.map(i => ({ path: i.path.join('.'), message: i.message, code: i.code }));

  

  app.use(pluginManager.getRequestMiddleware());
  app.use(express.json());
  
  const safeConnect = async (client) => {
    if (typeof client.connect !== 'function') return;
    if (client.status && client.status !== 'wait') return;
    try {
      await client.connect();
    } catch (err) {
      if (!err.message.includes('already connecting') && !err.message.includes('already connected')) {
        throw err;
      }
    }
  };

  let redisClient = null;
  let pubClient = null;
  let subClient = null;
  
  try {
    if (globalConfig.redisUrl) {
      redisClient = createClient({ url: globalConfig.redisUrl });
      redisClient.on('error', (err) => console.error('[bro.js] Redis Error:', err));
      await safeConnect(redisClient);
    } else if (process.env.NODE_ENV === 'test') {
      try {
        const IORedisMock = (await import('ioredis-mock')).default;
        redisClient = new IORedisMock();
        redisClient.connect = async () => {};
        redisClient.setEx = redisClient.setex.bind(redisClient);
      } catch (err) {
        throw new Error("ioredis-mock is required for test mode. Please install it as a devDependency to use NODE_ENV=test.");
      }
    }
  } catch (err) {
    if (redisClient) await redisClient.quit().catch(() => {});
    throw err;
  }

  if (globalConfig.rateLimit) {
    if (redisClient) {
      const fallbackLimiter = rateLimit(globalConfig.rateLimit);
      app.use(async (req, res, next) => {
        try {
          const key = generateRateLimitKey(req, globalConfig, 'global');
          const current = await redisClient.incr(key);
          if (current === 1) {
            await redisClient.expire(key, Math.floor(globalConfig.rateLimit.windowMs / 1000));
          }
          if (current > globalConfig.rateLimit.max) {
            return sendError(res, 429, 'Too Many Requests', null, req);
          }
          next();
        } catch (err) {
          console.error('[bro.js] Redis Global Rate Limit Error:', err);
          fallbackLimiter(req, res, next);
        }
      });
    } else {
      app.use(rateLimit(globalConfig.rateLimit));
    }
  }
  
  const io = new Server(server, { cors: typeof corsConfig === 'object' ? corsConfig : undefined });
  
  try {
    if (redisClient) {
      pubClient = redisClient.duplicate();
      subClient = redisClient.duplicate();
      await Promise.all([safeConnect(pubClient), safeConnect(subClient)]);
      io.adapter(createAdapter(pubClient, subClient));
    }
  } catch (err) {
    await Promise.allSettled([
      redisClient?.quit(),
      pubClient?.quit(),
      subClient?.quit()
    ].filter(Boolean));
    throw err;
  }
  
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
      const requestData = {
        method: req.method,
        originalUrl: req.originalUrl,
        headers: req.headers,
        body: req.body,
        query: req.query,
        params: req.params,
        files: req.files || req.file,
        ip: req.ip,
        locale: locale.resolveLocale(req)
      };
      
      const ctxExtras = {
      verifyJwt,
      generateRateLimitKey,
      generateCacheKey,
      generateId: () => crypto.randomUUID(),
        req,
        res,
        db,
        redis: redisClient,
        io,
        pluginManager,
        t: (key, values) => locale.translate(requestData.locale, key, values),
        logger: globalLogger,
        jwt: { sign: (payload, opts) => signJwt(payload, globalConfig.jwtSecret, opts || { expiresIn: globalConfig.auth?.expiresIn || '1d' }) },
        error: (status, message) => {
          const err = new Error(message);
          err.status = status;
          throw err;
        },
        fixtures: globalConfig.fixtures || {},
        stores: globalConfig.stores || {}
      };

      const response = await executeRequest(routeConfig, requestData, globalConfig, ctxExtras);

      if (response.headers && !res.headersSent) {
        for (const [k, v] of Object.entries(response.headers)) {
          res.setHeader(k, v);
        }
      }

      if (!res.headersSent) {
        res.status(response.status).json(response.body);
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
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key'
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

  if (globalConfig.health) {
    app.get('/health/live', (req, res) => {
      res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    
    app.get('/health/ready', async (req, res) => {
      let isReady = true;
      const checks = {};
      
      const timeoutPromise = (ms, promise) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout')), ms);
          promise.then(val => { clearTimeout(timer); resolve(val); }).catch(err => { clearTimeout(timer); reject(err); });
        });
      };

      if (redisClient) {
        try {
          await timeoutPromise(2000, redisClient.ping());
          checks.redis = 'up';
        } catch (err) {
          checks.redis = 'down';
          isReady = false;
        }
      }
      
      if (globalConfig.health === true || typeof globalConfig.health.dbCheck !== 'function') {
         if (db) checks.db = 'unknown (provide health.dbCheck)';
      } else if (db) {
        try {
          await timeoutPromise(2000, globalConfig.health.dbCheck(db));
          checks.db = 'up';
        } catch (err) {
          checks.db = 'down';
          isReady = false;
        }
      }

      res.status(isReady ? 200 : 503).json({
        status: isReady ? 'ready' : 'unavailable',
        checks,
        timestamp: new Date().toISOString()
      });
    });
  }

  let routeStack = express.Router();
  
  app.use((req, res, next) => {
    routeStack(req, res, next);
  });

  app.use((req, res) => {
    sendError(res, 404, 'Not Found', null, req);
  });

  app.use(pluginManager.getErrorMiddleware());
  app.use((err, req, res, next) => {
    console.error(`[bro.js] Uncaught Error:`, err);
    sendError(res, err.status || 500, err.message || 'Internal Server Error', null, req);
  });

  const reload = async () => {
    const newRouter = express.Router();
    const tempSpec = { paths: {} };
    const routes = await loadRoutes(newRouter, routesDir, createHandler, tempSpec, routeRegistry);
    openApiSpec.paths = tempSpec.paths;
    routeStack = newRouter;
    return routes;
  };

  const reloadLocale = async () => {
    locale = await loadLocale(localeDirectory, globalConfig.locale);
    return locale;
  };

  const initialRoutes = await reload();

  let taskManager = await scanTasks({ db, io });

  const reloadTasks = async () => {
    if (taskManager) taskManager.stopAll();
    await pluginManager.runOnShutdown();
    taskManager = await scanTasks({ db, io });
  };

  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    if (taskManager) taskManager.stopAll();
    if (io) io.close();
    await Promise.allSettled([
      redisClient?.quit(),
      pubClient?.quit(),
      subClient?.quit()
    ].filter(Boolean));
    
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

  return { app, server, routes: initialRoutes, reload, reloadLocale, reloadTasks, io, shutdown };
}
