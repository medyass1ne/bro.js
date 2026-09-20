
import crypto from 'node:crypto';

export function resolveIdentity(req, config = {}) {
  const headers = req.headers || {};
  let ip = req.ip || (req.socket && req.socket.remoteAddress) || 'anonymous';

  const getHeader = (k) => {
    if (typeof headers.get === 'function') return headers.get(k);
    if (typeof headers[k] === 'string') return headers[k];
    if (Array.isArray(headers[k])) return headers[k][0];
    return null;
  };

  if (config.trustProxy) {
    const xff = getHeader('x-forwarded-for');
    if (xff) {
      const ips = xff.split(',').map(s => s.trim()).filter(Boolean);
      if (ips.length > 0) {
         ip = ips[0];
      }
    }
  }

  const auth = getHeader('authorization');
  return getHeader('x-api-key') || (auth && auth.startsWith('Bearer ') ? auth.split(' ')[1] : null) || ip;
}





export class RouteRegistry {
  constructor() {
    this.routes = [];
  }
  register(routeInfo) {
    this.routes.push(routeInfo);
  }
  getRoutes() {
    return this.routes;
  }
  reset() {
    this.routes = [];
  }
  clear() {
    this.routes = [];
  }
}

/**
 * Validates Zod errors into RFC 7807 problem details
 */
export function formatZodError(zodError) {
  const details = {};
  for (const err of zodError.errors) {
    details[err.path.join('.')] = err.message;
  }
  return details;
}

export function formatErrorEnvelope(status, title, details, reqId, instanceUrl = 'about:blank') {
  const codeMap = { 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 429: 'TOO_MANY_REQUESTS' };
  const code = codeMap[status] || (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');

  const payload = {
    type: `https://brojs.dev/errors/${code.toLowerCase()}`,
    title,
    status,
    instance: instanceUrl,
    requestId: reqId
  };
  
  if (details) {
    if (typeof details === 'string') payload.detail = details;
    else payload.errors = details;
  }
  
  return payload;
}

/**
 * The transport-agnostic execution pipeline.
 * @param {Object} routeConfig - The exported configuration from defineRoute.
 * @param {Object} requestData - Standardized request object: { method, originalUrl, headers, body, query, params, ip, files }
 * @param {Object} globalConfig - The global framework configuration.
 * @param {Object} ctxExtras - Additional context properties (e.g. db, redis, io, pluginManager).
 * @returns {Promise<{ status: number, body: any, headers: Record<string, string>, error?: Error }>}
 */
export async function executeRequest(routeConfig, requestData, globalConfig, ctxExtras) {
  const reqId = requestData.headers['x-request-id'] || (ctxExtras.generateId ? ctxExtras.generateId() : Date.now().toString());
  let responseHeaders = { 'X-Request-Id': reqId };
  let errorHeaders = { 'X-Request-Id': reqId, 'Content-Type': 'application/problem+json' };

  try {
    const ctx = {
      req: requestData.originalUrl,
      method: requestData.method,
      ip: requestData.ip,
      headers: requestData.headers,
      locale: requestData.locale,
      requestId: reqId,
      ...ctxExtras,
      env: globalConfig.envData || process.env,
      body: requestData.body,
      query: requestData.query,
      params: requestData.params,
      files: requestData.files,
      user: null
    };

    if (ctxExtras.pluginManager) {
      await ctxExtras.pluginManager.runOnContext(ctx);
    }

    // Rate Limiting Evaluation
    const activeRateLimit = routeConfig.rateLimit === false ? null : (routeConfig.rateLimit || globalConfig.rateLimit);
    const redisClient = ctxExtras.redis;

    if (activeRateLimit && redisClient) {
      const rlKey = generateRateLimitKey ? await generateRateLimitKey(requestData, globalConfig) : `bro:rl:${requestData.originalUrl}:${requestData.ip}`;
      try {
        const current = await redisClient.incr(rlKey);
        const windowSeconds = Math.floor(activeRateLimit.windowMs / 1000);
        if (current === 1) {
          await redisClient.expire(rlKey, windowSeconds);
        }
        if (current > activeRateLimit.max) {
          responseHeaders['Retry-After'] = windowSeconds.toString();
          return { status: 429, headers: responseHeaders, body: formatErrorEnvelope(429, 'Too Many Requests', null, reqId) };
        }
      } catch (err) {
        console.error('[bro.js] Rate Limit Error:', err);
      }
    }

    // Auth verification
    if (routeConfig.auth === 'api-key') {
      const apiKey = requestData.headers['x-api-key'] || (requestData.headers['authorization'] || '').replace('Bearer ', '');
      const validKey = globalConfig.auth?.apiKey || process.env.API_KEY;
      
      let isValid = false;
      if (Array.isArray(validKey)) {
        isValid = validKey.includes(apiKey);
      } else {
        isValid = apiKey && apiKey === validKey;
      }
      
      if (!isValid) {
        return { status: 401, headers: errorHeaders, body: formatErrorEnvelope(401, 'Unauthorized', 'Missing or invalid API key', reqId, requestData.originalUrl) };
      }
    } else if (routeConfig.auth) {
      const authHeader = requestData.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { status: 401, headers: errorHeaders, body: formatErrorEnvelope(401, 'Unauthorized', 'Missing or invalid Bearer token', reqId, requestData.originalUrl) };
      }
      
      const token = authHeader.split(' ')[1] ?? '';
      const authResult = verifyJwt(token, globalConfig.jwtSecret);
      
      if (!authResult.valid) {
        return { status: 401, headers: errorHeaders, body: formatErrorEnvelope(401, 'Unauthorized', authResult.error, reqId, requestData.originalUrl) };
      }
      ctx.user = authResult.payload ?? null;
      
      if (Array.isArray(routeConfig.auth) && routeConfig.auth.length > 0) {
         if (!ctx.user || !ctx.user.role || !routeConfig.auth.includes(ctx.user.role)) {
            return { status: 403, headers: errorHeaders, body: formatErrorEnvelope(403, 'Forbidden', 'Insufficient role permissions', reqId, requestData.originalUrl) };
         }
      }
    }

    // Zod validation
    if (routeConfig.params) {
      const result = await routeConfig.params.safeParseAsync(requestData.params || {});
      if (!result.success) {
        return { status: 400, headers: errorHeaders, body: formatErrorEnvelope(400, 'Invalid URL Parameters', formatZodError(result.error), reqId, requestData.originalUrl) };
      }
      ctx.params = result.data;
    }
    
    if (routeConfig.body) {
      const result = await routeConfig.body.safeParseAsync(requestData.body || {});
      if (!result.success) {
        return { status: 400, headers: errorHeaders, body: formatErrorEnvelope(400, 'Invalid Request Body', formatZodError(result.error), reqId, requestData.originalUrl) };
      }
      ctx.body = result.data;
    }

    if (routeConfig.query) {
       const result = await routeConfig.query.safeParseAsync(requestData.query || {});
       if (!result.success) {
         return { status: 400, headers: errorHeaders, body: formatErrorEnvelope(400, 'Invalid Query Parameters', formatZodError(result.error), reqId, requestData.originalUrl) };
       }
       ctx.query = result.data;
    }

    if (typeof routeConfig.handler !== 'function') {
       throw new Error('Route "handler" is missing or is not a function');
    }

    // Cache evaluation
    let cacheKey = null;
    
    if (routeConfig.cache && redisClient && requestData.method === 'GET') {
      const authIdentity = crypto.createHash('sha256').update(String(requestData.headers['authorization'] || requestData.headers['x-api-key'] || requestData.ip || 'anonymous')).digest('hex');
      const locale = requestData.locale || 'en';
      // URL has query parameters, so use originalUrl completely
      cacheKey = `bro:cache:${requestData.method}:${requestData.originalUrl}:${locale}:${authIdentity}`;
      
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          return { status: 200, headers: responseHeaders, body: JSON.parse(cached) };
        }
      } catch (err) {
        console.error('[bro.js] Cache parsing failed, deleting key:', cacheKey);
        await redisClient.del(cacheKey).catch(() => {});
      }
    }

    // Execute User Handler
    let responseData = await routeConfig.handler(ctx);
    
    // Runtime Response Validation
    if (routeConfig.response && globalConfig.validateResponse !== false) {
       const result = await routeConfig.response.safeParseAsync(responseData);
       if (!result.success) {
          console.error('[bro.js] ⚠️ Response Validation Failed:', formatZodError(result.error));
          if (process.env.NODE_ENV === 'production' && globalConfig.validateResponse === 'strict') {
             throw new Error('Response Validation Failed');
          } else if (globalConfig.validateResponse !== 'warn') {
             // Strip invalid data, throw 500
             throw new Error('Response Validation Failed');
          }
       } else {
          responseData = result.data;
       }
    }
    
    if (cacheKey && routeConfig.cache) {
      await redisClient.setEx(cacheKey, routeConfig.cache, JSON.stringify(responseData));
    }
    
    return { status: 200, headers: responseHeaders, body: responseData };

  } catch (err) {
    const status = err.status || 500;
    const title = status === 500 ? 'Internal Server Error' : err.message;
    const isProd = process.env.NODE_ENV === 'production';
    
    if (status >= 500) {
      console.error(`[bro.js] Execution Error in route:`);
      console.error(err.stack || err);
    }
    
    return { status, headers: errorHeaders, body: formatErrorEnvelope(status, isProd && status >= 500 ? 'Internal Server Error' : title, isProd && status >= 500 ? null : err.details, reqId, requestData.originalUrl), error: status >= 500 ? err : undefined };
  }
}
