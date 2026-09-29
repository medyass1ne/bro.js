import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

/**
 * Local Developer Dashboard Server
 * Serves a dashboard UI that visualizes routes, telemetry, and configuration.
 */
export function startDashboard(globalConfig, routeRegistryOrGetter) {
  const host = '127.0.0.1'; // Strict local binding
  const basePort = globalConfig.server?.port || globalConfig.port || process.env.PORT || 3000;
  const port = Number(basePort) + 1;

  const server = http.createServer(async (req, res) => {
    // Restrict access to localhost strictly (IP + Host header for DNS Rebinding protection)
    if (req.socket.remoteAddress !== '127.0.0.1' && req.socket.remoteAddress !== '::1') {
      res.writeHead(403);
      res.end('Forbidden: Dashboard only available on localhost');
      return;
    }

    const hostHeader = (req.headers.host || '').split(':')[0];
    if (hostHeader !== 'localhost' && hostHeader !== '127.0.0.1' && hostHeader !== '[::1]') {
      res.writeHead(403);
      res.end('Forbidden: Invalid Host Header (DNS Rebinding Protection)');
      return;
    }

    if (req.url === '/') {
      try {
        const html = await fs.promises.readFile(path.join(__dirname, 'dashboard', 'dashboard.html'), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (err) {
        res.writeHead(500);
        res.end('Error loading dashboard UI');
      }
    } else if (req.url === '/dashboard.css') {
      try {
        const css = await fs.promises.readFile(path.join(__dirname, 'dashboard', 'dashboard.css'), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end(css);
      } catch (err) {
        res.writeHead(500);
        res.end('Error loading dashboard CSS');
      }
    } else if (req.url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      
      // Strict Redaction of Secrets
      const redactedConfig = JSON.parse(JSON.stringify(globalConfig, (k, v) => {
        if (typeof v === 'function') return '[Function]';
        if (typeof k === 'string') {
          const lowerK = k.toLowerCase();
          if (lowerK.includes('secret') || lowerK.includes('key') || lowerK.includes('pass') || lowerK.includes('token') || lowerK.includes('url')) {
            return '***REDACTED***';
          }
        }
        return v;
      }));
      if (redactedConfig.db) redactedConfig.db = '[Database Instance]';
      
      // Dynamic live state resolution
      const routes = typeof routeRegistryOrGetter === 'function' 
        ? routeRegistryOrGetter() 
        : (routeRegistryOrGetter.getRoutes ? routeRegistryOrGetter.getRoutes() : routeRegistryOrGetter);
        
      const normalizedRoutes = (routes || []).map(r => ({
        method: r.method || 'GET',
        path: r.path || r.routePath || r.url || '/',
        auth: r.auth ? (typeof r.auth === 'string' ? r.auth : 'required') : 'public',
        rateLimit: r.rateLimit ? `${r.rateLimit.max} req / ${r.rateLimit.windowMs / 1000}s` : 'none',
        cache: r.cache ? `${r.cache}s` : 'none',
        hasBodySchema: Boolean(r.body || r.schema?.body),
        hasQuerySchema: Boolean(r.query || r.schema?.query),
        hasParamsSchema: Boolean(r.params || r.schema?.params),
        hasResponseSchema: Boolean(r.response || r.schema?.response)
      }));
      
      res.end(JSON.stringify({
        config: redactedConfig,
        routes: normalizedRoutes,
        env: {
          platform: process.platform,
          nodeVersion: process.version
        }
      }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, host, () => {
    console.log(`[bro.js] Dev Dashboard running locally at http://${host}:${port}`);
  });

  return server;
}
