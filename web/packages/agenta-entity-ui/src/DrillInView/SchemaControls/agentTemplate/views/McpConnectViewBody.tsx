import {useEffect, useMemo, useRef, useState} from "react"

import {mcpEndpointsQueryAtom, useMcpConnectJourney} from "@agenta/entities/mcpEndpoint"
import {invalidateAgentRequirements} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import mcpViewsCatalog from "@agenta/i18n/catalogs/entityUi.mcpViews"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {useMcpConnectScreens} from "../../../../mcpEndpoint/McpConnectJourney"

import type {McpConnectViewParams} from "./mcpConnectView"

type Connected = {id: string; slug: string; name: string}

const McpConnectViewBody = ({params, nav}: ViewProps<McpConnectViewParams>) => {
    const t = useT(mcpViewsCatalog)
    const endpoints = useAtomValue(mcpEndpointsQueryAtom).data
    const existingNames = useMemo(
        () => (endpoints ?? []).map((endpoint) => endpoint.name),
        [endpoints],
    )
    const reconnect = params.reconnect ?? null
    const [connected, setConnected] = useState<Connected | null>(null)
    const journey = useMcpConnectJourney({existingNames, reconnect, onConnected: setConnected})
    // The screens close the view: their own Cancel links, and the end of the journey (they ask
    // to close once the connection is made). Navigation has this one owner.
    const screens = useMcpConnectScreens({
        journey,
        existingNames,
        reconnect,
        onClose: nav.cancel,
    })
    useViewTitle(screens.title)

    const done = connected !== null || journey.state.status === "connected"
    useViewForm({
        // Until the connection is made: what the person typed, or for a reconnect the repair
        // itself. Save (the step's action) needs a dirty form to run.
        dirty: !done && (reconnect !== null || journey.state.url.trim() !== ""),
        valid: screens.canConfirm && screens.screen !== "waiting",
        leaveDescription: t("entityUi.mcpViews.connectLeaveDescription"),
        saveLabel: screens.confirmLabel,
        // Each press runs the screen's action inside the press, so the provider's window can
        // open. The step stays on this view; the journey shows what happens next.
        save: async () => {
            screens.confirm()
            return "stay"
        },
    })

    // Connected: the screens have closed the view; tell the opener (it may open the server's
    // view) and re-check the agents' setup, which the sign-in may have fixed.
    const {onConnected} = params
    useEffect(() => {
        if (!connected) return
        void invalidateAgentRequirements()
        onConnected?.(connected)
    }, [connected, onConnected])

    // Leaving before the end drops the pending connection and closes the provider's window.
    // The view is already leaving, so this asks for no navigation.
    const abandonRef = useRef(screens.abandon)
    abandonRef.current = screens.abandon
    const doneRef = useRef(done)
    doneRef.current = done
    useEffect(
        () => () => {
            if (!doneRef.current) abandonRef.current()
        },
        [],
    )

    return <div className="px-4 py-3">{screens.body}</div>
}

export default McpConnectViewBody
