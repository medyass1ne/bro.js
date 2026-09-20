import http from 'http';
import fs from 'fs';
import path from 'path';

/**
 * Local Developer Dashboard Server
 * Serves a dashboard UI that visualizes routes, telemetry, and configuration.
 */
export function startDashboard(globalConfig, routes) {
  const host = '127.0.0.1'; // Strict local binding
  const port = (globalConfig.port || 5000) + 1;

  const server = http.createServer((req, res) => {
    // Restrict access to localhost strictly
    if (req.socket.remoteAddress !== '127.0.0.1' && req.socket.remoteAddress !== '::1') {
      res.writeHead(403);
      res.end('Forbidden: Dashboard only available on localhost');
      return;
    }

    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>bro.js Dev Dashboard</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
            h1 { color: #38bdf8; }
            .card { background: #1e293b; padding: 1.5rem; border-radius: 8px; margin-bottom: 1rem; }
            pre { background: #0f172a; padding: 1rem; border-radius: 4px; overflow-x: auto; }
          </style>
        </head>
        <body>
          <h1>bro.js Dev Dashboard</h1>
          
          <div class="card">
            <h2>Configuration (Redacted)</h2>
            <pre id="config"></pre>
          </div>
          
          <div class="card">
            <h2>Active Routes</h2>
            <pre id="routes"></pre>
          </div>
          
          <script>
            fetch('/api/state').then(r => r.json()).then(data => {
              document.getElementById('config').textContent = JSON.stringify(data.config, null, 2);
              document.getElementById('routes').textContent = JSON.stringify(data.routes, null, 2);
            });
          </script>
        </body>
        </html>
      `);
    } else if (req.url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      
      // Strict Redaction of Secrets
      const redactedConfig = JSON.parse(JSON.stringify(globalConfig));
      if (redactedConfig.auth?.jwtSecret) redactedConfig.auth.jwtSecret = '***REDACTED***';
      if (redactedConfig.db) redactedConfig.db = '[Database Instance]';
      
      res.end(JSON.stringify({
        config: redactedConfig,
        routes: routes.map(r => ({ method: r.method, path: r.routePath, auth: r.auth }))
      }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, host, () => {
    console.log(`[bro.js] 🛠️  Dev Dashboard running locally at http://${host}:${port}`);
  });

  return server;
}
