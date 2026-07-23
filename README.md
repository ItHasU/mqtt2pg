# mqtt2pg

Forward MQTT messages to PostgreSQL.

`mqtt2pg` subscribes to one or more MQTT topics and inserts every received
message into a PostgreSQL table. It is a small, single-purpose service written
in TypeScript and shipped as a Docker image.

## How it works

```
MQTT broker  ──subscribe(MQTT_TOPICS)──▶  mqtt2pg  ──INSERT──▶  PostgreSQL (history)
```

1. On startup the configuration is read from environment variables and
   **validated**; a missing variable stops the process immediately with a clear
   message (fail fast).
2. It connects to PostgreSQL (waiting for it to be reachable) and to the MQTT
   broker, then subscribes to every topic in `MQTT_TOPICS`.
3. For each received message it stores one row in the `history` table:
   `(topic, payload)`.
4. The `payload` column is `jsonb`. If the message body is already valid JSON it
   is stored as-is (keeping its natural type: object, array, number…). Otherwise
   the raw text is stored as a JSON string, correctly escaped.
5. `SIGINT` / `SIGTERM` trigger a graceful shutdown that closes the MQTT and
   PostgreSQL connections before exiting (clean `docker stop`).

The source lives in [`src/`](src/) and compiles to `dist/`:

| File | Responsibility |
| --- | --- |
| `src/config.ts` | Read & validate environment variables (`ConfigError` on failure) |
| `src/payload.ts` | Normalise a raw message into valid JSON for the `jsonb` column |
| `src/retry.ts` | Exponential-backoff retry helper used for reconnection |
| `src/main.ts` | Wire MQTT ➜ PostgreSQL together |

## Resilience & reconnection

The service is designed to survive an outage of either dependency and resume on
its own once the dependency is back — no restart required.

- **MQTT broker down:** the client keeps reconnecting (every 2 s). On each
  reconnect it re-subscribes to `MQTT_TOPICS`, so message flow resumes
  automatically. The loss and the recovery are each logged once.
- **PostgreSQL down at startup:** the service waits, retrying with exponential
  backoff (1 s → 30 s), instead of crashing — handy when the database boots
  after the service (e.g. in Compose).
- **PostgreSQL down while running:** a connection pool transparently replaces
  dropped connections, and each failing insert is retried with backoff. A
  message received during a brief outage is still stored once the database
  returns; only a prolonged outage (retries exhausted) drops a message, which is
  logged. Recovery is logged as `PostgreSQL recovered; inserts resumed`.

## Configuration

All configuration comes from environment variables (loaded from a `.env` file
when run via docker-compose or VS Code):

| Variable | Required | Description |
| --- | --- | --- |
| `MQTT_URL` | yes | Broker URL. Use `mqtts://…` for TLS. Example: `mqtt://broker:1883` |
| `MQTT_TOPICS` | no | Comma-separated topics to subscribe to. MQTT wildcards (`+`, `#`) are supported, e.g. `sensors/#,home/+/temp`. If unset, the service logs a warning and falls back to `#` (all topics) |
| `DATABASE_URL` | yes | PostgreSQL connection string. Append `?sslmode=require` to force TLS. Example: `postgres://user:pass@db:5432/metrics` |

Example `.env`:

```dotenv
MQTT_URL=mqtt://broker:1883
MQTT_TOPICS=sensors/#,home/+/temp
DATABASE_URL=postgres://user:pass@db:5432/metrics
```

## Database setup

The target table must exist before starting the service — there are no
migrations in this repository. Minimal schema:

```sql
CREATE TABLE history (
    id          BIGSERIAL PRIMARY KEY,
    topic       TEXT        NOT NULL,
    payload     JSONB       NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Only `topic` and `payload` are written by the application; `id` and
`received_at` are optional conveniences.

## Running

### With Docker (intended deployment)

```bash
docker compose up            # uses ithasu/mqtt2pg:latest with your .env
```

To build the image locally:

```bash
docker build -t mqtt2pg .
docker run --rm --env-file .env mqtt2pg
```

The image is a small multi-stage build on `node:24-alpine`: TypeScript is
compiled in a build stage, and the runtime image contains only production
dependencies and the compiled `dist/`. It runs as the unprivileged `node` user.

### Locally with Node.js

Requires **Node.js ≥ 24**.

```bash
npm ci
npm run build
MQTT_URL=… MQTT_TOPICS=… DATABASE_URL=… npm start
```

### npm scripts

| Script | Description |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled app (`dist/main.js`) |
| `npm run dev` | Compile in watch mode |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the unit tests directly on the TypeScript sources (Node's built-in test runner + native TS support) |

## Security notes

- **Credentials never hit the logs.** Connection URLs are redacted (password
  masked) before being printed.
- **Use TLS in transit** where the broker and database support it: `mqtts://`
  for MQTT and `sslmode=require` (or stricter) for PostgreSQL.
- **Least privilege for the database user:** the service only needs `INSERT`
  (and, for the startup connectivity check, `SELECT`) on `history`. Do not use a
  superuser.
- **Runs as non-root** inside the container.
- **Do not commit your `.env`** — it holds broker and database credentials.
  It is covered by `.gitignore` and excluded from the Docker build context via
  `.dockerignore`.

## CI / deployment

`.github/workflows/ci.yml` runs on pushes to `main`: it builds the Docker image
and pushes it to Docker Hub as `ithasu/mqtt2pg:latest`. Because the TypeScript
build happens inside the Dockerfile, a compilation error fails the image build
and blocks the push.

## License

MIT — see [LICENSE](LICENSE).
