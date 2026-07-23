/**
 * Normalize a raw MQTT message into a string that is always valid JSON, ready
 * to be stored in a JSON/JSONB PostgreSQL column.
 *
 * - If the raw payload already parses as JSON (object, array, number, string,
 *   boolean, or null) it is returned unchanged, so it keeps its natural JSON
 *   type in the database.
 * - Otherwise the raw text is wrapped as a JSON string literal via
 *   `JSON.stringify`, which escapes quotes, backslashes and control characters
 *   correctly. This replaces the previous `"${message}"` concatenation, which
 *   produced invalid JSON as soon as a message contained a double quote or a
 *   newline.
 */
export function toJsonPayload(raw: string): string {
    try {
        JSON.parse(raw);
        return raw;
    } catch {
        return JSON.stringify(raw);
    }
}
