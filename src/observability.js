import crypto from 'node:crypto';

/**
 * Pino Logger Adapter for bro.js plugins
 */
export function createPinoAdapter(pinoInstance, options = {}) {
  const redactPaths = options.redact || ['req.headers.authorization', 'req.headers.cookie'];
  if (!pinoInstance.redact) {
    pinoInstance.redact = redactPaths;
  }
  
  return {
    name: 'bro-pino-adapter',
    order: 5,
    onContext: (ctx) => {
      return {
        log: pinoInstance.child({ reqId: ctx.env?.TRACE_ID || crypto.randomUUID() })
      };
    },
    onRequest: (req, res) => {
      pinoInstance.info({ req: { method: req.method, url: req.url, headers: req.headers } }, 'Request received');
    },
    onError: (err, req, res) => {
      pinoInstance.error({ err, reqId: req.id || req.headers['x-request-id'] }, 'Request failed');
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
      return {
        traceId: traceparent ? traceparent.split('-')[1] : crypto.randomUUID()
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
