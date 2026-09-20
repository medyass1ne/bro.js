import { z } from 'zod';
import { verifyJwt, signJwt } from './auth.js';
import { executeRequest, RouteRegistry, resolveIdentity } from './engine.js';

export async function hashIdentity(identity) {
  const encoder = new TextEncoder();
  const data = encoder.encode(String(identity));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
export function generateRateLimitKey(req, config, prefix = 'route') { const identity = resolveIdentity(req, config); return `bro:rate_limit:${prefix}:${originalUrl}:${hashIdentity(identity)}`; }
export function generateCacheKey(req, config, locale) { const identity = resolveIdentity(req, config); return `bro:cache:${method}:${originalUrl}:${locale}:${hashIdentity(identity)}`; }

export { z };

export function createBro(globalConfig = {}) {
  const globalLogger = { info: console.log, debug: console.debug, warn: console.warn, error: console.error };

  let isInitialized = false;
  let initPromise = null;

  let globalDb = null;
  let globalLocale = null;
  const routeRegistry = new RouteRegistry();
  
  const __broRedis = null;
  const __broMemoryCache = new Map();
  const __broMemoryRateLimit = new Map();

  async function ensureInitialized() {
    if (isInitialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        if ((typeof process !== 'undefined' ? process.env : {}).NODE_ENV === 'production' && ['dev_secret_please_change', 'bro_default_secret_key', 'your_jwt_secret_here'].includes(globalConfig.auth?.jwtSecret)) {
          throw new Error('CRITICAL SECURITY ERROR: You are running in production with a default JWT secret!');
        }

        if (globalConfig.env) {
          try {
            globalConfig.env.parse((typeof process !== 'undefined' ? process.env : {}));
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

        // Redis is not supported natively in edge.js. Provide via globalConfig.redis client.

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
    // Register route for OpenAPI in Next environments
    routeRegistry.register(config);

    return async function (req, context) {
      try {
        await ensureInitialized();

        const resolvedLocale = resolveLocale(Object.fromEntries(req.headers.entries()));
        const url = new URL(req.url);
        
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

        let ctxFile = undefined;
        let ctxFiles = undefined;
        if (totalFiles === 1) {
          const keys = Object.keys(parsedFiles);
          ctxFile = parsedFiles[keys[0]][0];
          ctxFiles = parsedFiles;
        } else if (totalFiles > 1) {
          ctxFiles = parsedFiles;
        }

        const requestData = {
          method: req.method,
          originalUrl: url.pathname + url.search,
          headers: Object.fromEntries(req.headers.entries()),
          body: rawBody,
          query: Object.fromEntries(url.searchParams.entries()),
          params: context?.params ? await context.params : {},
          files: ctxFiles || ctxFile,
          ip: req.headers.get('x-forwarded-for') || 'ip',
          locale: resolvedLocale
        };

        let redisFallback = __broRedis;
        if (!redisFallback) {
          redisFallback = {
            async get(key) {
               const cached = __broMemoryCache.get(key);
               if (cached && Date.now() < cached.expires) return JSON.stringify(cached.data);
               return null;
            },
            async setEx(key, ex, val) {
               __broMemoryCache.set(key, { data: JSON.parse(val), expires: Date.now() + (ex * 1000) });
            },
            async del(key) { __broMemoryCache.delete(key); },
            async incr(key) {
               const now = Date.now();
               let record = __broMemoryRateLimit.get(key);
               if (!record || now > record.expires) record = { count: 0, expires: now + 60000 };
               record.count++;
               __broMemoryRateLimit.set(key, record);
               return record.count;
            },
            async expire(key, ex) {
               let record = __broMemoryRateLimit.get(key);
               if (record) {
                 record.expires = Date.now() + (ex * 1000);
                 __broMemoryRateLimit.set(key, record);
               }
            }
          };
        }

        const ctxExtras = {
          verifyJwt,
          generateRateLimitKey,
          generateCacheKey,
          generateId: () => crypto.randomUUID(),
          req, // Native NextRequest
          db: globalDb,
          redis: redisFallback,
          io: { emit: () => console.warn('[bro.js/next] WebSockets require standard bro.js server.') },
          t: (key, values) => translate(resolvedLocale, key, values),
          logger: globalLogger,
          jwt: { sign: (payload, opts) => signJwt(payload, globalConfig?.auth?.jwtSecret || (typeof process !== 'undefined' ? process.env : {}).JWT_SECRET, Object.assign({ expiresIn: globalConfig?.auth?.expiresIn || '1d' }, opts || {})) },
          error: errorHelper
        };

        const response = await executeRequest(config, requestData, globalConfig, ctxExtras);

        return Response.json(response.body, { 
           status: response.status, 
           headers: response.headers 
        });

      } catch (error) {
        console.error('[bro.js/next] Unhandled Error:', error);
        return Response.json(
          { 
            type: 'https://brojs.dev/errors/internal_server_error',
            title: 'Internal Server Error',
            status: 500,
            instance: req.url,
            requestId: req.headers.get('x-request-id') || 'unknown',
            detail: error.message || 'An unexpected error occurred'
          },
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } }
        );
      }
    };
  }

  return { defineRoute, z };
}
