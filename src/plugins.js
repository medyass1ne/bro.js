/**
 * Plugin Manager for bro.js
 * Handles lifecycle hooks, context extension, and typed plugins.
 */
export class PluginManager {
  constructor() {
    this.plugins = [];
    this.hooks = {
      onInit: [],
      onContext: [],
      onRequest: [],
      onError: [],
      onShutdown: []
    };
  }

  /**
   * Registers a plugin with the framework.
   * @param {Object} plugin 
   */
  register(plugin) {
    if (!plugin.name) throw new Error('[bro.js] Plugin must have a \'name\'.');
    if (!plugin.version) throw new Error(`[bro.js] Plugin '${plugin.name}' must specify a 'version' (e.g., '3.0.0').`);
    
    // Enforce v3 compatibility
    if (!plugin.version.startsWith('3.')) {
      throw new Error(`[bro.js] Plugin '${plugin.name}' (v${plugin.version}) is not compatible with bro.js v3.x.`);
    }

    const allowedKeys = ['name', 'version', 'order', 'onInit', 'onContext', 'onRequest', 'onError', 'onShutdown'];
    for (const key of Object.keys(plugin)) {
      if (!allowedKeys.includes(key)) {
        throw new Error(`[bro.js] Plugin '${plugin.name}' uses undocumented escape hatch / unknown property: '${key}'.`);
      }
    }

    this.plugins.push(plugin);
    // Sort plugins if they provide an order, default to 50
    this.plugins.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
    this._rebuildHooks();
  }

  _rebuildHooks() {
    for (const key of Object.keys(this.hooks)) {
      this.hooks[key] = [];
    }
    for (const plugin of this.plugins) {
      if (plugin.onInit) this.hooks.onInit.push(plugin.onInit);
      if (plugin.onContext) this.hooks.onContext.push(plugin.onContext);
      if (plugin.onRequest) this.hooks.onRequest.push(plugin.onRequest);
      if (plugin.onError) this.hooks.onError.push(plugin.onError);
      if (plugin.onShutdown) this.hooks.onShutdown.push(plugin.onShutdown);
    }
  }

  async runOnInit(globalConfig, app) {
    for (const hook of this.hooks.onInit) {
      await hook(globalConfig, app);
    }
  }

  async runOnContext(ctx) {
    for (const hook of this.hooks.onContext) {
      const ext = await hook(ctx);
      if (ext && typeof ext === 'object') {
        Object.assign(ctx, ext);
      }
    }
  }

  async runOnShutdown() {
    for (const hook of this.hooks.onShutdown) {
      await hook();
    }
  }

  getRequestMiddleware() {
    return async (req, res, next) => {
      try {
        for (const hook of this.hooks.onRequest) {
           await hook(req, res);
        }
        next();
      } catch (err) {
        next(err);
      }
    };
  }

  getErrorMiddleware() {
    return async (err, req, res, next) => {
      for (const hook of this.hooks.onError) {
        try {
          await hook(err, req, res);
        } catch (e) {
          console.error('[bro.js] Error in Plugin onError hook:', e);
        }
      }
      next(err);
    };
  }
}

/**
 * Baseline Observability Plugin
 * Adds performance measuring and correlation ids.
 */
export const ObservabilityPlugin = {
  name: 'bro-observability',
  version: '3.0.0',
  order: 10, // Runs early
  onRequest: (req, res) => {
    req.startTime = performance.now();
  },
  onContext: (ctx) => {
    return {
       traceId: ctx.env?.TRACE_ID || crypto.randomUUID()
    };
  }
};

/**
 * Baseline Security Plugin
 * Applies strict security headers beyond the default helmet configuration.
 */
export const SecurityPlugin = {
  name: 'bro-security',
  version: '3.0.0',
  order: 20,
  onRequest: (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
  }
};
