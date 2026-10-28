/**
 * Maps the server's needs-setup requirements onto the config rows. Pure: no hooks, no JSX.
 */
import {
    NEEDS_SETUP_LABEL,
    needsSetupReasonLabel,
    type AgentRequirementItem,
} from "@agenta/entities/workflow"

import type {ItemRowStatus} from "./ItemRow"

/** The row status for an item that needs setup: the tag, and the reason on a second line. */
export const needsSetupStatus = (req: AgentRequirementItem): ItemRowStatus => ({
    tone: "incomplete",
    label: NEEDS_SETUP_LABEL,
    reason: needsSetupReasonLabel(req.reason) ?? undefined,
    needsSetup: true,
})

/** Whether a row status is the needs-setup tag (so a click opens the fix, not the plain editor). */
export const isNeedsSetupStatus = (status: ItemRowStatus | undefined): boolean =>
    status?.needsSetup === true
