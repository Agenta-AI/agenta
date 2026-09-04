import {TraceDrawer} from "@agenta/observability-ui/traceDrawer"
import {useRouter} from "next/router"

import {bindTraceDrawerSeams} from "@/features/observability/bindTraceDrawerSeams"

/**
 * Drawers any screen can open, mounted once for the whole app.
 *
 * The trace drawer is opened by an ATOM (`openTraceDrawerAtom`), so whoever renders it decides
 * where it works. It used to be mounted inside the Observability screen alone, which meant the
 * "View trace" action on a chat turn set the atom and nothing appeared — the drawer simply was not
 * on that page. web/oss mounts it globally in AppGlobalWrappers for exactly this reason.
 *
 * The router seams move with it: they must be bound wherever the drawer can open, not only where
 * the traces table lives.
 */
export const GlobalDrawers = () => {
    const router = useRouter()
    bindTraceDrawerSeams(router)
    return <TraceDrawer />
}
