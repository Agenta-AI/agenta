import {useCallback, useState} from "react"

import {triggerSubscriptionDrawerAtom} from "@agenta/entities/gatewayTrigger"
import {workflowMolecule} from "@agenta/entities/workflow"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ArrowLeft} from "@phosphor-icons/react"
import {useAtom, useAtomValue} from "jotai"

import {browseHeaderAtom} from "./subscription/constants"
import {SubscriptionForm} from "./subscription/SubscriptionForm"

// ---------------------------------------------------------------------------
// TriggerSubscriptionDrawer (root) — create or edit a provider-event subscription.
//
// Binds a connected app's event to a workflow revision. Both hosts render the same single
// form; the playground passes its agent so the drawer can title itself with the agent name and
// offer "Run in playground".
// ---------------------------------------------------------------------------

export default function TriggerSubscriptionDrawer() {
    const [state, setState] = useAtom(triggerSubscriptionDrawerAtom)
    const open = !!state
    const handleClose = useCallback(() => setState(null), [setState])

    // EnhancedDrawer keeps the Sheet shell mounted ~320ms after `open` goes false to play
    // the slide-out, then calls `afterOpenChange(false)`. Gating content on `state` directly
    // would unmount it in the same render as the close click — an empty shell sliding out
    // for that window. Keep rendering the last known state until the shell actually unmounts.
    const [renderedState, setRenderedState] = useState(state)
    if (state && state !== renderedState) setRenderedState(state)
    const handleAfterOpenChange = useCallback((isOpen: boolean) => {
        if (!isOpen) setRenderedState(null)
    }, [])

    const playgroundEntityId = renderedState?.playgroundEntityId
    const agentName = useAtomValue(
        workflowMolecule.selectors.artifactName(playgroundEntityId ?? ""),
    )
    // Smart header: while the form is browsing for a source, the header becomes a back
    // affordance + "Choose a trigger"; otherwise it's the form title.
    const browseHeader = useAtomValue(browseHeaderAtom)
    const formTitle = renderedState?.subscriptionId ? "Edit trigger" : "New trigger"
    const title = browseHeader ? (
        <span className="flex items-center gap-3">
            <button
                type="button"
                onClick={browseHeader.onBack}
                className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-xs font-normal text-[var(--ag-colorTextSecondary)] hover:text-[var(--ag-colorText)]"
            >
                <ArrowLeft size={15} /> Back
            </button>
            <span>Choose a trigger</span>
        </span>
    ) : (
        <span className="flex min-w-0 items-baseline gap-1.5">
            <span>{formTitle}</span>
            {agentName ? (
                <>
                    <span className="text-[var(--ag-colorTextQuaternary)]">·</span>
                    <span className="min-w-0 truncate text-sm font-normal text-[var(--ag-colorTextDescription)]">
                        {agentName}
                    </span>
                </>
            ) : null}
        </span>
    )

    // EnhancedDrawer renders nothing until first open and unmounts after close, so the form
    // below — which owns all data fetching — only mounts (and its hooks only run) while the
    // drawer is open. The lifecycle is structural; no `enabled` flags needed.
    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={handleClose}
            afterOpenChange={handleAfterOpenChange}
            title={title}
            closable={!browseHeader}
            width={640}
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
        >
            {renderedState && (
                <SubscriptionForm
                    key={renderedState.subscriptionId ?? "new"}
                    subscriptionId={renderedState.subscriptionId}
                    onClose={handleClose}
                />
            )}
        </EnhancedDrawer>
    )
}
