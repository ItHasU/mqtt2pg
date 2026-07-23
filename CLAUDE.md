# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`mqtt2pg` subscribes to MQTT topics and inserts every received message into a PostgreSQL `history` table. It is a small TypeScript service (`src/`, ~3 files) compiled to `dist/` and shipped as a Docker image. There is no framework and no runtime state beyond the two connections.

## Layout

- `src/config.ts` — reads and validates env vars; throws `ConfigError` (reported without a stack trace) when one is missing. Exports `loadConfig()` and `redactUrl()` (masks passwords before logging).
- `src/payload.ts` — `toJsonPayload(raw)`: returns the raw message unchanged if it is already valid JSON, otherwise `JSON.stringify`s it so arbitrary text is stored as a valid JSON string. Pure and unit-tested.
- `src/main.ts` — entry point: connects to PostgreSQL (a `pg` **Pool**, so concurrent inserts don't serialise on one connection), connects to MQTT, subscribes to `MQTT_TOPICS`, and inserts each message. Handles `SIGINT`/`SIGTERM` for graceful shutdown.
- `src/payload.test.ts` — Node built-in test runner (`node:test`), run against the compiled JS.

## Commands

```bash
npm ci
npm run build        # tsc -> dist/
npm run typecheck    # tsc --noEmit
npm test             # builds, then: node --test "dist/**/*.test.js"
npm start            # node dist/main.js  (needs the env vars below)
```

TypeScript is on the **7.x** line and the config uses `module`/`moduleResolution: nodenext`, so **relative imports must carry a `.js` extension** (e.g. `import { toJsonPayload } from './payload.js'`) even though the sources are `.ts`. Output is CommonJS (no `"type"` in `package.json`). Requires **Node ≥ 24** (`engines`).

## Configuration (env vars)

- `MQTT_URL` — broker URL (`mqtt://` or `mqtts://`)
- `MQTT_TOPICS` — comma-separated topics; MQTT wildcards (`+`, `#`) allowed
- `DATABASE_URL` — PostgreSQL connection string (supports `sslmode`)

All three are required; missing ones fail fast. The `history` table must already exist (see the DDL in `README.md`) — there are **no migrations** in the repo. `payload` is a `jsonb` column.

## Docker / CI

`Dockerfile` is multi-stage (Node 24-slim): a build stage runs `npm ci` + `npm run build`; the runtime stage installs prod deps only (`npm ci --omit=dev`) and runs as the non-root `node` user. `.dockerignore` keeps `node_modules`, `.env`, `dist`, etc. out of the build context.

`.github/workflows/ci.yml` runs on pushes to `main`: it builds the image and pushes `ithasu/mqtt2pg:latest` to Docker Hub. The TS build runs inside the Dockerfile, so a broken build fails the push — there is no separate test/lint job.

## Debugging

`.vscode/launch.json` ("mqtt2pg") builds via the `npm: build` task then launches `dist/main.js` with `.env`. `.vscode/tasks.json` defines that build task.
