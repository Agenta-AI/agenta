/**
 * AgentOperationsSections
 *
 * The agent playground's operational panel regions — Triggers and Mounts — rendered as SIBLING
 * sections of the Configuration section, not inside it. Each region carries the same sticky
 * header bar as the panel's "Configuration" header (PlaygroundVariantConfigHeader), so the panel
 * reads as three vertically stacked sections and scrolling swaps the pinned header per region.
 * Operational state never enters the draftable/committable agent config — that's why these live
 * outside {@link AgentTemplateControl}.
 */
import {Typography} from "antd"

import {countSummary} from "./agentTemplate/agentTemplateUtils"
import {TriggerManagementSection, useAgentTriggers} from "./TriggerManagementSection"

// A visual copy of the Configuration header bar's classes (PlaygroundVariantConfigHeader) — keep
// the two in sync so the three region headers are indistinguishable.
const barClass = (sticky: boolean) =>
    `h-[48px] flex items-center justify-between overflow-hidden ${
        sticky ? "sticky top-0 z-[10]" : ""
    } w-full border-b border-colorBorderSecondary py-2 px-4 bg-[var(--ag-c-FFFFFF)] bg-[image:linear-gradient(var(--ant-color-fill-tertiary),var(--ant-color-fill-tertiary))]`
const titleClass = "text-[13px] font-semibold text-[var(--ant-color-text)]"

export function AgentOperationsSections({
    revisionId,
    disabled,
    sticky = true,
}: {
    /** The open agent's revision id (the playground's variantId). */
    revisionId: string | null
    disabled?: boolean
    /** Non-sticky headers for embedded (drawer) surfaces, matching the embedded config header. */
    sticky?: boolean
}) {
    const {count: triggerCount} = useAgentTriggers(revisionId)

    return (
        <>
            <section className="flex w-full flex-col">
                <div className={barClass(sticky)}>
                    <span className={titleClass}>Triggers</span>
                    <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                        {countSummary(triggerCount, "trigger")}
                    </span>
                </div>
                <div className="px-4 py-3">
                    <TriggerManagementSection entityId={revisionId} disabled={disabled} />
                </div>
            </section>

            <section className="flex w-full flex-col">
                <div className={barClass(sticky)}>
                    <span className={titleClass}>Mounts</span>
                    <span className="text-xs text-[var(--ag-colorTextTertiary)]">Coming soon</span>
                </div>
                {/* STUB: agent-scoped (artifact-level) mounts don't exist yet (#5215) — placeholder
                    for the agent's durable workspace. A conversation's live files are in the
                    session panel beside the chat. */}
                <div className="px-4 py-3">
                    <Typography.Text type="secondary" className="text-xs">
                        The agent&rsquo;s durable workspace — the memory and artifacts it
                        accumulates across runs — will live here once agent-level mounts land. A
                        conversation&rsquo;s live files are available in the session panel beside
                        the chat.
                    </Typography.Text>
                </div>
            </section>
        </>
    )
}
