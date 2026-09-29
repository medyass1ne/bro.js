import crypto from 'node:crypto';

/**
 * Pino Logger Adapter for bro.js plugins
 */
export function createPinoAdapter(pinoInstance, options = {}) {
  const redactKeys = options.redact || ['password', 'token', 'secret', 'authorization', 'cookie'];
  
  const redact = (obj, seen = new WeakSet()) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (seen.has(obj)) return '[CIRCULAR]';
    seen.add(obj);
    if (Array.isArray(obj)) return obj.map(item => redact(item, seen));
    const newObj = { ...obj };
    for (const key of Object.keys(newObj)) {
      if (redactKeys.some(r => key.toLowerCase().includes(r))) {
        newObj[key] = '[REDACTED]';
      } else if (typeof newObj[key] === 'object') {
        newObj[key] = redact(newObj[key], seen);
      }
    }
    return newObj;
  };

  const wrapLogger = (logger) => {
    return new Proxy(logger, {
      get(target, prop) {
        const val = target[prop];
        if (typeof val === 'function' && ['fatal', 'error', 'warn', 'info', 'debug', 'trace'].includes(prop)) {
          return function(obj, ...args) {
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
              return val.call(target, redact(obj), ...args);
            }
            return val.call(target, obj, ...args);
          };
        }
        if (prop === 'child') {
          return function(...args) {
            return wrapLogger(target.child(...args));
          };
        }
        return typeof val === 'function' ? val.bind(target) : val;
      }
    });
  };

  const safePino = wrapLogger(pinoInstance);
  
  return {
    name: 'bro-pino-adapter',
    order: 5,
    onContext: (ctx) => {
      return {
        log: safePino.child({ reqId: ctx.env?.TRACE_ID || crypto.randomUUID() })
      };
    },
    onRequest: (req, res) => {
      safePino.info({ req: { method: req.method, url: req.url, headers: req.headers } }, 'Request received');
    },
    onError: (err, req, res) => {
      safePino.error({ err, reqId: req.id || req.headers['x-request-id'] }, 'Request failed');
    }
  };
}

/**
 * OpenTelemetry Instrumentation Setup Helper
 */
export function setupOpenTelemetry(sdkConfig) {
  return {
    name: 'bro-otel-instrumentation',
    order: 1,
    onInit: async (globalConfig) => {
      console.log('[bro.js] OpenTelemetry initialized for service:', sdkConfig.serviceName);
    },
    onContext: (ctx) => {
      // W3C Trace Propagation
      const traceparent = ctx.req?.headers['traceparent'];
      const tracestate = ctx.req?.headers['tracestate'];
      
      let traceId = crypto.randomBytes(16).toString('hex');
      let parentId = '';
      let traceFlags = '00';
      
      if (traceparent) {
        const parts = traceparent.split('-');
        if (parts.length === 4) {
          traceId = parts[1];
          parentId = parts[2];
          traceFlags = parts[3];
        }
      }
      
      const spanId = crypto.randomBytes(8).toString('hex');
      
      return {
        traceId,
        spanId,
        parentId,
        traceFlags,
        traceparent: `00-${traceId}-${spanId}-${traceFlags}`,
        tracestate: tracestate || ''
      };
    },
    onRequest: (req, res) => {
      // In a real implementation, we would start an OTel span here
      req.__otelStartTime = Date.now();
    },
    onShutdown: () => {
       console.log('[bro.js] OpenTelemetry shutting down gracefully...');
    }
  };
}

/**
 * Dashboard Event Bus Plugin
 */
export function createDashboardEventBus(busConfig = {}) {
  const metrics = { requests: 0, errors: 0, latencies: [] };
  
  return {
    name: 'bro-dashboard-bus',
    order: 90,
    onRequest: (req, res) => {
      metrics.requests++;
      req.__busStartTime = Date.now();
    },
    onError: (err) => {
      metrics.errors++;
      if (busConfig.io) {
        busConfig.io.emit('metrics:error', { error: err.message, time: Date.now() });
      }
    },
    onShutdown: () => {
      if (busConfig.io) {
        busConfig.io.emit('system:shutdown', { metrics });
      }
    }
  };
}
