import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
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
    } else if (filePath.endsWith('.js')) {
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
  const namePart = parts.join('.');
  
  let routePath = '/' + path.dirname(relativePath).replace(/\\/g, '/');
  if (routePath === '/.') routePath = ''; 
  
  if (namePart !== 'index') {
    const formattedName = namePart.replace(/\[(.*?)\]/g, ':$1');
    routePath += `/${formattedName}`;
  }
  
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
  
  for (const file of files) {
    const routeInfo = parseRouteFile(file, routesDir);
    if (!routeInfo) continue;
    
    const { routePath, method } = routeInfo;
    
    if (typeof app[method] !== 'function') continue;

    try {
      const moduleUrl = pathToFileURL(file).href + '?update=' + Date.now();
      const module = await import(moduleUrl);
      const config = module.default;
      
      if (!config) continue;
      
      const handler = createHandler(config);
      app[method](routePath, handler);
      
      if (openApiSpec) {
        const openApiPath = routePath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
        if (!openApiSpec.paths[openApiPath]) openApiSpec.paths[openApiPath] = {};
        
        const operation = {
          summary: config.summary || `${method.toUpperCase()} ${routePath}`,
          responses: { '200': { description: 'Successful response' } }
        };
        
        if (config.body) {
          operation.requestBody = {
            content: { 'application/json': { schema: zodToJsonSchema(config.body) } }
          };
        }
        
        if (config.params) {
          operation.parameters = operation.parameters || [];
          const pSchema = zodToJsonSchema(config.params);
          if (pSchema.properties) {
            for (const [key, schema] of Object.entries(pSchema.properties)) {
              operation.parameters.push({ name: key, in: 'path', required: true, schema });
            }
          }
        }

        if (config.query) {
          operation.parameters = operation.parameters || [];
          const qSchema = zodToJsonSchema(config.query);
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
        
        openApiSpec.paths[openApiPath][method.toLowerCase()] = operation;
      }
      
      loadedRoutes.push({
        method: method.toUpperCase(),
        path: routePath,
        auth: !!config.auth
      });
      
    } catch (err) {
      console.error(`[bro.js] Failed to load route ${file}:`, err);
    }
  }
  
  return loadedRoutes;
}
