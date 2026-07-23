import process from 'node:process';
import { connect, type MqttClient } from 'mqtt';
import { Pool } from 'pg';
import { loadConfig, redactUrl, ConfigError } from './config.js';
import { toJsonPayload } from './payload.js';

const INSERT_QUERY = 'INSERT INTO history (topic, payload) VALUES ($1, $2)';

async function main(): Promise<void> {
    const config = loadConfig();

    // -- Connect to the PostgreSQL database ----------------------------------
    // A pool (rather than a single client) lets concurrent inserts from the
    // MQTT message handler run without serialising on one connection.
    const pgPool = new Pool({ connectionString: config.databaseUrl });

    // Surface errors on idle pooled connections instead of crashing the process.
    pgPool.on('error', (error) => {
        console.error('PostgreSQL pool error:', error);
    });

    console.log('Connecting to PostgreSQL:', redactUrl(config.databaseUrl));
    await pgPool.query('SELECT 1'); // fail fast if the database is unreachable
    console.log('Connected to PostgreSQL');

    // -- Connect to the MQTT broker ------------------------------------------
    console.log('Connecting to MQTT broker:', redactUrl(config.mqttUrl));
    const mqttClient: MqttClient = connect(config.mqttUrl);

    mqttClient.on('connect', () => {
        console.log('Connected to MQTT broker');
        console.log('Subscribing to topics:', config.mqttTopics.join(', '));
        mqttClient.subscribe(config.mqttTopics, (error) => {
            if (error) {
                console.error('Failed to subscribe to topics:', error);
            }
        });
    });

    // -- Persist every received message --------------------------------------
    mqttClient.on('message', async (topic, message) => {
        const payload = toJsonPayload(message.toString());
        try {
            await pgPool.query(INSERT_QUERY, [topic, payload]);
        } catch (error) {
            console.error('Error inserting message into PostgreSQL:', error);
        }
    });

    mqttClient.on('error', (error) => {
        console.error('MQTT error:', error);
    });

    // -- Graceful shutdown ---------------------------------------------------
    let shuttingDown = false;
    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        console.log(`Received ${signal}, shutting down...`);
        try {
            await mqttClient.endAsync();
        } catch (error) {
            console.error('Error closing MQTT client:', error);
        }
        try {
            await pgPool.end();
        } catch (error) {
            console.error('Error closing PostgreSQL pool:', error);
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
