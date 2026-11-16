/** Maps a root URL to the `/m` page that shows the same thing (links, bookmarks, SDK links). */

import {SESSION_QUERY_PARAM} from "@agenta/shared/utils/sessionParam"

const AUTH_CALLBACK_RE = /^\/auth\/callback(\/|$)/

const AUTH_RE = /^\/auth(\/|$)/

/** The reset password page. */
const RESET_PASSWORD_ROUTE_RE = /^\/auth\/reset-password\/?$/

/** The website "Use it for free" param, also the in-app create surface's pre-selection. */
const TEMPLATE_QUERY_PARAM = "template"

const PROJECT_PATH_RE = /^\/w\/([^/]+)\/p\/([^/]+)(?:\/(.*))?$/

/**
 * Sub-paths under `/apps` that are NOT an agent id — they must not be read as one.
 * `/apps/archived` is the archived list, `/apps/agent-templates` the template gallery.
 */
const APPS_RESERVED = new Set(["archived", "agent-templates"])

/** Strips leading and trailing `/`. A loop, not a regex: `/\/+$/` backtracks on long `/` runs. */
const trimSlashes = (value: string) => {
    let start = 0
    let end = value.length
    while (start < end && value[start] === "/") start++
    while (end > start && value[end - 1] === "/") end--
    return value.slice(start, end)
}

/** `?template=<key>` when the URL carries a website template link, else "". */
const templateQueryFrom = (search: string): string => {
    const templateKey = new URLSearchParams(search).get(TEMPLATE_QUERY_PARAM)?.trim()
    return templateKey ? `?${TEMPLATE_QUERY_PARAM}=${encodeURIComponent(templateKey)}` : ""
}

/** Project pages a developer view rebuilds, relative to the project; `null` when `/m` has none. */
const developerProjectRoute = (segments: string[]): string | null => {
    const [head, first, second] = segments
    switch (head) {
        case "prompts":
            return first ? null : "/prompts"
        case "evaluations":
            if (!first) return "/evaluations"
            return first === "results" && second && second !== "compare" && !segments[3]
                ? `/evaluations/results/${second}`
                : null
        case "testsets":
            return segments.length > 2 ? null : `/testsets${first ? `/${first}` : ""}`
        case "evaluators":
            return first === "archived" && !second
                ? "/evaluators/archived"
                : first
                  ? null
                  : "/evaluators"
        case "annotations":
            return segments.length > 2 ? null : `/annotations${first ? `/${first}` : ""}`
        default:
            return null
    }
}

/** App sections as `/m` paths; `undefined` when the section has no view, `null` when `/m` has no page. */
const developerAppRoute = (
    section: string,
    appId: string,
    [kind, evaluationId, extra]: string[],
): string | null | undefined => {
    switch (section) {
        case "overview":
            return `/apps/${appId}/overview`
        case "playground":
            return `/apps/${appId}/playground`
        case "variants":
            return `/apps/${appId}/variants`
        case "deployments":
            return `/apps/${appId}/variants?tab=deployments`
        case "endpoints":
            return `/apps/${appId}/endpoints`
        case "traces":
            return `/apps/${appId}/traces`
        case "evaluations":
            if (!kind) return `/apps/${appId}/evaluations`
            return kind === "results" && evaluationId && evaluationId !== "compare" && !extra
                ? `/evaluations/results/${evaluationId}`
                : null
        default:
            return undefined
    }
}

/** The `/m` route for a root URL, or `null` when `/m` has no such page. */
function routeFor(pathname: string, search: string): string | null {
    // The query is the payload of an `/auth` link (token, policy error, OAuth code): keep it.
    if (AUTH_RE.test(pathname)) {
        const page =
            RESET_PASSWORD_ROUTE_RE.test(pathname) || AUTH_CALLBACK_RE.test(pathname)
                ? pathname
                : "/auth"
        return `/m${page}${search}`
    }

    // An invite link: `/m` takes it through its sign-in, like an emailed invite.
    if (/^\/workspaces\/accept\/?$/.test(pathname)) {
        return new URLSearchParams(search).get("token") ? `/m/auth${search}` : "/m/invite"
    }

    // A website template link (`?template=`) rides along: `/m` opens that template's setup step.
    const templateKey = new URLSearchParams(search).get(TEMPLATE_QUERY_PARAM)?.trim()
    const templateQuery = templateQueryFrom(search)

    // The mobile root resolves last-used workspace/project (same resolution as post-login).
    if (/^\/w(\/[^/]+(\/p\/?)?)?\/?$/.test(pathname)) return `/m${templateQuery}`

    const match = pathname.match(PROJECT_PATH_RE)
    if (!match) return null

    const [, ws, proj, tail] = match
    const base = `/m/w/${ws}/p/${proj}`
    const rest = trimSlashes(tail ?? "")
    const segments = rest.split("/")
    const [head, first, second] = segments
    const params = new URLSearchParams(search)

    // The project root and /apps are both the home screen.
    if (!head || head === "apps") {
        if (head !== "apps" || !first) {
            return templateKey ? `${base}/agents/new${templateQuery}` : `${base}/apps`
        }

        if (first === "agent-templates") {
            return second ? `${base}/templates/${second}` : `${base}/templates`
        }
        if (APPS_RESERVED.has(first)) return null

        // `/m` has no playground route for an agent: a session's page IS the playground, and
        // `?agent=` names the agent for a session whose turns cannot yet.
        const sessionId = params.get(SESSION_QUERY_PARAM)
        if (second === "playground" && sessionId) {
            return `${base}/sessions/${encodeURIComponent(sessionId)}?agent=${first}`
        }
        const appRoute = developerAppRoute(
            second || "overview",
            encodeURIComponent(first),
            segments.slice(3),
        )
        // A section with no view of its own (sessions, ...) still lands on the app's screen.
        // The playground's own selection rides along: `/m` reads the same `?revisions=`.
        const revisions = second === "playground" ? params.get("revisions") : null
        const deployments = second === "variants" && params.get("tab") === "deployments"
        const selection = revisions
            ? `?revisions=${encodeURIComponent(revisions)}`
            : deployments
              ? "?tab=deployments"
              : ""
        if (appRoute !== undefined) return appRoute ? `${base}${appRoute}${selection}` : null
        // Every other app-scoped page (playground, overview, sessions, deployments…)
        // collapses to the agent's own screen — the only agent surface `/m` has.
        return `${base}/agents/${first}`
    }

    if (head === "agents") {
        if (!first) return `${base}/agents`
        return first === "archived" ? null : `${base}/agents/${first}`
    }

    if (head === "sessions") {
        return first ? `${base}/sessions/${encodeURIComponent(first)}` : `${base}/sessions`
    }

    if (head === "observability" && !first) {
        // ?session={id} is the observability drawer's own param,
        // distinct from SESSION_QUERY_PARAM — land in that session's chat.
        const drawerSession = params.get("session")
        if (drawerSession) return `${base}/sessions/${encodeURIComponent(drawerSession)}`
        // `/m` opens the trace drawer from the same `trace` and `span` params (SDK trace links).
        const drawer = new URLSearchParams()
        for (const key of ["trace", "span"]) {
            const value = params.get(key)
            if (value) drawer.set(key, value)
        }
        const drawerQuery = drawer.toString()
        return `${base}/observability${drawerQuery ? `?${drawerQuery}` : ""}`
    }

    if (head === "settings" && !first) {
        // `/m` Settings reads the same `tab` keys and falls back for one it does not have.
        const tab = params.get("tab")
        // A Billing link to the pack picker lands on Credits, where `/m` opens it.
        if (tab === "billing" && params.get("buy_credits") === "1") {
            return `${base}/settings?tab=credits&buy_credits=1`
        }
        return tab ? `${base}/settings?tab=${encodeURIComponent(tab)}` : `${base}/settings`
    }

    const route = developerProjectRoute(segments)
    return route ? `${base}${route}` : null
}

/** A root URL's `/m` target, and whether a page matched (else the `/m` root). */
export function legacyTarget(pathname: string, search: string): {target: string; matched: boolean} {
    const route = routeFor(pathname, search)
    // The `/m` root still opens a website template link (`/?template=`) on its setup step.
    return route
        ? {target: route, matched: true}
        : {target: `/m${templateQueryFrom(search)}`, matched: false}
}
