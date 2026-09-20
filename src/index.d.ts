/// <reference types="node" />
import { z, ZodTypeAny } from 'zod';

type InferZod<T> = T extends ZodTypeAny ? z.infer<T> : any;

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination?: string;
  filename?: string;
  path?: string;
  buffer?: Buffer;
}

export interface AppContext<Env = any, Db = any, User = any> {
  env: Env;
  db: Db;
  user: User;
}

export interface BroContext<Body = any, Params = any, Query = any, App extends AppContext = AppContext> {
  env?: App['env'];
  jwt?: { sign: (payload: any, options?: any) => string };
  body: InferZod<Body>;
  params: InferZod<Params>;
  query: InferZod<Query>;
  user?: App['user'];
  db?: App['db'];
  io?: any;
  file?: UploadedFile;
  files?: UploadedFile[] | Record<string, UploadedFile[]>;
  locale: string;
  t: (key: string, values?: Record<string, unknown>) => string;
  error?: any;
  redis?: any;
  requestId?: string;
}

export interface RouteConfig<Body = any, Params = any, Query = any, Response = any, App extends AppContext = AppContext> {
  auth?: boolean | string[] | 'api-key';
    operationId?: string;
  upload?: boolean | { limits?: any, fields?: { name: string, maxCount?: number }[], single?: string, array?: string, fileFilter?: any, storage?: any };
  body?: Body;
  params?: Params;
  query?: Query;
  response?: ZodTypeAny;
  cache?: number;
  rateLimit?: {
    windowMs: number;
    max: number;
  };
  summary?: string;
  handler: (ctx: BroContext<Body, Params, Query, App>) => Promise<Response extends import('zod').ZodTypeAny ? import('zod').infer<Response> : any> | (Response extends import('zod').ZodTypeAny ? import('zod').infer<Response> : any);
}

export function defineRoute<Body = any, Params = any, Query = any, Response = any, App extends AppContext = AppContext>(
  config: RouteConfig<Body, Params, Query, Response, App>
): RouteConfig<Body, Params, Query, Response, App>;

export function loadLocale(directory: string, options?: { defaultLocale?: string }): Promise<{
  locales: string[];
  defaultLocale: string;
  resolveLocale: (request: any) => string;
  translate: (locale: string, key: string, values?: Record<string, unknown>) => string;
}>;


export interface BroPlugin {
  name: string;
  version: string;
  order?: number;
  onInit?: (globalConfig: BroConfig, app: any) => void | Promise<void>;
  onContext?: (ctx: BroContext) => any | Promise<any>;
  onRequest?: (req: any, res: any) => void | Promise<void>;
  onError?: (err: any, req: any, res: any) => void | Promise<void>;
  onShutdown?: () => void | Promise<void>;
}
export interface BroConfig {
  routesDir?: string;
  tasksDir?: string;
  logger?: { level?: string; [key: string]: any };
  plugins?: BroPlugin[];
  fixtures?: Record<string, any>;
  stores?: Record<string, any>;
  health?: boolean | { dbCheck?: (db: any) => Promise<any> };
  locales?: Record<string, any>;
  defaultLocale?: string;
  envData?: any;
  redis?: any;
  port?: number;
  jwtSecret?: string;
  trustProxy?: boolean;
  validateResponse?: boolean | 'strict' | 'warn';
  env?: ZodTypeAny;
  server?: {
    port?: number;
    cors?: boolean | object;
    helmet?: boolean | object;
    timeoutMs?: number;
    headersTimeoutMs?: number;
  };
  locale?: {
    directory?: string;
    defaultLocale?: string;
  };
  auth?: {
    jwtSecret?: string;
    expiresIn?: string | number;
    apiKey?: string | string[];
  };
  docs?: boolean | { auth?: { user: string; pass: string } };
  rateLimit?: {
    windowMs: number;
    max: number;
  };
  upload?: {
    limits?: {
      fileSize?: number;
      files?: number;
      fields?: number;
      [key: string]: any;
    };
  };
  db?: () => Promise<any> | any;
  sockets?: (io: any, db: any) => Promise<void> | void;
  onShutdown?: (db: any) => Promise<void> | void;
  redisUrl?: string;
}

export function defineConfig(config: BroConfig): BroConfig;

export { z } from 'zod';
