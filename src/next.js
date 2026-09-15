import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyJwt, signJwt } from './auth.js';
import { createClient } from 'redis';

export function createBro(globalConfig = {}) {
  let isInitialized = false;
  let initPromise = null;

  let globalDb = null;
  let globalRedis = null;
  let globalLocale = null;

  async function ensureInitialized() {
    if (isInitialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        // Locale Dummy or Real
        if (globalConfig.locale && typeof globalConfig.locale.resolveLocale === 'function') {
          globalLocale = globalConfig.locale;
        } else {
          globalLocale = {
            resolveLocale: () => 'en',
            translate: (locale, key) => key
          };
        }

        // DB
        if (typeof globalConfig.db === 'function') {
          globalDb = await globalConfig.db();
        } else if (globalConfig.db && typeof globalConfig.db.init === 'function') {
          globalDb = await globalConfig.db.init();
        } else if (globalConfig.db) {
          globalDb = globalConfig.db;
          if (globalDb instanceof Promise) globalDb = await globalDb;
        }

        // Redis
        if (globalConfig.redisUrl) {
          globalRedis = createClient({ url: globalConfig.redisUrl });
          globalRedis.on('error', (err) => console.error('[bro.js/next] Redis Error:', err));
          if (globalRedis.status === 'wait' || !globalRedis.status) {
             await globalRedis.connect().catch(err => {
                if (!err.message.includes('already connecting') && !err.message.includes('already connected')) {
                  throw err;
                }
             });
          }
        }

        isInitialized = true;
      } catch (err) {
        console.error('[bro.js/next] Initialization Error:', err);
        throw err;
      }
    })();

    return initPromise;
  }

  const errorHelper = (status, message) => {
    const err = new Error(message);
    err.status = status;
    throw err;
  };

  function defineRoute(config) {
    return async function (req, context) {
      try {
        await ensureInitialized();

        const rawParams = context?.params ? await context.params : {};
        
        const url = new URL(req.url);
        const rawQuery = Object.fromEntries(url.searchParams.entries());
        
        let rawBody = {};
        const parsedFiles = {};
        let totalFiles = 0;
        
        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
          const contentType = req.headers.get('content-type') || '';
          
          if (contentType.includes('multipart/form-data')) {
             try {
                const formData = await req.formData();
                for (const [key, value] of formData.entries()) {
                   if (value instanceof File || value instanceof Blob) {
                      if (!parsedFiles[key]) parsedFiles[key] = [];
                      parsedFiles[key].push(value);
                      totalFiles++;
                   } else {
                      rawBody[key] = value;
                   }
                }
             } catch (err) {}
          } else {
            try {
              rawBody = await req.json();
            } catch (err) {}
          }
        }

        let body, params, query;
        try {
          if (config.body) body = await config.body.parseAsync(rawBody);
          if (config.params) params = await config.params.parseAsync(rawParams);
          if (config.query) query = await config.query.parseAsync(rawQuery);
        } catch (err) {
          if (err instanceof z.ZodError) {
            return NextResponse.json(
              { error: 'Validation Error', issues: err.issues },
              { status: 400 }
            );
          }
          throw err;
        }

        let user = null;
        if (config.auth) {
          if (config.auth === 'api-key') {
            const apiKey = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');
            const configuredKey = globalConfig?.auth?.apiKey || process.env.API_KEY;
            
            let isValid = false;
            if (configuredKey) {
              const keys = (Array.isArray(configuredKey) ? configuredKey : configuredKey.split(',')).map(k => String(k).trim());
              isValid = keys.includes(apiKey);
            }
            
            if (!isValid) {
              return NextResponse.json({ error: 'Unauthorized', details: 'Missing or invalid API key' }, { status: 401 });
            }
          } else {
            const authHeader = req.headers.get('authorization');
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return NextResponse.json({ error: 'Unauthorized', details: 'Missing Bearer token' }, { status: 401 });
            }
            
            const token = authHeader.split(' ')[1];
            const secret = globalConfig?.auth?.jwtSecret || process.env.JWT_SECRET;
            
            if (!secret) {
               return NextResponse.json({ error: 'Internal Server Error', details: 'JWT_SECRET is not configured' }, { status: 500 });
            }
            
            const decoded = verifyJwt(token, secret);
            if (!decoded.valid) {
              return NextResponse.json({ error: 'Unauthorized', details: decoded.error }, { status: 401 });
            }
            
            user = decoded.payload;
            
            if (Array.isArray(config.auth) && config.auth.length > 0) {
              if (!user.role || !config.auth.includes(user.role)) {
                return NextResponse.json({ error: 'Forbidden', details: 'Insufficient permissions' }, { status: 403 });
              }
            }
          }
        }

        const resolvedLocale = globalLocale.resolveLocale({ headers: Object.fromEntries(req.headers.entries()) });
        
        let ctxFile = undefined;
        let ctxFiles = undefined;
        if (totalFiles === 1) {
          const keys = Object.keys(parsedFiles);
          ctxFile = parsedFiles[keys[0]][0];
          ctxFiles = parsedFiles;
        } else if (totalFiles > 1) {
          ctxFiles = parsedFiles;
        }

        const ctx = {
          req,
          env: process.env,
          db: globalDb,
          redis: globalRedis,
          io: { emit: () => console.warn('[bro.js/next] WebSockets require standard bro.js server.') },
          body,
          params,
          query,
          file: ctxFile,
          files: ctxFiles,
          locale: resolvedLocale,
          t: (key, values) => globalLocale.translate(resolvedLocale, key, values),
          user,
          jwt: { sign: (payload, opts) => signJwt(payload, globalConfig?.auth?.jwtSecret || process.env.JWT_SECRET, opts) },
          error: errorHelper
        };

        const result = await config.handler(ctx);
        return NextResponse.json(result, { status: 200 });

      } catch (error) {
        if (error.status) {
           return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error('[bro.js/next] Unhandled Error:', error);
        return NextResponse.json(
          { error: 'Internal Server Error', message: error.message },
          { status: 500 }
        );
      }
    };
  }

  return { defineRoute, z };
}
