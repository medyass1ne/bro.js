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

  const corsConfig = globalConfig.server?.cors !== undefined ? globalConfig.server.cors : true;
  
  if (corsConfig !== false) {
    app.use(cors(typeof corsConfig === 'object' ? corsConfig : {}));
  }
  
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
          const key = `rate_limit:global:${req.ip}`;
          const current = await redisClient.incr(key);
          if (current === 1) {
            await redisClient.expire(key, Math.floor(globalConfig.rateLimit.windowMs / 1000));
          }
          if (current > globalConfig.rateLimit.max) {
            return res.status(429).json({ error: 'Too Many Requests' });
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
    
    if (routeConfig.rateLimit) {
      if (redisClient) {
        const fallbackLimiter = rateLimit(routeConfig.rateLimit);
        middlewares.push(async (req, res, next) => {
          try {
            const key = `rate_limit:${req.ip}:${req.originalUrl}`;
            const current = await redisClient.incr(key);
            if (current === 1) {
              await redisClient.expire(key, Math.floor(routeConfig.rateLimit.windowMs / 1000));
            }
            if (current > routeConfig.rateLimit.max) {
              return res.status(429).json({ error: 'Too Many Requests' });
            }
            next();
          } catch (err) {
            console.error('[bro.js] Redis Route Rate Limit Error:', err);
            fallbackLimiter(req, res, next);
          }
        });
      } else {
        middlewares.push(rateLimit(routeConfig.rateLimit));
      }
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
          redis: redisClient,
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

        if (routeConfig.auth === 'api-key') {
          const apiKey = req.headers['x-api-key'];
          const validKey = globalConfig.auth?.apiKey || process.env.API_KEY;
          
          let isValid = false;
          if (Array.isArray(validKey)) {
            isValid = validKey.includes(apiKey);
          } else {
            isValid = apiKey && apiKey === validKey;
          }
          
          if (!isValid) {
            return res.status(401).json({ error: 'Unauthorized', details: 'Missing or invalid API key' });
          }
        } else if (routeConfig.auth) {
          const authHeader = req.headers.authorization;
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized', details: 'Missing or invalid Bearer token' });
          }
          
          const token = authHeader?.split(' ')[1] ?? '';
          const authResult = verifyJwt(token, globalConfig.jwtSecret);
          
          if (!authResult.valid) {
            return res.status(401).json({ error: 'Unauthorized', details: authResult.error });
          }
          ctx.user = authResult.payload ?? null;
          
          if (Array.isArray(routeConfig.auth)) {
             if (!ctx.user || !ctx.user.role || !routeConfig.auth.includes(ctx.user.role)) {
                return res.status(403).json({ error: 'Forbidden', details: 'Insufficient role permissions' });
             }
          }
        }

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

        let cacheKey = null;
        if (routeConfig.cache && redisClient) {
          const authIdentity = crypto.createHash('sha256').update(req.headers.authorization || req.headers['x-api-key'] || 'anonymous').digest('hex');
          cacheKey = `bro:cache:${req.method}:${req.originalUrl}:${requestLocale}:${authIdentity}`;
          try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
              const parsed = JSON.parse(cached);
              if (!res.headersSent) res.status(200).json(parsed);
              return;
            }
          } catch (err) {
            console.error('[bro.js] Cache parsing failed, deleting key:', cacheKey);
            await redisClient.del(cacheKey).catch(() => {});
          }
        }

        const responseData = await routeConfig.handler(ctx);
        
        if (!res.headersSent) {
           if (cacheKey && routeConfig.cache) {
             await redisClient.setEx(cacheKey, routeConfig.cache, JSON.stringify(responseData));
           }
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

  return { app, server, routes: initialRoutes, reload, reloadLocale, io, shutdown };
}
