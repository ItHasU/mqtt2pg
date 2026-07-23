import process from 'node:process';
import { connect, type IClientOptions, type MqttClient } from 'mqtt';
import { Pool } from 'pg';
import { loadConfig, redactUrl, ConfigError } from './config.js';
import { toJsonPayload } from './payload.js';
import { retryWithBackoff } from './retry.js';

const INSERT_QUERY = 'INSERT INTO history (topic, payload) VALUES ($1, $2)';

// -- Resilience tuning -------------------------------------------------------
// The MQTT client reconnects on its own; the pg Pool transparently opens fresh
// connections once the database is reachable again. These constants control how
// aggressively we wait/retry so the service self-heals after an outage.
const MQTT_RECONNECT_PERIOD_MS = 2_000;
// Startup: keep waiting for the database (e.g. it boots after us in compose).
const DB_STARTUP_RETRY = { retries: Infinity, minDelayMs: 1_000, maxDelayMs: 30_000, factor: 2 };
// Per-message insert: ride out brief blips, then drop to avoid unbounded memory.
const DB_INSERT_RETRY = { retries: 6, minDelayMs: 500, maxDelayMs: 5_000, factor: 2 };

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
    const config = loadConfig();
    let shuttingDown = false;

    // -- Connect to the PostgreSQL database ----------------------------------
    // A pool (rather than a single client) lets concurrent inserts run without
    // serialising on one connection, and it automatically replaces connections
    // that were dropped while the database was down.
    const pgPool = new Pool({ connectionString: config.databaseUrl });

    // Surface errors on idle pooled connections instead of crashing the process.
    // This fires when the database drops an idle connection during an outage.
    pgPool.on('error', (error) => {
        console.error('PostgreSQL pool error (will recover on next query):', errorMessage(error));
    });

    console.log('Connecting to PostgreSQL:', redactUrl(config.databaseUrl));
    // Wait for the database to become reachable instead of exiting, so the
    // service can start before (or survive a restart of) PostgreSQL.
    await retryWithBackoff(() => pgPool.query('SELECT 1'), {
        ...DB_STARTUP_RETRY,
        onAttemptError: (error, attempt, delayMs) => {
            console.warn(
                `PostgreSQL not ready (attempt ${attempt}): ${errorMessage(error)}; retrying in ${delayMs} ms`,
            );
        },
    });
    console.log('Connected to PostgreSQL');

    // -- Connect to the MQTT broker ------------------------------------------
    // The client keeps trying to (re)connect on its own; `reconnectPeriod`
    // controls the interval. On every (re)connect we re-subscribe.
    console.log('Connecting to MQTT broker:', redactUrl(config.mqttUrl));
    const mqttOptions: IClientOptions = {
        reconnectPeriod: MQTT_RECONNECT_PERIOD_MS,
        connectTimeout: 30_000,
    };
    const mqttClient: MqttClient = connect(config.mqttUrl, mqttOptions);

    // `mqttWasConnected` distinguishes the first connect from a reconnect;
    // `mqttOffline` makes us log the loss only once, not on every retry.
    let mqttWasConnected = false;
    let mqttOffline = false;
    mqttClient.on('connect', () => {
        console.log(mqttWasConnected ? 'Reconnected to MQTT broker' : 'Connected to MQTT broker');
        mqttWasConnected = true;
        mqttOffline = false;
        console.log('Subscribing to topics:', config.mqttTopics.join(', '));
        mqttClient.subscribe(config.mqttTopics, (error) => {
            if (error) {
                console.error('Failed to subscribe to topics:', errorMessage(error));
            }
        });
    });

    mqttClient.on('close', () => {
        if (mqttWasConnected && !mqttOffline && !shuttingDown) {
            mqttOffline = true;
            console.warn('MQTT connection lost; reconnecting...');
        }
    });
    mqttClient.on('error', (error) => {
        console.error('MQTT error:', errorMessage(error));
    });

    // -- Persist every received message --------------------------------------
    let dbHealthy = true;
    mqttClient.on('message', async (topic, message) => {
        const payload = toJsonPayload(message.toString());
        try {
            await retryWithBackoff(() => pgPool.query(INSERT_QUERY, [topic, payload]), {
                ...DB_INSERT_RETRY,
                onAttemptError: (error) => {
                    if (dbHealthy) {
                        dbHealthy = false;
                        console.error(`PostgreSQL insert failing: ${errorMessage(error)}; retrying...`);
                    }
                },
            });
            if (!dbHealthy) {
                dbHealthy = true;
                console.log('PostgreSQL recovered; inserts resumed');
            }
        } catch (error) {
            console.error(
                `Dropping message on topic "${topic}" after repeated insert failures: ${errorMessage(error)}`,
            );
        }
    });

    // -- Graceful shutdown ---------------------------------------------------
    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        console.log(`Received ${signal}, shutting down...`);
        try {
            await mqttClient.endAsync();
        } catch (error) {
            console.error('Error closing MQTT client:', errorMessage(error));
        }
        try {
            await pgPool.end();
        } catch (error) {
            console.error('Error closing PostgreSQL pool:', errorMessage(error));
        }
        process.exit(0);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
    if (error instanceof ConfigError) {
        console.error(`Configuration error: ${error.message}`);
    } else {
        console.error('A fatal error occurred:', error);
    }
    process.exit(1);
});
