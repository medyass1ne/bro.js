import path from 'path';
import { createServer } from './server.js';
import { signJwt } from './auth.js';

/**
 * Creates a native Fetch-based testing harness for bro.js
 */
export async function createTestHarness(globalConfig = {}, options = {}) {
  let instance;
  const port = options.port || 0;
  let runningServer;
  let testUrl = '';
  
  const harness = {
    fixtures: options.fixtures || {},
    stores: options.stores || {},
    
    async start() {
      const routesDir = options.routesDir || path.join(process.cwd(), 'routes');
      
      // Inject testing fixtures into the framework config
      const testConfig = {
        ...globalConfig,
        fixtures: this.fixtures,
        stores: this.stores,
        // Override for testing
        jwtSecret: globalConfig.jwtSecret || 'test_secret_for_harness'
      };

      instance = await createServer(testConfig, routesDir, options.db || null);
      
      runningServer = instance.server;
      await new Promise(resolve => runningServer.listen(port, resolve));
      testUrl = `http://localhost:${runningServer.address().port}`;
    },
    
    async stop() {
      if (runningServer && runningServer.closeAllConnections) {
        runningServer.closeAllConnections();
      }
      if (instance?.shutdown) {
        await instance.shutdown();
      } else if (runningServer) {
        await new Promise(resolve => runningServer.close(resolve));
      }
      runningServer = null;
      if (typeof jest !== 'undefined' && jest.clearAllTimers) {
        jest.clearAllTimers();
      }
    },

    auth(payload) {
       const secret = globalConfig.jwtSecret || 'test_secret_for_harness';
       return signJwt(payload, secret, { expiresIn: '1h' });
    },

        // Clock hooks
    useFakeTimers(now) {
      if (typeof jest !== 'undefined') {
        jest.useFakeTimers();
        if (now) jest.setSystemTime(now);
      } else {
        console.warn('Fake timers only supported when running under Jest/Vitest environments.');
      }
    },
    useRealTimers() {
      if (typeof jest !== 'undefined') {
        jest.useRealTimers();
      }
    },

    // DB Transactions
    async runInTransaction(testFn) {
      if (!options.db || typeof options.db.transaction !== 'function') {
        throw new Error('Database adapter does not support transactions or no DB provided.');
      }
      return options.db.transaction(async (trx) => {
        try {
          await testFn(trx);
        } finally {
          // If the test framework supports rollback via error, we would throw here, 
          // but for isolated testing we assume the trx handles rollback gracefully if test fails.
          if (trx.rollback) await trx.rollback();
        }
      });
    },

    // Direct route testing without network
    async testRoute(routeModule, mockCtx = {}) {
      const config = routeModule.default || routeModule;
      const ctx = {
        env: globalConfig.env || {},
        db: options.db || null,
        user: null,
        body: {},
        query: {},
        params: {},
        ...mockCtx
      };
      return config.handler(ctx);
    },

    client(defaultHeaders = {}) {
       return {
         async fetch(route, fetchOpts = {}) {
           const headers = { ...defaultHeaders, ...(fetchOpts.headers || {}) };
           return fetch(`${testUrl}${route}`, { ...fetchOpts, headers });
         },
         async get(route, fetchOpts) { 
           return this.fetch(route, { method: 'GET', ...fetchOpts }); 
         },
         async post(route, body, fetchOpts = {}) { 
           return this.fetch(route, { 
             method: 'POST', 
             body: JSON.stringify(body), 
             headers: { 'Content-Type': 'application/json', ...(fetchOpts.headers || {}) }, 
             ...fetchOpts 
           }); 
         },
         async put(route, body, fetchOpts = {}) {
           return this.fetch(route, { 
             method: 'PUT', 
             body: JSON.stringify(body), 
             headers: { 'Content-Type': 'application/json', ...(fetchOpts.headers || {}) }, 
             ...fetchOpts 
           });
         },
         async delete(route, fetchOpts) { 
           return this.fetch(route, { method: 'DELETE', ...fetchOpts }); 
         },
         
         // Contract test helper
         async assertContract(response, schema) {
           const json = await response.json();
           return schema.parse(json);
         }
       };
    }
  };

  return harness;
}
