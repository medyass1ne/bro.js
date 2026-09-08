import { ZodType } from 'zod';

export interface BroContext {
  body?: any;
  params?: any;
  query?: any;
  user?: any;
  db?: any;
  io?: any;
  files?: any[];
  error?: any;
}

export interface RouteConfig {
  auth?: boolean;
  upload?: boolean;
  body?: ZodType<any, any, any>;
  params?: ZodType<any, any, any>;
  query?: ZodType<any, any, any>;
  rateLimit?: {
    windowMs: number;
    max: number;
  };
  summary?: string;
  handler: (ctx: BroContext) => Promise<any> | any;
}

export function defineRoute(config: RouteConfig): RouteConfig;

export interface BroConfig {
  env?: ZodType<any, any, any>;
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
  db?: () => Promise<any> | any;
  sockets?: (io: any, db: any) => Promise<void> | void;
}

export function defineConfig(config: BroConfig): BroConfig;

export { z } from 'zod';
