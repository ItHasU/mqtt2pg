const mqtt = require('mqtt');
const { Client } = require('pg');
const process = require('process');

async function main() {
    // -- Read configuration from environment variables -----------------------
    // MQTT configuration
    const mqttBrokerUrl = process.env.MQTT_URL;
    const mqttTopics = process.env.MQTT_TOPICS.split(",");

    // PostgreSQL configuration
    const databaseUrl = process.env.DATABASE_URL;

    // -- Connect to the PostgreSQL database ----------------------------------
    const pgClient = new Client(databaseUrl);

    console.log("Connecting to PostgreSQL...");
    console.log("Database URL:", databaseUrl);
    await pgClient.connect();
    console.log("Connected to PostgreSQL");

    // -- Connect to the MQTT broker ------------------------------------------
    console.log("Connecting to MQTT broker...");
    console.log("MQTT broker URL:", mqttBrokerUrl);
    const mqttClient = mqtt.connect(mqttBrokerUrl);

    // -- Subscribe to MQTT topic ---------------------------------------------
    mqttClient.on('connect', () => {
        console.log('Connected to MQTT broker');
        console.log('Subscribing to MQTT topics:', mqttTopics.join(', '));
        mqttClient.subscribe(mqttTopics);
    });

    // Handle MQTT messages
    mqttClient.on('message', async (topic, message) => {
        try {
            // Insert message into PostgreSQL
            const query = 'INSERT INTO history (topic, payload) VALUES ($1, $2)';

            try {
                await pgClient.query(query, [topic, message.toString()]);
            } catch (error) {
                // Failed to insert message as pure JSON, try to insert as text
                try {
                    await pgClient.query(query, [topic, `"${message.toString()}"`]);
                } catch (error) {
                    console.error('Error inserting message into PostgreSQL:', error);
                }
            }
        } catch (error) {
            console.error('Error processing MQTT message:', error);
        }
    });

    // Handle MQTT errors
    mqttClient.on('error', (error) => {
        console.error('MQTT error:', error);
    });

    // Handle PostgreSQL errors
    pgClient.on('error', (error) => {
        console.error('PostgreSQL error:', error);
    });
}

main().catch((error) => {
    console.error('A fatal error occurred:', error);
    process.exit(1);
});