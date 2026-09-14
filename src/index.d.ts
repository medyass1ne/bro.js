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

export interface BroContext<Body = any, Params = any, Query = any> {
  env?: any;
  jwt?: { sign: (payload: any, options?: any) => string };
  body: InferZod<Body>;
  params: InferZod<Params>;
  query: InferZod<Query>;
  user?: any;
  db?: any;
  io?: any;
  file?: UploadedFile;
  files?: UploadedFile[] | Record<string, UploadedFile[]>;
  locale: string;
  t: (key: string, values?: Record<string, unknown>) => string;
  error?: any;
  redis?: any;
}

export interface RouteConfig<Body = any, Params = any, Query = any> {
  auth?: boolean | string[] | 'api-key';
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
  handler: (ctx: BroContext<Body, Params, Query>) => Promise<any> | any;
}

export function defineRoute<Body = any, Params = any, Query = any>(
  config: RouteConfig<Body, Params, Query>
): RouteConfig<Body, Params, Query>;

export function loadLocale(directory: string, options?: { defaultLocale?: string }): Promise<{
  locales: string[];
  defaultLocale: string;
  resolveLocale: (request: any) => string;
  translate: (locale: string, key: string, values?: Record<string, unknown>) => string;
}>;

export interface BroConfig {
  env?: ZodTypeAny;
  server?: {
    port?: number;
    cors?: boolean | object;
    helmet?: boolean | object;
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
