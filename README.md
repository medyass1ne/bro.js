<p align="center">
  <img src="https://brojs.yessindevs.me/bro.js.png" alt="bro.js Logo" width="256" height="256">
  <h1 align="center">bro.js</h1>
  <p align="center">
    <strong>The zero-boilerplate Node.js framework that actually has your back.</strong>
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/bro-framework"><img src="https://img.shields.io/npm/v/bro-framework.svg?style=flat-square&color=e11d48" alt="npm version"></a>
    <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License: MIT">
    <img src="https://img.shields.io/badge/Node.js-%3E%3D%2018-green.svg?style=flat-square" alt="Node.js: >= 18">
    <img src="https://img.shields.io/badge/Architecture-Pure%20ESM-orange.svg?style=flat-square" alt="Architecture: Pure ESM">
    <img src="https://img.shields.io/badge/Validation-Zod-3068b7.svg?style=flat-square" alt="Validation: Zod">
    <img src="https://img.shields.io/badge/Realtime-Socket.io-black.svg?style=flat-square" alt="Realtime: Socket.io">
    <img src="https://img.shields.io/badge/Engine-Express-eeeeee.svg?style=flat-square" alt="Engine: Express">
  </p>
  <p align="center">
    <a href="https://brojs.yessindevs.me">Documentation Website</a>
  </p>
</p>

---

> Skip the boilerplate. bro.js gives you file-based routing, automatic Zod validation, JWT auth, and WebSockets right out of the box. Just write your business logic, return an object, and let the framework handle the rest.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [The Core Experience](#the-core-experience)
- [Deep-Dive Features](#deep-dive-features)
- [Route Reference](#route-reference)
- [Context Reference](#context-reference)
- [Architecture & Request Lifecycle](#architecture--request-lifecycle)
- [Tech Stack Breakdown](#tech-stack-breakdown)
- [CLI Reference](#cli-reference)
- [Author & License](#author--license)

---

## Getting Started

Bootstrapping a new `bro.js` project is incredibly simple. We recommend using our official scaffolding tool to set everything up instantly (with your choice of JavaScript or TypeScript):

```bash
npx create-bro-framework@latest my-api
cd my-api
npm run dev
```

That's it! Your zero-boilerplate backend is now running with hot-reloading enabled.

## Configuration

Configuration lives in `bro.config.js`:

```javascript
import { defineConfig } from 'bro-framework';

export default defineConfig({
  server: { port: 5000, cors: true, helmet: true },
  auth: {
    jwtSecret: process.env.JWT_SECRET,
    expiresIn: '7d',
    apiKey: process.env.API_KEY
  },
  locale: { directory: './locale', defaultLocale: 'en' },
  rateLimit: { windowMs: 15 * 60 * 1000, max: 100 },
  docs: process.env.NODE_ENV !== 'production',
  redisUrl: process.env.REDIS_URL,
  db: async () => {
    // Initialize database connection here
  },
  sockets: async (io, db) => {
    // Setup Socket.IO event listeners here
  },
  onShutdown: async (db) => {
    // Close application-owned database resources here.
  }
});
```

`cors: false` disables HTTP CORS middleware. Helmet is enabled by default and can be disabled with `helmet: false`. Redis is optional; when configured it powers distributed rate limiting, route caching, and Socket.IO scaling. In `NODE_ENV=test`, bro.js can inject `ioredis-mock`; install it in the consuming project's development dependencies.

---

## The Core Experience

In `bro.js`, everything you need is handed to you instantly. No setup, no middleware wrangling, no manual `req/res` handling. You define your route, set your validation, and return an object. 

`routes/posts/[id].post.js`:

```javascript
import { defineRoute, z } from 'bro-framework';

export default defineRoute({
  auth: true,
  params: z.object({
    id: z.string().uuid()
  }),
  body: z.object({
    title: z.string().min(5),
    content: z.string()
  }),
  query: z.object({
    draft: z.coerce.boolean().default(false)
  }),
  response: z.object({
    success: z.boolean(),
    updated: z.number()
  }),
  handler: async ({ body, params, user, db, io }) => {
    // 1. Data is already validated. user is already authenticated.
    
    // 2. Perform database operation using the injected Mongoose context
    const post = await db.collection('posts').updateOne(
      { _id: params.id },
      { $set: { ...body, authorId: user.id } }
    );
    
    // 3. Broadcast to all clients instantly using injected Socket.io
    io.emit('post_updated', { postId: params.id, title: body.title });
    
    // 4. Return an object. bro.js handles the 200 JSON response.
    return {
      success: true,
      updated: post.modifiedCount
    };
  }
});
```

Validation schemas are flat and must be declared directly as `body`, `params`, and `query`. The deprecated nested `schema: { body, params, query }` form is rejected during route loading. The optional `response` schema documents the successful JSON response in OpenAPI; it does not runtime-validate handler output.

---

## Deep-Dive Features

### File-Based Routing
Create a `.js` file in the `routes/` directory, and it automatically becomes an endpoint. We use Next.js-style bracket syntax for dynamic parameters. A file named `routes/users/[id].get.js` translates natively to a `GET /users/:id` Express route under the hood.

### Bouncer-Grade Validation
Powered by Zod. Attach a schema to `body`, `query`, or `params` directly in your route definition. If the client sends malformed data, `bro.js` automatically rejects the request with a structured `400 Bad Request` JSON payload *before* your handler ever executes. You never have to manually validate inputs again. You can also define a `response` schema to strongly type your OpenAPI documentation (strictly opt-in; arbitrary 200s work out of the box).

### Zero-Config Auth (JWTs, RBAC, API Keys)
Add `auth: true` to your route config. `bro.js` will intercept the request, extract the `Authorization: Bearer <token>` header, verify the signature using your `jwtSecret`, and inject the decoded payload directly into `ctx.user`.
You can also use Role-Based Access Control by passing an array of roles (e.g. `auth: ['admin']`) or enforce service-to-service communication with `auth: 'api-key'`. API keys are read from `auth.apiKey` or `API_KEY` and support zero-downtime rotation with an array:

```javascript
auth: {
  apiKey: ['current-key', 'next-key']
}
```

Clients send the selected key in the `x-api-key` header. API-key routes are represented as `apiKeyAuth` operations in OpenAPI.

### Context Injection
Stop importing singleton database connections and socket instances into every file. Define your `db` and `sockets` setup once in `bro.config.js`. `bro.js` orchestrates the initialization and injects both instances directly into the `ctx` object for every request handler.

### Redis Caching and Lifecycle
Set `redisUrl` to enable distributed rate limiting, route caching, and Socket.IO pub/sub scaling. Add `cache: 60` to a route to cache its JSON response for 60 seconds. Cache keys include the request URL, resolved locale, and authorization/API-key identity; do not cache responses with dimensions that are not represented in the key.

The programmatic `createServer()` API returns `shutdown()`. It stops scheduled tasks, closes Socket.IO, closes Redis clients, runs the optional `onShutdown(db)` hook, and closes the HTTP server. The CLI calls it automatically on `SIGINT` and `SIGTERM`.

### Zero-YAML Live Documentation
If you've ever hand-written OpenAPI YAML, you know the pain. `bro.js` parses your Zod schemas and automatically serves a stunning, interactive [Scalar](https://scalar.com/) API playground at `/docs`. It's highly secure: by default, these internal docs are disabled in production mode.

### The Frontend SDK Generator
Tired of writing frontend `fetch` wrappers? Run `bro sdk`. The CLI parses your backend routes and compiles a JavaScript `bro-sdk.js` file. It includes token and locale headers, query serialization, URL-encoded dynamic parameters, and deep tree traversal (e.g., `api.users.id("123").get()`). Configure it with `setBaseURL()`, `setTokenKey()`, and `setLocale()`.

### Background Task Scheduler
Don't spin up a separate worker server. Drop a JavaScript file anywhere in the `tasks/` folder, export a cron string (e.g., `"0 0 * * *"`), and an async handler. `bro.js` natively schedules it as a background worker with full access to your injected database and WebSocket contexts.

### Zero-Boilerplate File Uploads
Add `upload: true` to a route. bro.js uses Multer to parse `multipart/form-data` and inject files into the context. Use `single`, `array`, or `fields` for explicit field handling:

```javascript
export default defineRoute({
  upload: {
    single: 'avatar',
    limits: { fileSize: 5 * 1024 * 1024 }
  },
  handler: ({ file }) => ({ name: file?.originalname })
});
```

`ctx.file` is used by `single()`. `ctx.files` is an array for `array()` or a field-to-array object for `fields()`. Defaults include limits for file size, file count, fields, parts, and field size. Use `storage` for production disk/object-storage integration instead of retaining large buffers in memory.

### File-Based Locale
Create a `locale/` folder with one translation file per locale, such as `locale/en.js` and `locale/fr.js`. Export a plain object from each file, then use `t()` in any route:

```javascript
// locale/fr.js
export default { welcome: 'Bienvenue, {name} !' };

// routes/welcome.get.js
export default defineRoute({
  handler: async ({ t }) => ({ message: t('welcome', { name: 'Sam' }) })
});
```

The locale is negotiated dynamically using RFC 9110 `Accept-Language` headers, supporting full region fallback and custom defaults, and the generated SDK can securely set it via `setLocale('fr')`.

## Route Reference

| Option | Type | Purpose |
| :--- | :--- | :--- |
| `auth` | `boolean \| string[] \| 'api-key'` | JWT, role, or API-key protection. |
| `body` | Zod schema | Validates JSON request bodies. |
| `params` | Zod schema | Validates URL parameters. |
| `query` | Zod schema | Validates query-string values. |
| `response` | Zod schema | Documents successful JSON output in OpenAPI. |
| `cache` | number | Redis response-cache duration in seconds. |
| `rateLimit` | `{ windowMs, max }` | Route-specific request limiting. |
| `upload` | boolean or options | Enables Multer parsing and limits. |
| `summary` | string | OpenAPI operation summary. |

Dynamic route files use bracket parameters such as `routes/users/[id].get.js`. Nested dynamic directories are supported. HTTP method suffixes are `get`, `post`, `put`, `delete`, `patch`, `options`, and `head`.

## Context Reference

Handlers receive:

| Property | Description |
| :--- | :--- |
| `body` | Validated body data. |
| `params` | Validated path parameters. |
| `query` | Validated query data. |
| `user` | Decoded JWT payload when JWT auth is used. |
| `db` | Value returned by `config.db`. |
| `io` | Socket.IO server instance. |
| `redis` | Redis client when Redis is enabled or test mode is active. |
| `file` | Single uploaded file from `upload.single()`. |
| `files` | Array or field map from `array()`/`fields()`. |
| `locale` | Resolved request locale. |
| `t` | Translation function, `t(key, values)`. |
| `jwt` | Configured JWT signing helper. |
| `env` | Parsed environment data when configured, otherwise `process.env`. |

## Testing

For Redis-backed integration tests without an external Redis server, install `ioredis-mock` in the consuming project and run with `NODE_ENV=test`. bro.js injects a mock Redis client and exercises cache, rate-limit, Socket.IO adapter, and shutdown paths.

---

## Architecture & Request Lifecycle

```text
       [ Incoming HTTP Request ]
                  │
                  ▼
         ( Express Engine )
                  │
                  ▼
     [ CORS / JSON Pre-flight ]
                  │
                  ▼
          ( Dev Logger )
                  │
                  ▼
      [ Auth Guard (JWT Check) ] ──(Fail)──> 401 Unauthorized
                  │
                  ▼
     [ Zod Bouncer Validation ] ───(Fail)──> 400 Bad Request
                  │
                  ▼
         ( Route Handler )
      ╭─────────────────────╮
      │ Injects:            │
      │ - ctx.body / params │
      │ - ctx.user          │
      │ - ctx.db            │
      │ - ctx.io            │
      │ - ctx.files         │
      ╰─────────────────────╯
                  │
                  ▼
      [ Auto JSON Formatter ] ─────(Fail)──> 500 Internal Error
                  │
                  ▼
      [ Client JSON Response ]
```

---

## Tech Stack Breakdown

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Engine** | Node.js (Express) | High-performance, battle-tested HTTP abstraction layer. |
| **Validation** | Zod | Bouncer-grade, strictly typed schema validation for payloads. |
| **Authentication** | jsonwebtoken | Stateless, scalable security for protecting endpoints. |
| **Realtime** | Socket.io | Bi-directional, event-driven WebSocket communication. |
| **API Reference** | Scalar | Auto-generated, interactive Swagger/OpenAPI documentation. |
| **Task Scheduler** | node-cron | Reliable internal background task orchestration. |
| **File Parsing** | multer | Zero-boilerplate `multipart/form-data` file extraction. |
| **Caching & Scaling** | Redis | Optional zero-config route caching, distributed rate-limiting, and WebSocket scaling. |
| **Security** | Helmet | Auto-configured industry-standard HTTP security headers. |

---

## CLI Reference

| Command | Description |
| :--- | :--- |
| `bro dev` | Development server featuring instant boot, visual CLI banner, and `chokidar`-powered hot module remapping. |
| `bro start` &nbsp; | Production runner locked down for security. Features Graceful Shutdown APIs (with `onShutdown` DB teardown), suppressed internal logs, and isolated API docs. |
| `bro init` | Automated workspace scaffolder. Generates configuration files and forcefully ensures your `package.json` respects `"type": "module"`. |
| `bro sdk` | Route parser and browser client compiler. Generates your typed `bro-sdk.js` frontend SDK in one hit. |

---

## Author & License

- **Author**: Yessin (@medyass1ne)
- **License**: MIT
