/**
 * Deep links to a session on its agent's playground — the link a session is shared, bookmarked
 * and reloaded as. Pure string work, so every surface that builds or reads one agrees.
 *
 * The param is `session_id`, not `session`: the desktop app's URL layer owns `?session=` for the
 * observability session drawer and strips it off every route that isn't `/observability` or
 * `/sessions`, the playground included. `session_id` also matches the mobile session route.
 */
export const SESSION_QUERY_PARAM = "session_id"

/** `<baseAppURL>/<appId>/playground?session_id=<id>` — the path a session is linked as. */
export const playgroundSessionPath = (
    baseAppURL: string,
    appId: string,
    sessionId?: string | null,
): string => {
    const path = `${baseAppURL}/${encodeURIComponent(appId)}/playground`
    return sessionId ? `${path}?${SESSION_QUERY_PARAM}=${encodeURIComponent(sessionId)}` : path
}

/** The same link, absolute, for the clipboard. Empty outside the browser or without a target. */
export const playgroundSessionUrl = (
    baseAppURL: string,
    appId: string,
    sessionId: string,
): string => {
    if (typeof window === "undefined" || !baseAppURL || !appId || !sessionId) return ""
    return `${window.location.origin}${playgroundSessionPath(baseAppURL, appId, sessionId)}`
}

/** The linked session id in a query string, or "" when there is none. */
export const readSessionParam = (search: string): string =>
    new URLSearchParams(search).get(SESSION_QUERY_PARAM) ?? ""

/**
 * Is this location the playground of `scope`?
 *
 * `AgentChatPanel` also mounts on scopes the URL says nothing about — the revision drawer, the
 * onboarding surface, the app-less `__global__` fallback. The param belongs to the agent named in
 * the path and to no one else, so those must neither adopt it nor overwrite it.
 */
export const isScopePlaygroundPath = (pathname: string, scope: string): boolean => {
    if (!scope || !pathname.includes("/playground")) return false
    const appId = pathname.match(/\/apps\/([^/]+)/)?.[1]
    return Boolean(appId) && decodeURIComponent(appId as string) === scope
}

/** The session `scope`'s playground is currently linked to, or "". */
export const sessionParamForScope = (pathname: string, search: string, scope: string): string =>
    isScopePlaygroundPath(pathname, scope) ? readSessionParam(search) : ""

/** `href` with the param set to `sessionId` (or removed when null). Every other param survives. */
export const withSessionParam = (href: string, sessionId: string | null): string => {
    const url = new URL(href)
    if (sessionId) url.searchParams.set(SESSION_QUERY_PARAM, sessionId)
    else url.searchParams.delete(SESSION_QUERY_PARAM)
    return `${url.pathname}${url.search}${url.hash}`
}

/** The session the current URL links to, for a scope that owns the URL. */
export const currentSessionParamForScope = (scope: string): string =>
    typeof window === "undefined"
        ? ""
        : sessionParamForScope(window.location.pathname, window.location.search, scope)

/**
 * Point the address bar at `sessionId`. `history.replaceState`, not the router: switching tabs is
 * not a navigation, and a shallow `Router.replace` would re-run every URL sync slice on each one.
 */
export const writeSessionParamForScope = (scope: string, sessionId: string): void => {
    if (typeof window === "undefined") return
    if (!isScopePlaygroundPath(window.location.pathname, scope)) return
    if (readSessionParam(window.location.search) === sessionId) return
    window.history.replaceState(
        window.history.state,
        "",
        withSessionParam(window.location.href, sessionId),
    )
}
