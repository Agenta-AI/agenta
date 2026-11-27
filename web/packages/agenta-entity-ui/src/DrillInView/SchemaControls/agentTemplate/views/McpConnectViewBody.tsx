import {useEffect, useMemo, useRef, useState} from "react"

import {
    mcpEndpointsQueryAtom,
    useMcpConnectJourney,
    type McpConnectedEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {invalidateAgentRequirements} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import mcpJourneyCatalog from "@agenta/i18n/catalogs/entityUi.mcpJourney"
import mcpViewsCatalog from "@agenta/i18n/catalogs/entityUi.mcpViews"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {type ConnectionOwner} from "../../../../accounts/ConnectOwnerField"
import {OwnerField} from "../../../../accounts/OwnerField"
import {useProjectName} from "../../../../accounts/useProjectName"
import {useMcpConnectScreens} from "../../../../mcpEndpoint/McpConnectJourney"

import type {McpConnectViewParams} from "./mcpConnectView"

/** Whether this code runs inside a press the browser still counts (it then allows a window). */
const hasUserActivation = (): boolean => {
    const activation = (navigator as Navigator & {userActivation?: {isActive: boolean}})
        .userActivation
    // Without the API, assume a press: the journey's own window fallback still applies.
    return activation ? activation.isActive : true
}

const McpConnectViewBody = ({params, nav}: ViewProps<McpConnectViewParams>) => {
    const t = useT(mcpViewsCatalog, mcpJourneyCatalog, mcpConnectCatalog)
    const endpoints = useAtomValue(mcpEndpointsQueryAtom).data
    const existingNames = useMemo(
        () => (endpoints ?? []).map((endpoint) => endpoint.name),
        [endpoints],
    )
    const reconnect = params.reconnect ?? null
    const [connected, setConnected] = useState<McpConnectedEndpoint | null>(null)
    // A reconnect repairs the project's sign-in. Otherwise the first permitted owner is the
    // default, as in the integration connect form.
    const permitted = reconnect ? null : (params.owners ?? null)
    // "Who can use it" asks only when the opener allows both owners.
    const owners = permitted && permitted.length > 1 ? permitted : null
    const [initialOwner] = useState<ConnectionOwner>(permitted?.[0] ?? "project")
    const [chosenOwner, setOwner] = useState(initialOwner)
    const owner = permitted?.includes(chosenOwner) ? chosenOwner : (permitted?.[0] ?? "project")
    const projectName = useProjectName(owners !== null)
    const journey = useMcpConnectJourney({
        existingNames,
        reconnect,
        owner,
        onConnected: setConnected,
    })
    // The screens close the view: their own Cancel links, and the end of the journey (they ask
    // to close once the connection is made). Navigation has this one owner.
    const screens = useMcpConnectScreens({
        journey,
        existingNames,
        reconnect,
        onClose: nav.cancel,
        canvas: true,
        ownerField: owners ? (
            <OwnerField<ConnectionOwner>
                value={owner}
                owners={owners}
                onChange={setOwner}
                projectName={projectName}
            />
        ) : null,
    })
    // The crumb names the step in one verb (canvas F03 f5): "Connect", or "Reconnect".
    useViewTitle(reconnect ? t("entityUi.mcpConnect.reconnect") : t("entityUi.mcpJourney.connect"))

    const done = connected !== null || journey.state.status === "connected"
    // The address the view opened with: empty, or a reconnect's saved one.
    const [openingUrl] = useState(journey.state.url)
    useViewForm({
        // Until the connection is made, leaving asks only after the person changed the address or
        // the owner. Leaving drops the pending connection (see below).
        dirty:
            !done &&
            (journey.state.url.trim() !== openingUrl.trim() || chosenOwner !== initialOwner),
        saveWhenClean: true,
        leaveDescription: t("entityUi.mcpViews.connectLeaveDescription"),
        valid: !done && screens.canConfirm && screens.screen !== "waiting",
        invalidReason: screens.confirmBlockedReason ?? undefined,
        saveLabel: screens.confirmLabel,
        // Each press runs the screen's action inside the press, so the provider's window can
        // open. The step stays on this view; the journey shows what happens next.
        save: async () => {
            // A step that opens the provider's window needs the press itself: from the
            // unsaved-changes dialog (after awaits) the browser would refuse the window and the
            // journey would send the whole tab to the provider. The person stays on the step.
            if (screens.confirmOpensWindow && !hasUserActivation()) return "stay"
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
