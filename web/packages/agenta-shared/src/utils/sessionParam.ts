/**
 * The query param a session is addressed by.
 *
 * It lives at the bottom of the package graph because two unrelated layers need the same string:
 * `@agenta/sessions/link` builds and reads the links, and `utils/mobileGate` maps a URL outside
 * `/m` onto `/m`. A second copy is a silent deep-link break.
 *
 * `session_id` and not `session`: `?session=` on an observability URL is the observability
 * drawer's own param (see `utils/mobileGate`).
 */
export const SESSION_QUERY_PARAM = "session_id"
