import {MediaViewerHost} from "@agenta/entity-ui/drive"
import {TraceDrawer} from "@agenta/observability-ui/traceDrawer"
import {useMediaQuery} from "@agenta/ui/hooks"
import {useRouter} from "next/router"

import {FeatureGuideDialog} from "@/features/education/FeatureGuideDialog"
import {WhatsNewDialog} from "@/features/education/WhatsNewDialog"
import {bindTraceDrawerSeams} from "@/features/observability/bindTraceDrawerSeams"
import {registerTraceDrawerSlots} from "@/features/observability/registerTraceDrawerSlots"

// Registered when this module loads, not while rendering: `Component` renders before this
// component in `_app`, and a screen that read the slots first would get the antd defaults.
registerTraceDrawerSlots()

/**
 * Drawers any screen can open, mounted once for the whole app.
 *
 * The trace drawer is opened by an ATOM (`openTraceDrawerAtom`), so whoever renders it decides
 * where it works. It used to be mounted inside the Observability screen alone, which meant the
 * "View trace" action on a chat turn set the atom and nothing appeared — the drawer simply was not
 * on that page.
 *
 * The router seams move with it: they must be bound wherever the drawer can open, not only where
 * the traces table lives. The slots are registered here for the same reason.
 */
export const GlobalDrawers = () => {
    const router = useRouter()
    bindTraceDrawerSeams(router)
    // The split puts a 320px tree beside a content pane of at least 400px, so it stacks below 720px.
    const wide = useMediaQuery("(min-width: 720px)")
    return (
        <>
            <TraceDrawer layout={wide ? "split" : "stacked"} />
            {/* These dialogs open by atom, so they mount wherever an entry point can set them. */}
            <FeatureGuideDialog />
            <WhatsNewDialog />
            <MediaViewerHost />
        </>
    )
}
