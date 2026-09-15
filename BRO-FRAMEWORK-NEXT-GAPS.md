# bro-framework vs `bro-framework/next`

This comparison is based on the installed `bro-framework` 2.4.2 package in `node_modules/bro-framework`, specifically `src/server.js`, `src/router.js`, `src/tasks.js`, `src/sdk.js`, `src/locale.js`, `src/index.d.ts`, `src/next.js`, and `src/next.d.ts`.

## Executive Summary

The Next adapter is a route-handler adapter, not a complete replacement for the core Express server. It currently implements the request-level basics: Zod body/query/params parsing, JWT and API-key checks, database and Redis initialization, locale hooks, error handling, and native Web `FormData` parsing.

The following core features are not implemented in `bro-framework/next`:

- Core HTTP middleware and security setup: CORS and Helmet.
- Route-level and global rate limiting.
- Route response caching.
- OpenAPI generation and Scalar API documentation.
- Socket.IO server setup, socket lifecycle, and Redis Socket.IO adapter scaling.
- Background task discovery and cron scheduling.
- SDK generation.
- Core file-upload configuration and Multer behavior.
- File-based locale loading and locale hot reload.
- Graceful shutdown and the `onShutdown` hook.

## Feature Matrix

| Core capability | Core `bro-framework` | Next adapter | Status |
| --- | --- | --- | --- |
| Route handler wrapper | `defineRoute` returns route config consumed by Express | `createBro().defineRoute` returns a Next request handler | Implemented differently |
| Body validation | Flat `body` Zod schema | Flat `body` Zod schema | Implemented |
| Query validation | Flat `query` Zod schema | Flat `query` Zod schema | Implemented |
| Params validation | Flat `params` Zod schema | Flat `params` Zod schema; awaits Next params | Implemented |
| JWT authentication | Bearer JWT authentication and role checks | Bearer JWT authentication and role checks | Implemented differently |
| API-key authentication | `x-api-key`, configured key or key array | `x-api-key`, plus Authorization fallback; configured key, array, or comma-separated string | Implemented differently |
| Database injection | Core server receives initialized `db` and injects it into every handler | Adapter initializes `globalConfig.db` once and injects the result | Implemented differently |
| Redis connection | Redis client supports caching, rate limits, and Socket.IO scaling | Redis client is injected into `ctx.redis` | Partial; dependent features are missing |
| Locale resolution | Automatically loads locale files from `locale/` using `loadLocale` | Uses a supplied object with `resolveLocale`; otherwise uses an English identity translator | Partial |
| Multipart parsing | Multer, opt-in through `config.upload` | Native `req.formData()` for every multipart POST/PUT/PATCH request | Implemented differently |
| File limits and storage | Multer limits, `fileFilter`, custom storage, and `single`/`array`/`fields` selection | No `upload` route option or limits/storage/filter handling | Missing |
| Response schema | `response` documents a response in OpenAPI | No `response` config support | Missing |
| Route summary | `summary` contributes to OpenAPI metadata | No `summary` config support | Missing |
| Route cache | `cache` reads/writes Redis with method, URL, locale, and auth identity in the key | No cache handling | Missing |
| Rate limiting | Global and route-level `rateLimit` with Redis-backed and local fallback modes | No rate-limit handling | Missing |
| CORS | Global Express CORS middleware, configurable or disabled | No adapter-level CORS handling | Missing from adapter |
| Helmet | Global Helmet middleware enabled by default/configurable | No Helmet integration | Missing from adapter |
| OpenAPI | Builds route spec from schemas, auth, uploads, and response schemas | No spec generation | Missing |
| Scalar docs | Mounts `/docs` and `/docs/json`, with optional Basic Auth | No docs endpoints | Missing |
| Socket.IO | Creates Socket.IO server and calls `config.sockets(io, db)` | `ctx.io.emit` is only a warning stub | Missing |
| Redis Socket.IO adapter | Duplicates Redis clients and configures `@socket.io/redis-adapter` | No Socket.IO server or adapter | Missing |
| Background tasks | Scans `tasks/`, schedules `cron` exports, and stops them on shutdown | No task scanning or scheduling | Missing |
| SDK generator | `bro sdk` generates `bro-sdk.js` from route files | No Next equivalent in adapter | Missing |
| Graceful shutdown | Returns `shutdown()`, stops tasks, closes Socket.IO/Redis, and invokes `onShutdown` | No shutdown API or `onShutdown` support | Missing |
| Environment schema | Core config declares `env`; the server can inject parsed `envData` | Next config has no `env` field; `ctx.env` is raw `process.env` | Missing |
| Hot route reload | Core exposes `reload()` and route scanner reloads route modules | Next relies on Next's own route compilation/HMR | Not provided by adapter |

## Details

### 1. Route configuration options are incomplete

Core `RouteConfig` supports these options that are absent from `NextRouteConfig` and ignored by `src/next.js`:

```text
upload
response
cache
rateLimit
summary
```

The Next adapter's route config currently contains only `auth`, `body`, `query`, `params`, and `handler`.

This means a route may still accept an object containing one of these fields at runtime because JavaScript does not reject extra properties, but the adapter will not execute the corresponding behavior.

### 2. File uploads are native but not equivalent

The adapter's native parsing is useful for Next route handlers and supports the requested mixed text-plus-file request shape. It converts non-file form values into `ctx.body` and groups files into a field-to-array object in `ctx.files`.

It does not reproduce the core upload contract:

- No opt-in `upload` flag.
- No default or configurable file/field/part limits.
- No `fileFilter`.
- No custom storage engine.
- No `single`, `array`, or `fields` selection.
- No Multer `UploadedFile` metadata such as `originalname`, `mimetype`, `buffer`, `path`, or `filename`.

The Next adapter exposes Web `File` objects (`name`, `type`, `size`, `arrayBuffer()`, `stream()`, and `text()`) instead.

There is also a shape difference: the core type allows `ctx.files` to be either an array or a field map, while the Next type declares only a field map.

### 3. No OpenAPI or interactive documentation layer

The core router generates OpenAPI operations from route files, including:

- Body, params, and query schemas.
- Response schemas.
- Authentication security definitions.
- Multipart request metadata.
- Standard 400, 401, 404, and 500 responses.
- Route summaries.

The core server mounts the generated spec at `/docs/json` and Scalar UI at `/docs`. The Next adapter returns JSON directly from route handlers and does not generate or mount either endpoint.

### 4. No caching or rate limiting

Core routes can use `cache: seconds` and `rateLimit: { windowMs, max }`. The core server supports Redis-backed counters/cache with local middleware fallbacks.

The Next adapter connects Redis when `redisUrl` is configured, but `src/next.js` never reads `config.cache`, `config.rateLimit`, or global rate-limit configuration. Redis therefore remains available only as an injected context client in the adapter.

### 5. Realtime behavior is a stub

The core server creates a real Socket.IO server, invokes the global `sockets(io, db)` setup hook, and can configure the Socket.IO Redis adapter for multi-process scaling.

The Next adapter injects this instead:

```javascript
io: { emit: () => console.warn('[bro.js/next] WebSockets require standard bro.js server.') }
```

Handlers can call `ctx.io.emit`, but no event is delivered and there is no Socket.IO lifecycle in the adapter.

### 6. Lifecycle and background-task features are core-only

The core server scans `tasks/` for modules exporting `cron` and `handler`, starts them with `node-cron`, and stops them in `shutdown()`.

The core shutdown path also closes Socket.IO and Redis clients and calls `onShutdown(db)`. The Next adapter has no equivalent task manager, shutdown return value, or `onShutdown` invocation.

### 7. Locale loading differs

The core server automatically scans the configured locale directory, loads translation modules, negotiates `Accept-Language`, supports language-region fallback, and exposes `reloadLocale()`.

The Next adapter does not call `loadLocale`. It accepts a prebuilt locale object only when `globalConfig.locale.resolveLocale` exists; otherwise it returns `'en'` and translates every key to the key itself. There is no locale directory loading or reload API.

### 8. Environment validation is not carried over

The core type exposes `BroConfig.env`, and the core server injects `globalConfig.envData || process.env` into handlers. The Next config type has no `env` field and the adapter injects raw `process.env` directly as `ctx.env`.

Applications using a Zod environment schema therefore need to validate environment variables themselves when using the Next adapter.

## Important Behavioral Differences

These are not necessarily missing features, but they can affect portability between core routes and Next routes:

1. **Request parsing:** The core server relies on Express middleware and Multer. The adapter reads JSON or `req.formData()` directly and silently falls back to an empty body if parsing fails.
2. **Query values:** The adapter uses `Object.fromEntries(url.searchParams.entries())`, so repeated query keys are reduced to their last value. Express query parsing can preserve array-like values depending on configuration.
3. **Error response shape:** Zod failures from the adapter use `{ error: 'Validation Error', issues }`; core validation uses `{ error: 'Invalid Request Body' }`, `{ error: 'Invalid URL Parameters' }`, or `{ error: 'Invalid Query Parameters' }` with flattened details.
4. **JWT defaults:** Core `ctx.jwt.sign` applies the configured `auth.expiresIn` default when options are omitted. The adapter forwards `opts` directly to `signJwt`, so the configured default expiration is not applied by the adapter.
5. **API-key lookup:** Core API-key auth checks `x-api-key`; the adapter also accepts an Authorization value as a fallback and splits string configuration on commas.
6. **Runtime response validation:** Neither implementation runtime-validates handler output with `response`; core uses that schema for OpenAPI documentation only.

## Recommended Next Adapter Roadmap

For parity, the highest-value additions are:

1. Add `response`, `summary`, `cache`, `rateLimit`, and `upload` to `NextRouteConfig` and implement their behavior.
2. Add a Next-compatible OpenAPI registry or route metadata export, then expose `/docs/json` and a documentation UI through App Router routes.
3. Replace the `ctx.io` stub with an explicit integration boundary for a Socket.IO server or document a separate realtime server contract.
4. Add shared locale loading and environment parsing utilities that work in both core and Next runtimes.
5. Add lifecycle hooks for application shutdown where the deployment runtime supports them.
6. Add integration tests that compare core and Next responses for validation, auth, query arrays, uploads, and error formatting.
