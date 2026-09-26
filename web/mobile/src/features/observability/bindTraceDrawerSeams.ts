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
 * host's job. web/oss binds the same three seams from its own provider — this is the second
 * host, which is the whole reason they are seams rather than imports.
 *
 * The data slots are filled by `registerTraceDrawerSlots`; the reference/action slots stay on
 * their fallbacks (a plain label, no button), which are enough on `/m`.
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
