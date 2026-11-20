import {useEffect, useMemo, useRef, useState} from "react"

import {mcpEndpointsQueryAtom, useMcpConnectJourney} from "@agenta/entities/mcpEndpoint"
import {useT} from "@agenta/i18n"
import mcpViewsCatalog from "@agenta/i18n/catalogs/entityUi.mcpViews"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {useMcpConnectScreens} from "../../../../mcpEndpoint/McpConnectJourney"

import type {McpConnectViewParams} from "./mcpConnectView"

type Connected = {id: string; slug: string; name: string}

const noop = () => undefined

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
    // The view leaves on its own once connected (below), so the screens' close does nothing.
    const screens = useMcpConnectScreens({journey, existingNames, reconnect, onClose: noop})
    useViewTitle(screens.title)

    const status = journey.state.status
    const done = connected !== null || status === "connected"
    useViewForm({
        // What the person typed, until the connection is made. A reconnect starts with nothing
        // to lose.
        dirty: !done && !reconnect && journey.state.url.trim() !== "",
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

    // Connected: leave first, then tell the opener, which may open the server's view.
    const {onConnected} = params
    const {cancel} = nav
    useEffect(() => {
        if (!connected) return
        cancel()
        onConnected?.(connected)
    }, [connected, cancel, onConnected])

    // Leaving before the end drops the pending connection and closes the provider's window, as
    // the dialog's Cancel does.
    const doneRef = useRef(done)
    doneRef.current = done
    const closeRef = useRef(screens.handleClose)
    closeRef.current = screens.handleClose
    useEffect(
        () => () => {
            if (!doneRef.current) closeRef.current()
        },
        [],
    )

    return <div className="px-4 py-3">{screens.body}</div>
}

export default McpConnectViewBody
