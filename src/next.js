import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyJwt, signJwt } from './auth.js';
import { createClient } from 'redis';

export { z };

export function createBro(globalConfig = {}) {
  let isInitialized = false;
  let initPromise = null;

  let globalDb = null;
  let globalLocale = null;
  
  const globalStore = globalThis;
  globalStore.__broRedis = globalStore.__broRedis || null;
  globalStore.__broMemoryCache = globalStore.__broMemoryCache || new Map();
  globalStore.__broMemoryRateLimit = globalStore.__broMemoryRateLimit || new Map();

  async function ensureInitialized() {
    if (isInitialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        if (globalConfig.env) {
          try {
            globalConfig.env.parse(process.env);
          } catch (err) {
            console.error('[bro.js/next] Environment Validation Error:', err);
            throw err;
          }
        }

        if (typeof globalConfig.db === 'function') {
          globalDb = await globalConfig.db();
        } else if (globalConfig.db && typeof globalConfig.db.init === 'function') {
          globalDb = await globalConfig.db.init();
        } else if (globalConfig.db) {
          globalDb = globalConfig.db;
          if (globalDb instanceof Promise) globalDb = await globalDb;
        }

        if (globalConfig.redisUrl) {
          globalStore.__broRedis = createClient({ url: globalConfig.redisUrl });
          globalStore.__broRedis.on('error', (err) => console.error('[bro.js/next] Redis Error:', err));
          if (!globalStore.__broRedis.isOpen) {
             await globalStore.__broRedis.connect().catch(err => {
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

  const resolveLocale = (headers) => {
    const acceptLanguage = headers['accept-language'] || '';
    const preferredLanguages = acceptLanguage
      .split(',')
      .map(lang => lang.split(';')[0].trim().toLowerCase())
      .filter(lang => lang);
    
    const configuredLocales = Object.keys(globalConfig.locales || {});
    
    for (const lang of preferredLanguages) {
      if (configuredLocales.includes(lang)) {
        return lang;
      }
      const baseLang = lang.split('-')[0];
      if (configuredLocales.includes(baseLang)) {
        return baseLang;
      }
    }
    
    return globalConfig.defaultLocale || 'en';
  };

  const translate = (locale, key, values = {}) => {
    let messages = globalConfig.locales?.[locale] || globalConfig.locales?.[globalConfig.defaultLocale || 'en'];
    if (!messages) return key;

    // Handle Webpack / ES module JSON interop where the object is under .default
    if (messages.default && typeof messages.default === 'object') {
      messages = messages.default;
    }

    const message = key.split('.').reduce((acc, part) => acc && acc[part], messages);
    if (!message || typeof message !== 'string') return key;

    return message.replace(/\{(\w+)\}/g, (_, name) => {
      return values[name] !== undefined ? String(values[name]) : `{${name}}`;
    });
  };

  const errorHelper = (status, message) => {
    const err = new Error(message);
    err.status = status;
    throw err;
  };

  function defineRoute(config) {
    return async function (req, context) {
      try {
        await ensureInitialized();

        const resolvedLocale = resolveLocale(Object.fromEntries(req.headers.entries()));

        // Auth extraction early for Identity caching
        let user = null;
        let apiKeyUsed = null;
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
            apiKeyUsed = apiKey;
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

        // Rate Limiting
        const activeRateLimit = config.rateLimit === false ? null : (config.rateLimit || globalConfig.rateLimit);
        if (activeRateLimit) {
          const ip = req.headers.get('x-forwarded-for') || 'ip';
          const urlObj = new URL(req.url);
          const rlKey = `rate-limit:${urlObj.pathname}:${ip}`;
          
          if (globalStore.__broRedis) {
            const currentCount = await globalStore.__broRedis.incr(rlKey);
            if (currentCount === 1) {
              await globalStore.__broRedis.expire(rlKey, Math.ceil(activeRateLimit.windowMs / 1000));
            }
            if (currentCount > activeRateLimit.max) {
              return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
            }
          } else {
            const now = Date.now();
            let record = globalStore.__broMemoryRateLimit.get(rlKey);
            
            if (!record || now > record.expires) {
              record = { count: 0, expires: now + activeRateLimit.windowMs };
            }
            
            record.count++;
            globalStore.__broMemoryRateLimit.set(rlKey, record);
            
            if (record.count > activeRateLimit.max) {
              return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
            }
          }
        }

        // Caching
        let cacheKey = null;
        if (config.cache && req.method === 'GET') {
          const urlObj = new URL(req.url);
          const identity = user ? (user.id || user.role || 'user') : (apiKeyUsed || 'anon');
          cacheKey = `cache:${urlObj.pathname}${urlObj.search}:${resolvedLocale}:${identity}`;
          
          if (globalStore.__broRedis) {
            const cachedData = await globalStore.__broRedis.get(cacheKey);
            if (cachedData) {
              return NextResponse.json(JSON.parse(cachedData), { status: 200 });
            }
          } else {
            const cached = globalStore.__broMemoryCache.get(cacheKey);
            if (cached) {
              if (Date.now() < cached.expires) {
                return NextResponse.json(cached.data, { status: 200 });
              } else {
                globalStore.__broMemoryCache.delete(cacheKey);
              }
            }
          }
        }

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
        } catch (err) {
          if (err instanceof z.ZodError) return NextResponse.json({ error: 'Invalid Request Body', details: err.issues }, { status: 400 });
          throw err;
        }
        try {
          if (config.params) params = await config.params.parseAsync(rawParams);
        } catch (err) {
          if (err instanceof z.ZodError) return NextResponse.json({ error: 'Invalid URL Parameters', details: err.issues }, { status: 400 });
          throw err;
        }
        try {
          if (config.query) query = await config.query.parseAsync(rawQuery);
        } catch (err) {
          if (err instanceof z.ZodError) return NextResponse.json({ error: 'Invalid Query Parameters', details: err.issues }, { status: 400 });
          throw err;
        }

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
          redis: globalStore.__broRedis,
          io: { emit: () => console.warn('[bro.js/next] WebSockets require standard bro.js server.') },
          body,
          params,
          query,
          file: ctxFile,
          files: ctxFiles,
          locale: resolvedLocale,
          t: (key, values) => translate(resolvedLocale, key, values),
          user,
          jwt: { 
             sign: (payload, opts) => signJwt(payload, globalConfig?.auth?.jwtSecret || process.env.JWT_SECRET, Object.assign({ expiresIn: globalConfig?.auth?.expiresIn || '1d' }, opts || {})) 
          },
          error: errorHelper
        };

        const result = await config.handler(ctx);

        if (cacheKey) {
           if (globalStore.__broRedis) {
             await globalStore.__broRedis.set(cacheKey, JSON.stringify(result), { EX: config.cache });
           } else {
             globalStore.__broMemoryCache.set(cacheKey, { data: result, expires: Date.now() + (config.cache * 1000) });
           }
        }

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
