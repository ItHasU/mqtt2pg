# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`mqtt2pg` is a proof-of-concept that subscribes to MQTT topics and inserts every received message into a PostgreSQL table. The entire application is a single CommonJS file, `main.js` (~70 lines). There is no build step, no test suite, and no linter.

## Running

Configuration comes entirely from environment variables (loaded from a `.env` file when run via VS Code or docker-compose):

- `MQTT_URL` — MQTT broker URL (e.g. `mqtt://host:1883`)
- `MQTT_TOPICS` — comma-separated list of topics to subscribe to
- `DATABASE_URL` — PostgreSQL connection string

Run locally:
```bash
npm install
node main.js          # requires the three env vars above to be set
```

Run via Docker (the intended deployment): `docker compose up` uses the prebuilt `ithasu/mqtt2pg:latest` image with an `.env` file. To build locally: `docker build -t mqtt2pg .`

## Database expectation

`main.js` writes to a table that must already exist:
```sql
INSERT INTO history (topic, payload) VALUES ($1, $2)
```
`payload` is expected to be a JSON/JSONB column. The message handler first tries to insert the raw message (assuming it is valid JSON); if that fails it retries wrapping the message as a JSON string (`"<message>"`). There are no migrations in the repo — the `history` table must be created out of band.

## CI / deployment

`.github/workflows/ci.yml` runs only on pushes to `main`: it builds the Docker image and pushes it to Docker Hub as `ithasu/mqtt2pg:latest`. There is no test or lint job.

## Stale template artifacts (ignore)

`package.json` scripts (`clean`, `clean-all`) and `.vscode/tasks.json` reference an `apps/*` / `dagda/*` monorepo layout that does not exist in this repo — they are leftovers from a project template. Only the `mqtt` and `pg` dependencies and `main.js` are real. The `.vscode/launch.json` "mqtt2pg" config is the working way to debug (`program: main.js`, `envFile: .env`).
