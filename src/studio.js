import fs from 'fs';
import path from 'path';
import { generateSDK } from './sdk.js';
import { scanDir, parseRouteFile } from './router.js';
import { pathToFileURL } from 'url';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Contract Studio Engine
 * Generates TS Client, OpenAPI Spec, MSW Mocks, React Query Hooks, and Error Types
 */
export class ContractStudio {
  constructor(routesDir, routeRegistry) {
    this.routeRegistry = routeRegistry;
    this.routesDir = routesDir || path.join(process.cwd(), 'routes');
    this.outputDir = path.join(process.cwd(), '.bro-studio');
  }

  async buildAll() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // 1. TypeScript Client (reuse existing SDK generator)
    await generateSDK();
    
    // 2. Scan endpoints for other generators
    const endpoints = await this._scanEndpoints();

    // 3. Generate OpenAPI
    await this.generateOpenAPI(endpoints);

    // 4. Generate MSW Mocks
    await this.generateMswMocks(endpoints);

    // 5. Generate React Query Hooks
    await this.generateReactQuery(endpoints);
    
    console.log('[bro.js] Contract Studio generation complete.');
  }

  async _scanEndpoints() {
    const files = scanDir(this.routesDir);
    const endpoints = [];
    let routeCounter = 0;
    
    for (const file of files) {
      const routeInfo = parseRouteFile(file, this.routesDir);
      if (routeInfo) {
        const mod = await import(pathToFileURL(file).href + '?t=' + Date.now());
        endpoints.push({
          ...routeInfo,
          file,
          config: mod.default,
          moduleName: `Route${routeCounter++}`
        });
      }
    }
    return endpoints;
  }

  async generateOpenAPI(endpoints) {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'bro.js API', version: '1.0.0' },
      paths: {}
    };

    for (const ep of endpoints) {
      const pathKey = ep.routePath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
      if (!spec.paths[pathKey]) spec.paths[pathKey] = {};
      
      
      // Stable Naming
      let stableName = ep.config.operationId;
      if (!stableName) {
        const cleanPath = ep.routePath.replace(/[^a-zA-Z0-9]/g, ' ').trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
        stableName = ep.method.toLowerCase() + cleanPath;
      }
      
      const routeOp = {
        operationId: stableName,
        summary: ep.config.summary || `${ep.method.toUpperCase()} ${ep.routePath}`,
        responses: {
          '200': { description: 'Successful response' },
          '400': { description: 'Validation error' },
          '401': { description: 'Unauthorized' }
        }
      };

      if (ep.config.response) {
         routeOp.responses['200'].content = {
           'application/json': {
             schema: zodToJsonSchema(ep.config.response, { target: 'openApi3' })
           }
         };
      }
      
      spec.paths[pathKey][ep.method.toLowerCase()] = routeOp;
    }
    
    fs.writeFileSync(
      path.join(this.outputDir, 'openapi.json'),
      JSON.stringify(spec, null, 2)
    );
  }

    async generateMswMocks(endpoints) {
    let mswCode = `import { http, HttpResponse } from 'msw';\n\nexport const handlers = [\n`;
    for (const ep of endpoints) {
      const mswPath = ep.routePath.replace(/:([a-zA-Z0-9_]+)/g, ':$1');
      mswCode += `  http.${ep.method.toLowerCase()}('*${mswPath}', ({ request, params, cookies }) => {\n`;
      
      let mockData = '{ mock: true }';
      if (ep.config && ep.config.response) {
        const schema = zodToJsonSchema(ep.config.response);
        if (schema.type === 'object' && schema.properties) {
          const mockObj = {};
          for (const key of Object.keys(schema.properties)) {
            mockObj[key] = schema.properties[key].type === 'string' ? 'mock_string' : schema.properties[key].type === 'number' ? 123 : schema.properties[key].type === 'boolean' ? true : null;
          }
          mockData = JSON.stringify(mockObj);
        }
      }
      
      mswCode += `    return HttpResponse.json(${mockData});\n`;
      mswCode += `  }),\n`;
    }
    mswCode += `];\n`;
    fs.writeFileSync(path.join(this.outputDir, 'msw.js'), mswCode);
  }

    async generateReactQuery(endpoints) {
    let rqCode = `import { useQuery, useMutation } from '@tanstack/react-query';\nimport { api } from './bro-sdk';\n\n`;
    for (const ep of endpoints) {
      const hookName = `use${ep.moduleName}`;
      const fnName = ep.moduleName.charAt(0).toLowerCase() + ep.moduleName.slice(1);
      if (ep.method.toLowerCase() === 'get') {
        rqCode += `export function ${hookName}(query, options) {\n  return useQuery({\n    queryKey: ['${ep.routePath}', query],\n    queryFn: () => api.${fnName}(query),\n    ...options\n  });\n}\n\n`;
      } else {
        rqCode += `export function ${hookName}(options) {\n  return useMutation({\n    mutationFn: (data) => api.${fnName}(data),\n    ...options\n  });\n}\n\n`;
      }
    }
    fs.writeFileSync(path.join(this.outputDir, 'react-query.js'), rqCode);
  }

  async watch() {
    console.log('[bro.js] Contract Studio watching for route changes...');
    const chokidar = await import('chokidar');
    chokidar.watch(this.routesDir).on('change', async (path) => {
      console.log(`[bro.js] Route ${path} changed, rebuilding contracts...`);
      await this.buildAll();
    });
  }
}

export async function startStudio(cwd) {
  console.log('[bro.js] Starting Contract Studio generation...');
  const studio = new ContractStudio(path.join(cwd, 'api'));
  await studio.buildAll();
  console.log('[bro.js] Studio generation complete.');
}
