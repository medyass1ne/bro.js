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

export interface NextBroGlobalConfig<TDb = any> {
  locale?: any;
  redisUrl?: string;
  auth?: {
    jwtSecret?: string;
    apiKey?: string | string[];
  };
  db?: TDb | Promise<TDb> | (() => TDb | Promise<TDb>) | { init: () => TDb | Promise<TDb> };
}

export interface NextRouteContext<TBody = any, TQuery = any, TParams = any, TDb = any> {
  req: Request;
  env: Record<string, string | undefined>;
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
  user?: any;
  jwt: { sign: (payload: any, opts?: any) => string };
  error: (status: number, message: string) => never;
}

export interface NextRouteConfig<TBody = any, TQuery = any, TParams = any, TDb = any> {
  auth?: boolean | string[] | 'api-key' | string;
  body?: TBody;
  query?: TQuery;
  params?: TParams;
  handler: (ctx: NextRouteContext<TBody, TQuery, TParams, TDb>) => Promise<any> | any;
}

export interface BroNextInstance<TDb = any> {
  z: typeof z;
  defineRoute: <
    TBody extends ZodTypeAny = any,
    TQuery extends ZodTypeAny = any,
    TParams extends ZodTypeAny = any
  >(
    config: NextRouteConfig<TBody, TQuery, TParams, TDb>
  ) => (req: Request | any, context: any) => Promise<any>;
}

export declare function createBro<TDb = any>(config?: NextBroGlobalConfig<TDb>): BroNextInstance<TDb>;
