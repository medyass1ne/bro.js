import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import crypto from 'crypto';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Recursively scans a directory for .js files.
 * @param {string} dir - The base directory to scan.
 * @param {string[]} [fileList] - Internal accumulator for recursion.
 * @returns {string[]} Array of absolute file paths.
 */
export function scanDir(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      scanDir(filePath, fileList);
    } else if (filePath.endsWith('.js') || filePath.endsWith('.ts')) {
      fileList.push(filePath);
    }
  }
  
  return fileList;
}

/**
 * Converts a file path to an Express route path.
 * Example: routes/users/[id].get.js -> { routePath: '/users/:id', method: 'get' }
 * @param {string} filePath - Absolute path to the route file.
 * @param {string} routesDir - The root routes directory.
 * @returns {{ routePath: string, method: string } | null}
 */
export function parseRouteFile(filePath, routesDir) {
  const relativePath = path.relative(routesDir, filePath);
  
  const parsed = path.parse(relativePath);
  const parts = parsed.name.split('.');
  
  if (parts.length < 2) return null; 
  
  const method = parts.pop().toLowerCase();
  
  const allowedMethods = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head']);
  if (!allowedMethods.has(method)) {
    throw new Error(`Invalid HTTP method "${method}" in file: ${filePath}`);
  }
  
  const namePart = parts.join('.');
  
  let routePath = '/' + path.dirname(relativePath).replace(/\\/g, '/');
  if (routePath === '/.') routePath = ''; 
  
  if (namePart !== 'index') {
    routePath += `/${namePart}`;
  }
  
  const bracketRegex = /\[(.*?)\]/g;
  let match;
  while ((match = bracketRegex.exec(routePath)) !== null) {
    const paramName = match[1];
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(paramName)) {
      throw new Error(`Invalid dynamic parameter "[${paramName}]" in file: ${filePath}. Must be a valid JavaScript identifier.`);
    }
  }
  
  routePath = routePath.replace(/\[(.*?)\]/g, ':$1');
  
  if (routePath === '') routePath = '/';

  return { routePath, method };
}

/**
 * Loads and maps all route files into the Express application.
 * @param {import('express').Application} app - The Express app instance.
 * @param {string} routesDir - Path to the user's routes folder.
 * @param {Function} createHandler - Core wrapper function for route logic.
 * @param {Object} [openApiSpec] - Optional OpenAPI Spec object to build.
 * @returns {Promise<Array>} Array of loaded route objects.
 */
export async function loadRoutes(app, routesDir, createHandler, openApiSpec) {
  const files = scanDir(routesDir);
  const loadedRoutes = [];
  const routeModules = [];
  
  for (const file of files) {
    const routeInfo = parseRouteFile(file, routesDir);
    if (!routeInfo) continue;
    
    const { routePath, method } = routeInfo;
    
    if (typeof app[method] !== 'function') continue;

    const moduleUrl = pathToFileURL(file).href + '?update=' + crypto.randomUUID();
    const module = await import(moduleUrl);
    const config = module.default;
    
    if (!config) continue;
    
    routeModules.push({ file, routePath, method, config });
  }
  
  for (const { file, routePath, method, config } of routeModules) {
    const handler = createHandler(config);
    app[method](routePath, handler);
    
    if (openApiSpec) {
      const openApiPath = routePath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
      if (!openApiSpec.paths[openApiPath]) openApiSpec.paths[openApiPath] = {};
      
      const operation = {
        summary: config.summary || `${method.toUpperCase()} ${routePath}`,
        responses: { '200': { description: 'Successful response' } }
      };
      
      const bodySchema = config.schema?.body || config.body;
      const paramsSchema = config.schema?.params || config.params;
      const querySchema = config.schema?.query || config.query;

      if (bodySchema) {
        operation.requestBody = {
          content: { 'application/json': { schema: zodToJsonSchema(bodySchema) } }
        };
      }
      
      if (paramsSchema) {
        operation.parameters = operation.parameters || [];
        const pSchema = zodToJsonSchema(paramsSchema);
        if (pSchema.properties) {
          for (const [key, schema] of Object.entries(pSchema.properties)) {
            operation.parameters.push({ name: key, in: 'path', required: true, schema });
          }
        }
      }

      if (querySchema) {
        operation.parameters = operation.parameters || [];
        const qSchema = zodToJsonSchema(querySchema);
        if (qSchema.properties) {
          for (const [key, schema] of Object.entries(qSchema.properties)) {
            operation.parameters.push({ 
              name: key, 
              in: 'query', 
              required: qSchema.required?.includes(key), 
              schema 
            });
          }
        }
      }
      
      // Auto-inject security definition if auth is true
      if (config.auth) {
        operation.security = [{ bearerAuth: [] }];
      }
      
      if (config.upload) {
        operation.requestBody = operation.requestBody || { content: {} };
        operation.requestBody.content['multipart/form-data'] = {
          schema: { type: 'object' }
        };
      }
      
      if (bodySchema || paramsSchema || querySchema) {
        operation.responses['400'] = { $ref: '#/components/responses/BadRequest' };
      }
      if (config.auth) {
        operation.responses['401'] = { $ref: '#/components/responses/Unauthorized' };
      }
      operation.responses['404'] = { $ref: '#/components/responses/NotFound' };
      operation.responses['500'] = { $ref: '#/components/responses/ServerError' };
      
      openApiSpec.paths[openApiPath][method.toLowerCase()] = operation;
    }
    
    loadedRoutes.push({
      method: method.toUpperCase(),
      path: routePath,
      auth: !!config.auth
    });
  }
  
  return loadedRoutes;
}
