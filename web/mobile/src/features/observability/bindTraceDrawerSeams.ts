import {
    bindTraceDrawerClearParams,
    bindTraceDrawerNavigate,
    bindTraceDrawerSetQueryParam,
} from "@agenta/observability/traceDrawer"
import type {NextRouter} from "next/router"

/**
 * Points the packaged trace drawer at `/m`'s router.
 *
 * The drawer keeps its open trace in `?trace`/`?span` and links out to evaluators; both are the
 * host's job, which is why they are seams rather than imports.
 *
 * The reference/drill-in/playground SLOTS are deliberately left unregistered here: their
 * fallbacks render a plain label or nothing at all, so `/m` degrades instead of crashing.
 */
export const bindTraceDrawerSeams = (router: NextRouter) => {
    bindTraceDrawerNavigate((href) => {
        void router.push(href)
    })

    bindTraceDrawerSetQueryParam((name, value) => {
        const query = {...router.query}
        if (value == null) delete query[name]
        else query[name] = value
        void router.push({pathname: router.pathname, query}, undefined, {shallow: true})
    })

    bindTraceDrawerClearParams(() => {
        const query = {...router.query}
        delete query.trace
        delete query.span
        void router.push({pathname: router.pathname, query}, undefined, {shallow: true})
    })
}
