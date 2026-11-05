import type {TraceSpanNode} from "@agenta/entities/trace"
import {
    bindTraceDrawerClearParams,
    bindTraceDrawerNavigate,
    bindTraceDrawerPlaygroundActions,
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
 * host's job, which is why they are seams rather than imports. `openTraceId` reads the trace the
 * drawer shows, which the address carries next to the span.
 *
 * The data slots are filled by `registerTraceDrawerSlots`; the reference/action slots stay on
 * their fallbacks (a plain label, no button), which are enough on `/m`. The span header's
 * Playground button exists only while the `playground` developer view is on: its code
 * loads on the first click.
 */
export const bindTraceDrawerSeams = (
    router: NextRouter,
    {playground, openTraceId}: {playground: boolean; openTraceId: () => string | null},
) => {
    bindTraceDrawerPlaygroundActions(
        playground
            ? {
                  openTraceInPlayground: (span) =>
                      import("./tracePlayground").then((module) =>
                          module.openTraceInPlayground(router, span as TraceSpanNode),
                      ),
              }
            : {},
    )

    bindTraceDrawerNavigate((href) => {
        void router.push(href)
    })

    bindTraceDrawerSetQueryParam((name, value) => {
        const query = currentQuery(router, window.location.search)
        // The drawer writes only the span. The trace goes with it, so a reload can reopen the
        // drawer (`useTraceDrawerFromUrl`): a span id alone does not name its trace. While the
        // trace loads the drawer writes no span; the address keeps the one it asked for.
        const traceId = name === "span" ? openTraceId() : null
        if (traceId) query.trace = traceId
        if (value != null) query[name] = value
        else if (!traceId) delete query[name]
        void router.push({pathname: router.pathname, query}, undefined, {shallow: true})
    })

    bindTraceDrawerClearParams(() => {
        const query = currentQuery(router, window.location.search)
        // The drawer also clears after its close animation. By then the Playground button can
        // have moved to another page, and a push there would drop that page's hash.
        if (!("trace" in query) && !("span" in query)) return
        delete query.trace
        delete query.span
        void router.push({pathname: router.pathname, query}, undefined, {shallow: true})
    })
}
