/**
 * AgentOperationsSections
 *
 * The agent playground's operational panel regions — Triggers and Storage — rendered as SIBLING
 * sections of the Configuration section, not inside it. Each region carries the same sticky
 * header bar as the panel's "Configuration" header (PlaygroundVariantConfigHeader), so the panel
 * reads as three vertically stacked sections and scrolling swaps the pinned header per region.
 * Operational state never enters the draftable/committable agent config — that's why these live
 * outside {@link AgentTemplateControl}.
 *
 * Naming: "Storage" + "drive" (App drive / Session drive), not "mounts" — a mount is the
 * MECHANISM (geesefs/FUSE mount points); a drive is the thing users have a model for.
 */
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {ChatCircle, HardDrives} from "@phosphor-icons/react"
import {Skeleton, Typography} from "antd"

import {SkeletonSectionRow} from "./agentTemplate/AgentConfigSkeleton"
import {countSummary} from "./agentTemplate/agentTemplateUtils"
import {TriggerManagementSection, useAgentTriggers} from "./TriggerManagementSection"

// A visual copy of the Configuration header bar's classes (PlaygroundVariantConfigHeader) — keep
// the two in sync so the three region headers are indistinguishable.
const barClass = (sticky: boolean) =>
    `h-[48px] flex items-center justify-between overflow-hidden ${
        sticky ? "sticky top-0 z-[10]" : ""
    } w-full border-b border-colorBorderSecondary py-2 px-4 bg-[var(--ag-c-FFFFFF)] bg-[image:linear-gradient(var(--ant-color-fill-tertiary),var(--ant-color-fill-tertiary))]`
const titleClass = "text-[13px] font-semibold text-[var(--ant-color-text)]"

/**
 * Loading shape for the operational regions, shown while the panel's hydration/agent-ness is
 * still pending: the REAL header bars (their titles are static) over pulsing bodies — so the
 * three-section structure is present from first paint and nothing shifts when data lands.
 */
export function AgentOperationsSkeleton({sticky = true}: {sticky?: boolean}) {
    return (
        <>
            <section className="flex w-full flex-col" aria-busy>
                <div className={barClass(sticky)}>
                    <span className={titleClass}>Triggers</span>
                    <Skeleton.Button active size="small" style={{width: 44, height: 14}} />
                </div>
                <div className="flex flex-col px-4">
                    <SkeletonSectionRow title={112} value={44} withAdd divider />
                    <SkeletonSectionRow title={82} value={44} withAdd />
                </div>
            </section>
            <section className="flex w-full flex-col" aria-busy>
                <div className={barClass(sticky)}>
                    <span className={titleClass}>Storage</span>
                    <Skeleton.Button active size="small" style={{width: 44, height: 14}} />
                </div>
                <div className="flex flex-col px-4">
                    <SkeletonSectionRow title={86} value={90} divider />
                    <SkeletonSectionRow title={110} value={110} />
                </div>
            </section>
        </>
    )
}

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
                    <span className={titleClass}>Storage</span>
                </div>
                <div className="flex flex-col px-4 pb-3">
                    {/* App drive: the agent's durable folder (#5215, design PR — not built yet).
                        Wire this section to POST /mounts/agents/query + the mount file browser
                        once slice 1 lands. */}
                    <ConfigAccordionSection
                        icon={<HardDrives size={16} />}
                        title="App drive"
                        summary="Coming soon"
                        defaultOpen={false}
                        animateInitialOpen
                    >
                        <Typography.Text type="secondary" className="text-xs">
                            One durable folder this agent keeps across every conversation — the
                            skills, notes, and artifacts it accumulates. Agent-level storage is in
                            design; its files will be browsable here once it lands.
                        </Typography.Text>
                    </ConfigAccordionSection>
                    <ConfigAccordionSection
                        icon={<ChatCircle size={16} />}
                        title="Session drive"
                        summary="Per conversation"
                        defaultOpen={false}
                        noDivider
                        animateInitialOpen
                    >
                        <Typography.Text type="secondary" className="text-xs">
                            Each conversation gets its own working folder while it runs — the files
                            the agent reads and writes live there. Open a chat and browse them from
                            the session panel beside the transcript.
                        </Typography.Text>
                    </ConfigAccordionSection>
                </div>
            </section>
        </>
    )
}
