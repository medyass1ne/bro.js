import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { Server } from 'socket.io';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { apiReference } from '@scalar/express-api-reference';
import { verifyJwt, signJwt, setJwtSecret } from './auth.js';
import { loadRoutes } from './router.js';

const upload = multer();

/**
 * Creates and configures the core Express server.
 * @param {Object} globalConfig - User's bro.config.js configurations.
 * @param {string} routesDir - Path to the target routes directory.
 * @param {any} db - Initialized database instance.
 * @returns {Promise<{ app: import('express').Application, server: http.Server, routes: Array, reload: Function, io: import('socket.io').Server }>}
 */
export async function createServer(globalConfig, routesDir, db) {
  const app = express();
  const server = http.createServer(app);
  
  const corsConfig = globalConfig.server?.cors !== undefined ? globalConfig.server.cors : true;
  
  app.use(cors(typeof corsConfig === 'object' ? corsConfig : {}));
  app.use(express.json());
  
  if (globalConfig.rateLimit) {
    app.use(rateLimit(globalConfig.rateLimit));
  }
  
  const io = new Server(server, { cors: typeof corsConfig === 'object' ? corsConfig : undefined });
  
  if (globalConfig.sockets) {
    await globalConfig.sockets(io, db);
  }
  
  if (globalConfig.jwtSecret) {
    setJwtSecret(globalConfig.jwtSecret);
  }

  const createHandler = (routeConfig) => {
    const middlewares = [];
    
    if (routeConfig.rateLimit) {
      middlewares.push(rateLimit(routeConfig.rateLimit));
    }
    
    if (routeConfig.upload) {
      middlewares.push(upload.any());
    }
    
    middlewares.push(async (req, res) => {
      try {
        const ctx = {
          db,
          io,
          body: req.body,
          params: req.params,
          query: req.query,
          files: req.files || req.file,
          user: null,
          jwt: { sign: signJwt },
          error: (status, message) => {
             const err = new Error(message);
             err.status = status;
             throw err;
          }
        };

        if (routeConfig.auth) {
          const authHeader = req.headers.authorization;
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized', details: 'Missing or invalid Bearer token' });
          }
          
          const token = authHeader.split(' ')[1];
          const authResult = verifyJwt(token);
          
          if (!authResult.valid) {
            return res.status(401).json({ error: 'Unauthorized', details: authResult.error });
          }
          
          ctx.user = authResult.payload;
        }

        if (routeConfig.params) {
          const result = routeConfig.params.safeParse(req.params);
          if (!result.success) {
            return res.status(400).json({ error: 'Invalid URL Parameters', details: result.error.flatten() });
          }
          ctx.params = result.data;
        }
        
        if (routeConfig.body) {
          const result = routeConfig.body.safeParse(req.body);
          if (!result.success) {
            return res.status(400).json({ error: 'Invalid Request Body', details: result.error.flatten() });
          }
          ctx.body = result.data;
        }

        if (routeConfig.query) {
           const result = routeConfig.query.safeParse(req.query);
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

  const reload = async () => {
    const newRouter = express.Router();
    openApiSpec.paths = {};
    const routes = await loadRoutes(newRouter, routesDir, createHandler, openApiSpec);
    routeStack = newRouter;
    return routes;
  };

  const initialRoutes = await reload();

  return { app, server, routes: initialRoutes, reload, io };
}
