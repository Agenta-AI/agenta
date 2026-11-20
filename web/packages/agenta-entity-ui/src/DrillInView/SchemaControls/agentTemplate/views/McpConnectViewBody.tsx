import {useEffect, useMemo, useRef, useState} from "react"

import {
    hostnameLabel,
    mcpEndpointsQueryAtom,
    useMcpConnectJourney,
    type McpConnectedEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {invalidateAgentRequirements} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import mcpConnectOwnerCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnectOwner"
import mcpViewsCatalog from "@agenta/i18n/catalogs/entityUi.mcpViews"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {ConnectOwnerField, type ConnectionOwner} from "../../../../accounts/ConnectOwnerField"
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
    const t = useT(mcpViewsCatalog, mcpConnectOwnerCatalog)
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
    const [chosenOwner, setOwner] = useState<ConnectionOwner>(permitted?.[0] ?? "project")
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
        ownerField: owners ? (
            <ConnectOwnerField
                value={owner}
                owners={owners}
                onChange={setOwner}
                onlyMeDetail={t("entityUi.mcpConnectOwner.onlyMeNote", {
                    name: journey.state.name.trim() || hostnameLabel(journey.state.url),
                })}
                projectName={projectName}
            />
        ) : null,
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
