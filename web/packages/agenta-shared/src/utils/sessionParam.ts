/**
 * The query param a session is addressed by, on either app.
 *
 * It lives at the bottom of the package graph because two unrelated layers need the same string:
 * `@agenta/sessions/link` builds and reads the links, and `utils/mobileGate` translates one app's
 * URL into the other's. A second copy is a silent deep-link break.
 *
 * `session_id` and not `session`: the desktop app's URL layer owns `?session=` for the
 * observability session drawer and strips it off every route that isn't `/observability` or
 * `/sessions`, the playground included.
 */
export const SESSION_QUERY_PARAM = "session_id"
