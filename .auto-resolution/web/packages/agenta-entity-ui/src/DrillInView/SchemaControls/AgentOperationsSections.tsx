/**
 * AgentOperationsSections
 *
 * The agent playground's operational panel regions — Triggers and Files — rendered as SIBLING
 * sections of the Configuration section, not inside it. Each region carries the same sticky
 * header bar as the panel's "Configuration" header (PlaygroundVariantConfigHeader), so the panel
 * reads as three vertically stacked sections and scrolling swaps the pinned header per region.
 * Operational state never enters the draftable/committable agent config — that's why these live
 * outside {@link AgentTemplateControl}.
 *
 * Naming: "Files", not "Storage"/"mounts" — a mount is the MECHANISM (geesefs/FUSE mount points).
 * The config surface shows one flat file view; the agent's durable folder is a SUBFOLDER of the
 * conversation's working folder, not a separate "App drive" (that split lives only in the drawer).
 */
import {type ReactNode} from "react"

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
                <div className="flex flex-col px-4 pb-3 pt-1">
                    <SkeletonSectionRow title={112} value={44} withAdd divider />
                    <SkeletonSectionRow title={82} value={44} withAdd />
                </div>
            </section>
            <section className="flex w-full flex-col" aria-busy>
                <div className={barClass(sticky)}>
                    <span className={titleClass}>Files</span>
                    <Skeleton.Button active size="small" style={{width: 44, height: 14}} />
                </div>
                <div className="flex flex-col px-4 pb-3 pt-1">
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
    storage,
    storageHeader,
}: {
    /** The open agent's revision id (the playground's variantId). */
    revisionId: string | null
    disabled?: boolean
    /** Non-sticky headers for embedded (drawer) surfaces, matching the embedded config header. */
    sticky?: boolean
    /** The Files region body (the flat file listing), slotted in by the app layer — it owns the
     * chat session state this package can't reach. Absent → static placeholder. */
    storage?: ReactNode
    /** Right-side content of the Files header bar (file count + browse entry), slotted by the app
     * layer for the same reason as `storage`. Matches the Triggers header's count slot. */
    storageHeader?: ReactNode
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
                <div className="px-4 pb-3 pt-1">
                    <TriggerManagementSection entityId={revisionId} disabled={disabled} />
                </div>
            </section>

            <section className="flex w-full flex-col">
                <div className={barClass(sticky)}>
                    <span className={titleClass}>Files</span>
                    {storageHeader}
                </div>
                <div className="flex flex-col px-4 pb-3 pt-1">
                    {storage ?? (
                        // Static fallback for surfaces that don't slot the live Files body.
                        <Typography.Text type="secondary" className="text-xs">
                            The agent&rsquo;s working files — everything it reads and writes during
                            a run. Open a conversation to browse them here; the agent&rsquo;s
                            durable folder appears as a subfolder once agent-level storage lands.
                        </Typography.Text>
                    )}
                </div>
            </section>
        </>
    )
}
