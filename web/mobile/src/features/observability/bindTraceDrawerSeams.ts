import {
    bindTraceDrawerClearParams,
    bindTraceDrawerNavigate,
    bindTraceDrawerSetQueryParam,
} from "@agenta/observability/traceDrawer"
import type {NextRouter} from "next/router"

/**
 * Route params from the router, the rest from the address bar: `replaceState` writes skip
 * `router.query`. Route params win, so `?session_id=B` on `/sessions/A` cannot move the page.
 */
export const currentQuery = (router: NextRouter, search: string): NextRouter["query"] => {
    const routeKeys = [...router.pathname.matchAll(/\[\.{0,3}([^\]]+)\]/g)].map((m) => m[1])
    return {
        ...Object.fromEntries(new URLSearchParams(search)),
        ...Object.fromEntries(routeKeys.map((key) => [key, router.query[key]])),
    }
}

/**
 * Points the packaged trace drawer at `/m`'s router.
 *
 * The drawer keeps its open trace in `?trace`/`?span` and links out to evaluators; both are the
 * host's job, which is why they are seams rather than imports.
 *
 * The data slots are filled by `registerTraceDrawerSlots`; the reference/action slots stay on
 * their fallbacks (a plain label, no button), which are enough on `/m`. The playground actions
 * stay unbound on purpose, so the span header shows no Playground button: it was built for
 * prompt traces, and an agent trace opens an empty playground because the root span no longer
 * stores the agent config.
 */
export const bindTraceDrawerSeams = (router: NextRouter) => {
    bindTraceDrawerNavigate((href) => {
        void router.push(href)
    })

    bindTraceDrawerSetQueryParam((name, value) => {
        const query = currentQuery(router, window.location.search)
        if (value == null) delete query[name]
        else query[name] = value
        void router.push({pathname: router.pathname, query}, undefined, {shallow: true})
    })

    bindTraceDrawerClearParams(() => {
        const query = currentQuery(router, window.location.search)
        delete query.trace
        delete query.span
        void router.push({pathname: router.pathname, query}, undefined, {shallow: true})
    })
}
