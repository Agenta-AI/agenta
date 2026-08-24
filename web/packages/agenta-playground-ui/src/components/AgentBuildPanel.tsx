import {memo, type ReactNode} from "react"

import {
    AgentConfigSkeleton,
    AgentOperationsSections,
    AgentOperationsSkeleton,
    FieldsDetectionProvider,
    PlaygroundConfigSection,
} from "@agenta/entity-ui/drill-in"
import {hasPendingHydrationAtomFamily} from "@agenta/playground"
import {useAtomValue} from "jotai"

/** Stable element: an inline `<AgentConfigSkeleton />` would defeat memo(PlaygroundConfigSection). */
const AGENT_CONFIG_SKELETON = <AgentConfigSkeleton />

/** Stable empty detection value — a fresh object each render changes the context identity. */
const EMPTY_FIELDS_DETECTION = {}

export interface AgentBuildPanelProps {
    /** The revision being configured. Everything else is read off the workflow molecule. */
    revisionId: string
    /** The panel's own header — identity, and the Commit/Deploy actions. */
    header?: ReactNode
    /**
     * The Files region. `AgentOperationsSections` has always taken this as a slot, because the
     * drive listing is the one part of the panel that is still app-layer.
     */
    storage?: ReactNode
    storageHeader?: ReactNode
    /**
     * Sticky section headers clear a sticky panel header above them. Pass 0 where the header
     * scrolls with the content (an embedded drawer, a phone) so they sit flush at the scroll top.
     */
    stickyHeaderTop?: number
    /** Operational section headers stick while their own section scrolls past. */
    sticky?: boolean
    className?: string
}

/**
 * An agent's Build surface: its committable configuration, then the operational sections
 * (Triggers, Subscriptions, Schedules, Files) that are never part of the committed config.
 *
 * One panel for every viewport. The desktop playground and the mobile agent screen render THIS —
 * the config editors, their schema-driven controls and the hydration gates are identical, and
 * what differs (the header's variant picker, where Files comes from) arrives as a slot.
 */
export const AgentBuildPanel = memo(
    ({
        revisionId,
        header,
        storage,
        storageHeader,
        stickyHeaderTop = 48,
        sticky = true,
        className,
    }: AgentBuildPanelProps) => {
        const hasPendingHydration = useAtomValue(hasPendingHydrationAtomFamily(revisionId))

        return (
            <div className={className}>
                <section className="flex flex-col">
                    {header}
                    {hasPendingHydration ? (
                        // The same px-4 pb-3 pt-1 inset the schema-loading gate and the real
                        // agent_config field wrapper use — without it the skeleton renders flush
                        // and its rows jump when the real content lands.
                        <div className="px-4 pb-3 pt-1">
                            <AgentConfigSkeleton />
                        </div>
                    ) : (
                        <FieldsDetectionProvider value={EMPTY_FIELDS_DETECTION}>
                            <PlaygroundConfigSection
                                revisionId={revisionId}
                                stickyHeaderTop={stickyHeaderTop}
                                // Hold the panel's real section-row shape while the schema loads,
                                // instead of the generic prompt-config pulse boxes.
                                loadingFallback={AGENT_CONFIG_SKELETON}
                            />
                        </FieldsDetectionProvider>
                    )}
                </section>

                {/* Triggers and Mounts — operational, never part of the committable config, each
                    with its own Configuration-style sticky header. */}
                {hasPendingHydration ? (
                    <AgentOperationsSkeleton sticky={sticky} />
                ) : (
                    <AgentOperationsSections
                        revisionId={revisionId}
                        sticky={sticky}
                        storage={storage}
                        storageHeader={storageHeader}
                    />
                )}
            </div>
        )
    },
)

AgentBuildPanel.displayName = "AgentBuildPanel"
