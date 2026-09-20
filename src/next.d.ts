import { z, ZodTypeAny } from 'zod';

export { z };

export interface UploadedFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
  stream: () => ReadableStream;
  text: () => Promise<string>;
}

export interface NextBroGlobalConfig<TEnv = any, TDb = any, TUser = any> {
  env?: ZodTypeAny;
  locales?: Record<string, any>;
  defaultLocale?: string;
  redisUrl?: string;
  rateLimit?: { windowMs: number; max: number; };
  auth?: {
    jwtSecret?: string;
    apiKey?: string | string[];
    expiresIn?: string | number;
  };
  db?: TDb | Promise<TDb> | (() => TDb | Promise<TDb>) | { init: () => TDb | Promise<TDb> };
}

export interface NextRouteContext<TBody = any, TQuery = any, TParams = any, TEnv = any, TDb = any, TUser = any> {
  req: Request;
  env: TEnv;
  db: TDb;
  redis: any;
  io: { emit: (event: string, data: any) => void };
  body: TBody extends ZodTypeAny ? z.infer<TBody> : any;
  query: TQuery extends ZodTypeAny ? z.infer<TQuery> : any;
  params: TParams extends ZodTypeAny ? z.infer<TParams> : any;
  file?: UploadedFile;
  files?: Record<string, UploadedFile[]>;
  locale: string;
  t: (key: string, values?: any) => string;
  user?: TUser;
  jwt: { sign: (payload: any, opts?: any) => string };
  error: (status: number, message: string) => never;
}

export interface NextRouteConfig<TBody = any, TQuery = any, TParams = any, TEnv = any, TDb = any, TUser = any> {
  auth?: boolean | string[] | 'api-key' | string;
  body?: TBody;
  query?: TQuery;
  params?: TParams;
  cache?: number;
  rateLimit?: { windowMs: number; max: number; } | false;
  response?: ZodTypeAny;
  summary?: string;
  upload?: any;
  handler: (ctx: NextRouteContext<TBody, TQuery, TParams, TEnv, TDb, TUser>) => Promise<any> | any;
}

export interface BroNextInstance<TEnv = any, TDb = any, TUser = any> {
  z: typeof z;
  defineRoute: <
    TBody extends ZodTypeAny = any,
    TQuery extends ZodTypeAny = any,
    TParams extends ZodTypeAny = any
  >(
    config: NextRouteConfig<TBody, TQuery, TParams, TEnv, TDb, TUser>
  ) => (req: Request | any, context: any) => Promise<any>;
}

export declare function createBro<TEnv = any, TDb = any, TUser = any>(config?: NextBroGlobalConfig<TEnv, TDb, TUser>): BroNextInstance<TEnv, TDb, TUser>;
