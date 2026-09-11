import { z, ZodTypeAny } from 'zod';

type InferZod<T> = T extends ZodTypeAny ? z.infer<T> : any;

export interface BroContext<Body = any, Params = any, Query = any> {
  env?: any;
  jwt?: { sign: (payload: any, options?: any) => string };
  body: InferZod<Body>;
  params: InferZod<Params>;
  query: InferZod<Query>;
  user?: any;
  db?: any;
  io?: any;
  files?: any[];
  error?: any;
}

export interface RouteConfig<Body = any, Params = any, Query = any> {
  auth?: boolean;
  upload?: boolean | { limits?: any, fields?: { name: string, maxCount?: number }[], single?: string, array?: string, fileFilter?: any, storage?: any };
  schema?: { body?: Body; params?: Params; query?: Query; };
  body?: Body;
  params?: Params;
  query?: Query;
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

export interface BroConfig {
  env?: ZodTypeAny;
  server?: {
    port?: number;
    cors?: boolean | object;
  };
  auth?: {
    jwtSecret?: string;
    expiresIn?: string | number;
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
}

export function defineConfig(config: BroConfig): BroConfig;

export { z } from 'zod';
