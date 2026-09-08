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
import {useCallback, type ReactNode} from "react"

import {triggerScheduleDrawerAtom} from "@agenta/entities/gatewayTrigger"
import {CONFIG_REGION_BAR, ConfigRowTrailing} from "@agenta/ui/components/presentational"
import {Button, SkeletonBlock} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {SkeletonSectionRow} from "./agentTemplate/AgentConfigSkeleton"
import {countSummary} from "./agentTemplate/agentTemplateUtils"
import {TriggerManagementSection, useAgentTriggers} from "./TriggerManagementSection"

const barClass = (sticky: boolean) =>
    `${CONFIG_REGION_BAR} ${sticky ? "sticky top-0 z-[10]" : ""} bg-[var(--ag-surface-section-header)]`
const titleClass = "text-[13px] font-semibold text-colorText"

/** A region header bar. `children` follow the {@link ConfigRowTrailing} convention. */
export function AgentRegionHeaderBar({
    title,
    sticky = true,
    children,
}: {
    title: ReactNode
    sticky?: boolean
    children?: ReactNode
}) {
    return (
        <div className={barClass(sticky)}>
            <span className={titleClass}>{title}</span>
            {children}
        </div>
    )
}
// Region BODIES are the white sheet the Configuration region's field list already paints
// (`ag-drill-in-field-list`). Without it they'd expose the raised panel tint behind collapsed
// section headers, so Subscriptions/Schedules would not match collapsed Tools/Skills.
const bodyClass = "bg-[var(--ag-surface-section-content)] px-4 pb-3 pt-1"
// Sections-holding body: no vertical padding, so an expanded section's band runs flush into the
// region header above and the next region below instead of leaving white slivers.
const sectionsBodyClass = "bg-[var(--ag-surface-section-content)] px-4"

/**
 * Loading shape for the operational regions, shown while the panel's hydration/agent-ness is
 * still pending: the REAL header bars (their titles are static) over pulsing bodies — so the
 * three-section structure is present from first paint and nothing shifts when data lands.
 */
export function AgentOperationsSkeleton({sticky = true}: {sticky?: boolean}) {
    return (
        <>
            <section className="flex flex-col" aria-busy>
                <AgentRegionHeaderBar title="Automations" sticky={sticky}>
                    <ConfigRowTrailing>
                        <SkeletonBlock active className="h-3.5 w-11 shrink-0" />
                    </ConfigRowTrailing>
                </AgentRegionHeaderBar>
                <div className={`flex flex-col ${bodyClass}`}>
                    <SkeletonSectionRow title={112} value={44} withAdd divider />
                    <SkeletonSectionRow title={82} value={44} withAdd />
                </div>
            </section>
            <section className="flex grow flex-col" aria-busy>
                <AgentRegionHeaderBar title="Files" sticky={sticky}>
                    <ConfigRowTrailing>
                        <SkeletonBlock active className="h-3.5 w-11 shrink-0" />
                    </ConfigRowTrailing>
                </AgentRegionHeaderBar>
                <div className={`flex grow flex-col ${bodyClass}`}>
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
    automationDrawer,
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
     * layer for the same reason as `storage`. Follows the shared `ConfigRowTrailing` convention so
     * its folder glyph lands on the panel's affordance axis. */
    storageHeader?: ReactNode
    /** The automations create/edit drawer, passed down to the Automations section. */
    automationDrawer?: ReactNode
}) {
    const {count: triggerCount, defaultReferences, defaultBoundLabel} = useAgentTriggers(revisionId)
    const openScheduleDrawer = useSetAtom(triggerScheduleDrawerAtom)

    // The region's own "+", now that Subscriptions and Schedules are one list with no headers of
    // their own to hang it from. It opens a schedule-shaped draft; the drawer's own "Runs when"
    // control is where a reader switches it to an event, so there is nothing to choose here.
    const onAdd = useCallback(() => {
        openScheduleDrawer({
            defaultReferences,
            defaultBoundLabel,
            playgroundEntityId: revisionId ?? undefined,
        })
    }, [defaultBoundLabel, defaultReferences, openScheduleDrawer, revisionId])

    return (
        <>
            <section className="flex flex-col">
                <AgentRegionHeaderBar title="Automations" sticky={sticky}>
                    <ConfigRowTrailing>
                        <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                            {countSummary(triggerCount, "automation")}
                        </span>
                        {disabled ? null : (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onAdd}
                                aria-label="Add automation"
                            >
                                <Plus size={16} />
                            </Button>
                        )}
                    </ConfigRowTrailing>
                </AgentRegionHeaderBar>
                <div className={sectionsBodyClass}>
                    <TriggerManagementSection
                        entityId={revisionId}
                        disabled={disabled}
                        automationDrawer={automationDrawer}
                    />
                </div>
            </section>

            {/* Last region: it grows so its white sheet runs to the panel's bottom edge instead of
                stopping at the last file row. */}
            <section className="flex grow flex-col">
                <AgentRegionHeaderBar title="Files" sticky={sticky}>
                    {storageHeader}
                </AgentRegionHeaderBar>
                {/* Files never recolours on expand (unlike Triggers' sections) — it stays a white sheet. */}
                <div className={`flex grow flex-col ${bodyClass}`}>
                    {storage ?? (
                        // Static fallback for surfaces that don't slot the live Files body.
                        <span className="text-xs text-colorTextDescription">
                            The agent&rsquo;s working files — everything it reads and writes during
                            a run. Open a conversation to browse them here; the agent&rsquo;s
                            durable folder appears as a subfolder once agent-level storage lands.
                        </span>
                    )}
                </div>
            </section>
        </>
    )
}
