/**
 * Maps the server's needs-setup requirements onto the config rows. Pure: no hooks, no JSX.
 */
import type {AgentRequirementItem} from "@agenta/entities/workflow"

import type {ItemRowStatus} from "./ItemRow"
import {needsSetupLabel, needsSetupReasonText} from "./needsSetupText"

/** The row status for an item that needs setup: the tag, and the reason on a second line. */
export const needsSetupStatus = (req: AgentRequirementItem): ItemRowStatus => ({
    tone: "incomplete",
    label: needsSetupLabel(),
    reason: needsSetupReasonText(req.reason) ?? undefined,
    needsSetup: true,
})
