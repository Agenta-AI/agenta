/**
 * The link a session is shared, bookmarked and reloaded as. Pure string work, so every surface
 * that builds or reads one agrees.
 *
 * Two host shapes, because the two apps show a session differently: the desktop opens it as a tab
 * on its agent's playground (`playgroundSessionPath`), the mobile app gives it a page of its own
 * (`sessionRoutePath`). Both name the session `session_id`.
 */
import {SESSION_QUERY_PARAM} from "@agenta/shared/utils"

/** Re-exported from `@agenta/shared`, where the mobile gate's route map reads it too. */
export {SESSION_QUERY_PARAM}

/** `<base>/sessions/<id>` — the session's own page, on a host that routes to one. */
export const sessionRoutePath = (base: string, sessionId: string): string =>
    base && sessionId ? `${base}/sessions/${encodeURIComponent(sessionId)}` : ""

/**
 * A path made absolute, for the clipboard. Empty outside the browser, or with nothing to link.
 *
 * The only part of this module that reads `window`, and it runs on the copy itself. Building a
 * link stays pure, so a surface can ask "is this session linkable?" while rendering.
 */
export const shareUrl = (path: string): string =>
    typeof window === "undefined" || !path ? "" : `${window.location.origin}${path}`

/**
 * `<baseAppURL>/<appId>/playground?session_id=<id>` — the path a session is linked as. Empty
 * without a base or an agent, so a caller that asks too early gets nothing rather than a path
 * missing its middle. Omitting `sessionId` still gives the agent's bare playground.
 */
export const playgroundSessionPath = (
    baseAppURL: string,
    appId: string,
    sessionId?: string | null,
): string => {
    if (!baseAppURL || !appId) return ""
    const path = `${baseAppURL}/${encodeURIComponent(appId)}/playground`
    return sessionId ? `${path}?${SESSION_QUERY_PARAM}=${encodeURIComponent(sessionId)}` : path
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
