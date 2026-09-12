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
  
  assert.ok(sdkCode.includes('"my-hyphen-route": {'));
  assert.ok(sdkCode.includes('users: {'));
  
  // Cleanup
  fs.rmSync(routesDir, { recursive: true, force: true });
  fs.rmSync('bro-sdk.js', { force: true });
  
  if (backup) {
    fs.renameSync(backup, routesDir);
  }
});

test('5. Direct createServer() rejection on default JWT secret in production', async () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  
  try {
    await createServer({ jwtSecret: 'dev_secret_please_change' }, path.join(process.cwd(), 'routes'), null);
    assert.fail('Should have thrown an error');
  } catch (err) {
    assert.ok(err.message.includes('CRITICAL SECURITY ERROR'));
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

test('6. Runtime validation using config.schema.body rejects invalid data', async () => {
  const routesDir = path.join(process.cwd(), 'test_routes_tmp3');
  if (!fs.existsSync(routesDir)) fs.mkdirSync(routesDir, { recursive: true });
  
  fs.writeFileSync(path.join(routesDir, 'index.post.js'), `
    import { z } from 'zod';
    export default { 
      schema: { body: z.object({ value: z.string().min(3) }) },
      handler: () => ({ ok: true }) 
    }
  `);

  const { app, server } = await createServer({}, routesDir, null);
  
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  
  // Valid payload
  const res1 = await fetch(`http://localhost:${port}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'yes' })
  });
  assert.strictEqual(res1.status, 200);

  // Invalid payload
  const res2 = await fetch(`http://localhost:${port}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'no' })
  });
  assert.strictEqual(res2.status, 400);
  const data = await res2.json();
  assert.ok(data.error.includes('Invalid Request Body'));
  
  server.close();
  fs.rmSync(routesDir, { recursive: true, force: true });
});

test('7. Route compilation crashes on malformed HTTP methods (e.g., users.psot.js)', () => {
  try {
    parseRouteFile('routes/users.psot.js', 'routes');
    assert.fail('Should have thrown an error for invalid method');
  } catch (err) {
    assert.ok(err.message.includes('Invalid HTTP method "psot"'));
  }
});

test('8. Route compilation crashes on invalid dynamic brackets', () => {
  try {
    parseRouteFile('routes/users/[user-id].get.js', 'routes');
    assert.fail('Should have thrown an error for invalid dynamic parameter');
  } catch (err) {
    assert.ok(err.message.includes('Invalid dynamic parameter "[user-id]"'));
  }
});

test('9. SDK generator crashes on static vs dynamic route conflict', async () => {
  const originalRoutes = path.join(process.cwd(), 'routes');
  const tempRoutes = path.join(process.cwd(), 'routes_backup_2');
  
  if (fs.existsSync(originalRoutes)) {
    fs.renameSync(originalRoutes, tempRoutes);
  }
  
  fs.mkdirSync(originalRoutes, { recursive: true });
  fs.writeFileSync(path.join(originalRoutes, '[id].get.js'), 'export default {}');
  fs.writeFileSync(path.join(originalRoutes, 'id.get.js'), 'export default {}');
  
  try {
    await generateSDK();
    assert.fail('Should have thrown a collision error');
  } catch (err) {
    assert.ok(err.message.includes('SDK Collision'));
  } finally {
    fs.rmSync(originalRoutes, { recursive: true, force: true });
    if (fs.existsSync(tempRoutes)) {
      fs.renameSync(tempRoutes, originalRoutes);
    }
  }
});
