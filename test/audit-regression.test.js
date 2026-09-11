import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { parseRouteFile } from '../src/router.js';
import { createServer } from '../src/server.js';
import { generateSDK } from '../src/sdk.js';

test('1. parseRouteFile with nested dynamic routes', () => {
  const routesDir = path.join(process.cwd(), 'routes');
  const filePath = path.join(routesDir, 'users', '[userId]', 'videos', '[videoId].get.js');
  const result = parseRouteFile(filePath, routesDir);
  assert.strictEqual(result.routePath, '/users/:userId/videos/:videoId');
  assert.strictEqual(result.method, 'get');
});

test('2. Server startup with cors: false', async () => {
  const routesDir = path.join(process.cwd(), 'test_routes_tmp');
  if (!fs.existsSync(routesDir)) fs.mkdirSync(routesDir, { recursive: true });
  fs.writeFileSync(path.join(routesDir, 'index.get.js'), 'export default { handler: () => ({ ok: true }) }');

  const { app, server } = await createServer({ server: { cors: false } }, routesDir, null);
  
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  
  const res = await fetch(`http://localhost:${port}/`);
  assert.strictEqual(res.headers.get('access-control-allow-origin'), null);
  
  server.close();
  fs.rmSync(routesDir, { recursive: true, force: true });
});

test('3. Unknown route returning JSON 404', async () => {
  const routesDir = path.join(process.cwd(), 'test_routes_tmp2');
  if (!fs.existsSync(routesDir)) fs.mkdirSync(routesDir, { recursive: true });
  
  const { app, server } = await createServer({}, routesDir, null);
  
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  
  const res = await fetch(`http://localhost:${port}/non-existent-route`);
  const data = await res.json();
  
  assert.strictEqual(res.status, 404);
  assert.strictEqual(data.error, 'Not Found');
  
  server.close();
  fs.rmSync(routesDir, { recursive: true, force: true });
});

test('4. SDK generation output parses correctly', async () => {
  const routesDir = path.join(process.cwd(), 'routes');
  const backup = fs.existsSync(routesDir) ? path.join(process.cwd(), 'routes_backup') : null;
  
  if (backup && fs.existsSync(routesDir)) {
    fs.renameSync(routesDir, backup);
  }
  
  fs.mkdirSync(routesDir, { recursive: true });
  fs.writeFileSync(path.join(routesDir, 'my-hyphen-route.get.js'), 'export default { handler: () => {} }');
  
  const nestedPath = path.join(routesDir, 'users', '[userId]', 'videos');
  fs.mkdirSync(nestedPath, { recursive: true });
  fs.writeFileSync(path.join(nestedPath, '[videoId].get.js'), 'export default { handler: () => {} }');
  
  await generateSDK();
  
  const sdkCode = fs.readFileSync(path.join(process.cwd(), 'bro-sdk.js'), 'utf-8');
  
  // This will throw SyntaxError if it's invalid JS
  const check = spawnSync('node', ['--check', 'bro-sdk.js']);
  assert.strictEqual(check.status, 0, check.stderr?.toString());
  
  // Cleanup
  fs.rmSync(routesDir, { recursive: true, force: true });
  fs.rmSync('bro-sdk.js', { force: true });
  
  if (backup) {
    fs.renameSync(backup, routesDir);
  }
});

test('5. Production startup rejection on default JWT secret', () => {
  // Instead of testing bin/bro.js execution, we can just assert the logic since it's a CLI wrapper.
  // We'll test it by spawning bro.js
  const result = spawnSync('node', ['bin/bro.js', 'start'], {
    env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'dev_secret_please_change' }
  });
  
  assert.strictEqual(result.status, 1);
  assert.ok(result.stderr.toString().includes('CRITICAL SECURITY ERROR'));
});
