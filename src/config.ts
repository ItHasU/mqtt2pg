import process from 'node:process';

/** Validated runtime configuration, read once at startup. */
export interface AppConfig {
    /** MQTT broker URL, e.g. `mqtt://host:1883` or `mqtts://host:8883`. */
    mqttUrl: string;
    /** Topics to subscribe to (already split and trimmed). */
    mqttTopics: string[];
    /** PostgreSQL connection string. */
    databaseUrl: string;
}

/** Thrown when the environment is misconfigured. Reported without a stack trace. */
export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigError';
    }
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (value === undefined || value.trim() === '') {
        throw new ConfigError(`Missing required environment variable: ${name}`);
    }
    return value;
}

/**
 * Read and validate configuration from environment variables.
 *
 * Throws a clear `Error` (rather than an obscure runtime crash) when a
 * required variable is missing or empty, so a misconfigured container fails
 * fast with an actionable message.
 */
export function loadConfig(): AppConfig {
    const mqttUrl = requireEnv('MQTT_URL');

    // MQTT_TOPICS is optional: when it is missing or resolves to an empty list,
    // warn and fall back to '#' (subscribe to every topic) rather than failing.
    const mqttTopics = (process.env.MQTT_TOPICS ?? '')
        .split(',')
        .map((topic) => topic.trim())
        .filter((topic) => topic.length > 0);

    if (mqttTopics.length === 0) {
        console.warn('MQTT_TOPICS is not set; falling back to "#" (all topics)');
        mqttTopics.push('#');
    }

    const databaseUrl = requireEnv('DATABASE_URL');

    return { mqttUrl, mqttTopics, databaseUrl };
}

/**
 * Return a copy of a URL with any embedded password redacted, safe for
 * logging. Connection strings routinely carry credentials, so the raw value
 * must never be written to logs.
 */
export function redactUrl(url: string): string {
    try {
        const parsed = new URL(url);
        if (parsed.password) {
            parsed.password = '***';
        }
        return parsed.toString();
    } catch {
        return '<unparseable url>';
    }
}
