import {useCallback} from "react"

import {triggerSubscriptionDrawerAtom} from "@agenta/entities/gatewayTrigger"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ArrowLeft} from "@phosphor-icons/react"
import {useAtom, useAtomValue} from "jotai"

import {browseHeaderAtom, SHOW_LIST_RAIL, subscriptionEditingAtom} from "./subscription/constants"
import {SubscriptionDrawerContent} from "./subscription/SubscriptionDrawerContent"
import {SubscriptionForm} from "./subscription/SubscriptionForm"

// ---------------------------------------------------------------------------
// TriggerSubscriptionDrawer (root) — create or edit a provider-event subscription.
//
// Mirrors the schedule drawer: from a playground it's a master-detail manager
// (existing subscriptions on the left, config on the right, a persistent "Run in
// playground" in the footer); from settings it's a single create/edit form.
// EnhancedDrawer renders nothing until first open, so SubscriptionDrawerContent —
// which owns all data fetching + master-detail state — only mounts while open, and
// only in a playground: settings never shows the rail, so it mounts the bare form
// rather than paying for the subscriptions list query and the draft state.
// ---------------------------------------------------------------------------

export default function TriggerSubscriptionDrawer() {
    const [state, setState] = useAtom(triggerSubscriptionDrawerAtom)
    const open = !!state
    const handleClose = useCallback(() => setState(null), [setState])

    const playgroundEntityId = state?.playgroundEntityId
    // Smart header: while the active form is browsing for a source, the header becomes a
    // back affordance + "Choose a trigger"; otherwise it's the form title.
    const browseHeader = useAtomValue(browseHeaderAtom)
    // Editing = opened on a saved id OR the master-detail switched to one (e.g. after create).
    const editing = useAtomValue(subscriptionEditingAtom)
    const formTitle =
        SHOW_LIST_RAIL && playgroundEntityId
            ? "Triggers"
            : state?.subscriptionId || editing
              ? "Edit trigger"
              : "New trigger"
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
        formTitle
    )

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={handleClose}
            title={title}
            closable={!browseHeader}
            width={playgroundEntityId ? 960 : 640}
            closeOnLayoutClick={false}
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
        >
            {state &&
                (playgroundEntityId ? (
                    <SubscriptionDrawerContent
                        state={state}
                        playgroundEntityId={playgroundEntityId}
                        onClose={handleClose}
                    />
                ) : (
                    <SubscriptionForm
                        key={state.subscriptionId ?? "new"}
                        subscriptionId={state.subscriptionId}
                        onClose={handleClose}
                    />
                ))}
        </EnhancedDrawer>
    )
}
