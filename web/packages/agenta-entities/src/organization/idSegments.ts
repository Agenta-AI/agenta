/**
 * The check every organization id passes before it is interpolated into a request URL.
 *
 * Organization, workspace and project ids arrive from routes, invite links and cached state, so a
 * value carrying `../`, `?`, `#` or a whole second URL would move the request off the endpoint the
 * caller meant to hit. The allow-list below holds only characters that are already legal, literal
 * URL path characters, so every id these endpoints really see — a UUID, a Mongo id, a slug such as
 * `org-1` — passes unchanged, and none of the redirect vectors do.
 */
const SAFE_ID_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/

/** True when the value is safe to place in a URL path or query as it is. */
export const isSafeIdSegment = (value: string): boolean => SAFE_ID_SEGMENT.test(value)

/**
 * The id as an encoded URL segment, or null when it is not a safe one.
 *
 * The value passes through `String(...)` first. These ids are typed `string`, but the invite page
 * passes a parameter the invite may not carry, and the request URLs have always interpolated that
 * as the literal `undefined`. Keeping the conversion keeps the request identical.
 *
 * The check and the encoding sit together on purpose. The check has to be the last thing that
 * happens to the value before it reaches a URL, and keeping the pair here is also what lets static
 * analysis see that no unchecked value can reach one.
 */
export const toSafeIdSegment = (value: string): string | null => {
    const raw = String(value)
    if (SAFE_ID_SEGMENT.test(raw)) return encodeURIComponent(raw)
    return null
}
