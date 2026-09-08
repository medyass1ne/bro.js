<p align="center">
  <h1 align="center">bro.js</h1>
  <p align="center">
    <strong>The zero-boilerplate Node.js framework that actually has your back.</strong>
  </p>
  <p align="center">
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

> "NestJS wants four decorators, three modules, and an existential crisis just to handle a GET request. Express makes you write the same 40 lines of CORS, JSON parsing, and auth middleware for every project. bro.js gives you file routing, auto-validation, JWT auth, WebSockets, and live docs out of the box. Be honest: you just want to return an object."

---

## Table of Contents

- [The Core Experience](#the-core-experience)
- [Deep-Dive Features](#deep-dive-features)
- [Architecture & Request Lifecycle](#architecture--request-lifecycle)
- [Tech Stack Breakdown](#tech-stack-breakdown)
- [CLI Reference](#cli-reference)
- [Author & License](#author--license)

---

## The Core Experience

In `bro.js`, everything you need is handed to you instantly. No setup, no middleware wrangling, no manual `req/res` handling. You define your route, set your validation, and return an object. 

`routes/posts/[id].post.js`:

```javascript
import { defineRoute, z } from 'bro.js';

export default defineRoute({
  auth: true,
  params: z.object({
    id: z.string().uuid()
  }),
  body: z.object({
    title: z.string().min(5),
    content: z.string()
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

---

## Deep-Dive Features

### File-Based Routing
Create a `.js` file in the `routes/` directory, and it automatically becomes an endpoint. We use Next.js-style bracket syntax for dynamic parameters. A file named `routes/users/[id].get.js` translates natively to a `GET /users/:id` Express route under the hood.

### Bouncer-Grade Validation
Powered by Zod. Attach a schema to `body`, `query`, or `params` in your route definition. If the client sends malformed data, `bro.js` automatically rejects the request with a structured `400 Bad Request` JSON payload *before* your handler ever executes. You never have to manually validate inputs again.

### Zero-Config JWTs
Add `auth: true` to your route config. `bro.js` will intercept the request, extract the `Authorization: Bearer <token>` header, verify the signature using your `jwtSecret`, and inject the decoded payload directly into `ctx.user`.

### Context Injection
Stop importing singleton database connections and socket instances into every file. Define your `db` and `sockets` setup once in `bro.config.js`. `bro.js` orchestrates the initialization and injects both instances directly into the `ctx` object for every request handler.

### Zero-YAML Live Documentation
If you've ever hand-written OpenAPI YAML, you know the pain. `bro.js` parses your Zod schemas and automatically serves a stunning, interactive [Scalar](https://scalar.com/) API playground at `/docs`. It's highly secure: by default, these internal docs are disabled in production mode.

### The Frontend SDK Generator
Tired of writing frontend `fetch` wrappers? Run `bro sdk`. The CLI will parse your backend routes and compile a `bro-client.js` file for your frontend. It features built-in token management, request stringification, and type-safe deep tree traversal (e.g., `api.users.id("123").post(data)`).

### Background Task Scheduler
Don't spin up a separate worker server. Drop a JavaScript file anywhere in the `tasks/` folder, export a cron string (e.g., `"0 0 * * *"`), and an async handler. `bro.js` natively schedules it as a background worker with full access to your injected database and WebSocket contexts.

### Zero-Boilerplate File Uploads
Add `upload: true` to a route. `bro.js` automatically hooks into `multer`, parses the `multipart/form-data` payload in memory, and injects the files directly into `ctx.files`.

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

---

## CLI Reference

| Command | Description |
| :--- | :--- |
| `bro dev` | Development server featuring instant boot, visual CLI banner, and `chokidar`-powered hot module remapping. |
| `bro start` &nbsp; | Production runner locked down for security. Zero watcher overhead, suppressed internal logs, and isolated API docs. |
| `bro init` | Automated workspace scaffolder. Generates configuration files and forcefully ensures your `package.json` respects `"type": "module"`. |
| `bro sdk` | Route parser and browser client compiler. Generates your frontend SDK in one hit. |

---

## Author & License

- **Author**: Yessin (@medyass1ne)
- **License**: MIT
