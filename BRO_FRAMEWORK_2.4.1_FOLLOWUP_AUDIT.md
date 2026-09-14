# bro-framework follow-up audit

Date: 2026-09-14  
Package resolved by workspace: `bro-framework@2.4.1`  
Requested update: newer version, unspecified  
Audit type: fresh regression and integration re-audit

## Important version note

The local workspace still resolves `bro-framework@2.4.1` from the linked package. No newer package version was present in `node_modules/bro-framework/package.json`, so this report certifies the current 2.4.1 source again rather than claiming results for an unseen release.

## Verdict

**PASS for the currently installed package, with Redis runtime coverage limited by environment.**

The two 2.4.1 findings from the previous audit are fixed in the current source:

- API-key routes now receive an OpenAPI `apiKeyAuth` security requirement.
- Redis global and route fallback limiters are constructed once and reused.

The earlier Redis shutdown, cache isolation, corrupt-cache recovery, validation, OpenAPI response, locale, upload, SDK, Helmet, and shutdown fixes remain present. A live Redis integration test was not possible because no local Redis server executable is installed.

## Scorecard

| Area | Check | Result | Evidence |
| --- | --- | --- | --- |
| Package version | Current package identity | **PASS / NOTE** | Workspace resolves 2.4.1, not a newer version. |
| Validation | Invalid flat body rejected | **PASS** | 400 returned before handler execution. |
| Validation | Valid flat body/query accepted | **PASS** | 200 response returned. |
| OpenAPI | Explicit response schema | **PASS** | 200 JSON schema generated. |
| OpenAPI | API-key security metadata | **PASS** | `apiKeyAuth` scheme and operation mapping present. |
| OpenAPI | Standard errors | **PASS** | 400/404/500 references remain present. |
| Locale | RFC quality/q=0/fallback | **PASS** | Prior implementation remains in place. |
| Upload | Partial default-limit merge | **PASS** | Complete defaults remain merged before overrides. |
| SDK | Null-prototype tree | **PASS** | `Object.create(null)` remains present. |
| SDK | `$` parameter encoding | **PASS** | `$` is accepted by the replacement regex. |
| Security | Helmet defaults | **PASS** | `nosniff` header observed. |
| Lifecycle | Repeated shutdown | **PASS** | Two calls resolved. |
| Lifecycle | Shutdown before listen | **PASS** | Returned `shutdown()` resolved safely before `server.listen()`. |
| Redis | Pub/sub cleanup | **PASS / source-confirmed** | Both duplicate clients are quit. |
| Redis | Fallback limiter ownership | **PASS / source-confirmed** | Global and route fallback limiters are created once. |
| Redis | Live integration | **NOT RUN** | No local `redis-server` executable available. |

## Regression results

### Flat validation and context: PASS

The current server reads top-level route properties:

```js
const bodySchema = routeConfig.body;
const paramsSchema = routeConfig.params;
const querySchema = routeConfig.query;
```

The temporary route returned 400 for an invalid body and 200 for a valid body/query request. The handler received the expected request data and context fields. The fatal nested-schema guard remains active for deprecated `schema` wrappers.

### OpenAPI response parity: PASS

The router still reads `config.response` and emits `responses.200.content['application/json'].schema` using `zodToJsonSchema`. The generated operation also includes standard 400, 404, and 500 references.

### API-key OpenAPI mapping: fixed

The router now defines and selects:

```js
apiKeyAuth: {
  type: 'apiKey',
  in: 'header',
  name: 'x-api-key'
}
```

For `auth: 'api-key'`, generated operations use `apiKeyAuth`; bearer routes continue to use `bearerAuth`. This fixes the previous documentation mismatch.

### Locale: PASS

The locale module still supports quality parsing, `q=0` exclusion, descending preference order, later supported-language fallback, underscore normalization, UUID cache busting, and configured defaults. The current workspace has no locale catalog files, so the direct runtime probe resolved to the default `en`; the source regression check passed.

### Upload defaults: PASS

The complete default limits remain applied before global and route-level overrides:

```js
fileSize: 10 * 1024 * 1024,
files: 5,
fields: 20,
parts: 25,
fieldSize: 1024 * 1024
```

This preserves the previous partial-limit fix.

### SDK hardening: PASS

The generator retains null-prototype route maps and the `$`-aware dynamic path regex. Generated paths continue to use `encodeURIComponent`.

### Helmet: PASS

Helmet remains enabled by default. A live request returned `X-Content-Type-Options: nosniff`.

## Redis findings retested

### Pub/sub client shutdown: fixed and stable

The source retains `pubClient` and `subClient` in server scope and closes both alongside the primary client through `Promise.allSettled`.

### Startup cleanup: fixed and stable

Initial Redis connection and Socket.IO adapter setup are wrapped in cleanup paths that quit clients already created when connection setup fails.

### Cache isolation: fixed and stable

Cache keys include the request locale and a SHA-256 identity hash derived from authorization/API-key headers. This prevents the prior cross-locale and cross-identity cache collision.

### Corrupt cache recovery: fixed and stable

Cache parse failures delete the bad key and allow the request to rebuild the response.

### Rate-limit fallback: fixed and stable

The current source constructs fallback limiters once:

```js
const fallbackLimiter = rateLimit(globalConfig.rateLimit);
```

and similarly for route-level limits. Redis errors reuse those instances instead of creating one per request.

## New audit observations

### 1. Redis behavior remains unverified at runtime

Severity: **P2 test-coverage gap**  
Status: **Not run**

There is no local Redis executable. The following behaviors remain source-confirmed only:

- Redis connection/reconnect behavior
- Redis-backed global and route rate limiting
- Socket.IO Redis adapter communication
- Cache hit/miss/TTL behavior
- Corrupt cache deletion against a real Redis server
- Redis client state after shutdown

#### Recommendation

Add a Redis service to CI and run integration tests covering startup, adapter connectivity, rate-limit outages, cache corruption, TTL, and shutdown.

### 2. The installed package did not advance beyond 2.4.1

Severity: **P2 release-process note**  
Status: **Confirmed**

The requested update could not be independently certified because the linked package metadata still reports 2.4.1. This report should not be used as evidence for a later version until the workspace is relinked/installed and the package version is rechecked.

## Remaining non-blocking risks

- Multipart OpenAPI schemas remain generic.
- Path parameters are marked required unconditionally in OpenAPI.
- Upload result typings do not precisely model `single`, `array`, and `fields` shapes.
- Configuration import failures may continue with defaults.
- API keys are now configurable through `globalConfig.auth.apiKey`, but rotation and multi-key support are not provided.
- `ctx.error()` accepts arbitrary status values.
- Cache safety still depends on route authors selecting appropriate cache behavior.
- SDK lacks generated request/response types and injectable fetch/error APIs.

## Recommended next steps

1. Install or relink the intended newer package version and rerun this report against its actual version.
2. Add live Redis CI coverage.
3. Add OpenAPI multipart/success-response snapshots.
4. Improve upload result typings and API-key rotation configuration.

## Final certification

**PASS for the installed `bro-framework@2.4.1` package.**

The prior 2.4.1 defects are fixed in the current source, all available runtime checks passed, and no new blocking defect was found. Certification of a newer release remains pending because no newer version is currently installed in this workspace.

## Files inspected

- [src/auth.js](node_modules/bro-framework/src/auth.js)
- [src/index.js](node_modules/bro-framework/src/index.js)
- [src/locale.js](node_modules/bro-framework/src/locale.js)
- [src/router.js](node_modules/bro-framework/src/router.js)
- [src/server.js](node_modules/bro-framework/src/server.js)
- [src/sdk.js](node_modules/bro-framework/src/sdk.js)
- [src/tasks.js](node_modules/bro-framework/src/tasks.js)
- [src/index.d.ts](node_modules/bro-framework/src/index.d.ts)