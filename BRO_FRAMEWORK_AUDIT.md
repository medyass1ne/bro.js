# bro-framework 2.0.1 audit

Date: 2026-09-11  
Package inspected: `bro-framework@2.0.1`  
Repository under test: the local package in `node_modules/bro-framework`  
Audit scope: runtime behavior, route parsing, server lifecycle, auth, validation, uploads, docs, tasks, and SDK generation.

## Executive summary

The package has a clean, small core and the basic request lifecycle works: file routes load, Zod validation runs, JWT auth works, route-level rate limiting and uploads are wired, and handlers can return JSON directly. The most urgent problems are concentrated in security defaults, the SDK generator, route parsing, and hot reload behavior.

### Highest-priority fixes

| Priority | Finding | Impact |
| --- | --- | --- |
| P0 | Generated SDK can be syntactically invalid | `bro sdk` can generate a client that cannot be imported at all. |
| P1 | `cors: false` enables permissive CORS | Applications cannot disable cross-origin access as configuration suggests. |
| P1 | Nested dynamic route parameters are not converted | Documented routes such as `/users/[userId]/videos/[videoId]` do not work. |
| P1 | Default JWT secret is weak and silently active | Misconfigured production applications can accept forgeable tokens. |
| P1 | Upload middleware has unlimited in-memory buffering | An upload endpoint can exhaust process memory. |
| P1 | Hot reload can replace a working router with a partial router | A single broken route import can make unrelated endpoints disappear. |
| P1 | `auth.expiresIn` is ignored | Token lifetime configuration is misleading and can create unexpected sessions. |
| P2 | Unknown routes return HTML, not the JSON API error format | API clients receive an inconsistent response contract. |
| P2 | OpenAPI output omits important security and error metadata | Generated docs understate the real API contract. |
| P2 | Environment schema results are validated but discarded | Coercions and defaults in `config.env` never reach application code. |

## Test method

The following checks were run against the installed package and the local demo application:

- Read all runtime files under `node_modules/bro-framework/src` and the CLI under `node_modules/bro-framework/bin`.
- Started the application and exercised video listing, filtering, details, search, channel listing, publishing, likes, comments, and invalid request bodies.
- Imported and tested `parseRouteFile` with static, index, dynamic, nested dynamic, and compound filenames.
- Ran `bro sdk` and parsed the generated file with `node --check`.
- Tested JWT signing and verification directly.
- Started a server with `cors: false` and inspected CORS response headers.
- Requested an unknown endpoint and inspected status, content type, and body.
- Used temporary audit routes to verify route-level rate limiting and multipart uploads. Both worked, so they are explicitly not reported as bugs.
- Inspected generated OpenAPI output.

## Confirmed bugs

### 1. SDK emits invalid JavaScript for hyphenated route segments

Severity: **P0**  
Area: SDK generator  
Status: **Confirmed at runtime**

`generateApiObject()` renders route segment names directly as JavaScript object keys. A route such as `/api/channel-videos/:id` produces:

```js
channel-videos: {
```

That is invalid syntax because the key is not quoted. The current demo generated this exact output, and `node --check bro-sdk.js` failed with:

```text
SyntaxError: Unexpected token '-'
```

Relevant source: [src/sdk.js](node_modules/bro-framework/src/sdk.js).

#### Recommended fix

Use a valid identifier transformation for generated keys, or quote every property key. The best API is usually:

```js
"channel-videos": {
```

For ergonomic clients, also consider camel-casing only when the transformation is deterministic and documented. Add a fixture route containing hyphens, dots, and reserved words, then run `node --check` on the generated client in CI.

### 2. Nested dynamic directory segments are not converted to Express parameters

Severity: **P1**  
Area: file routing  
Status: **Confirmed by direct parser test**

The README and project guidance describe routes such as:

```text
routes/users/[userId]/videos/[videoId].get.js
```

The parser returned:

```js
{ routePath: '/users/[userId]/videos/:videoId', method: 'get' }
```

Only the final filename is transformed. Directory names are copied verbatim. Express therefore treats `[userId]` as a literal path segment. This forced the demo API to use flat routes such as `/api/channel-videos/:id` instead of the documented nested form.

Relevant source: [src/router.js](node_modules/bro-framework/src/router.js), `parseRouteFile()`.

#### Recommended fix

Transform every path segment, not only `namePart`. A safe route conversion should split the relative path into segments, remove the final method suffix, and apply the bracket replacement to each segment. Add parser tests for one and multiple nested parameters.

### 3. `cors: false` still enables wildcard CORS

Severity: **P1**  
Area: server security configuration  
Status: **Confirmed by runtime test**

The server computes the configured value, then calls:

```js
cors(typeof corsConfig === 'object' ? corsConfig : {})
```

Both `true` and `false` become `{}`, which is the permissive default. A server created with `{ server: { cors: false } }` returned:

```text
Access-Control-Allow-Origin: *
```

This contradicts the apparent meaning of the setting and makes it impossible to disable CORS.

Relevant source: [src/server.js](node_modules/bro-framework/src/server.js).

#### Recommended fix

Mount CORS conditionally:

```js
if (corsConfig !== false) {
  app.use(cors(corsConfig === true ? {} : corsConfig));
}
```

Add tests for `true`, `false`, and an options object.

### 4. `auth.expiresIn` is never used

Severity: **P1**  
Area: JWT configuration  
Status: **Confirmed by source inspection**

The CLI loads `userConfig.auth.jwtSecret`, but it never maps `userConfig.auth.expiresIn` into the signing helper. `signJwt()` defaults to `expiresIn: '1d'`. The scaffolded config advertises `expiresIn: '7d'`, but that value has no effect unless application code manually passes an option to `ctx.jwt.sign()`.

Relevant sources: [bin/bro.js](node_modules/bro-framework/bin/bro.js) and [src/auth.js](node_modules/bro-framework/src/auth.js).

#### Recommended fix

Store a complete auth configuration in the server instance or expose a configured signer, for example `setJwtConfig({ secret, expiresIn })`. Avoid global mutable auth state; see the related finding below.

### 5. A weak default JWT secret is silently enabled

Severity: **P1**  
Area: authentication security  
Status: **Confirmed by source inspection**

The CLI falls back to `dev_secret_please_change`, while the auth module itself falls back to `bro_default_secret_key`. If a production deployment omits its secret, tokens can be forged by anyone who knows the package defaults. The framework starts normally instead of failing closed.

Relevant sources: [bin/bro.js](node_modules/bro-framework/bin/bro.js), [src/auth.js](node_modules/bro-framework/src/auth.js), and [bro.config.js](bro.config.js).

#### Recommended fix

Require a non-empty secret in production and throw during startup if it is absent or still equals a known development default. Keep a development fallback only when `NODE_ENV !== 'production'`.

### 6. File uploads use unlimited in-memory storage

Severity: **P1**  
Area: resource exhaustion  
Status: **Confirmed by source inspection**

The package creates one global `multer()` instance with no `limits`, `fileFilter`, or disk/object-storage strategy, then uses `upload.any()`. Every accepted upload is buffered in process memory, and any field name is accepted. A public upload route can consume memory until the process is killed.

Relevant source: [src/server.js](node_modules/bro-framework/src/server.js).

#### Recommended fix

Expose upload options in route configuration and apply safe defaults for file size, number of files, field count, and total request size. Prefer an explicit field list over `any()`. Document how handlers should stream or persist files rather than retaining unbounded buffers.

### 7. Hot reload can replace the working router with a partial router

Severity: **P1**  
Area: development reliability  
Status: **Confirmed by source inspection; failure mode is deterministic**

`loadRoutes()` catches import errors per file and continues. `reload()` then returns the new router regardless of whether some routes failed. The CLI assigns that router to `routeStack`. If one edited route has a syntax error or missing import, unrelated routes that failed only because of the same reload pass can disappear until the next successful reload.

Relevant sources: [src/router.js](node_modules/bro-framework/src/router.js), [src/server.js](node_modules/bro-framework/src/server.js), and [bin/bro.js](node_modules/bro-framework/bin/bro.js).

#### Recommended fix

Make reload transactional: load and validate all route modules into a new router, return a failure result if any required route cannot load, and keep the previous router when the result is unhealthy. Report the failed files clearly.

### 8. Unknown routes return Express HTML instead of JSON

Severity: **P2**  
Area: API consistency  
Status: **Confirmed by runtime test**

Requesting an unknown route returned `404 text/html` with an Express error page containing `Cannot GET /...`. All framework-managed route errors otherwise use JSON. API consumers therefore need two error parsers.

#### Recommended fix

Install a final JSON 404 middleware after the route stack, for example `{ error: 'Not Found' }`, and add a test for an unknown method and unknown path. Consider also adding a JSON error middleware for uncaught Express errors.

### 9. The OpenAPI document is incomplete and can be misleading

Severity: **P2**  
Area: documentation  
Status: **Confirmed by source inspection and document inspection**

The generated operation metadata has several gaps:

- `auth: true` does not add a bearer security scheme or operation security requirement.
- Every route advertises only a `200` response, even though auth, validation, 404, and 500 responses are built in.
- Upload routes do not describe `multipart/form-data` or files.
- There is no schema for the successful response.
- The OpenAPI `info` title and version are hard-coded.
- Route-level rate limits are not represented.
- The generated `required` status for path parameters is always true, even when the supplied Zod schema could be optional.

Relevant source: [src/router.js](node_modules/bro-framework/src/router.js) and [src/server.js](node_modules/bro-framework/src/server.js).

#### Recommended fix

Build a complete base OpenAPI document with `components.securitySchemes.bearerAuth`, standard error schemas, and configurable API metadata. Add operation-level security, upload request bodies, and at least the framework-generated 400, 401, 404, and 500 responses.

### 10. Environment validation results are discarded

Severity: **P2**  
Area: configuration  
Status: **Confirmed by source inspection**

The CLI calls `globalConfig.env.safeParse(process.env)` and exits on failure, but on success it does not replace `process.env` or expose the parsed result. Zod defaults, coercions, transforms, and normalized values are therefore lost. The feature validates input but does not provide the validated configuration to routes or the app.

Relevant source: [bin/bro.js](node_modules/bro-framework/bin/bro.js).

#### Recommended fix

Assign the successful `result.data` to a documented context, such as `globalConfig.envData`, and inject it into route context. Do not mutate `process.env` with typed values.

### 11. Global JWT state leaks across server instances

Severity: **P2**  
Area: isolation and testing  
Status: **Confirmed by source inspection**

`src/auth.js` stores the secret in a module-level variable. Calling `createServer()` for a second app changes the secret used by the first app as well. This affects tests, embedded applications, multi-tenant processes, and any process hosting more than one server.

Relevant sources: [src/auth.js](node_modules/bro-framework/src/auth.js) and [src/server.js](node_modules/bro-framework/src/server.js).

#### Recommended fix

Create auth helpers bound to a server configuration, or pass the configured secret into the request handler closure. Keep the exported helper API only as a backwards-compatible convenience layer.

### 12. SDK dynamic path values are not URL encoded

Severity: **P2**  
Area: generated client correctness and security  
Status: **Confirmed by source inspection**

Generated calls interpolate values directly into template literals:

```js
`/users/${id}`
```

An id containing `/`, `?`, `#`, spaces, or percent sequences can change the request path or query. This also makes the generated SDK unsafe for ordinary user-controlled identifiers.

Relevant source: [src/sdk.js](node_modules/bro-framework/src/sdk.js).

#### Recommended fix

Generate `encodeURIComponent(id)` for each dynamic segment. Add tests for spaces, slashes, Unicode, and reserved URL characters.

### 13. Route import failures are swallowed during normal loading

Severity: **P2**  
Area: observability and correctness  
Status: **Confirmed by source inspection**

`loadRoutes()` logs an import failure and continues. The caller receives a route list that looks valid but silently lacks endpoints. This is especially dangerous in production startup, where a typo can deploy an incomplete API while the process reports that it is running.

#### Recommended fix

Return structured load errors and make startup fail by default when a route module cannot be imported. Provide an explicit development-only best-effort mode if desired.

### 14. Rapid reloads can reuse an import cache-busting timestamp

Severity: **P3**  
Area: development tooling  
Status: **Confirmed by source inspection**

Route imports append `?update=${Date.now()}`. Two reloads within the same millisecond can receive the same URL and reuse the module cache. This is rare but easy to avoid.

#### Recommended fix

Use a monotonic reload counter or a high-resolution unique token per reload instead of relying on millisecond wall-clock time.

### 15. Task discovery is non-recursive and lacks lifecycle management

Severity: **P2**  
Area: background tasks  
Status: **Confirmed by source inspection**

`scanTasks()` only lists `.js` files directly in `process.cwd()/tasks`; nested task folders are ignored. It also does not return cron job handles or provide a shutdown method, so applications cannot stop scheduled jobs cleanly during tests or graceful shutdown.

Relevant source: [src/tasks.js](node_modules/bro-framework/src/tasks.js).

#### Recommended fix

Reuse the recursive scanner or document the flat-only behavior. Return scheduled task handles and expose `stopTasks()` for process shutdown and test isolation. Consider a task identifier and duplicate detection.

## Lower-priority correctness and maintainability issues

### Configuration and startup

- Configuration load errors are logged and startup continues with defaults. A production app can run with an unintended secret, port, rate limit, or database configuration.
- `BroConfig` types document nested `server.port`, while the CLI also supports legacy/top-level values internally. The public type contract should match the actual accepted shape.
- The framework initializes the database before environment validation. Invalid configuration can open connections and then terminate without a cleanup path.
- There is no framework-owned graceful shutdown path for HTTP, Socket.IO, database resources, or cron jobs.
- The default scaffold uses a development secret directly in `bro.config.js`, making accidental production deployment easy.

### Error handling

- `ctx.error(status, message)` accepts arbitrary values. Invalid status codes can cause secondary Express errors instead of a clean API response.
- Handler errors are logged with full stack traces to stderr, which can expose sensitive paths or application details in centralized logs.
- The framework hard-codes `500 Internal Server Error` for all unrecognized errors but does not provide a configurable error serializer or correlation id.
- The route wrapper always sends `200` for returned data. There is no supported route-level status or response-header API, which makes redirects, `201 Created`, `204 No Content`, caching, and content negotiation awkward.

### Routing

- Duplicate route method/path combinations are not detected or warned about; filesystem order decides which handler is effective.
- `parseRouteFile()` accepts any filename suffix and only later checks whether Express has a method with that name. Invalid route files are silently ignored.
- Dots in route names are interpreted as part of the route name after the final method suffix. This makes filenames such as `[id].comments.get.js` produce an unexpected parameter named `id.comments`.
- `scanDir()` follows every directory beneath `routes`, including directories that may contain non-route JavaScript helpers. The convention should either reserve a helper directory or distinguish route modules explicitly.

### SDK

- The README says the output is `bro-client.js`, while the CLI actually writes `bro-sdk.js`.
- The generated API tree can collide when a static segment and a parameter have the same normalized key.
- Hyphenated, spaced, reserved, and otherwise non-identifier route segments need a stable property-key strategy.
- Query serialization appends `?` even when the data object serializes to an empty string.
- The generated client assumes `fetch` and `localStorage` semantics but does not allow injecting a custom fetch implementation, headers, credentials, or abort signal.
- SDK generation does not include validation types, request/response types, OpenAPI-derived models, or the route schemas that are available at runtime.

## Findings from the earlier demo work

These findings came from building and testing the YouTube-like API in this workspace and are important integration lessons, although some are application-level rather than package defects.

### Dynamic nested routes initially appeared to load but were unreachable

The first implementation used paths such as `routes/api/videos/[id]/comments.get.js`. The framework printed them as `/api/videos/[id]/comments`, and requests to `/api/videos/video-bro-api/comments` returned 404. This was the runtime manifestation of the nested dynamic parser bug described above.

### In-memory database behavior resets on restart

The demo configured `db: async () => null`, so the API used a local store to remain runnable without an external database. Published videos, likes, and comments disappear on restart. This is expected for the demo, but the framework documentation should make persistence and transaction responsibilities explicit when `db` is null.

### The framework's actual route API differs from some guidance

The installed package supports top-level `body`, `query`, and `params` schemas. The workspace guidance showed a nested `schema: { ... }` object, which the runtime does not read. Documentation and generated examples should use one canonical API shape.

### Confirmed non-bugs

- Route-level `rateLimit` is applied. A temporary route with `max: 1` returned 429 after its first request was consumed.
- Route-level `upload: true` is applied. A multipart request reached the handler with one parsed file.
- Basic JWT signing and verification work, including expiry detection in `verifyJwt()`.
- Route body, query, and parameter Zod validation returned 400 for invalid input.
- Socket.IO setup and database context injection are present in the request context.

## Suggested regression suite

The package would benefit from a small automated suite that runs without a network dependency:

1. `parseRouteFile()` tests for static, index, nested dynamic, multiple dynamic, dotted, and hyphenated segments.
2. `createServer()` tests using an ephemeral port and `fetch` for JSON success, validation 400, auth 401, handler 404, unknown route 404, and handler 500.
3. CORS tests for `true`, `false`, and an options object.
4. JWT tests proving configured secret and configured expiration are used, plus startup rejection of a production default secret.
5. Upload tests for file count, maximum size, maximum number of files, and rejected content types.
6. Reload tests proving a failed reload keeps the previous healthy router and a successful reload swaps routes atomically.
7. OpenAPI tests for bearer security, request schemas, upload schemas, and standard error responses.
8. SDK tests that generate routes containing hyphens and dynamic values, run `node --check`, import the result, and verify URL encoding.
9. Task tests for nested task discovery, scheduling errors, and clean shutdown.
10. Type tests comparing `index.d.ts` with the runtime-supported configuration and route options.

## Recommended repair order

1. Fix SDK key quoting and dynamic path encoding.
2. Fix nested parameter parsing and add parser tests.
3. Make production authentication fail closed without an explicit secret; wire `expiresIn`.
4. Correct `cors: false` semantics.
5. Add upload limits and a configurable storage strategy.
6. Make route loading and hot reload transactional.
7. Add JSON 404/error middleware.
8. Repair environment injection and configuration failure behavior.
9. Bring OpenAPI output and TypeScript declarations up to parity with runtime behavior.
10. Add task lifecycle controls and graceful server shutdown.

## Files inspected

- [src/auth.js](node_modules/bro-framework/src/auth.js)
- [src/index.js](node_modules/bro-framework/src/index.js)
- [src/logger.js](node_modules/bro-framework/src/logger.js)
- [src/router.js](node_modules/bro-framework/src/router.js)
- [src/server.js](node_modules/bro-framework/src/server.js)
- [src/sdk.js](node_modules/bro-framework/src/sdk.js)
- [src/tasks.js](node_modules/bro-framework/src/tasks.js)
- [src/index.d.ts](node_modules/bro-framework/src/index.d.ts)
- [bin/bro.js](node_modules/bro-framework/bin/bro.js)
- [README.md](node_modules/bro-framework/README.md)